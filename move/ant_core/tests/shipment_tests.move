#[test_only]
module ant_core::shipment_tests {
    use iota::test_scenario;
    use ant_core::shipment;
    use ant_core::errors;
    use std::vector;

    fun h32(): vector<u8> {
        // 32 bytes dummy hash
        vector[0u8,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1]
    }

    fun notar_id(): vector<u8> { vector[1u8,2,3] }

    #[test]
    fun happy_path_out_in() {
        let carrier: address = @0xA;
        let receiver: address = @0xB;

        let mut sc = test_scenario::begin(carrier);

        // Tx1: create + share
        {
            let mut ctx = test_scenario::ctx(&mut sc);
            let s = shipment::new_shipment(b"ANT-TEST", carrier, &mut ctx);
            shipment::share(s);
        };

        // end tx1, start tx2 as carrier
        test_scenario::next_tx(&mut sc, carrier);

        // take shared shipment
        let mut sh: shipment::Shipment = test_scenario::take_shared(&sc);

        // OUT by carrier
        {
            let mut ctx = test_scenario::ctx(&mut sc);
            shipment::handover_out(&mut sh, receiver, h32(), notar_id(), 1000, &mut ctx);
        };

        // return shared object
        test_scenario::return_shared(sh);

        // tx3 as receiver confirms IN
        test_scenario::next_tx(&mut sc, receiver);

        let mut sh2: shipment::Shipment = test_scenario::take_shared(&sc);
        {
            let mut ctx = test_scenario::ctx(&mut sc);
            shipment::handover_in_confirm(&mut sh2, h32(), notar_id(), 2000, &mut ctx);
        };
        test_scenario::return_shared(sh2);

        test_scenario::end(sc);
    }

    #[test]
    #[expected_failure(abort_code = errors::E_NOT_CUSTODIAN)]
    fun out_fails_if_not_custodian() {
        let carrier: address = @0xA;
        let attacker: address = @0xC;
        let receiver: address = @0xB;

        let mut sc = test_scenario::begin(carrier);
        {
            let mut ctx = test_scenario::ctx(&mut sc);
            let s = shipment::new_shipment(b"ANT-TEST2", carrier, &mut ctx);
            shipment::share(s);
        };
        test_scenario::next_tx(&mut sc, attacker);

        let mut sh: shipment::Shipment = test_scenario::take_shared(&sc);
        {
            let mut ctx = test_scenario::ctx(&mut sc);
            shipment::handover_out(&mut sh, receiver, h32(), notar_id(), 1000, &mut ctx);
        };
    }

    #[test]
    #[expected_failure(abort_code = errors::E_WRONG_RECEIVER)]
    fun in_fails_if_wrong_receiver() {
        let carrier: address = @0xA;
        let receiver: address = @0xB;
        let wrong: address = @0xD;

        let mut sc = test_scenario::begin(carrier);
        {
            let mut ctx = test_scenario::ctx(&mut sc);
            let s = shipment::new_shipment(b"ANT-TEST3", carrier, &mut ctx);
            shipment::share(s);
        };
        test_scenario::next_tx(&mut sc, carrier);
        let mut sh: shipment::Shipment = test_scenario::take_shared(&sc);
        {
            let mut ctx = test_scenario::ctx(&mut sc);
            shipment::handover_out(&mut sh, receiver, h32(), notar_id(), 1000, &mut ctx);
        };
        test_scenario::return_shared(sh);

        test_scenario::next_tx(&mut sc, wrong);
        let mut sh2: shipment::Shipment = test_scenario::take_shared(&sc);
        {
            let mut ctx = test_scenario::ctx(&mut sc);
            shipment::handover_in_confirm(&mut sh2, h32(), notar_id(), 2000, &mut ctx);
        };
    }
}
