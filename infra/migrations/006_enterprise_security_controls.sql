BEGIN;

-- Propagate tenant_id to EPCIS events and attachments/staging
ALTER TABLE epcis_events
  ADD COLUMN IF NOT EXISTS tenant_id text NOT NULL DEFAULT 'default';

UPDATE epcis_events e
SET tenant_id = s.tenant_id
FROM shipments s
WHERE e.shipment_id = s.id
  AND (e.tenant_id IS NULL OR e.tenant_id = 'default');

CREATE INDEX IF NOT EXISTS idx_epcis_events_tenant ON epcis_events(tenant_id, event_time DESC);
CREATE INDEX IF NOT EXISTS idx_epcis_events_tenant_idem
  ON epcis_events(tenant_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

ALTER TABLE staged_attachments
  ADD COLUMN IF NOT EXISTS tenant_id text NOT NULL DEFAULT 'default';

DO $$
BEGIN
  ALTER TABLE staged_attachments
    DROP CONSTRAINT IF EXISTS staged_attachments_sha256_key;
EXCEPTION WHEN undefined_object THEN NULL; END $$;

DROP INDEX IF EXISTS idx_staged_attachments_sha256;

CREATE UNIQUE INDEX IF NOT EXISTS uq_staged_attachments_tenant_sha
  ON staged_attachments(tenant_id, sha256);

CREATE INDEX IF NOT EXISTS idx_staged_attachments_tenant_uploaded
  ON staged_attachments(tenant_id, uploaded_at DESC);

ALTER TABLE attachments
  ADD COLUMN IF NOT EXISTS tenant_id text NOT NULL DEFAULT 'default';

UPDATE attachments a
SET tenant_id = e.tenant_id
FROM epcis_events e
WHERE a.epcis_event_id = e.id
  AND (a.tenant_id IS NULL OR a.tenant_id = 'default');

CREATE INDEX IF NOT EXISTS idx_attachments_tenant_sha
  ON attachments(tenant_id, sha256);

-- Append-only audit log trigger (with explicit break-glass session variable for controlled maintenance)
CREATE OR REPLACE FUNCTION ant_guard_audit_log_append_only()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF current_setting('ant.allow_audit_log_mutation', true) = 'on' THEN
    IF TG_OP = 'DELETE' THEN
      RETURN OLD;
    END IF;
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'audit_log is append-only (% blocked)', TG_OP
    USING ERRCODE = '55000';
END;
$$;

DROP TRIGGER IF EXISTS trg_audit_log_append_only ON audit_log;
CREATE TRIGGER trg_audit_log_append_only
BEFORE UPDATE OR DELETE ON audit_log
FOR EACH ROW
EXECUTE FUNCTION ant_guard_audit_log_append_only();

-- Dual-control approval workflow for admin compensations
CREATE TABLE IF NOT EXISTS admin_action_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id text NOT NULL DEFAULT 'default',
  shipment_id uuid NOT NULL REFERENCES shipments(id) ON DELETE CASCADE,
  action text NOT NULL CHECK (action IN ('OPEN_DISPUTE','SUSPEND','CORRECTIVE_HANDOVER')),
  status text NOT NULL DEFAULT 'PENDING_APPROVAL'
    CHECK (status IN ('PENDING_APPROVAL','APPROVED','REJECTED','EXECUTED','CANCELLED')),
  reason text NOT NULL,
  payload jsonb NOT NULL,

  requester_subject text NULL,
  requester_actor_id text NULL,
  approver_subject text NULL,
  approver_actor_id text NULL,
  approval_note text NULL,
  reject_note text NULL,

  approved_at timestamptz NULL,
  rejected_at timestamptz NULL,
  executed_at timestamptz NULL,
  tx_digest text NULL,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_admin_action_requests_shipment
  ON admin_action_requests(shipment_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_admin_action_requests_tenant_status
  ON admin_action_requests(tenant_id, status, created_at DESC);

COMMIT;

