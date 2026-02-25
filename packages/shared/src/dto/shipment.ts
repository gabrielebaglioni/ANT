import { z } from "zod";

export const TrackingUnitTypeSchema = z.enum(["LOGISTIC_UNIT", "LOT", "ITEM"]);

export const LocationInputSchema = z.object({
  readPointId: z.string().min(1),
  bizLocationId: z.string().min(1),
  label: z.string().min(1).optional(),
});

export const ConditionsSchema = z
  .object({
    tempMin: z.number().optional(),
    tempMax: z.number().optional(),
    sealRequired: z.boolean().optional(),
    routeOpenDynamic: z.boolean().optional(),
    routePlan: z
      .array(
        z.object({
          stepType: z.enum([
            "CARRIER",
            "WAREHOUSE",
            "HUB",
            "RETAIL",
            "FINAL_RECEIVER",
            "CUSTOM",
          ]),
          actorDid: z.string().min(1),
          label: z.string().min(1).optional(),
          maxStepHours: z.number().positive().optional(),
        }),
      )
      .min(1)
      .optional(),
    // Optional debug/progressive route definition (future multi-hop support).
    // If provided, it should list custody actors in order after creation (e.g. carrier, warehouse, carrier, store).
    routeActors: z.array(z.string().min(1)).min(1).optional(),
  })
  .optional()
  .superRefine((value, ctx) => {
    if (!value) return;
    if (
      value.tempMin !== undefined &&
      value.tempMax !== undefined &&
      value.tempMin > value.tempMax
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "tempMin cannot be greater than tempMax",
        path: ["tempMin"],
      });
    }
  });

export const ParticipantsSchema = z.object({
  producerDid: z.string().min(1),
  carrierDid: z.string().min(1),
  receiverDid: z.string().min(1),
});

export const CreateShipmentRequestSchema = z
  .object({
    trackingUnitType: TrackingUnitTypeSchema,
    trackingId: z.string().min(1),
    lotNumber: z.string().optional(),
    epcClass: z.string().optional(),
    origin: LocationInputSchema,
    destination: LocationInputSchema,
    slaHours: z.number().int().positive().default(24),
    maxDelayHours: z.number().int().positive().default(6),
    conditions: ConditionsSchema,
    participants: ParticipantsSchema,
  })
  .superRefine((value, ctx) => {
    if (value.trackingUnitType === "LOT") {
      if (!value.lotNumber) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "lotNumber is required when trackingUnitType=LOT",
          path: ["lotNumber"],
        });
      }
      if (!value.epcClass) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "epcClass is required when trackingUnitType=LOT",
          path: ["epcClass"],
        });
      }
    }
  });

export const CreateShipmentResponseSchema = z.object({
  shipmentCode: z.string().min(1),
  moveObjectId: z.string().min(1).nullable(),
  qrPayload: z.string().min(1),
  provisioning: z.object({
    status: z.enum(["PROVISIONING", "ACTIVE", "PROVISIONING_FAILED"]),
    message: z.string(),
  }),
});

export const ShipmentWorkspaceItemSchema = z.object({
  shipmentCode: z.string().min(1),
  trackingUnitType: TrackingUnitTypeSchema,
  trackingId: z.string().min(1),
  originReadPoint: z.string().nullable(),
  originBizLocation: z.string().nullable(),
  destinationReadPoint: z.string().nullable(),
  destinationBizLocation: z.string().nullable(),
  conditions: z.record(z.unknown()).nullable().optional(),
  producerDid: z.string().min(1),
  carrierDid: z.string().min(1),
  receiverDid: z.string().min(1),
  status: z.enum([
    "PROVISIONING",
    "PROVISIONING_FAILED",
    "ACTIVE",
    "CREATED",
    "IN_TRANSIT",
    "PENDING_RECEIVER",
    "DELIVERED",
    "DISPUTE",
  ]),
  currentCustodianDid: z.string().nullable(),
  expectedReceiverDid: z.string().nullable(),
  operationsBlocked: z.boolean().default(false),
  blockReason: z.string().nullable().optional(),
  reconciliationStatus: z.enum(["UNKNOWN", "OK", "MISMATCH", "ERROR"]).optional(),
  moveObjectId: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const ShipmentWorkspaceListSchema = z.array(ShipmentWorkspaceItemSchema);

export const ShipmentStateReadModelSchema = z.object({
  shipmentCode: z.string().min(1),
  status: z.enum([
    "PROVISIONING",
    "PROVISIONING_FAILED",
    "ACTIVE",
    "CREATED",
    "IN_TRANSIT",
    "PENDING_RECEIVER",
    "DELIVERED",
    "DISPUTE",
  ]),
  operationsBlocked: z.boolean().default(false),
  blockReason: z.string().nullable().optional(),
  reconciliationStatus: z.enum(["UNKNOWN", "OK", "MISMATCH", "ERROR"]).optional(),
  currentCustodianDid: z.string().nullable(),
  expectedReceiverDid: z.string().nullable(),
  moveObjectId: z.string().nullable(),
  lastProof: z
    .object({
      notarizationObjectId: z.string(),
      anchoredAt: z.string().nullable(),
      verifyStatus: z.enum(["PENDING", "OK", "MISMATCH", "MISSING"]),
    })
    .nullable(),
});

export const ShipmentIssueHistoryItemSchema = z.object({
  issueId: z.string(),
  createdAt: z.string(),
  actorType: z.string(),
  actorId: z.string().nullable(),
  title: z.string(),
  description: z.string().nullable(),
  category: z.string(),
  subcategory: z.string().nullable().optional(),
  severity: z.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"]),
  damaged: z.boolean(),
  notifyNextActor: z.boolean().default(false),
  attachmentsCount: z.number().int().nonnegative().default(0),
  attachments: z
    .array(
      z.object({
        sha256: z.string().length(64),
        type: z.string().optional(),
        mime: z.string().nullable().optional(),
        sizeBytes: z.number().nullable().optional(),
        sourceFileName: z.string().nullable().optional(),
        downloadUrl: z.string().nullable().optional(),
      }),
    )
    .default([]),
  blockingImpact: z.boolean().default(false),
});

export const ShipmentIssueHistorySchema = z.array(ShipmentIssueHistoryItemSchema);

export const HandoverRequestSchema = z.object({
  shipmentCode: z.string().min(1).optional(),
  who: z.object({
    actorDid: z.string().min(1),
  }),
  where: z.object({
    readPointId: z.string().min(1),
    bizLocationId: z.string().min(1),
    label: z.string().optional(),
  }),
  when: z.string().datetime({ offset: true }),
  attachments: z.array(z.string().regex(/^[a-f0-9]{64}$/i)).default([]),
  bizTx: z
    .array(
      z.object({
        type: z.string().min(1),
        bizTransaction: z.string().min(1),
      }),
    )
    .optional(),
});

export const ProofStatusSchema = z.enum(["PENDING", "OK", "MISMATCH", "MISSING"]);
export const EventProcessingStageSchema = z.enum([
  "EVENT_CAPTURED",
  "NOTARIZATION_CONFIRMED",
  "MOVE_UPDATED",
  "FINALIZED",
  "FAILED",
]);

export const EpcisEventReadModelSchema = z.object({
  eventId: z.string().min(1),
  type: z.string().min(1),
  eventTime: z.string(),
  action: z.string(),
  bizStep: z.string(),
  disposition: z.string(),
  readPoint: z.string(),
  bizLocation: z.string(),
  whatSummary: z.string(),
  payloadHash: z.string().length(64),
  processingStage: EventProcessingStageSchema,
  processingError: z.string().nullable().optional(),
  notarizationConfirmedAt: z.string().nullable().optional(),
  moveUpdatedAt: z.string().nullable().optional(),
  finalizedAt: z.string().nullable().optional(),
  proof: z
    .object({
      status: ProofStatusSchema,
      notarizationObjectId: z.string().nullable(),
      anchoredAt: z.string().nullable(),
    })
    .nullable(),
  payload: z.unknown(),
});

export const BottleneckResultSchema = z.object({
  type: z.enum([
    "NONE",
    "MISSING_RECEIVER_CONFIRMATION",
    "SLA_BREACH",
    "CONDITION_VIOLATION",
  ]),
  message: z.string(),
  since: z.string().nullable(),
  suggestedAction: z.string().nullable(),
});

export type CreateShipmentRequest = z.infer<typeof CreateShipmentRequestSchema>;
export type CreateShipmentResponse = z.infer<typeof CreateShipmentResponseSchema>;
export type ShipmentWorkspaceItem = z.infer<typeof ShipmentWorkspaceItemSchema>;
export type ShipmentWorkspaceList = z.infer<typeof ShipmentWorkspaceListSchema>;
export type ShipmentStateReadModel = z.infer<typeof ShipmentStateReadModelSchema>;
export type ShipmentIssueHistoryItem = z.infer<typeof ShipmentIssueHistoryItemSchema>;
export type ShipmentIssueHistory = z.infer<typeof ShipmentIssueHistorySchema>;
export type HandoverRequest = z.infer<typeof HandoverRequestSchema>;
export type EpcisEventReadModel = z.infer<typeof EpcisEventReadModelSchema>;
export type BottleneckResult = z.infer<typeof BottleneckResultSchema>;
