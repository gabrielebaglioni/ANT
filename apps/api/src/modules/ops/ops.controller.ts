import { Controller, Get, Inject } from "@nestjs/common";
import { getResolvedAppConfig } from "../../config/env";
import { PgStoreService } from "../../store/pg-store.service";
import { RequireRoles } from "../auth/auth.decorators";

@Controller("ops")
@RequireRoles("supervisor", "auditor")
export class OpsController {
  constructor(@Inject(PgStoreService) private readonly store: PgStoreService) {}

  @Get("metrics")
  async metrics() {
    const cfg = getResolvedAppConfig();
    const metrics = await this.store.getOpsMetrics();
    return {
      timestamp: new Date().toISOString(),
      runtime: cfg.runtime,
      iota: {
        network: cfg.iota.network,
        mode: cfg.iota.mode,
      },
      metrics,
      thresholds: cfg.monitoring.thresholds,
    };
  }
}

