BEGIN;

-- Shipment lifecycle for async on-chain provisioning
DO $$
BEGIN
  ALTER TYPE shipment_status ADD VALUE IF NOT EXISTS 'PROVISIONING';
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$
BEGIN
  ALTER TYPE shipment_status ADD VALUE IF NOT EXISTS 'PROVISIONING_FAILED';
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$
BEGIN
  ALTER TYPE shipment_status ADD VALUE IF NOT EXISTS 'ACTIVE';
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Outbox job kind for on-chain create saga step
DO $$
BEGIN
  ALTER TYPE outbox_kind ADD VALUE IF NOT EXISTS 'MOVE_CREATE';
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Shipments: idempotency, blocking, reconciliation metadata, tenant parity
ALTER TABLE shipments
  ADD COLUMN IF NOT EXISTS tenant_id text NOT NULL DEFAULT 'default',
  ADD COLUMN IF NOT EXISTS create_idempotency_key text NULL,
  ADD COLUMN IF NOT EXISTS operations_blocked boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS block_reason text NULL,
  ADD COLUMN IF NOT EXISTS reconciliation_status text NOT NULL DEFAULT 'UNKNOWN',
  ADD COLUMN IF NOT EXISTS last_reconciled_at timestamptz NULL;

DO $$
BEGIN
  ALTER TABLE shipments
    ADD CONSTRAINT chk_shipments_reconciliation_status
    CHECK (reconciliation_status IN ('UNKNOWN','OK','MISMATCH','ERROR'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_shipments_create_idempotency_key
  ON shipments(create_idempotency_key)
  WHERE create_idempotency_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_shipments_tenant ON shipments(tenant_id);
CREATE INDEX IF NOT EXISTS idx_shipments_reconciliation_status ON shipments(reconciliation_status);
CREATE INDEX IF NOT EXISTS idx_shipments_blocked ON shipments(operations_blocked);

-- EPCIS event processing/finalization gates + idempotency
ALTER TABLE epcis_events
  ADD COLUMN IF NOT EXISTS idempotency_key text NULL,
  ADD COLUMN IF NOT EXISTS processing_stage text NOT NULL DEFAULT 'EVENT_CAPTURED',
  ADD COLUMN IF NOT EXISTS processing_error text NULL,
  ADD COLUMN IF NOT EXISTS notarization_confirmed_at timestamptz NULL,
  ADD COLUMN IF NOT EXISTS move_updated_at timestamptz NULL,
  ADD COLUMN IF NOT EXISTS finalized_at timestamptz NULL,
  ADD COLUMN IF NOT EXISTS move_tx_digest text NULL;

DO $$
BEGIN
  ALTER TABLE epcis_events
    ADD CONSTRAINT chk_epcis_events_processing_stage
    CHECK (processing_stage IN (
      'EVENT_CAPTURED',
      'NOTARIZATION_CONFIRMED',
      'MOVE_UPDATED',
      'FINALIZED',
      'FAILED'
    ));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_epcis_events_idempotency_key
  ON epcis_events(idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_epcis_events_processing_stage ON epcis_events(processing_stage);
CREATE INDEX IF NOT EXISTS idx_epcis_events_finalized_at ON epcis_events(finalized_at);

-- Outbox: dedupe + retry scheduling
ALTER TABLE outbox_jobs
  ADD COLUMN IF NOT EXISTS dedupe_key text NULL,
  ADD COLUMN IF NOT EXISTS next_attempt_at timestamptz NOT NULL DEFAULT now();

CREATE UNIQUE INDEX IF NOT EXISTS uq_outbox_jobs_dedupe_key
  ON outbox_jobs(dedupe_key)
  WHERE dedupe_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_outbox_sched
  ON outbox_jobs(status, next_attempt_at, created_at);

-- Append-only audit log (platform + admin actions)
CREATE TABLE IF NOT EXISTS audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id text NOT NULL DEFAULT 'default',
  actor_type text NOT NULL,      -- SYSTEM | OPERATOR | SUPERVISOR | AUDITOR
  actor_id text NULL,            -- DID / user / service
  action text NOT NULL,          -- e.g. MOVE_CREATE_SUCCESS / OPEN_DISPUTE
  shipment_id uuid NULL REFERENCES shipments(id) ON DELETE SET NULL,
  epcis_event_id uuid NULL REFERENCES epcis_events(id) ON DELETE SET NULL,
  details jsonb NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_audit_log_shipment ON audit_log(shipment_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_log_action ON audit_log(action, created_at DESC);

-- Reconciliation alerts
CREATE TABLE IF NOT EXISTS reconciliation_alerts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id text NOT NULL DEFAULT 'default',
  shipment_id uuid NOT NULL REFERENCES shipments(id) ON DELETE CASCADE,
  epcis_event_id uuid NULL REFERENCES epcis_events(id) ON DELETE SET NULL,
  severity text NOT NULL CHECK (severity IN ('WARN','HIGH','CRITICAL')),
  code text NOT NULL,          -- PROOF_MISMATCH | CHAIN_STATE_MISMATCH | CHAIN_UNAVAILABLE
  message text NOT NULL,
  details jsonb NULL,
  status text NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','ACK','RESOLVED')),
  created_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz NULL
);

CREATE INDEX IF NOT EXISTS idx_recon_alerts_shipment ON reconciliation_alerts(shipment_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_recon_alerts_status ON reconciliation_alerts(status, severity, created_at DESC);

COMMIT;

