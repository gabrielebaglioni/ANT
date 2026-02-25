import { z } from "zod";

/**
 * CBV URIs can be either:
 *  - urn:epcglobal:cbv:bizstep:receiving
 *  - https://ref.gs1.org/cbv/BizStep-receiving
 * Same for disposition and other CBV code lists.
 */
const cbvBizStep = z.string().refine((s) => {
  return (
    /^urn:epcglobal:cbv:bizstep:[a-z_]+$/.test(s) ||
    /^https:\/\/ref\.gs1\.org\/cbv\/BizStep-[A-Za-z_]+$/.test(s)
  );
}, "Invalid CBV bizStep URI");

const cbvDisposition = z.string().refine((s) => {
  return (
    /^urn:epcglobal:cbv:disp:[a-z_]+$/.test(s) ||
    /^https:\/\/ref\.gs1\.org\/cbv\/Disp-[A-Za-z_]+$/.test(s)
  );
}, "Invalid CBV disposition URI");

const isoDateTime = z.string().refine((s) => {
  const d = new Date(s);
  return !Number.isNaN(d.getTime());
}, "Invalid ISO datetime");

const tzOffset = z
  .string()
  .regex(/^[+-](0\d|1\d|2[0-3]):[0-5]\d$/, "Invalid eventTimeZoneOffset");

const uriLike = z.string().min(1);

export const ReadPointSchema = z.object({
  id: uriLike, // typically SGLN URI
});

export const BizLocationSchema = z.object({
  id: uriLike, // typically SGLN URI
});

export const BizTransactionSchema = z.object({
  type: uriLike, // e.g. urn:epcglobal:cbv:btt:po (or web form)
  bizTransaction: uriLike,
});

export const SourceDestSchema = z.object({
  type: uriLike, // e.g. urn:epcglobal:cbv:sdt:owning_party
  source: uriLike,
});

export const DestinationSchema = z.object({
  type: uriLike,
  destination: uriLike,
});

export const QuantityElementSchema = z.object({
  epcClass: uriLike, // class-level EPC (GTIN-based URI)
  quantity: z.number().positive(),
  uom: z.string().optional(), // e.g. KGM, EA
});

export const BaseEpcisEventSchema = z.object({
  eventTime: isoDateTime,
  eventTimeZoneOffset: tzOffset,
  recordTime: isoDateTime.optional(),
  action: z.enum(["ADD", "OBSERVE", "DELETE"]),
  bizStep: cbvBizStep,
  disposition: cbvDisposition,
  readPoint: ReadPointSchema,
  bizLocation: BizLocationSchema,

  // optional but common EPCIS fields
  bizTransactionList: z.array(BizTransactionSchema).optional(),
  sourceList: z.array(SourceDestSchema).optional(),
  destinationList: z.array(DestinationSchema).optional(),

  // extensions / ILMD (keep flexible + commodity-agnostic)
  ilmd: z.record(z.unknown()).optional(),
  extensions: z.record(z.unknown()).optional(),
});

export const ObjectEventSchema = BaseEpcisEventSchema.extend({
  type: z.literal("ObjectEvent"),
  epcList: z.array(uriLike).optional(),
  quantityList: z.array(QuantityElementSchema).optional(),
}).superRefine((val, ctx) => {
  // WHAT must be present: epcList OR quantityList
  if (!val.epcList?.length && !val.quantityList?.length) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "ObjectEvent must include epcList or quantityList (WHAT dimension).",
      path: ["epcList"],
    });
  }
});

export const AggregationEventSchema = BaseEpcisEventSchema.extend({
  type: z.literal("AggregationEvent"),
  parentID: uriLike,
  childEPCs: z.array(uriLike).optional(),
  childQuantityList: z.array(QuantityElementSchema).optional(),
}).superRefine((val, ctx) => {
  // WHAT aggregation must be present: childEPCs OR childQuantityList
  if (!val.childEPCs?.length && !val.childQuantityList?.length) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "AggregationEvent must include childEPCs or childQuantityList.",
      path: ["childEPCs"],
    });
  }

  // In most cases: ADD for packing/aggregation, DELETE for de-aggregation/unpacking
  if (val.action === "OBSERVE") {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message:
        "AggregationEvent action should typically be ADD or DELETE (OBSERVE is unusual).",
      path: ["action"],
    });
  }
});

export const EpcisEventSchema = z.union([
  ObjectEventSchema,
  AggregationEventSchema,
]);

export type EpcisEvent = z.infer<typeof EpcisEventSchema>;
export type ObjectEvent = z.infer<typeof ObjectEventSchema>;
export type AggregationEvent = z.infer<typeof AggregationEventSchema>;
