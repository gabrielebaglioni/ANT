import type { EpcisEventReadModel } from "@ant/shared";
import { Inject, Injectable } from "@nestjs/common";
import { PgStoreService } from "../../store/pg-store.service";

function summarizeWhat(payload: unknown): string {
  if (!payload || typeof payload !== "object") return "Unknown payload";
  const p = payload as Record<string, unknown>;

  if (Array.isArray(p.epcList) && p.epcList.length > 0) {
    return `${p.epcList.length} EPC(s)`;
  }
  if (Array.isArray(p.quantityList) && p.quantityList.length > 0) {
    return `${p.quantityList.length} quantity line(s)`;
  }
  if (typeof p.parentID === "string") {
    const childCount = Array.isArray(p.childEPCs) ? p.childEPCs.length : 0;
    return `Parent ${p.parentID} with ${childCount} child EPC(s)`;
  }
  return "WHAT missing";
}

@Injectable()
export class EpcisQueryService {
  constructor(@Inject(PgStoreService) private readonly store: PgStoreService) {}

  async getTimeline(shipmentCode: string, tenantId = "default"): Promise<EpcisEventReadModel[]> {
    const shipment = await this.store.getShipmentByCode(shipmentCode, tenantId);
    if (!shipment) return [];

    const events = await this.store.listEventsByShipmentId(shipment.id);
    return Promise.all(
      events.map(async (event) => {
        const proof = await this.store.getProofByEventId(event.id);
        return {
          eventId: event.id,
          type: event.type,
          eventTime: event.eventTime,
          action: event.action,
          bizStep: event.bizStep,
          disposition: event.disposition,
          readPoint: event.readPoint,
          bizLocation: event.bizLocation,
          whatSummary: summarizeWhat(event.payload),
          payloadHash: event.payloadHash,
          processingStage: event.processingStage,
          processingError: event.processingError,
          notarizationConfirmedAt: event.notarizationConfirmedAt,
          moveUpdatedAt: event.moveUpdatedAt,
          finalizedAt: event.finalizedAt,
          proof: proof
            ? {
                status: proof.verifyStatus,
                notarizationObjectId: proof.notarizationObjectId,
                anchoredAt: proof.anchoredAt,
              }
            : null,
          payload: event.payload,
        };
      }),
    );
  }
}
