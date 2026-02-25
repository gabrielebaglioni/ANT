import { apiFetch } from "./client";

export interface OpsMetricsResponse {
  timestamp: string;
  runtime: string;
  iota: { network: string; mode: string };
  metrics: {
    outbox: {
      pending: number;
      inProgress: number;
      failed: number;
      retrying: number;
      maxLagSeconds: number;
      retriesLastHour: number;
    };
    reconciliation: {
      openAlerts: number;
      criticalOpenAlerts: number;
      mismatchesLast24h: number;
      failuresLastHour: number;
    };
    shipments: {
      blocked: number;
      provisioningFailed: number;
    };
  };
  thresholds?: Record<string, unknown>;
}

export function getOpsMetrics() {
  return apiFetch<OpsMetricsResponse>("/ops/metrics");
}

