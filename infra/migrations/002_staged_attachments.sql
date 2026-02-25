BEGIN;

CREATE TABLE IF NOT EXISTS staged_attachments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sha256 char(64) NOT NULL UNIQUE,
  object_store_key text NOT NULL,
  type text NOT NULL,
  mime text NULL,
  size_bytes bigint NULL,
  source_file_name text NULL,
  uploaded_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_staged_attachments_uploaded_at ON staged_attachments(uploaded_at);

COMMIT;
