BEGIN;

CREATE UNIQUE INDEX IF NOT EXISTS uq_attachments_event_sha
  ON attachments(epcis_event_id, sha256);

COMMIT;

