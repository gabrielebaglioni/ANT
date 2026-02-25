BEGIN;

-- Optional (UUID helper)
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Enums
DO $$ BEGIN
  CREATE TYPE shipment_status AS ENUM ('CREATED','IN_TRANSIT','PENDING_RECEIVER','DELIVERED','DISPUTE');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE epcis_event_type AS ENUM ('ObjectEvent','AggregationEvent','TransformationEvent','TransactionEvent');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE outbox_status AS ENUM ('PENDING','DONE','FAILED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE outbox_kind AS ENUM ('NOTARIZE_EVENT','MOVE_UPDATE');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Shipments
CREATE TABLE IF NOT EXISTS shipments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shipment_code text NOT NULL UNIQUE,              -- e.g. ANT-8F2A

  -- commodity-agnostic WHAT correlation (used to build EPCIS WHAT)
  tracking_unit_type text NOT NULL CHECK (tracking_unit_type IN ('LOGISTIC_UNIT','LOT','ITEM')),
  tracking_id text NOT NULL,                       -- SSCC / lot key / serial key
  epc_class text NULL,                             -- for LOT quantityList (class-level)
  lot_number text NULL,

  -- WHERE defaults (can be overridden per event)
  origin_read_point text NULL,
  origin_biz_location text NULL,
  destination_read_point text NULL,
  destination_biz_location text NULL,

  -- SLA / conditions
  sla_hours int NOT NULL DEFAULT 24,
  max_delay_hours int NOT NULL DEFAULT 6,
  conditions jsonb NULL,

  -- participants (Identity)
  producer_did text NOT NULL,
  carrier_did text NOT NULL,
  receiver_did text NOT NULL,

  -- on-chain pointers (Move)
  move_object_id text NULL,
  move_version bigint NULL,

  status shipment_status NOT NULL DEFAULT 'CREATED',
  current_custodian_did text NULL,
  expected_receiver_did text NULL,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_shipments_status ON shipments(status);
CREATE INDEX IF NOT EXISTS idx_shipments_custodian ON shipments(current_custodian_did);

-- EPCIS Events Store (IBM Food Trust style: event-first)
CREATE TABLE IF NOT EXISTS epcis_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shipment_id uuid NOT NULL REFERENCES shipments(id) ON DELETE CASCADE,

  type epcis_event_type NOT NULL,
  event_time timestamptz NOT NULL,
  event_time_zone_offset text NOT NULL,
  record_time timestamptz NULL,

  action text NOT NULL CHECK (action IN ('ADD','OBSERVE','DELETE')),
  biz_step text NOT NULL,
  disposition text NOT NULL,

  read_point text NOT NULL,
  biz_location text NOT NULL,

  -- WHAT for ObjectEvent
  epc_list text[] NULL,
  quantity_list jsonb NULL,

  -- WHAT for AggregationEvent
  parent_id text NULL,
  child_epcs text[] NULL,
  child_quantity_list jsonb NULL,

  -- EPCIS payload full + deterministic hash
  payload jsonb NOT NULL,
  payload_hash char(64) NOT NULL,

  -- optional link to previous event (e.g., handover IN confirms OUT)
  previous_event_id uuid NULL REFERENCES epcis_events(id) ON DELETE SET NULL,

  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_events_shipment_time ON epcis_events(shipment_id, event_time);
CREATE INDEX IF NOT EXISTS idx_events_biz_step ON epcis_events(biz_step);
CREATE INDEX IF NOT EXISTS idx_events_read_point ON epcis_events(read_point);
CREATE INDEX IF NOT EXISTS idx_events_hash ON epcis_events(payload_hash);

-- Proofs (IOTA Notarization references)
CREATE TABLE IF NOT EXISTS proofs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  epcis_event_id uuid NOT NULL UNIQUE REFERENCES epcis_events(id) ON DELETE CASCADE,

  method text NOT NULL CHECK (method IN ('LOCKED','DYNAMIC')),
  notarization_object_id text NOT NULL,
  tx_digest text NOT NULL,

  anchored_hash char(64) NOT NULL,
  anchored_at timestamptz NULL,

  verify_status text NOT NULL DEFAULT 'PENDING' CHECK (verify_status IN ('PENDING','OK','MISMATCH','MISSING')),
  checked_at timestamptz NULL
);

CREATE INDEX IF NOT EXISTS idx_proofs_notarization ON proofs(notarization_object_id);

-- Attachments (optional)
CREATE TABLE IF NOT EXISTS attachments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  epcis_event_id uuid NOT NULL REFERENCES epcis_events(id) ON DELETE CASCADE,

  type text NOT NULL, -- PHOTO_SEAL, PDF_DOC, SENSOR_FILE, ...
  object_store_key text NOT NULL,
  sha256 char(64) NOT NULL,
  mime text NULL,
  size_bytes bigint NULL,

  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_attachments_event ON attachments(epcis_event_id);
CREATE INDEX IF NOT EXISTS idx_attachments_sha ON attachments(sha256);

-- Outbox jobs
CREATE TABLE IF NOT EXISTS outbox_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind outbox_kind NOT NULL,
  status outbox_status NOT NULL DEFAULT 'PENDING',

  shipment_id uuid NOT NULL REFERENCES shipments(id) ON DELETE CASCADE,
  epcis_event_id uuid NULL REFERENCES epcis_events(id) ON DELETE CASCADE,

  attempts int NOT NULL DEFAULT 0,
  last_error text NULL,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_outbox_pending ON outbox_jobs(status, kind, created_at);

COMMIT;
