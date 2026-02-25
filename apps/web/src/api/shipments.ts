import type {
  BottleneckResult,
  CreateShipmentRequest,
  CreateShipmentResponse,
  EpcisEventReadModel,
  ShipmentIssueHistory,
  ShipmentStateReadModel,
  ShipmentWorkspaceList,
} from "@ant/shared";
import { apiFetch } from "./client";

export function createShipment(body: CreateShipmentRequest) {
  return apiFetch<CreateShipmentResponse>("/shipments", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function getShipmentState(code: string) {
  return apiFetch<ShipmentStateReadModel>(`/shipments/${encodeURIComponent(code)}/state`);
}

export function getShipmentTimeline(code: string) {
  return apiFetch<EpcisEventReadModel[]>(
    `/shipments/${encodeURIComponent(code)}/timeline`,
  );
}

export function getShipmentBottleneck(code: string) {
  return apiFetch<BottleneckResult>(`/shipments/${encodeURIComponent(code)}/bottleneck`);
}

export function getShipmentIssueHistory(code: string) {
  return apiFetch<ShipmentIssueHistory>(`/shipments/${encodeURIComponent(code)}/issues`);
}

export function listWorkspaceShipments(limit = 25) {
  const search = new URLSearchParams({ limit: String(limit) });
  return apiFetch<ShipmentWorkspaceList>(`/shipments?${search.toString()}`);
}

export function resolveShipmentScan(code: string) {
  return apiFetch<{
    shipmentCode: string;
    status: string;
    currentCustodianDid: string | null;
    expectedReceiverDid: string | null;
    nextActorDid: string | null;
    operationsBlocked: boolean;
    blockReason: string | null;
    reconciliationStatus?: string;
    policy: {
      slaHours: number;
      maxDelayHours: number;
      sealRequired: boolean;
      tempMin: number | null;
      tempMax: number | null;
      routeActors?: string[];
      routeOpenDynamic?: boolean;
      routePlan?: Array<{
        stepType: string;
        actorDid: string;
        label?: string;
        maxStepHours?: number;
      }>;
    };
    route: { actors: string[]; currentIndex: number; mode?: "OPEN_DYNAMIC" | "PLANNED" };
    recommendedAction:
      | "NONE"
      | "WAIT"
      | "SCAN_TAKE_CUSTODY"
      | "SCAN_CONFIRM_IN"
      | "SCAN_RELEASE_TO_NEXT"
      | "NOT_AUTHORIZED";
    message: string;
    debugMode: boolean;
  }>(`/shipments/${encodeURIComponent(code)}/scan/resolve`, {
    method: "POST",
    body: JSON.stringify({}),
  });
}

export function confirmShipmentScan(
  code: string,
  body: unknown,
  opts?: { idempotencyKey?: string },
) {
  return apiFetch<unknown>(`/shipments/${encodeURIComponent(code)}/scan/confirm`, {
    method: "POST",
    headers: opts?.idempotencyKey ? { "Idempotency-Key": opts.idempotencyKey } : undefined,
    body: JSON.stringify(body),
  });
}

export function handoverOut(code: string, body: unknown) {
  return apiFetch<{ eventId: string; payloadHash: string; status: "ACCEPTED" }>(
    `/shipments/${encodeURIComponent(code)}/handover/out`,
    {
      method: "POST",
      body: JSON.stringify(body),
    },
  );
}

export function handoverIn(code: string, body: unknown) {
  return apiFetch<{ eventId: string; payloadHash: string; status: "ACCEPTED" }>(
    `/shipments/${encodeURIComponent(code)}/handover/in`,
    {
      method: "POST",
      body: JSON.stringify(body),
    },
  );
}

export function reportShipmentIssue(
  code: string,
  body: {
    title?: string;
    description: string;
    category?:
      | "DAMAGED"
      | "TEMPERATURE"
      | "SEAL"
      | "MISMATCH"
      | "DELAY"
      | "WEATHER"
      | "INCIDENT"
      | "TRANSPORT"
      | "STORAGE"
      | "QUALITY"
      | "NOTICE"
      | "OTHER";
    subcategory?: string;
    severity?: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
    damaged?: boolean;
    notifyNextActor?: boolean;
    attachments?: string[];
  },
) {
  return apiFetch<{
    issueId: string;
    shipmentCode: string;
    status: string;
    operationsBlocked: boolean;
    message: string;
  }>(`/shipments/${encodeURIComponent(code)}/issues`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}
