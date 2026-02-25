import type { EpcisEventReadModel } from "@ant/shared";

interface ProofBadgeProps {
  proof: EpcisEventReadModel["proof"];
}

export function ProofBadge({ proof }: ProofBadgeProps) {
  if (!proof) {
    return <span className="badge pending">Proof pending</span>;
  }

  if (proof.status === "OK") {
    return <span className="badge ok">Notarization OK</span>;
  }

  if (proof.status === "PENDING") {
    return <span className="badge pending">Notarization pending</span>;
  }

  return <span className="badge mismatch">Mismatch</span>;
}
