import type { VerifyResponse } from "@ant/shared";
import { apiFetch } from "./client";

export function getVerifyShipment(code: string) {
  return apiFetch<VerifyResponse>(`/verify/${encodeURIComponent(code)}`);
}
