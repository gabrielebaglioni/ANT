import { Injectable, Logger, OnModuleDestroy } from "@nestjs/common";
import {
  Pool,
  type PoolClient,
  type PoolConfig,
  type QueryResult,
  type QueryResultRow,
} from "pg";
import { getRawApiEnv } from "../config/env";

export type Queryable = Pool | PoolClient;

@Injectable()
export class PostgresService implements OnModuleDestroy {
  private readonly logger = new Logger(PostgresService.name);
  readonly pool: Pool;

  constructor() {
    const env = getRawApiEnv();
    const config: PoolConfig = {
      connectionString: env.DATABASE_URL,
      host: env.PGHOST,
      port: env.PGPORT ? Number(env.PGPORT) : undefined,
      user: env.PGUSER,
      password: env.PGPASSWORD,
      database: env.PGDATABASE,
      max: env.PGPOOL_MAX ? Number(env.PGPOOL_MAX) : 10,
      ssl: env.PGSSL === "1" || env.PGSSL === "true" ? { rejectUnauthorized: false } : undefined,
    };

    this.pool = new Pool(config);
    this.pool.on("error", (error: Error) => {
      this.logger.error(`Unexpected PG pool error: ${error.message}`, error.stack);
    });
  }

  query<T extends QueryResultRow = any>(
    text: string,
    params?: unknown[],
    client?: Queryable,
  ): Promise<QueryResult<T>> {
    return (client ?? this.pool).query(text, params);
  }

  async withTransaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const result = await fn(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async ping(): Promise<boolean> {
    await this.pool.query("select 1");
    return true;
  }

  async onModuleDestroy(): Promise<void> {
    await this.pool.end();
  }
}
