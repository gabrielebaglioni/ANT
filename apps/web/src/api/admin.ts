import { apiFetch } from "./client";

export type AdminActionRoute = "open-dispute" | "suspend" | "corrective-handover";

export interface AdminActionRequestResponse {
  ok: boolean;
  approvalRequired?: boolean;
  requestId?: string;
  status?: string;
  action?: string;
  txDigest?: string | null;
}

export interface AdminActionRequestRecord {
  id: string;
  tenantId: string;
  shipmentId: string;
  action: string;
  reason: string;
  payload: Record<string, unknown>;
  status: string;
  requesterSubject?: string | null;
  requesterActorId?: string | null;
  approverSubject?: string | null;
  approverActorId?: string | null;
  approvalNote?: string | null;
  rejectNote?: string | null;
  txDigest?: string | null;
  createdAt: string;
  updatedAt: string;
  approvedAt?: string | null;
  rejectedAt?: string | null;
  executedAt?: string | null;
}

export function requestAdminAction(
  shipmentCode: string,
  action: "open-dispute" | "suspend",
  body: { reason: string },
) {
  return apiFetch<AdminActionRequestResponse>(
    `/admin/shipments/${encodeURIComponent(shipmentCode)}/${action}/request`,
    {
      method: "POST",
      body: JSON.stringify(body),
    },
  );
}

export function requestCorrectiveHandover(
  shipmentCode: string,
  body: {
    reason: string;
    receiverDid: string;
    payloadHash: string;
    notarizationObjectId: string;
    note?: string;
  },
) {
  return apiFetch<AdminActionRequestResponse>(
    `/admin/shipments/${encodeURIComponent(shipmentCode)}/corrective-handover/request`,
    {
      method: "POST",
      body: JSON.stringify(body),
    },
  );
}

export function getAdminActionRequest(requestId: string) {
  return apiFetch<AdminActionRequestRecord>(`/admin/action-requests/${encodeURIComponent(requestId)}`);
}

export function approveAdminActionRequest(requestId: string, note?: string) {
  return apiFetch<AdminActionRequestResponse>(
    `/admin/action-requests/${encodeURIComponent(requestId)}/approve`,
    {
      method: "POST",
      body: JSON.stringify(note ? { note } : {}),
    },
  );
}

export function rejectAdminActionRequest(requestId: string, note: string) {
  return apiFetch<AdminActionRequestResponse>(
    `/admin/action-requests/${encodeURIComponent(requestId)}/reject`,
    {
      method: "POST",
      body: JSON.stringify({ note }),
    },
  );
}

export function executeAdminActionRequest(requestId: string) {
  return apiFetch<AdminActionRequestResponse>(
    `/admin/action-requests/${encodeURIComponent(requestId)}/execute`,
    {
      method: "POST",
      body: JSON.stringify({}),
    },
  );
}

