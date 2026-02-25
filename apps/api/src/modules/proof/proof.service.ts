import { Injectable } from "@nestjs/common";
import { sha256Hex } from "@ant/shared/node";
import type { EpcisEventRecord, ProofRecord } from "../../store/store.types";

@Injectable()
export class ProofService {
  computePayloadHash(payload: unknown): string {
    return sha256Hex(payload);
  }

  verifyProof(event: EpcisEventRecord, proof: ProofRecord | null): {
    proofValid: boolean;
    check: "OK" | "MISMATCH" | "MISSING";
  } {
    if (!proof) {
      return { proofValid: false, check: "MISSING" };
    }

    if (proof.anchoredHash !== event.payloadHash) {
      return { proofValid: false, check: "MISMATCH" };
    }

    return { proofValid: true, check: "OK" };
  }

  verifyDidSignature(_payloadHash: string, _signature?: string): boolean {
    // MVP placeholder for DID signature verification.
    return true;
  }
}
