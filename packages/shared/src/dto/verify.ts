import { z } from "zod";
import { EpcisEventReadModelSchema } from "./shipment";

export const EventVerificationResultSchema = z.object({
  eventId: z.string(),
  payloadHash: z.string().length(64),
  signatureValid: z.boolean(),
  proofValid: z.boolean(),
  notarizationObjectId: z.string().nullable(),
  anchoredAt: z.string().nullable(),
  check: z.enum(["OK", "MISMATCH", "MISSING"]),
});

export const VerifyShipmentSummarySchema = z.object({
  shipmentCode: z.string(),
  status: z.string(),
  moveObjectId: z.string().nullable(),
  trackingUnitType: z.enum(["LOGISTIC_UNIT", "LOT", "ITEM"]).optional(),
  trackingId: z.string().optional(),
  lotNumber: z.string().nullable().optional(),
  epcClass: z.string().nullable().optional(),
  origin: z
    .object({
      readPointId: z.string().nullable(),
      bizLocationId: z.string().nullable(),
    })
    .optional(),
  destination: z
    .object({
      readPointId: z.string().nullable(),
      bizLocationId: z.string().nullable(),
    })
    .optional(),
  slaHours: z.number().optional(),
  maxDelayHours: z.number().optional(),
  conditions: z.record(z.unknown()).nullable().optional(),
  participants: z.object({
    producerDid: z.string(),
    carrierDid: z.string(),
    receiverDid: z.string(),
  }),
});

export const VerifyResponseSchema = z.object({
  shipment: VerifyShipmentSummarySchema,
  verificationSummary: z.object({
    eventsVerified: z.string(),
    signaturesValid: z.string(),
    proofsValid: z.string(),
  }),
  events: z.array(EpcisEventReadModelSchema),
  results: z.array(EventVerificationResultSchema),
});

export type VerifyResponse = z.infer<typeof VerifyResponseSchema>;
export type EventVerificationResult = z.infer<typeof EventVerificationResultSchema>;
