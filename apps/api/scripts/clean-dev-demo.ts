import "dotenv/config";
import { Pool } from "pg";

function assertDevelopment() {
  const runtime = process.env.APP_RUNTIME ?? "development";
  if (runtime !== "development") {
    throw new Error(`Refusing to clean demo data because APP_RUNTIME=${runtime}`);
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
      delete from audit_log
      where shipment_id in (
        select id from shipments where shipment_code like 'ANT-DEMO-%'
      )
    `);
    await client.query(`
      delete from reconciliation_alerts
      where shipment_id in (
        select id from shipments where shipment_code like 'ANT-DEMO-%'
      )
    `);
    const deleted = await client.query(
      `delete from shipments where shipment_code like 'ANT-DEMO-%' returning shipment_code`,
    );
    await client.query(`delete from staged_attachments where object_store_key like 'dev-seed/%'`);
    await client.query("COMMIT");
    const codes = deleted.rows.map((r) => String(r.shipment_code));
    console.log(`Deleted demo shipments: ${codes.length}`);
    for (const code of codes) console.log(`- ${code}`);
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
