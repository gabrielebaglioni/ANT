export const TENANT_ID_REGEX = /^tenant-[a-z0-9]+(?:-[a-z0-9]+)*$/;

// Demo workspace tenant used across mock profiles and development seed data.
// Represents the shared ANT network (multi-entity workspace), not a single company.
export const ANT_DEMO_MULTI_ENTITY_TENANT_ID = "tenant-ant-multientity-network";

// Human-readable convention for docs/UI hints.
export const TENANT_ID_NAMING_PATTERN = "tenant-<platform>-<network>[-<region>][-<vertical>]";

export function isValidTenantId(value: string): boolean {
  return TENANT_ID_REGEX.test(value.trim());
}

export function normalizeTenantId(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

export function buildTenantId(parts: string[]): string {
  const normalizedParts = parts
    .map((part) => normalizeTenantId(part))
    .filter(Boolean)
    .map((part) => part.replace(/^tenant-/, ""));

  const candidate = normalizeTenantId(`tenant-${normalizedParts.join("-")}`);
  if (!isValidTenantId(candidate)) {
    throw new Error(`Invalid tenant id generated: ${candidate}`);
  }
  return candidate;
}

