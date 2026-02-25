import { AppError } from "../../lib/errors";
import type { CreateShipmentRequest } from "@ant/shared";
import { Inject, Injectable } from "@nestjs/common";
import { PgStoreService } from "../../store/pg-store.service";
import type { ShipmentRecord } from "../../store/store.types";

/**
 * Postgres repository shape for the final implementation.
 * For this scaffold it delegates to the in-memory store while preserving module boundaries.
 */
@Injectable()
export class ShipmentsRepoPg {
  constructor(@Inject(PgStoreService) private readonly store: PgStoreService) {}

  async createShipment(input: {
    request: CreateShipmentRequest;
    shipmentCode: string;
    createIdempotencyKey: string;
    tenantId: string;
  }): Promise<ShipmentRecord> {
    const { request, shipmentCode, createIdempotencyKey, tenantId } = input;
    if (await this.store.getShipmentByCode(shipmentCode, tenantId)) {
      throw new AppError("shipmentCode collision", 409);
    }

    return this.store.createShipment({
      tenantId,
      shipmentCode,
      createIdempotencyKey,
      trackingUnitType: request.trackingUnitType,
      trackingId: request.trackingId,
      epcClass: request.epcClass ?? null,
      lotNumber: request.lotNumber ?? null,
      originReadPoint: request.origin.readPointId,
      originBizLocation: request.origin.bizLocationId,
      destinationReadPoint: request.destination.readPointId,
      destinationBizLocation: request.destination.bizLocationId,
      slaHours: request.slaHours,
      maxDelayHours: request.maxDelayHours,
      conditions: (request.conditions ?? null) as Record<string, unknown> | null,
      producerDid: request.participants.producerDid,
      carrierDid: request.participants.carrierDid,
      receiverDid: request.participants.receiverDid,
      moveObjectId: null,
      moveVersion: null,
      status: "PROVISIONING",
      currentCustodianDid: request.participants.carrierDid,
      expectedReceiverDid: null,
      operationsBlocked: false,
      blockReason: null,
      reconciliationStatus: "UNKNOWN",
      lastReconciledAt: null,
    });
  }

  async getByCodeOrThrow(code: string, tenantId = "default"): Promise<ShipmentRecord> {
    const shipment = await this.store.getShipmentByCode(code, tenantId);
    if (!shipment) throw new AppError(`Shipment not found: ${code}`, 404);
    return shipment;
  }
}
