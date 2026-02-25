module ant_core::shipment {
    use iota::object::{Self, UID, ID};
    use iota::tx_context::{Self, TxContext};
    use iota::transfer;
    use std::vector;
    use ant_core::errors;

    // status constants
    public const STATUS_CREATED: u8 = 0;
    public const STATUS_IN_TRANSIT: u8 = 1;
    public const STATUS_PENDING: u8 = 2;
    public const STATUS_DELIVERED: u8 = 3;
    public const STATUS_DISPUTE: u8 = 4;

    /// Shared on-chain state: minimal, commodity-agnostic
    public struct Shipment has key, store {
        id: UID,
        shipment_code: vector<u8>,        // "ANT-8F2A"
        status: u8,
        current_custodian: address,
        expected_receiver: address,       // set when pending
        last_event_hash: vector<u8>,      // 32 bytes expected (sha256)
        last_notarization_id: vector<u8>, // bytes (opaque id representation)
        seq: u64,
        pending_since_ms: u64,
    }

    /// Create (owned). Caller can read ID then share.
    public fun new_shipment(
        shipment_code: vector<u8>,
        initial_custodian: address,
        ctx: &mut TxContext
    ): Shipment {
        Shipment {
            id: object::new(ctx),
            shipment_code,
            status: STATUS_CREATED,
            current_custodian: initial_custodian,
            expected_receiver: @0x0,
            last_event_hash: vector::empty<u8>(),
            last_notarization_id: vector::empty<u8>(),
            seq: 0,
            pending_since_ms: 0,
        }
    }

    /// Share as mutable shared object (IOTA convention: provide create + share separately)
    public fun share(shipment: Shipment) {
        transfer::share_object(shipment)
    }

    /// Sender signs "handover OUT": sets Pending until receiver confirms.
    public entry fun handover_out(
        shipment: &mut Shipment,
        receiver: address,
        out_event_hash: vector<u8>,
        out_notarization_id: vector<u8>,
        now_ms: u64,
        ctx: &mut TxContext
    ) {
        let sender = tx_context::sender(ctx);

        assert!(shipment.status != STATUS_DELIVERED, errors::E_ALREADY_DELIVERED);
        assert!(sender == shipment.current_custodian, errors::E_NOT_CUSTODIAN);

        // hash length check (sha256 bytes)
        assert!(vector::length(&out_event_hash) == 32, errors::E_BAD_HASH_LEN);
        // notarization id length: keep loose, but avoid empty
        assert!(vector::length(&out_notarization_id) > 0, errors::E_BAD_NOTAR_ID_LEN);

        shipment.status = STATUS_PENDING;
        shipment.expected_receiver = receiver;
        shipment.last_event_hash = out_event_hash;
        shipment.last_notarization_id = out_notarization_id;
        shipment.pending_since_ms = now_ms;
        shipment.seq = shipment.seq + 1;
    }

    /// Receiver confirms "handover IN": closes pending and transfers custody.
    public entry fun handover_in_confirm(
        shipment: &mut Shipment,
        in_event_hash: vector<u8>,
        in_notarization_id: vector<u8>,
        now_ms: u64,
        ctx: &mut TxContext
    ) {
        let sender = tx_context::sender(ctx);

        assert!(shipment.status == STATUS_PENDING, errors::E_NOT_PENDING);
        assert!(sender == shipment.expected_receiver, errors::E_WRONG_RECEIVER);

        assert!(vector::length(&in_event_hash) == 32, errors::E_BAD_HASH_LEN);
        assert!(vector::length(&in_notarization_id) > 0, errors::E_BAD_NOTAR_ID_LEN);

        shipment.current_custodian = sender;
        shipment.expected_receiver = @0x0;
        shipment.status = STATUS_IN_TRANSIT;

        shipment.last_event_hash = in_event_hash;
        shipment.last_notarization_id = in_notarization_id;
        shipment.pending_since_ms = now_ms; // keep last change time
        shipment.seq = shipment.seq + 1;
    }

    /// Optional: mark delivered by current custodian
    public entry fun mark_delivered(
        shipment: &mut Shipment,
        delivered_event_hash: vector<u8>,
        delivered_notarization_id: vector<u8>,
        now_ms: u64,
        ctx: &mut TxContext
    ) {
        let sender = tx_context::sender(ctx);

        assert!(sender == shipment.current_custodian, errors::E_NOT_CUSTODIAN);
        assert!(shipment.status == STATUS_IN_TRANSIT || shipment.status == STATUS_CREATED, errors::E_BAD_STATUS);

        assert!(vector::length(&delivered_event_hash) == 32, errors::E_BAD_HASH_LEN);
        assert!(vector::length(&delivered_notarization_id) > 0, errors::E_BAD_NOTAR_ID_LEN);

        shipment.status = STATUS_DELIVERED;
        shipment.last_event_hash = delivered_event_hash;
        shipment.last_notarization_id = delivered_notarization_id;
        shipment.pending_since_ms = now_ms;
        shipment.seq = shipment.seq + 1;
    }

    // View helpers
    public fun status(shipment: &Shipment): u8 { shipment.status }
    public fun custodian(shipment: &Shipment): address { shipment.current_custodian }
    public fun expected_receiver(shipment: &Shipment): address { shipment.expected_receiver }
    public fun seq(shipment: &Shipment): u64 { shipment.seq }
    public fun shipment_code(shipment: &Shipment): vector<u8> { shipment.shipment_code }
}
