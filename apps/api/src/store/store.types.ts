import type { EpcisEvent } from "@ant/shared";

export type ShipmentStatus =
  | "PROVISIONING"
  | "PROVISIONING_FAILED"
  | "ACTIVE"
  | "CREATED"
  | "IN_TRANSIT"
  | "PENDING_RECEIVER"
  | "DELIVERED"
  | "DISPUTE";

export type ReconciliationStatus = "UNKNOWN" | "OK" | "MISMATCH" | "ERROR";

export interface ShipmentRecord {
  id: string;
  tenantId: string;
  shipmentCode: string;
  createIdempotencyKey: string | null;
  trackingUnitType: "LOGISTIC_UNIT" | "LOT" | "ITEM";
  trackingId: string;
  epcClass: string | null;
  lotNumber: string | null;
  originReadPoint: string | null;
  originBizLocation: string | null;
  destinationReadPoint: string | null;
  destinationBizLocation: string | null;
  slaHours: number;
  maxDelayHours: number;
  conditions: Record<string, unknown> | null;
  producerDid: string;
  carrierDid: string;
  receiverDid: string;
  moveObjectId: string | null;
  moveVersion: number | null;
  status: ShipmentStatus;
  currentCustodianDid: string | null;
  expectedReceiverDid: string | null;
  operationsBlocked: boolean;
  blockReason: string | null;
  reconciliationStatus: ReconciliationStatus;
  lastReconciledAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export type EventProcessingStage =
  | "EVENT_CAPTURED"
  | "NOTARIZATION_CONFIRMED"
  | "MOVE_UPDATED"
  | "FINALIZED"
  | "FAILED";

export interface EpcisEventRecord {
  id: string;
  shipmentId: string;
  tenantId: string;
  idempotencyKey: string | null;
  type: string;
  eventTime: string;
  eventTimeZoneOffset: string;
  recordTime: string | null;
  action: "ADD" | "OBSERVE" | "DELETE";
  bizStep: string;
  disposition: string;
  readPoint: string;
  bizLocation: string;
  epcList: string[] | null;
  quantityList: unknown[] | null;
  parentId: string | null;
  childEpcs: string[] | null;
  childQuantityList: unknown[] | null;
  payload: EpcisEvent;
  payloadHash: string;
  previousEventId: string | null;
  processingStage: EventProcessingStage;
  processingError: string | null;
  notarizationConfirmedAt: string | null;
  moveUpdatedAt: string | null;
  finalizedAt: string | null;
  moveTxDigest: string | null;
  createdAt: string;
}

export interface ProofRecord {
  id: string;
  epcisEventId: string;
  method: "LOCKED" | "DYNAMIC";
  notarizationObjectId: string;
  txDigest: string;
  anchoredHash: string;
  anchoredAt: string | null;
  verifyStatus: "PENDING" | "OK" | "MISMATCH" | "MISSING";
  checkedAt: string | null;
}

export interface OutboxJobRecord {
  id: string;
  kind: "NOTARIZE_EVENT" | "MOVE_UPDATE" | "MOVE_CREATE";
  status: "PENDING" | "IN_PROGRESS" | "DONE" | "FAILED";
  shipmentId: string;
  epcisEventId: string | null;
  dedupeKey: string | null;
  attempts: number;
  lastError: string | null;
  nextAttemptAt: string;
  createdAt: string;
  updatedAt: string;
}

export interface AttachmentRecord {
  id: string;
  tenantId: string;
  epcisEventId: string;
  type: string;
  objectStoreKey: string;
  sha256: string;
  mime: string | null;
  sizeBytes: number | null;
  createdAt: string;
}

export interface StagedAttachmentRecord {
  id: string;
  tenantId: string;
  sha256: string;
  objectStoreKey: string;
  type: string;
  mime: string | null;
  sizeBytes: number | null;
  sourceFileName: string | null;
  uploadedAt: string;
}

export interface CreateShipmentRecordInput
  extends Omit<
    ShipmentRecord,
    | "id"
    | "createdAt"
    | "updatedAt"
    | "tenantId"
    | "createIdempotencyKey"
    | "operationsBlocked"
    | "blockReason"
    | "reconciliationStatus"
    | "lastReconciledAt"
  > {
  tenantId?: string;
  createIdempotencyKey?: string | null;
  operationsBlocked?: boolean;
  blockReason?: string | null;
  reconciliationStatus?: ReconciliationStatus;
  lastReconciledAt?: string | null;
}

export interface CreateEpcisEventRecordInput
  extends Omit<
    EpcisEventRecord,
    | "id"
    | "createdAt"
    | "tenantId"
    | "idempotencyKey"
    | "processingStage"
    | "processingError"
    | "notarizationConfirmedAt"
    | "moveUpdatedAt"
    | "finalizedAt"
    | "moveTxDigest"
> {
  tenantId: string;
  idempotencyKey?: string | null;
  processingStage?: EventProcessingStage;
  processingError?: string | null;
  notarizationConfirmedAt?: string | null;
  moveUpdatedAt?: string | null;
  finalizedAt?: string | null;
  moveTxDigest?: string | null;
}

export interface CreateOutboxJobInput {
  kind: OutboxJobRecord["kind"];
  shipmentId: string;
  epcisEventId: string | null;
  dedupeKey?: string | null;
}

export interface CreateProofRecordInput
  extends Omit<ProofRecord, "id" | "checkedAt" | "verifyStatus"> {
  verifyStatus?: ProofRecord["verifyStatus"];
  checkedAt?: string | null;
}

export interface StageAttachmentInput {
  tenantId: string;
  sha256: string;
  objectStoreKey: string;
  type: string;
  mime: string | null;
  sizeBytes: number | null;
  sourceFileName: string | null;
}

export interface AuditLogRecord {
  id: string;
  tenantId: string;
  actorType: "SYSTEM" | "OPERATOR" | "SUPERVISOR" | "AUDITOR";
  actorId: string | null;
  action: string;
  shipmentId: string | null;
  epcisEventId: string | null;
  details: Record<string, unknown> | null;
  createdAt: string;
}

export interface CreateAuditLogInput extends Omit<AuditLogRecord, "id" | "createdAt"> {}

export interface ReconciliationAlertRecord {
  id: string;
  tenantId: string;
  shipmentId: string;
  epcisEventId: string | null;
  severity: "WARN" | "HIGH" | "CRITICAL";
  code: string;
  message: string;
  details: Record<string, unknown> | null;
  status: "OPEN" | "ACK" | "RESOLVED";
  createdAt: string;
  resolvedAt: string | null;
}

export interface CreateReconciliationAlertInput
  extends Omit<ReconciliationAlertRecord, "id" | "status" | "createdAt" | "resolvedAt"> {}

export type AdminActionType = "OPEN_DISPUTE" | "SUSPEND" | "CORRECTIVE_HANDOVER";
export type AdminActionRequestStatus =
  | "PENDING_APPROVAL"
  | "APPROVED"
  | "REJECTED"
  | "EXECUTED"
  | "CANCELLED";

export interface AdminActionRequestRecord {
  id: string;
  tenantId: string;
  shipmentId: string;
  action: AdminActionType;
  status: AdminActionRequestStatus;
  reason: string;
  payload: Record<string, unknown>;
  requesterSubject: string | null;
  requesterActorId: string | null;
  approverSubject: string | null;
  approverActorId: string | null;
  approvalNote: string | null;
  rejectNote: string | null;
  approvedAt: string | null;
  rejectedAt: string | null;
  executedAt: string | null;
  txDigest: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateAdminActionRequestInput
  extends Omit<
    AdminActionRequestRecord,
    | "id"
    | "status"
    | "approverSubject"
    | "approverActorId"
    | "approvalNote"
    | "rejectNote"
    | "approvedAt"
    | "rejectedAt"
    | "executedAt"
    | "txDigest"
    | "createdAt"
    | "updatedAt"
  > {}
