import type { HandoverRequest } from "@ant/shared";
import type { ObjectEvent } from "@ant/shared";
import { CBV_BIZSTEP, CBV_DISPOSITION } from "@ant/shared";
import type { ShipmentRecord } from "../../store/store.types";

function isoToOffset(iso: string): string {
  if (iso.endsWith("Z")) return "+00:00";
  const match = iso.match(/([+-]\d{2}:\d{2})$/);
  return match?.[1] ?? "+00:00";
}

function buildWhat(shipment: ShipmentRecord): Pick<ObjectEvent, "epcList" | "quantityList" | "ilmd"> {
  if (shipment.trackingUnitType === "LOT") {
    return {
      quantityList: [
        {
          epcClass: shipment.epcClass ?? shipment.trackingId,
          quantity: 1,
          uom: "EA",
        },
      ],
      ilmd: shipment.lotNumber ? { lotNumber: shipment.lotNumber } : undefined,
    };
  }

  return {
    epcList: [shipment.trackingId],
    ilmd: shipment.lotNumber ? { lotNumber: shipment.lotNumber } : undefined,
  };
}

function commonExtensions(
  shipment: ShipmentRecord,
  request: HandoverRequest,
  handover: "OUT" | "IN",
  extra?: Record<string, unknown>,
): Record<string, unknown> {
  return {
    ant: {
      shipmentCode: shipment.shipmentCode,
      handover,
      actorDid: request.who.actorDid,
      attachments: request.attachments,
      ...(extra ?? {}),
    },
  };
}

function isRoutePlanFinalReceiverActor(shipment: ShipmentRecord, actorDid: string): boolean {
  const routePlan = Array.isArray(shipment.conditions?.routePlan)
    ? shipment.conditions?.routePlan
    : [];
  return routePlan.some((step) => {
    if (!step || typeof step !== "object") return false;
    const row = step as Record<string, unknown>;
    return (
      String(row.stepType ?? "").toUpperCase() === "FINAL_RECEIVER" &&
      typeof row.actorDid === "string" &&
      row.actorDid === actorDid
    );
  });
}

export function buildHandoverOutEvent(
  shipment: ShipmentRecord,
  request: HandoverRequest,
  options?: { destinationDid?: string | null },
): ObjectEvent {
  const what = buildWhat(shipment);
  const destinationDid = options?.destinationDid ?? shipment.expectedReceiverDid ?? shipment.receiverDid;
  return {
    type: "ObjectEvent",
    eventTime: request.when,
    eventTimeZoneOffset: isoToOffset(request.when),
    action: "OBSERVE",
    bizStep: CBV_BIZSTEP.SHIPPING,
    disposition: CBV_DISPOSITION.IN_TRANSIT,
    readPoint: { id: request.where.readPointId },
    bizLocation: { id: request.where.bizLocationId },
    ...(request.bizTx ? { bizTransactionList: request.bizTx } : {}),
    sourceList: [
      {
        type: "urn:epcglobal:cbv:sdt:owning_party",
        source: request.who.actorDid,
      },
    ],
    destinationList: [
      {
        type: "urn:epcglobal:cbv:sdt:owning_party",
        destination: destinationDid,
      },
    ],
    ...what,
    extensions: commonExtensions(shipment, request, "OUT", {
      ...(destinationDid ? { nextActorDid: destinationDid } : {}),
    }),
  };
}

export function buildHandoverInEvent(
  shipment: ShipmentRecord,
  request: HandoverRequest,
  confirmsOutEventId?: string,
): ObjectEvent {
  const what = buildWhat(shipment);
  const isFinalDelivery =
    request.who.actorDid === shipment.receiverDid ||
    isRoutePlanFinalReceiverActor(shipment, request.who.actorDid);
  return {
    type: "ObjectEvent",
    eventTime: request.when,
    eventTimeZoneOffset: isoToOffset(request.when),
    action: "OBSERVE",
    bizStep: CBV_BIZSTEP.RECEIVING,
    disposition: CBV_DISPOSITION.IN_PROGRESS,
    readPoint: { id: request.where.readPointId },
    bizLocation: { id: request.where.bizLocationId },
    ...(request.bizTx ? { bizTransactionList: request.bizTx } : {}),
    ...what,
    extensions: commonExtensions(shipment, request, "IN", {
      ...(isFinalDelivery ? { finalDelivery: true } : {}),
      ...(confirmsOutEventId ? { confirmsOutEventId } : {}),
    }),
  };
}
