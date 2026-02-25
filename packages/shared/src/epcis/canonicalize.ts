export function canonicalizeJson(value: unknown): string {
  // Minimal deterministic canonicalization:
  // - sort object keys recursively
  // - keep array order stable (EPCIS arrays can be semantically ordered)
  return JSON.stringify(sortKeys(value));
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortKeys);
  }

  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      out[key] = sortKeys((value as Record<string, unknown>)[key]);
    }
    return out;
  }

  return value;
}
