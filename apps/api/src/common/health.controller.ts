import { Controller, Get, Inject } from "@nestjs/common";
import { getResolvedAppConfig } from "../config/env";
import { PostgresService } from "../db/postgres.service";
import { Public } from "../modules/auth/auth.decorators";

@Controller()
export class HealthController {
  constructor(@Inject(PostgresService) private readonly pg: PostgresService) {}

  @Get("health")
  @Public()
  async health() {
    const cfg = getResolvedAppConfig();
    let database = false;
    try {
      database = await this.pg.ping();
    } catch {
      database = false;
    }
    return {
      ok: true,
      service: "ant-api",
      database,
      runtime: cfg.runtime,
      iota: {
        network: cfg.iota.network,
        mode: cfg.iota.mode,
      },
      workers: {
        outboxEnabled: cfg.outboxWorkerEnabled,
        reconciliationEnabled: cfg.reconciliationEnabled,
        monitoringEnabled: cfg.monitoring.enabled,
      },
      auth: {
        mode: cfg.auth.mode,
      },
      security: {
        iotaKeySource: cfg.iota.keySource,
        adminCompensationRequireApproval: cfg.adminCompensationRequireApproval,
      },
    };
  }
}
