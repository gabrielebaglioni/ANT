import { Inject, Injectable } from "@nestjs/common";
import { EpcisEventSchema, type EpcisEvent } from "@ant/shared";
import { AppError } from "../../lib/errors";
import { PgStoreService } from "../../store/pg-store.service";
import { ProofService } from "../proof/proof.service";
import { validateEpcisBusinessRules } from "./epcis.validator";

export interface CaptureEventResult {
  eventId: string;
  payloadHash: string;
  status: "ACCEPTED";
}

@Injectable()
export class EpcisCaptureService {
  constructor(
    @Inject(PgStoreService) private readonly store: PgStoreService,
    @Inject(ProofService) private readonly proofService: ProofService,
  ) {}

  async captureEvent(input: {
    event: unknown;
    shipmentCode?: string;
    previousEventId?: string | null;
    idempotencyKey?: string;
    tenantId?: string;
  }): Promise<CaptureEventResult> {
    const tenantId = input.tenantId ?? "default";
    const idempotencyKey = input.idempotencyKey?.trim();
    if (!idempotencyKey) {
      throw new AppError("Idempotency-Key header is required for EPCIS capture", 400);
    }

    const event = EpcisEventSchema.parse(input.event);
    validateEpcisBusinessRules(event);
    const payloadHash = this.proofService.computePayloadHash(event);

    const existing = await this.store.getEventByIdempotencyKey(idempotencyKey, tenantId);
    if (existing) {
      if (existing.payloadHash !== payloadHash) {
        throw new AppError(
          "Idempotency-Key already used with a different EPCIS payload",
          409,
        );
      }
      return {
        eventId: existing.id,
        payloadHash: existing.payloadHash,
        status: "ACCEPTED",
      };
    }

    const shipmentCodeCandidate = input.shipmentCode ?? this.extractShipmentCode(event);
    if (typeof shipmentCodeCandidate !== "string" || shipmentCodeCandidate.length === 0) {
      throw new AppError("shipmentCode missing in EPCIS extensions.ant.shipmentCode", 400);
    }
    const shipmentCode = shipmentCodeCandidate;

    const shipment = await this.store.getShipmentByCode(shipmentCode, tenantId);
    if (!shipment) {
      throw new AppError(`Shipment not found: ${shipmentCode}`, 404);
    }
    if (shipment.operationsBlocked) {
      throw new AppError(
        `Shipment is blocked for operations: ${shipment.blockReason ?? "SECURITY_HOLD"}`,
        409,
      );
    }
    if (shipment.status === "PROVISIONING" || shipment.status === "PROVISIONING_FAILED") {
      throw new AppError(`Shipment is not operational yet (status=${shipment.status})`, 409);
    }

    return this.store.withTransaction(async (tx) => {
      const eventRow = await this.store.createEvent(
        {
          shipmentId: shipment.id,
          tenantId: shipment.tenantId,
          type: event.type,
          eventTime: event.eventTime,
          eventTimeZoneOffset: event.eventTimeZoneOffset,
          recordTime: event.recordTime ?? null,
          action: event.action,
          bizStep: event.bizStep,
          disposition: event.disposition,
          readPoint: event.readPoint.id,
          bizLocation: event.bizLocation.id,
          epcList: "epcList" in event ? (event.epcList ?? null) : null,
          quantityList: "quantityList" in event ? (event.quantityList ?? null) : null,
          parentId: "parentID" in event ? event.parentID : null,
          childEpcs: "childEPCs" in event ? (event.childEPCs ?? null) : null,
          childQuantityList:
            "childQuantityList" in event ? (event.childQuantityList ?? null) : null,
          payload: event,
          payloadHash,
          previousEventId: input.previousEventId ?? null,
          idempotencyKey,
          processingStage: "EVENT_CAPTURED",
          processingError: null,
          notarizationConfirmedAt: null,
          moveUpdatedAt: null,
          finalizedAt: null,
          moveTxDigest: null,
        },
        tx,
      );

      await this.store.enqueueOutbox(
        {
          kind: "NOTARIZE_EVENT",
          shipmentId: shipment.id,
          epcisEventId: eventRow.id,
          dedupeKey: `event:${eventRow.id}:notarize`,
        },
        tx,
      );

      const handover = this.extractHandover(event);
      if (handover === "OUT" || handover === "IN") {
        await this.store.enqueueOutbox(
          {
            kind: "MOVE_UPDATE",
            shipmentId: shipment.id,
            epcisEventId: eventRow.id,
            dedupeKey: `event:${eventRow.id}:move-update`,
          },
          tx,
        );
      }

      await this.store.appendAuditLog(
        {
          tenantId: shipment.tenantId,
          actorType: "SYSTEM",
          actorId: "epcis.capture",
          action: "EPCIS_EVENT_CAPTURED",
          shipmentId: shipment.id,
          epcisEventId: eventRow.id,
          details: {
            idempotencyKey,
            payloadHash,
            processingStage: "EVENT_CAPTURED",
          },
        },
        tx,
      );

      return {
        eventId: eventRow.id,
        payloadHash,
        status: "ACCEPTED" as const,
      };
    });
  }

  private extractShipmentCode(event: EpcisEvent): string | undefined {
    const ext = event.extensions as Record<string, unknown> | undefined;
    const ant = ext?.ant as Record<string, unknown> | undefined;
    const code = ant?.shipmentCode;
    return typeof code === "string" ? code : undefined;
  }

  private extractHandover(event: EpcisEvent): string | undefined {
    const ext = event.extensions as Record<string, unknown> | undefined;
    const ant = ext?.ant as Record<string, unknown> | undefined;
    const handover = ant?.handover;
    return typeof handover === "string" ? handover : undefined;
  }
}
