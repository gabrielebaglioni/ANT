const DEV_DID_LABELS: Record<string, string> = {
  "did:iota:producer-demo": "Producer Marta",
  "did:iota:carrier-demo": "Corriere Luca",
  "did:iota:warehouse-demo": "Magazzino Paolo",
  "did:iota:carrier-2-demo": "Corriere Elena",
  "did:iota:receiver-demo": "Receiver Hub Anna",
  "did:iota:final-receiver-demo": "Final Receiver Sofia",
  "did:iota:supervisor-demo": "Supervisor Marco",
  "did:iota:auditor-demo": "Auditor Giulia",
};

export function actorLabelFromDid(did: string | null | undefined): string {
  if (!did) return "Attore sconosciuto";
  const normalized = did.trim();
  if (!normalized) return "Attore sconosciuto";
  if (DEV_DID_LABELS[normalized]) return DEV_DID_LABELS[normalized];
  if (normalized.length <= 28) return normalized;
  return `${normalized.slice(0, 18)}…${normalized.slice(-6)}`;
}

export function actorRoleHintFromDid(did: string | null | undefined): string {
  if (!did) return "attore";
  const key = did.toLowerCase();
  if (key.includes("producer")) return "producer";
  if (key.includes("warehouse")) return "magazzino";
  if (key.includes("carrier")) return "corriere";
  if (key.includes("receiver") || key.includes("final-receiver")) return "receiver";
  return "attore";
}

