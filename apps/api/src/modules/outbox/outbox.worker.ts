import {
  Inject,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from "@nestjs/common";
import { getResolvedAppConfig } from "../../config/env";
import { AppError } from "../../lib/errors";
import { PgStoreService } from "../../store/pg-store.service";
import { IotaGateway } from "../iota/iota.gateway";

@Injectable()
export class OutboxWorker {
  private readonly logger = new Logger(OutboxWorker.name);
  private timer: NodeJS.Timeout | null = null;

  constructor(
    @Inject(PgStoreService) private readonly store: PgStoreService,
    @Inject(IotaGateway) private readonly iotaGateway: IotaGateway,
  ) {}

  onModuleInit(): void {
    const cfg = getResolvedAppConfig();
    if (!cfg.outboxWorkerEnabled) return;
    const intervalMs = cfg.outboxWorkerIntervalMs;
    this.timer = setInterval(() => {
      void this.drain(10).catch((error) => {
        this.logger.error(
          `Outbox drain failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      });
    }, intervalMs);
    this.timer.unref?.();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async processNext(kind?: "NOTARIZE_EVENT" | "MOVE_UPDATE" | "MOVE_CREATE"): Promise<boolean> {
    const job = await this.store.withTransaction(async (tx) =>
      this.store.claimNextOutboxJob(kind, tx),
    );
    if (!job) return false;

    try {
      if (job.kind === "NOTARIZE_EVENT") {
        await this.processNotarize(job.epcisEventId);
      } else if (job.kind === "MOVE_CREATE") {
        await this.processMoveCreate(job.shipmentId);
      } else {
        await this.processMoveUpdate(job.shipmentId, job.epcisEventId);
      }
      await this.store.completeOutboxJob(job.id);
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown outbox error";
      if (this.shouldRequeue(job.attempts, error)) {
        await this.store.requeueOutboxJob(job.id, message);
        return false;
      }
      await this.store.failOutboxJob(job.id, message);
      if (job.kind === "MOVE_CREATE") {
        await this.markProvisioningFailed(job.shipmentId, message);
      }
      if (job.epcisEventId) {
        await this.store.updateEventProcessing(job.epcisEventId, {
          processingStage: "FAILED",
          processingError: message,
        });
      }
      return false;
    }
  }

  async drain(limit = 20): Promise<number> {
    let processed = 0;
    for (let i = 0; i < limit; i += 1) {
      const ok = await this.processNext();
      if (!ok) break;
      processed += 1;
    }
    return processed;
  }

  private async processNotarize(epcisEventId: string | null): Promise<void> {
    if (!epcisEventId) throw new AppError("NOTARIZE_EVENT job missing epcisEventId", 500);
    const event = await this.store.getEventById(epcisEventId);
    if (!event) throw new AppError(`Event not found: ${epcisEventId}`, 500);

    const notar = await this.iotaGateway.createLockedNotarization(event.payloadHash);
    await this.store.createOrReplaceProof({
      epcisEventId: event.id,
      method: "LOCKED",
      notarizationObjectId: notar.notarizationObjectId,
      txDigest: notar.txDigest,
      anchoredHash: event.payloadHash,
      anchoredAt: notar.anchoredAt,
      verifyStatus: "OK",
      checkedAt: new Date().toISOString(),
    });
    const ext = (event.payload.extensions ?? {}) as Record<string, unknown>;
    const ant = (ext.ant ?? {}) as Record<string, unknown>;
    const handover = typeof ant.handover === "string" ? ant.handover : undefined;
    const nowIso = new Date().toISOString();
    await this.store.updateEventProcessing(event.id, {
      processingStage: handover === "OUT" || handover === "IN" ? "NOTARIZATION_CONFIRMED" : "FINALIZED",
      notarizationConfirmedAt: notar.anchoredAt,
      finalizedAt: handover === "OUT" || handover === "IN" ? null : nowIso,
      processingError: null,
    });
    const shipment = await this.store.getShipmentById(event.shipmentId);
    if (shipment) {
      await this.store.appendAuditLog({
        tenantId: shipment.tenantId,
        actorType: "SYSTEM",
        actorId: "outbox.notarize",
        action: "NOTARIZATION_CONFIRMED",
        shipmentId: shipment.id,
        epcisEventId: event.id,
        details: {
          txDigest: notar.txDigest,
          notarizationObjectId: notar.notarizationObjectId,
        },
      });
    }
  }

  private async processMoveCreate(shipmentId: string): Promise<void> {
    const shipment = await this.store.getShipmentById(shipmentId);
    if (!shipment) throw new AppError(`Shipment not found: ${shipmentId}`, 500);
    if (shipment.moveObjectId && shipment.status !== "PROVISIONING_FAILED") {
      // Idempotent: create already completed.
      return;
    }

    const chain = await this.iotaGateway.createShipmentObject({
      shipmentCode: shipment.shipmentCode,
      // Create starts under producer custody; first pickup is confirmed by next actor via scan/handover.
      initialCustodianDid: shipment.producerDid,
    });

    await this.store.updateShipment(shipment.id, {
      moveObjectId: chain.moveObjectId,
      moveVersion: chain.moveVersion,
      status: "ACTIVE",
      operationsBlocked: false,
      blockReason: null,
    });
    await this.store.appendAuditLog({
      tenantId: shipment.tenantId,
      actorType: "SYSTEM",
      actorId: "outbox.move_create",
      action: "MOVE_CREATE_SUCCESS",
      shipmentId: shipment.id,
      epcisEventId: null,
      details: {
        moveObjectId: chain.moveObjectId,
        moveVersion: chain.moveVersion,
        txDigest: chain.txDigest ?? null,
      },
    });
  }

  private async processMoveUpdate(
    shipmentId: string,
    epcisEventId: string | null,
  ): Promise<void> {
    if (!epcisEventId) throw new AppError("MOVE_UPDATE job missing epcisEventId", 500);
    const shipment = await this.store.getShipmentById(shipmentId);
    const event = await this.store.getEventById(epcisEventId);
    if (!shipment || !event) {
      throw new AppError("MOVE_UPDATE references missing shipment/event", 500);
    }
    if (shipment.operationsBlocked) {
      throw new AppError(
        `Shipment blocked for operations (${shipment.blockReason ?? "SECURITY_HOLD"})`,
        409,
      );
    }

    const proof = await this.store.getProofByEventId(event.id);
    if (!proof) {
      throw new AppError("Proof not ready yet for MOVE_UPDATE", 503);
    }

    const ext = (event.payload.extensions ?? {}) as Record<string, unknown>;
    const ant = (ext.ant ?? {}) as Record<string, unknown>;
    const handover = typeof ant.handover === "string" ? ant.handover : undefined;
    const actorDid = typeof ant.actorDid === "string" ? ant.actorDid : undefined;
    const nextActorDid = typeof ant.nextActorDid === "string" ? ant.nextActorDid : undefined;

    if (handover === "OUT") {
      const tx = await this.iotaGateway.handoverOut({
        moveObjectId: shipment.moveObjectId ?? "",
        shipmentCode: shipment.shipmentCode,
        receiverDid: nextActorDid ?? shipment.expectedReceiverDid ?? shipment.receiverDid,
        payloadHash: event.payloadHash,
        notarizationObjectId: proof.notarizationObjectId,
      });
      const nowIso = new Date().toISOString();
      await this.store.updateEventProcessing(event.id, {
        processingStage: "MOVE_UPDATED",
        moveUpdatedAt: nowIso,
        moveTxDigest: tx.txDigest ?? null,
        processingError: null,
      });
      await this.store.updateEventProcessing(event.id, {
        processingStage: "FINALIZED",
        finalizedAt: nowIso,
      });
      await this.store.updateShipment(shipment.id, {
        status: "PENDING_RECEIVER",
        expectedReceiverDid: nextActorDid ?? shipment.expectedReceiverDid ?? shipment.receiverDid,
      });
      await this.store.appendAuditLog({
        tenantId: shipment.tenantId,
        actorType: "SYSTEM",
        actorId: "outbox.move_update",
        action: "MOVE_HANDOVER_OUT_CONFIRMED",
        shipmentId: shipment.id,
        epcisEventId: event.id,
        details: { txDigest: tx.txDigest ?? null },
      });
      return;
    }

    if (handover === "IN") {
      const isFinalReceiverTakeover =
        Boolean(actorDid) && actorDid === shipment.receiverDid;
      const tx = isFinalReceiverTakeover
        ? await this.iotaGateway.handoverInFinalDelivery({
            moveObjectId: shipment.moveObjectId ?? "",
            shipmentCode: shipment.shipmentCode,
            payloadHash: event.payloadHash,
            notarizationObjectId: proof.notarizationObjectId,
          })
        : await this.iotaGateway.handoverInConfirm({
            moveObjectId: shipment.moveObjectId ?? "",
            shipmentCode: shipment.shipmentCode,
            payloadHash: event.payloadHash,
            notarizationObjectId: proof.notarizationObjectId,
          });
      const nowIso = new Date().toISOString();
      await this.store.updateEventProcessing(event.id, {
        processingStage: "MOVE_UPDATED",
        moveUpdatedAt: nowIso,
        moveTxDigest: tx.txDigest ?? null,
        processingError: null,
      });
      await this.store.updateEventProcessing(event.id, {
        processingStage: "FINALIZED",
        finalizedAt: nowIso,
      });
      await this.store.updateShipment(shipment.id, {
        status: isFinalReceiverTakeover ? "DELIVERED" : "IN_TRANSIT",
        currentCustodianDid: actorDid ?? shipment.currentCustodianDid,
        expectedReceiverDid: null,
      });
      await this.store.appendAuditLog({
        tenantId: shipment.tenantId,
        actorType: "SYSTEM",
        actorId: "outbox.move_update",
        action: isFinalReceiverTakeover
          ? "MOVE_HANDOVER_IN_FINAL_DELIVERY_CONFIRMED"
          : "MOVE_HANDOVER_IN_CONFIRMED",
        shipmentId: shipment.id,
        epcisEventId: event.id,
        details: { txDigest: tx.txDigest ?? null },
      });
      return;
    }

    // Non-handover events with MOVE_UPDATE should not happen; finalize defensively.
    await this.store.updateEventProcessing(event.id, {
      processingStage: "FINALIZED",
      finalizedAt: new Date().toISOString(),
      processingError: null,
    });
  }

  private async markProvisioningFailed(shipmentId: string, message: string): Promise<void> {
    const shipment = await this.store.getShipmentById(shipmentId);
    if (!shipment) return;
    await this.store.updateShipment(shipment.id, {
      status: "PROVISIONING_FAILED",
      operationsBlocked: true,
      blockReason: `MOVE_CREATE_FAILED: ${message}`,
    });
    await this.store.appendAuditLog({
      tenantId: shipment.tenantId,
      actorType: "SYSTEM",
      actorId: "outbox.move_create",
      action: "MOVE_CREATE_FAILED",
      shipmentId: shipment.id,
      epcisEventId: null,
      details: { error: message },
    });
  }

  private shouldRequeue(attempts: number, error: unknown): boolean {
    if (attempts >= 25) return false;
    if (error instanceof AppError) {
      if (error.message.includes("Proof not ready yet for MOVE_UPDATE")) return true;
      if (error.statusCode >= 500) return true;
      if (error.statusCode === 429) return true;
      return false;
    }
    return true;
  }
}
