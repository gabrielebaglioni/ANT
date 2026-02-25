import { useShipmentStore } from "../store/shipmentStore";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:3000";

export class ApiError extends Error {
  status: number;
  details?: unknown;

  constructor(message: string, status: number, details?: unknown) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.details = details;
  }
}

export async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const isFormData = typeof FormData !== "undefined" && init?.body instanceof FormData;
  const method = (init?.method ?? "GET").toUpperCase();
  const isMutation = method === "POST" || method === "PUT" || method === "PATCH" || method === "DELETE";
  const headers = new Headers(init?.headers ?? undefined);
  const hasIdempotencyHeader = headers.has("Idempotency-Key");
  const autoIdempotencyKey =
    isMutation && !hasIdempotencyHeader && typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : undefined;

  if (!isFormData && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  if (autoIdempotencyKey && !headers.has("Idempotency-Key")) {
    headers.set("Idempotency-Key", autoIdempotencyKey);
  }

  const session = useShipmentStore.getState().workspaceSession;
  const shouldSendDevHeaders = !headers.has("Authorization");
  if (shouldSendDevHeaders) {
    if (session.tenantId && !headers.has("x-ant-tenant-id")) {
      headers.set("x-ant-tenant-id", session.tenantId);
    }
    if (session.rolesCsv && !headers.has("x-ant-role")) {
      headers.set("x-ant-role", session.rolesCsv);
    }
    const actorId = session.actorDid || session.actorId;
    if (actorId && !headers.has("x-ant-actor-id")) {
      headers.set("x-ant-actor-id", actorId);
    }
    if (session.subject && !headers.has("x-ant-sub")) {
      headers.set("x-ant-sub", session.subject);
    }
  }

  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    headers,
  });

  const contentType = response.headers.get("content-type") ?? "";
  const payload = contentType.includes("application/json")
    ? await response.json()
    : await response.text();

  if (!response.ok) {
    const message =
      typeof payload === "object" && payload && "error" in payload
        ? String((payload as { error: unknown }).error)
        : `HTTP ${response.status}`;
    throw new ApiError(message, response.status, payload);
  }

  return payload as T;
}
