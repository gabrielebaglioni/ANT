import { createHash } from "node:crypto";
import { canonicalizeJson } from "./canonicalize";

export function sha256Hex(payload: unknown): string {
  const canonical = canonicalizeJson(payload);
  return createHash("sha256").update(canonical).digest("hex");
}
