import "dotenv/config";
import { Pool } from "pg";

function assertDevelopment() {
  const runtime = process.env.APP_RUNTIME ?? "development";
  if (runtime !== "development") {
    throw new Error(`Refusing to wipe DB because APP_RUNTIME=${runtime}`);
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

async function main() {
  assertDevelopment();
  const pool = createPool();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(`set local ant.allow_audit_log_mutation = 'on'`);
    await client.query(`
      TRUNCATE TABLE
        admin_action_requests,
        reconciliation_alerts,
        audit_log,
        staged_attachments,
        shipments
      RESTART IDENTITY CASCADE
    `);
    await client.query("COMMIT");
    console.log("Development DB wiped successfully (shipments/events/proofs/outbox/attachments/audit/admin requests).");
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
