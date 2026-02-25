import {
  Inject,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from "@nestjs/common";
import { getResolvedAppConfig } from "../../config/env";
import { PgStoreService } from "../../store/pg-store.service";

type AlertCode =
  | "OUTBOX_LAG_HIGH"
  | "OUTBOX_RETRYING_HIGH"
  | "RECON_MISMATCH_RATE_HIGH"
  | "RECON_FAILURE_RATE_HIGH";

@Injectable()
export class MonitoringWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(MonitoringWorker.name);
  private timer: NodeJS.Timeout | null = null;
  private readonly lastAlertAt = new Map<AlertCode, number>();

  constructor(@Inject(PgStoreService) private readonly store: PgStoreService) {}

  onModuleInit(): void {
    const cfg = getResolvedAppConfig();
    if (!cfg.monitoring.enabled) return;
    this.timer = setInterval(() => {
      void this.runOnce().catch((error) => {
        this.logger.error(
          `Monitoring run failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      });
    }, cfg.monitoring.intervalMs);
    this.timer.unref?.();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async runOnce(): Promise<void> {
    const cfg = getResolvedAppConfig();
    const metrics = await this.store.getOpsMetrics();
    const alerts: Array<{ code: AlertCode; message: string; details: Record<string, unknown> }> = [];

    if (metrics.outbox.maxLagSeconds > cfg.monitoring.thresholds.outboxMaxLagSeconds) {
      alerts.push({
        code: "OUTBOX_LAG_HIGH",
        message: `Outbox lag is ${metrics.outbox.maxLagSeconds}s (threshold ${cfg.monitoring.thresholds.outboxMaxLagSeconds}s)`,
        details: { outbox: metrics.outbox },
      });
    }
    if (metrics.outbox.retrying > cfg.monitoring.thresholds.retryingJobs) {
      alerts.push({
        code: "OUTBOX_RETRYING_HIGH",
        message: `Retrying outbox jobs=${metrics.outbox.retrying} (threshold ${cfg.monitoring.thresholds.retryingJobs})`,
        details: { outbox: metrics.outbox },
      });
    }
    if (metrics.reconciliation.mismatchesLast24h > cfg.monitoring.thresholds.reconMismatches24h) {
      alerts.push({
        code: "RECON_MISMATCH_RATE_HIGH",
        message: `Reconciliation mismatches in 24h=${metrics.reconciliation.mismatchesLast24h} (threshold ${cfg.monitoring.thresholds.reconMismatches24h})`,
        details: { reconciliation: metrics.reconciliation },
      });
    }
    if (metrics.reconciliation.failuresLastHour > cfg.monitoring.thresholds.reconFailures1h) {
      alerts.push({
        code: "RECON_FAILURE_RATE_HIGH",
        message: `Reconciliation failures in 1h=${metrics.reconciliation.failuresLastHour} (threshold ${cfg.monitoring.thresholds.reconFailures1h})`,
        details: { reconciliation: metrics.reconciliation },
      });
    }

    for (const alert of alerts) {
      if (!this.shouldEmit(alert.code, cfg.monitoring.alertCooldownMs)) continue;
      this.logger.warn(`${alert.code}: ${alert.message}`);
      await this.emitWebhookAlert(alert).catch((error) => {
        this.logger.warn(
          `Alert webhook failed (${alert.code}): ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      });
    }
  }

  private shouldEmit(code: AlertCode, cooldownMs: number): boolean {
    const now = Date.now();
    const last = this.lastAlertAt.get(code) ?? 0;
    if (now - last < cooldownMs) return false;
    this.lastAlertAt.set(code, now);
    return true;
  }

  private async emitWebhookAlert(input: {
    code: AlertCode;
    message: string;
    details: Record<string, unknown>;
  }): Promise<void> {
    const url = getResolvedAppConfig().monitoring.alertWebhookUrl;
    if (!url) return;
    await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        source: "ant-api-monitoring",
        severity: "warning",
        ...input,
        timestamp: new Date().toISOString(),
      }),
    });
  }
}

