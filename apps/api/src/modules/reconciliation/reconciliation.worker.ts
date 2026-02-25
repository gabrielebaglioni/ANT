import {
  Inject,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from "@nestjs/common";
import { getResolvedAppConfig } from "../../config/env";
import { PgStoreService } from "../../store/pg-store.service";
import { ProofService } from "../proof/proof.service";
import { IotaGateway } from "../iota/iota.gateway";

@Injectable()
export class ReconciliationWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ReconciliationWorker.name);
  private timer: NodeJS.Timeout | null = null;

  constructor(
    @Inject(PgStoreService) private readonly store: PgStoreService,
    @Inject(ProofService) private readonly proofService: ProofService,
    @Inject(IotaGateway) private readonly iotaGateway: IotaGateway,
  ) {}

  onModuleInit(): void {
    const cfg = getResolvedAppConfig();
    if (!cfg.reconciliationEnabled) return;
    this.timer = setInterval(() => {
      void this.runOnce(20).catch((error) => {
        this.logger.error(
          `Reconciliation run failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      });
    }, cfg.reconciliationIntervalMs);
    this.timer.unref?.();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async runOnce(limit = 20): Promise<number> {
    const shipments = await this.store.listShipmentsForReconciliation(limit);
    let processed = 0;
    for (const shipment of shipments) {
      await this.reconcileShipment(shipment.id);
      processed += 1;
    }
    return processed;
  }

  async reconcileShipment(shipmentId: string): Promise<void> {
    const shipment = await this.store.getShipmentById(shipmentId);
    if (!shipment) return;

    const nowIso = new Date().toISOString();
    const events = await this.store.listEventsByShipmentId(shipment.id);
    const latestEvent = events[events.length - 1] ?? null;
    const latestFinalizedEvent =
      [...events].reverse().find((event) => event.processingStage === "FINALIZED") ?? null;

    if (!latestEvent) {
      await this.store.updateShipment(shipment.id, {
        reconciliationStatus: "OK",
        lastReconciledAt: nowIso,
      });
      return;
    }

    // Skip transient events still in-flight (proof/notarization/move update pending).
    // Reconciliation should compare chain state only against the latest finalized handover/event.
    if (!latestFinalizedEvent) {
      await this.store.updateShipment(shipment.id, {
        reconciliationStatus: shipment.reconciliationStatus === "UNKNOWN" ? "UNKNOWN" : "OK",
        lastReconciledAt: nowIso,
      });
      return;
    }

    const proof = await this.store.getProofByEventId(latestFinalizedEvent.id);
    const proofCheck = this.proofService.verifyProof(latestFinalizedEvent, proof);
    if (!proofCheck.proofValid) {
      await this.raiseMismatch({
        shipmentId: shipment.id,
        tenantId: shipment.tenantId,
        epcisEventId: latestFinalizedEvent.id,
        code: proofCheck.check === "MISSING" ? "PROOF_MISSING" : "PROOF_MISMATCH",
        message: `Proof reconciliation failed for latest event (${proofCheck.check}).`,
        details: {
          eventId: latestFinalizedEvent.id,
          payloadHash: latestFinalizedEvent.payloadHash,
          proofCheck: proofCheck.check,
        },
      });
      return;
    }

    let chainSnapshot = null;
    try {
      chainSnapshot = shipment.moveObjectId
        ? await this.iotaGateway.getShipmentSnapshot(shipment.moveObjectId)
        : null;
    } catch (error) {
      await this.store.createReconciliationAlert({
        tenantId: shipment.tenantId,
        shipmentId: shipment.id,
        epcisEventId: latestFinalizedEvent.id,
        severity: "WARN",
        code: "CHAIN_UNAVAILABLE",
        message: "Chain snapshot unavailable during reconciliation.",
        details: {
          error: error instanceof Error ? error.message : String(error),
        },
      });
      await this.store.updateShipment(shipment.id, {
        reconciliationStatus: "ERROR",
        lastReconciledAt: nowIso,
      });
      return;
    }

    const mismatches: Record<string, unknown> = {};
    if (chainSnapshot?.lastEventHashHex) {
      const normalized = chainSnapshot.lastEventHashHex.replace(/^0x/, "").toLowerCase();
      if (normalized !== latestEvent.payloadHash.toLowerCase()) {
        mismatches.lastEventHashHex = {
          chain: normalized,
          db: latestFinalizedEvent.payloadHash.toLowerCase(),
        };
      }
    }
    if (chainSnapshot?.lastNotarizationId && proof?.notarizationObjectId) {
      if (chainSnapshot.lastNotarizationId !== proof.notarizationObjectId) {
        mismatches.lastNotarizationId = {
          chain: chainSnapshot.lastNotarizationId,
          db: proof.notarizationObjectId,
        };
      }
    }
    if (typeof chainSnapshot?.status === "string") {
      const normalizedChainStatus = this.normalizeChainStatus(chainSnapshot.status);
      const normalizedDbStatus = this.normalizeDbStatus(shipment.status);
      if (normalizedChainStatus !== normalizedDbStatus) {
        mismatches.status = {
          chain: normalizedChainStatus,
          db: normalizedDbStatus,
        };
      }
    }
    if (chainSnapshot?.seq !== null && chainSnapshot?.seq !== undefined) {
      const expectedSeq = events.filter((e) => {
        const ant = ((e.payload.extensions ?? {}) as Record<string, unknown>).ant as
          | Record<string, unknown>
          | undefined;
        const handover = ant?.handover;
        return (
          (handover === "OUT" || handover === "IN") &&
          e.processingStage === "FINALIZED"
        );
      }).length;
      if (chainSnapshot.seq !== expectedSeq) {
        mismatches.seq = { chain: chainSnapshot.seq, db: expectedSeq };
      }
    }
    if (chainSnapshot?.currentCustodianAddress) {
      const expectedCustodianAddress = this.iotaGateway.tryResolveDidAddress(
        shipment.currentCustodianDid,
      );
      if (
        expectedCustodianAddress &&
        chainSnapshot.currentCustodianAddress.toLowerCase() !==
          expectedCustodianAddress.toLowerCase()
      ) {
        mismatches.currentCustodianAddress = {
          chain: chainSnapshot.currentCustodianAddress,
          db: expectedCustodianAddress,
        };
      }
    }

    if (Object.keys(mismatches).length > 0) {
      await this.raiseMismatch({
        shipmentId: shipment.id,
        tenantId: shipment.tenantId,
        epcisEventId: latestEvent.id,
        code: "CHAIN_STATE_MISMATCH",
        message: "On-chain snapshot does not match off-chain latest finalized event/proof.",
        details: {
          shipmentCode: shipment.shipmentCode,
          mismatches,
          chainSnapshot,
          latestEventId: latestFinalizedEvent.id,
        },
      });
      return;
    }

    await this.store.updateShipment(shipment.id, {
      reconciliationStatus: "OK",
      lastReconciledAt: nowIso,
    });
  }

  private normalizeDbStatus(status: string): string {
    const s = status.toUpperCase();
    if (s === "PENDING_RECEIVER") return "PENDING";
    return s;
  }

  private normalizeChainStatus(status: string): string {
    const s = status.toUpperCase();
    if (s === "PENDING_RECEIVER") return "PENDING";
    return s;
  }

  private async raiseMismatch(input: {
    tenantId: string;
    shipmentId: string;
    epcisEventId: string | null;
    code: string;
    message: string;
    details: Record<string, unknown>;
  }): Promise<void> {
    const shipment = await this.store.getShipmentById(input.shipmentId);
    if (!shipment) return;

    // Avoid alert storms on already blocked shipments unless the reason changes.
    const nextReason = `RECON_${input.code}`;
    const firstTimeBlock = shipment.blockReason !== nextReason || !shipment.operationsBlocked;

    await this.store.updateShipment(shipment.id, {
      status: "DISPUTE",
      operationsBlocked: true,
      blockReason: nextReason,
      reconciliationStatus: "MISMATCH",
      lastReconciledAt: new Date().toISOString(),
    });

    if (firstTimeBlock) {
      await this.store.createReconciliationAlert({
        tenantId: input.tenantId,
        shipmentId: input.shipmentId,
        epcisEventId: input.epcisEventId,
        severity: "CRITICAL",
        code: input.code,
        message: input.message,
        details: input.details,
      });

      await this.store.appendAuditLog({
        tenantId: input.tenantId,
        actorType: "SYSTEM",
        actorId: "reconciliation.worker",
        action: "RECONCILIATION_MISMATCH_BLOCKED",
        shipmentId: input.shipmentId,
        epcisEventId: input.epcisEventId,
        details: {
          code: input.code,
          message: input.message,
          ...input.details,
        },
      });
    }
  }
}
