function qrChecksum(shipmentCode: string, version = "1"): string {
  let hash = 0x811c9dc5;
  const input = `ANT|SHIPMENT|v${version}|${shipmentCode.toUpperCase()}`;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36).toUpperCase().padStart(7, "0").slice(-7);
}

export interface ParsedShipmentQr {
  shipmentCode: string;
  version: string | null;
  checksum: string | null;
  checksumValid: boolean | null;
  rawPayload: string;
}

export function parseShipmentQrDetails(raw: string): ParsedShipmentQr | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  const qrMatch = /^ant:\/\/shipment\/([^?]+)(?:\?(.+))?$/i.exec(trimmed);
  if (qrMatch) {
    const shipmentCode = decodeURIComponent(qrMatch[1]).trim().toUpperCase();
    const search = new URLSearchParams(qrMatch[2] ?? "");
    const version = search.get("v");
    const checksum = search.get("chk")?.toUpperCase() ?? null;
    const checksumValid =
      checksum && version ? checksum === qrChecksum(shipmentCode, version) : checksum ? false : null;
    return {
      shipmentCode,
      version,
      checksum,
      checksumValid,
      rawPayload: trimmed,
    };
  }

  // Allow direct manual paste of shipment code.
  if (/^ANT-[A-Z0-9]+$/i.test(trimmed)) {
    return {
      shipmentCode: trimmed.toUpperCase(),
      version: null,
      checksum: null,
      checksumValid: null,
      rawPayload: trimmed,
    };
  }

  return null;
}

export function parseShipmentQr(raw: string): string | null {
  const parsed = parseShipmentQrDetails(raw);
  if (!parsed) return null;
  if (parsed.checksum && parsed.checksumValid === false) return null;
  return parsed.shipmentCode;
}
