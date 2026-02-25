import "dotenv/config";
import { randomUUID } from "node:crypto";
import { Pool, type PoolClient } from "pg";
import {
  ANT_DEMO_MULTI_ENTITY_TENANT_ID,
  CBV_BIZSTEP,
  CBV_DISPOSITION,
  EpcisEventSchema,
  type EpcisEvent,
} from "@ant/shared";
import { sha256Hex } from "@ant/shared/node";

type ShipmentStatus = "CREATED" | "IN_TRANSIT" | "PENDING_RECEIVER" | "DELIVERED" | "DISPUTE";

interface SeedShipmentInput {
  shipmentCode: string;
  trackingId: string;
  status: ShipmentStatus;
  maxDelayHours: number;
  conditions?: Record<string, unknown> | null;
  currentCustodianDid: string | null;
  expectedReceiverDid: string | null;
}

interface InsertedShipment {
  id: string;
  shipmentCode: string;
}

interface SeedEventInput {
  shipmentId: string;
  payload: EpcisEvent;
  previousEventId?: string | null;
  proofStatus?: "OK" | "PENDING" | "MISSING" | "MISMATCH";
  anchoredHashMode?: "MATCH" | "MISMATCH";
}

// Keep demo dashboard data visible to the mock Carrier/Receiver/Supervisor/Auditor profiles.
// Can be overridden for ad-hoc local tests.
const DEMO_TENANT_ID = process.env.SEED_DEMO_TENANT_ID ?? ANT_DEMO_MULTI_ENTITY_TENANT_ID;

function assertDevelopment() {
  const runtime = process.env.APP_RUNTIME ?? "development";
  if (runtime !== "development") {
    throw new Error(`Refusing to seed demo data because APP_RUNTIME=${runtime}`);
  }
}

function createPool() {
  return new Pool({
    connectionString: process.env.DATABASE_URL,
    host: process.env.PGHOST,
    port: process.env.PGPORT ? Number(process.env.PGPORT) : undefined,
    user: process.env.PGUSER,
    password: process.env.PGPASSWORD,
    database: process.env.PGDATABASE,
    ssl:
      process.env.PGSSL === "true" || process.env.PGSSL === "1"
        ? { rejectUnauthorized: false }
        : undefined,
  });
}

function isoMinutesAgo(minutesAgo: number): string {
  return new Date(Date.now() - minutesAgo * 60_000).toISOString();
}

function objectEvent(input: {
  eventTime: string;
  action: "ADD" | "OBSERVE" | "DELETE";
  bizStep: string;
  disposition: string;
  readPoint: string;
  bizLocation: string;
  epcList?: string[];
  quantityList?: Array<{ epcClass: string; quantity: number; uom?: string }>;
  ilmd?: Record<string, unknown>;
  sourceList?: Array<{ type: string; source: string }>;
  destinationList?: Array<{ type: string; destination: string }>;
  extensions?: Record<string, unknown>;
}): EpcisEvent {
  return EpcisEventSchema.parse({
    type: "ObjectEvent",
    eventTime: input.eventTime,
    eventTimeZoneOffset: "+00:00",
    action: input.action,
    bizStep: input.bizStep,
    disposition: input.disposition,
    readPoint: { id: input.readPoint },
    bizLocation: { id: input.bizLocation },
    ...(input.epcList ? { epcList: input.epcList } : {}),
    ...(input.quantityList ? { quantityList: input.quantityList } : {}),
    ...(input.ilmd ? { ilmd: input.ilmd } : {}),
    ...(input.sourceList ? { sourceList: input.sourceList } : {}),
    ...(input.destinationList ? { destinationList: input.destinationList } : {}),
    ...(input.extensions ? { extensions: input.extensions } : {}),
  });
}

async function insertShipment(client: PoolClient, input: SeedShipmentInput): Promise<InsertedShipment> {
  const { rows } = await client.query<{ id: string; shipment_code: string }>(
    `
    insert into shipments (
      tenant_id, shipment_code, tracking_unit_type, tracking_id, epc_class, lot_number,
      origin_read_point, origin_biz_location, destination_read_point, destination_biz_location,
      sla_hours, max_delay_hours, conditions,
      producer_did, carrier_did, receiver_did,
      move_object_id, move_version,
      status, current_custodian_did, expected_receiver_did
    ) values (
      $1,$2,'LOGISTIC_UNIT',$3,null,null,
      'urn:epc:id:sgln:9521141.54321.0','urn:epc:id:sgln:9521141.54377.0',
      'urn:epc:id:sgln:9521141.11111.0','urn:epc:id:sgln:9521141.11111.0',
      24,$4,$5::jsonb,
      'did:iota:producer-demo','did:iota:carrier-demo','did:iota:receiver-demo',
      $6,1,
      $7,$8,$9
    )
    returning id, shipment_code
    `,
    [
      DEMO_TENANT_ID,
      input.shipmentCode,
      input.trackingId,
      input.maxDelayHours,
      input.conditions ? JSON.stringify(input.conditions) : null,
      `0x${randomUUID().replace(/-/g, "")}`,
      input.status,
      input.currentCustodianDid,
      input.expectedReceiverDid,
    ],
  );

  return {
    id: rows[0].id,
    shipmentCode: rows[0].shipment_code,
  };
}

async function insertAttachment(
  client: PoolClient,
  epcisEventId: string,
  sha256: string,
  type = "PHOTO_SEAL",
) {
  await client.query(
    `
    insert into attachments (
      tenant_id, epcis_event_id, type, object_store_key, sha256, mime, size_bytes
    ) values (
      $1, $2, $3, $4, $5, 'image/jpeg', 123456
    )
    `,
    [DEMO_TENANT_ID, epcisEventId, type, `dev-seed/${sha256}.jpg`, sha256],
  );
}

async function insertEvent(client: PoolClient, input: SeedEventInput): Promise<{ eventId: string; payloadHash: string }> {
  const payload = EpcisEventSchema.parse(input.payload);
  const payloadHash = sha256Hex(payload);

  const isObjectEvent = payload.type === "ObjectEvent";
  const isAggregationEvent = payload.type === "AggregationEvent";

  const { rows } = await client.query<{ id: string }>(
    `
    insert into epcis_events (
      tenant_id, shipment_id, type, event_time, event_time_zone_offset, record_time,
      action, biz_step, disposition, read_point, biz_location,
      epc_list, quantity_list, parent_id, child_epcs, child_quantity_list,
      payload, payload_hash, previous_event_id
    ) values (
      $1, $2, $3, $4::timestamptz, $5, $6::timestamptz,
      $7, $8, $9, $10, $11,
      $12, $13::jsonb, $14, $15, $16::jsonb,
      $17::jsonb, $18, $19
    )
    returning id
    `,
    [
      DEMO_TENANT_ID,
      input.shipmentId,
      payload.type,
      payload.eventTime,
      payload.eventTimeZoneOffset,
      null,
      payload.action,
      payload.bizStep,
      payload.disposition,
      payload.readPoint.id,
      payload.bizLocation.id,
      isObjectEvent ? (payload.epcList ?? null) : null,
      isObjectEvent && payload.quantityList ? JSON.stringify(payload.quantityList) : null,
      isAggregationEvent ? payload.parentID : null,
      isAggregationEvent ? (payload.childEPCs ?? null) : null,
      isAggregationEvent && payload.childQuantityList ? JSON.stringify(payload.childQuantityList) : null,
      JSON.stringify(payload),
      payloadHash,
      input.previousEventId ?? null,
    ],
  );

  const eventId = rows[0].id;
  const proofStatus = input.proofStatus ?? "OK";

  if (proofStatus !== "MISSING") {
    const anchoredHash =
      (input.anchoredHashMode ?? "MATCH") === "MISMATCH"
        ? `deadbeef${payloadHash.slice(8)}`
        : payloadHash;
    const verifyStatus = proofStatus === "MISMATCH" ? "MISMATCH" : proofStatus;

    await client.query(
      `
      insert into proofs (
        epcis_event_id, method, notarization_object_id, tx_digest,
        anchored_hash, anchored_at, verify_status, checked_at
      ) values (
        $1, 'LOCKED', $2, $3,
        $4, $5::timestamptz, $6, $5::timestamptz
      )
      `,
      [
        eventId,
        `notar-${randomUUID()}`,
        `tx-${randomUUID()}`,
        anchoredHash,
        new Date(new Date(payload.eventTime).getTime() + 15_000).toISOString(),
        verifyStatus,
      ],
    );
  }

  return { eventId, payloadHash };
}

async function seedOkShipment(client: PoolClient): Promise<string> {
  const code = "ANT-DEMO-OK1";
  const shipment = await insertShipment(client, {
    shipmentCode: code,
    trackingId: "urn:epc:id:sscc:1234567.0000000101",
    status: "IN_TRANSIT",
    maxDelayHours: 6,
    currentCustodianDid: "did:iota:receiver-demo",
    expectedReceiverDid: null,
  });

  await insertEvent(client, {
    shipmentId: shipment.id,
    payload: objectEvent({
      eventTime: isoMinutesAgo(180),
      action: "ADD",
      bizStep: CBV_BIZSTEP.COMMISSIONING,
      disposition: CBV_DISPOSITION.ACTIVE,
      readPoint: "urn:epc:id:sgln:9521141.54321.0",
      bizLocation: "urn:epc:id:sgln:9521141.54377.0",
      epcList: ["urn:epc:id:sscc:1234567.0000000101"],
      extensions: {
        ant: {
          shipmentCode: code,
          actorDid: "did:iota:producer-demo",
          stage: "commissioning",
          attachments: [],
        },
      },
    }),
  });

  const out = await insertEvent(client, {
    shipmentId: shipment.id,
    payload: objectEvent({
      eventTime: isoMinutesAgo(120),
      action: "OBSERVE",
      bizStep: CBV_BIZSTEP.SHIPPING,
      disposition: CBV_DISPOSITION.IN_TRANSIT,
      readPoint: "urn:epc:id:sgln:9521141.54321.0",
      bizLocation: "urn:epc:id:sgln:9521141.54377.0",
      epcList: ["urn:epc:id:sscc:1234567.0000000101"],
      sourceList: [
        { type: "urn:epcglobal:cbv:sdt:owning_party", source: "did:iota:carrier-demo" },
      ],
      destinationList: [
        {
          type: "urn:epcglobal:cbv:sdt:owning_party",
          destination: "did:iota:receiver-demo",
        },
      ],
      extensions: {
        ant: {
          shipmentCode: code,
          handover: "OUT",
          actorDid: "did:iota:carrier-demo",
          attachments: [],
        },
      },
    }),
  });

  const sealHash = sha256Hex({ file: "demo-seal-photo-ok1", shipmentCode: code });
  const receiving = await insertEvent(client, {
    shipmentId: shipment.id,
    previousEventId: out.eventId,
    payload: objectEvent({
      eventTime: isoMinutesAgo(90),
      action: "OBSERVE",
      bizStep: CBV_BIZSTEP.RECEIVING,
      disposition: CBV_DISPOSITION.IN_PROGRESS,
      readPoint: "urn:epc:id:sgln:9521141.11111.0",
      bizLocation: "urn:epc:id:sgln:9521141.11111.0",
      epcList: ["urn:epc:id:sscc:1234567.0000000101"],
      extensions: {
        ant: {
          shipmentCode: code,
          handover: "IN",
          actorDid: "did:iota:receiver-demo",
          confirmsOutEventId: out.eventId,
          attachments: [sealHash],
        },
      },
    }),
  });

  await insertAttachment(client, receiving.eventId, sealHash);
  return code;
}

async function seedPendingShipment(client: PoolClient): Promise<string> {
  const code = "ANT-DEMO-PEND1";
  const shipment = await insertShipment(client, {
    shipmentCode: code,
    trackingId: "urn:epc:id:sscc:1234567.0000000201",
    status: "PENDING_RECEIVER",
    maxDelayHours: 6,
    currentCustodianDid: "did:iota:carrier-demo",
    expectedReceiverDid: "did:iota:receiver-demo",
  });

  await insertEvent(client, {
    shipmentId: shipment.id,
    payload: objectEvent({
      eventTime: isoMinutesAgo(40),
      action: "OBSERVE",
      bizStep: CBV_BIZSTEP.SHIPPING,
      disposition: CBV_DISPOSITION.IN_TRANSIT,
      readPoint: "urn:epc:id:sgln:9521141.54321.0",
      bizLocation: "urn:epc:id:sgln:9521141.54377.0",
      epcList: ["urn:epc:id:sscc:1234567.0000000201"],
      extensions: {
        ant: {
          shipmentCode: code,
          handover: "OUT",
          actorDid: "did:iota:carrier-demo",
          attachments: [],
        },
      },
    }),
  });

  return code;
}

async function seedSlaShipment(client: PoolClient): Promise<string> {
  const code = "ANT-DEMO-SLA1";
  const shipment = await insertShipment(client, {
    shipmentCode: code,
    trackingId: "urn:epc:id:sscc:1234567.0000000301",
    status: "IN_TRANSIT",
    maxDelayHours: 1,
    currentCustodianDid: "did:iota:carrier-demo",
    expectedReceiverDid: null,
  });

  await insertEvent(client, {
    shipmentId: shipment.id,
    payload: objectEvent({
      eventTime: isoMinutesAgo(190),
      action: "OBSERVE",
      bizStep: CBV_BIZSTEP.SHIPPING,
      disposition: CBV_DISPOSITION.IN_TRANSIT,
      readPoint: "urn:epc:id:sgln:9521141.54321.0",
      bizLocation: "urn:epc:id:sgln:9521141.54377.0",
      epcList: ["urn:epc:id:sscc:1234567.0000000301"],
      extensions: {
        ant: {
          shipmentCode: code,
          handover: "OUT",
          actorDid: "did:iota:carrier-demo",
          attachments: [],
        },
      },
    }),
  });

  return code;
}

async function seedSealViolationShipment(client: PoolClient): Promise<string> {
  const code = "ANT-DEMO-SEAL1";
  const shipment = await insertShipment(client, {
    shipmentCode: code,
    trackingId: "urn:epc:id:sscc:1234567.0000000401",
    status: "IN_TRANSIT",
    maxDelayHours: 6,
    conditions: { sealRequired: true },
    currentCustodianDid: "did:iota:receiver-demo",
    expectedReceiverDid: null,
  });

  await insertEvent(client, {
    shipmentId: shipment.id,
    payload: objectEvent({
      eventTime: isoMinutesAgo(20),
      action: "OBSERVE",
      bizStep: CBV_BIZSTEP.RECEIVING,
      disposition: CBV_DISPOSITION.IN_PROGRESS,
      readPoint: "urn:epc:id:sgln:9521141.11111.0",
      bizLocation: "urn:epc:id:sgln:9521141.11111.0",
      epcList: ["urn:epc:id:sscc:1234567.0000000401"],
      extensions: {
        ant: {
          shipmentCode: code,
          handover: "IN",
          actorDid: "did:iota:receiver-demo",
          attachments: [],
        },
      },
    }),
  });

  return code;
}

async function seedProofMismatchShipment(client: PoolClient): Promise<string> {
  const code = "ANT-DEMO-MISMATCH1";
  const shipment = await insertShipment(client, {
    shipmentCode: code,
    trackingId: "urn:epc:id:sscc:1234567.0000000501",
    status: "IN_TRANSIT",
    maxDelayHours: 6,
    currentCustodianDid: "did:iota:receiver-demo",
    expectedReceiverDid: null,
  });

  const out = await insertEvent(client, {
    shipmentId: shipment.id,
    payload: objectEvent({
      eventTime: isoMinutesAgo(70),
      action: "OBSERVE",
      bizStep: CBV_BIZSTEP.SHIPPING,
      disposition: CBV_DISPOSITION.IN_TRANSIT,
      readPoint: "urn:epc:id:sgln:9521141.54321.0",
      bizLocation: "urn:epc:id:sgln:9521141.54377.0",
      epcList: ["urn:epc:id:sscc:1234567.0000000501"],
      extensions: {
        ant: {
          shipmentCode: code,
          handover: "OUT",
          actorDid: "did:iota:carrier-demo",
          attachments: [],
        },
      },
    }),
    proofStatus: "OK",
  });

  await insertEvent(client, {
    shipmentId: shipment.id,
    previousEventId: out.eventId,
    payload: objectEvent({
      eventTime: isoMinutesAgo(50),
      action: "OBSERVE",
      bizStep: CBV_BIZSTEP.RECEIVING,
      disposition: CBV_DISPOSITION.IN_PROGRESS,
      readPoint: "urn:epc:id:sgln:9521141.11111.0",
      bizLocation: "urn:epc:id:sgln:9521141.11111.0",
      epcList: ["urn:epc:id:sscc:1234567.0000000501"],
      extensions: {
        ant: {
          shipmentCode: code,
          handover: "IN",
          actorDid: "did:iota:receiver-demo",
          confirmsOutEventId: out.eventId,
          attachments: [],
        },
      },
    }),
    proofStatus: "MISMATCH",
    anchoredHashMode: "MISMATCH",
  });

  return code;
}

async function main() {
  assertDevelopment();
  const pool = createPool();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(`set local ant.allow_audit_log_mutation = 'on'`);
    await client.query(`delete from shipments where shipment_code like 'ANT-DEMO-%'`);

    const seededCodes = [
      await seedOkShipment(client),
      await seedPendingShipment(client),
      await seedSlaShipment(client),
      await seedSealViolationShipment(client),
      await seedProofMismatchShipment(client),
    ];

    await client.query("COMMIT");

    console.log("Seed completed (development dashboard dataset)");
    for (const code of seededCodes) {
      console.log(`- ${code}`);
    }
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
