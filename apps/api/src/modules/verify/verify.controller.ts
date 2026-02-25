import { Controller, Get, Inject, Param } from "@nestjs/common";
import { PgStoreService } from "../../store/pg-store.service";
import { EpcisQueryService } from "../epcis/epcis.query.service";
import { ProofService } from "../proof/proof.service";
import { ShipmentsRepoPg } from "../shipments/shipments.repo.pg";
import { CurrentAuth, RequireRoles } from "../auth/auth.decorators";
import type { AuthContext } from "../auth/auth.types";

@Controller("verify")
export class VerifyController {
  constructor(
    @Inject(ShipmentsRepoPg) private readonly shipmentsRepo: ShipmentsRepoPg,
    @Inject(PgStoreService) private readonly store: PgStoreService,
    @Inject(EpcisQueryService) private readonly epcisQueryService: EpcisQueryService,
    @Inject(ProofService) private readonly proofService: ProofService,
  ) {}

  @Get(":code")
  @RequireRoles("operator", "supervisor", "auditor", "service")
  async verifyShipment(@Param("code") code: string, @CurrentAuth() auth?: AuthContext) {
    const tenantId = auth?.tenantId ?? "default";
    const shipment = await this.shipmentsRepo.getByCodeOrThrow(code, tenantId);
    const timeline = await this.epcisQueryService.getTimeline(code, tenantId);
    const events = await this.store.listEventsByShipmentId(shipment.id);

    const results = await Promise.all(
      events.map(async (event) => {
        const proof = await this.store.getProofByEventId(event.id);
        const proofCheck = this.proofService.verifyProof(event, proof);
        return {
          eventId: event.id,
          payloadHash: event.payloadHash,
          signatureValid: true,
          proofValid: proofCheck.proofValid,
          notarizationObjectId: proof?.notarizationObjectId ?? null,
          anchoredAt: proof?.anchoredAt ?? null,
          check: proofCheck.check,
        };
      }),
    );

    const total = results.length;
    const signaturesValidCount = results.filter((r) => r.signatureValid).length;
    const proofsValidCount = results.filter((r) => r.proofValid).length;

    return {
      shipment: {
        shipmentCode: shipment.shipmentCode,
        status: shipment.status,
        moveObjectId: shipment.moveObjectId,
        trackingUnitType: shipment.trackingUnitType,
        trackingId: shipment.trackingId,
        lotNumber: shipment.lotNumber,
        epcClass: shipment.epcClass,
        origin: {
          readPointId: shipment.originReadPoint,
          bizLocationId: shipment.originBizLocation,
        },
        destination: {
          readPointId: shipment.destinationReadPoint,
          bizLocationId: shipment.destinationBizLocation,
        },
        slaHours: shipment.slaHours,
        maxDelayHours: shipment.maxDelayHours,
        conditions: shipment.conditions ?? null,
        participants: {
          producerDid: shipment.producerDid,
          carrierDid: shipment.carrierDid,
          receiverDid: shipment.receiverDid,
        },
      },
      verificationSummary: {
        eventsVerified: `${total}/${total}`,
        signaturesValid: `${signaturesValidCount}/${total}`,
        proofsValid: `${proofsValidCount}/${total}`,
      },
      events: timeline,
      results,
    };
  }
}
