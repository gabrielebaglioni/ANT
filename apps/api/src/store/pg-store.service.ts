import { Inject, Injectable, Logger } from "@nestjs/common";
import type { EpcisEvent } from "@ant/shared";
import { getResolvedAppConfig } from "../config/env";
import { PostgresService, type Queryable } from "../db/postgres.service";
import {
  type AdminActionRequestRecord,
  type AttachmentRecord,
  type AuditLogRecord,
  type CreateAdminActionRequestInput,
  type CreateAuditLogInput,
  type CreateEpcisEventRecordInput,
  type CreateOutboxJobInput,
  type CreateProofRecordInput,
  type CreateReconciliationAlertInput,
  type CreateShipmentRecordInput,
  type EpcisEventRecord,
  type OutboxJobRecord,
  type ProofRecord,
  type ReconciliationAlertRecord,
  type ShipmentRecord,
  type StageAttachmentInput,
  type StagedAttachmentRecord,
} from "./store.types";

type DbRow = Record<string, unknown>;

function toIso(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  return String(value);
}

function mapShipmentRow(row: DbRow): ShipmentRecord {
  return {
    id: String(row.id),
    tenantId: row.tenant_id ? String(row.tenant_id) : "default",
    shipmentCode: String(row.shipment_code),
    createIdempotencyKey: row.create_idempotency_key ? String(row.create_idempotency_key) : null,
    trackingUnitType: row.tracking_unit_type as ShipmentRecord["trackingUnitType"],
    trackingId: String(row.tracking_id),
    epcClass: row.epc_class ? String(row.epc_class) : null,
    lotNumber: row.lot_number ? String(row.lot_number) : null,
    originReadPoint: row.origin_read_point ? String(row.origin_read_point) : null,
    originBizLocation: row.origin_biz_location ? String(row.origin_biz_location) : null,
    destinationReadPoint: row.destination_read_point
      ? String(row.destination_read_point)
      : null,
    destinationBizLocation: row.destination_biz_location
      ? String(row.destination_biz_location)
      : null,
    slaHours: Number(row.sla_hours),
    maxDelayHours: Number(row.max_delay_hours),
    conditions: (row.conditions as Record<string, unknown> | null) ?? null,
    producerDid: String(row.producer_did),
    carrierDid: String(row.carrier_did),
    receiverDid: String(row.receiver_did),
    moveObjectId: row.move_object_id ? String(row.move_object_id) : null,
    moveVersion:
      row.move_version === null || row.move_version === undefined
        ? null
        : Number(row.move_version),
    status: row.status as ShipmentRecord["status"],
    currentCustodianDid: row.current_custodian_did ? String(row.current_custodian_did) : null,
    expectedReceiverDid: row.expected_receiver_did ? String(row.expected_receiver_did) : null,
    operationsBlocked: Boolean(row.operations_blocked),
    blockReason: row.block_reason ? String(row.block_reason) : null,
    reconciliationStatus:
      (row.reconciliation_status as ShipmentRecord["reconciliationStatus"]) ?? "UNKNOWN",
    lastReconciledAt: row.last_reconciled_at ? toIso(row.last_reconciled_at) : null,
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  };
}

function mapEventRow(row: DbRow): EpcisEventRecord {
  return {
    id: String(row.id),
    shipmentId: String(row.shipment_id),
    tenantId: row.tenant_id ? String(row.tenant_id) : "default",
    idempotencyKey: row.idempotency_key ? String(row.idempotency_key) : null,
    type: String(row.type),
    eventTime: toIso(row.event_time),
    eventTimeZoneOffset: String(row.event_time_zone_offset),
    recordTime: row.record_time ? toIso(row.record_time) : null,
    action: row.action as EpcisEventRecord["action"],
    bizStep: String(row.biz_step),
    disposition: String(row.disposition),
    readPoint: String(row.read_point),
    bizLocation: String(row.biz_location),
    epcList: (row.epc_list as string[] | null) ?? null,
    quantityList: (row.quantity_list as unknown[] | null) ?? null,
    parentId: row.parent_id ? String(row.parent_id) : null,
    childEpcs: (row.child_epcs as string[] | null) ?? null,
    childQuantityList: (row.child_quantity_list as unknown[] | null) ?? null,
    payload: row.payload as EpcisEvent,
    payloadHash: String(row.payload_hash),
    previousEventId: row.previous_event_id ? String(row.previous_event_id) : null,
    processingStage:
      (row.processing_stage as EpcisEventRecord["processingStage"]) ?? "EVENT_CAPTURED",
    processingError: row.processing_error ? String(row.processing_error) : null,
    notarizationConfirmedAt: row.notarization_confirmed_at
      ? toIso(row.notarization_confirmed_at)
      : null,
    moveUpdatedAt: row.move_updated_at ? toIso(row.move_updated_at) : null,
    finalizedAt: row.finalized_at ? toIso(row.finalized_at) : null,
    moveTxDigest: row.move_tx_digest ? String(row.move_tx_digest) : null,
    createdAt: toIso(row.created_at),
  };
}

function mapProofRow(row: DbRow): ProofRecord {
  return {
    id: String(row.id),
    epcisEventId: String(row.epcis_event_id),
    method: row.method as ProofRecord["method"],
    notarizationObjectId: String(row.notarization_object_id),
    txDigest: String(row.tx_digest),
    anchoredHash: String(row.anchored_hash),
    anchoredAt: row.anchored_at ? toIso(row.anchored_at) : null,
    verifyStatus: row.verify_status as ProofRecord["verifyStatus"],
    checkedAt: row.checked_at ? toIso(row.checked_at) : null,
  };
}

function mapOutboxRow(row: DbRow): OutboxJobRecord {
  return {
    id: String(row.id),
    kind: row.kind as OutboxJobRecord["kind"],
    status: row.status as OutboxJobRecord["status"],
    shipmentId: String(row.shipment_id),
    epcisEventId: row.epcis_event_id ? String(row.epcis_event_id) : null,
    dedupeKey: row.dedupe_key ? String(row.dedupe_key) : null,
    attempts: Number(row.attempts),
    lastError: row.last_error ? String(row.last_error) : null,
    nextAttemptAt: row.next_attempt_at ? toIso(row.next_attempt_at) : toIso(new Date()),
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  };
}

function mapAttachmentRow(row: DbRow): AttachmentRecord {
  return {
    id: String(row.id),
    tenantId: row.tenant_id ? String(row.tenant_id) : "default",
    epcisEventId: String(row.epcis_event_id),
    type: String(row.type),
    objectStoreKey: String(row.object_store_key),
    sha256: String(row.sha256),
    mime: row.mime ? String(row.mime) : null,
    sizeBytes:
      row.size_bytes === null || row.size_bytes === undefined ? null : Number(row.size_bytes),
    createdAt: toIso(row.created_at),
  };
}

function mapStagedAttachmentRow(row: DbRow): StagedAttachmentRecord {
  return {
    id: String(row.id),
    tenantId: row.tenant_id ? String(row.tenant_id) : "default",
    sha256: String(row.sha256),
    objectStoreKey: String(row.object_store_key),
    type: String(row.type),
    mime: row.mime ? String(row.mime) : null,
    sizeBytes:
      row.size_bytes === null || row.size_bytes === undefined ? null : Number(row.size_bytes),
    sourceFileName: row.source_file_name ? String(row.source_file_name) : null,
    uploadedAt: toIso(row.uploaded_at),
  };
}

function mapAuditLogRow(row: DbRow): AuditLogRecord {
  return {
    id: String(row.id),
    tenantId: row.tenant_id ? String(row.tenant_id) : "default",
    actorType: row.actor_type as AuditLogRecord["actorType"],
    actorId: row.actor_id ? String(row.actor_id) : null,
    action: String(row.action),
    shipmentId: row.shipment_id ? String(row.shipment_id) : null,
    epcisEventId: row.epcis_event_id ? String(row.epcis_event_id) : null,
    details: (row.details as Record<string, unknown> | null) ?? null,
    createdAt: toIso(row.created_at),
  };
}

function mapReconciliationAlertRow(row: DbRow): ReconciliationAlertRecord {
  return {
    id: String(row.id),
    tenantId: row.tenant_id ? String(row.tenant_id) : "default",
    shipmentId: String(row.shipment_id),
    epcisEventId: row.epcis_event_id ? String(row.epcis_event_id) : null,
    severity: row.severity as ReconciliationAlertRecord["severity"],
    code: String(row.code),
    message: String(row.message),
    details: (row.details as Record<string, unknown> | null) ?? null,
    status: row.status as ReconciliationAlertRecord["status"],
    createdAt: toIso(row.created_at),
    resolvedAt: row.resolved_at ? toIso(row.resolved_at) : null,
  };
}

function mapAdminActionRequestRow(row: DbRow): AdminActionRequestRecord {
  return {
    id: String(row.id),
    tenantId: row.tenant_id ? String(row.tenant_id) : "default",
    shipmentId: String(row.shipment_id),
    action: row.action as AdminActionRequestRecord["action"],
    status: row.status as AdminActionRequestRecord["status"],
    reason: String(row.reason),
    payload: (row.payload as Record<string, unknown>) ?? {},
    requesterSubject: row.requester_subject ? String(row.requester_subject) : null,
    requesterActorId: row.requester_actor_id ? String(row.requester_actor_id) : null,
    approverSubject: row.approver_subject ? String(row.approver_subject) : null,
    approverActorId: row.approver_actor_id ? String(row.approver_actor_id) : null,
    approvalNote: row.approval_note ? String(row.approval_note) : null,
    rejectNote: row.reject_note ? String(row.reject_note) : null,
    approvedAt: row.approved_at ? toIso(row.approved_at) : null,
    rejectedAt: row.rejected_at ? toIso(row.rejected_at) : null,
    executedAt: row.executed_at ? toIso(row.executed_at) : null,
    txDigest: row.tx_digest ? String(row.tx_digest) : null,
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  };
}

@Injectable()
export class PgStoreService {
  private readonly logger = new Logger(PgStoreService.name);
  constructor(@Inject(PostgresService) private readonly pg: PostgresService) {}

  withTransaction<T>(fn: (client: Queryable) => Promise<T>): Promise<T> {
    return this.pg.withTransaction(async (client) => fn(client));
  }

  async createShipment(
    input: CreateShipmentRecordInput,
    client?: Queryable,
  ): Promise<ShipmentRecord> {
    const { rows } = await this.pg.query<DbRow>(
      `
      insert into shipments (
        tenant_id, shipment_code, create_idempotency_key, tracking_unit_type, tracking_id, epc_class, lot_number,
        origin_read_point, origin_biz_location, destination_read_point, destination_biz_location,
        sla_hours, max_delay_hours, conditions,
        producer_did, carrier_did, receiver_did,
        move_object_id, move_version, status, current_custodian_did, expected_receiver_did,
        operations_blocked, block_reason, reconciliation_status, last_reconciled_at
      ) values (
        $1,$2,$3,$4,$5,$6,$7,
        $8,$9,$10,$11,
        $12,$13,$14::jsonb,
        $15,$16,$17,
        $18,$19,$20,$21,$22,
        $23,$24,$25,$26::timestamptz
      )
      returning *
      `,
      [
        input.tenantId ?? "default",
        input.shipmentCode,
        input.createIdempotencyKey ?? null,
        input.trackingUnitType,
        input.trackingId,
        input.epcClass,
        input.lotNumber,
        input.originReadPoint,
        input.originBizLocation,
        input.destinationReadPoint,
        input.destinationBizLocation,
        input.slaHours,
        input.maxDelayHours,
        input.conditions ? JSON.stringify(input.conditions) : null,
        input.producerDid,
        input.carrierDid,
        input.receiverDid,
        input.moveObjectId,
        input.moveVersion,
        input.status,
        input.currentCustodianDid,
        input.expectedReceiverDid,
        input.operationsBlocked ?? false,
        input.blockReason ?? null,
        input.reconciliationStatus ?? "UNKNOWN",
        input.lastReconciledAt ?? null,
      ],
      client,
    );
    return mapShipmentRow(rows[0] as DbRow);
  }

  async updateShipment(
    id: string,
    patch: Partial<ShipmentRecord>,
    client?: Queryable,
  ): Promise<ShipmentRecord> {
    const fields: string[] = [];
    const values: unknown[] = [];
    let i = 1;
    const set = (column: string, value: unknown) => {
      fields.push(`${column} = $${i++}`);
      values.push(value);
    };

    if ("status" in patch) set("status", patch.status ?? null);
    if ("currentCustodianDid" in patch) set("current_custodian_did", patch.currentCustodianDid);
    if ("expectedReceiverDid" in patch) set("expected_receiver_did", patch.expectedReceiverDid);
    if ("moveVersion" in patch) set("move_version", patch.moveVersion);
    if ("moveObjectId" in patch) set("move_object_id", patch.moveObjectId);
    if ("operationsBlocked" in patch) set("operations_blocked", patch.operationsBlocked);
    if ("blockReason" in patch) set("block_reason", patch.blockReason);
    if ("reconciliationStatus" in patch)
      set("reconciliation_status", patch.reconciliationStatus);
    if ("lastReconciledAt" in patch) set("last_reconciled_at", patch.lastReconciledAt);

    set("updated_at", new Date());
    values.push(id);

    const { rows } = await this.pg.query<DbRow>(
      `update shipments set ${fields.join(", ")} where id = $${i} returning *`,
      values,
      client,
    );
    return mapShipmentRow(rows[0] as DbRow);
  }

  async getShipmentByCode(
    code: string,
    tenantId?: string,
    client?: Queryable,
  ): Promise<ShipmentRecord | null> {
    const params: unknown[] = [code];
    const tenantClause = tenantId ? ` and tenant_id = $2` : "";
    if (tenantId) params.push(tenantId);
    const { rows } = await this.pg.query<DbRow>(
      `select * from shipments where shipment_code = $1${tenantClause} limit 1`,
      params,
      client,
    );
    return rows[0] ? mapShipmentRow(rows[0] as DbRow) : null;
  }

  async getShipmentByCreateIdempotencyKey(
    idempotencyKey: string,
    tenantId?: string,
    client?: Queryable,
  ): Promise<ShipmentRecord | null> {
    const params: unknown[] = [idempotencyKey];
    const tenantClause = tenantId ? ` and tenant_id = $2` : "";
    if (tenantId) params.push(tenantId);
    const { rows } = await this.pg.query<DbRow>(
      `select * from shipments where create_idempotency_key = $1${tenantClause} limit 1`,
      params,
      client,
    );
    return rows[0] ? mapShipmentRow(rows[0] as DbRow) : null;
  }

  async getShipmentById(id: string, client?: Queryable): Promise<ShipmentRecord | null> {
    const { rows } = await this.pg.query<DbRow>(
      `select * from shipments where id = $1 limit 1`,
      [id],
      client,
    );
    return rows[0] ? mapShipmentRow(rows[0] as DbRow) : null;
  }

  async listShipmentsByTenant(
    tenantId: string,
    options?: {
      limit?: number;
    },
    client?: Queryable,
  ): Promise<ShipmentRecord[]> {
    const limit = Math.max(1, Math.min(options?.limit ?? 25, 200));
    const { rows } = await this.pg.query<DbRow>(
      `
      select *
      from shipments
      where tenant_id = $1
      order by updated_at desc, created_at desc
      limit $2
      `,
      [tenantId, limit],
      client,
    );
    return rows.map((row: DbRow) => mapShipmentRow(row));
  }

  async createEvent(input: CreateEpcisEventRecordInput, client?: Queryable): Promise<EpcisEventRecord> {
    const { rows } = await this.pg.query<DbRow>(
      `
      insert into epcis_events (
        tenant_id, shipment_id, type, event_time, event_time_zone_offset, record_time,
        action, biz_step, disposition, read_point, biz_location,
        epc_list, quantity_list, parent_id, child_epcs, child_quantity_list,
        payload, payload_hash, previous_event_id,
        idempotency_key, processing_stage, processing_error,
        notarization_confirmed_at, move_updated_at, finalized_at, move_tx_digest
      ) values (
        $1,$2,$3,$4::timestamptz,$5,$6::timestamptz,
        $7,$8,$9,$10,$11,
        $12,$13::jsonb,$14,$15,$16::jsonb,
        $17::jsonb,$18,$19,
        $20,$21,$22,
        $23::timestamptz,$24::timestamptz,$25::timestamptz,$26
      )
      returning *
      `,
      [
        input.tenantId,
        input.shipmentId,
        input.type,
        input.eventTime,
        input.eventTimeZoneOffset,
        input.recordTime,
        input.action,
        input.bizStep,
        input.disposition,
        input.readPoint,
        input.bizLocation,
        input.epcList,
        input.quantityList ? JSON.stringify(input.quantityList) : null,
        input.parentId,
        input.childEpcs,
        input.childQuantityList ? JSON.stringify(input.childQuantityList) : null,
        JSON.stringify(input.payload),
        input.payloadHash,
        input.previousEventId,
        input.idempotencyKey ?? null,
        input.processingStage ?? "EVENT_CAPTURED",
        input.processingError ?? null,
        input.notarizationConfirmedAt ?? null,
        input.moveUpdatedAt ?? null,
        input.finalizedAt ?? null,
        input.moveTxDigest ?? null,
      ],
      client,
    );
    return mapEventRow(rows[0] as DbRow);
  }

  async getEventById(id: string, client?: Queryable): Promise<EpcisEventRecord | null> {
    const { rows } = await this.pg.query<DbRow>(
      `select * from epcis_events where id = $1 limit 1`,
      [id],
      client,
    );
    return rows[0] ? mapEventRow(rows[0] as DbRow) : null;
  }

  async getEventByIdempotencyKey(
    idempotencyKey: string,
    tenantId?: string,
    client?: Queryable,
  ): Promise<EpcisEventRecord | null> {
    const params: unknown[] = [idempotencyKey];
    const tenantClause = tenantId ? ` and tenant_id = $2` : "";
    if (tenantId) params.push(tenantId);
    const { rows } = await this.pg.query<DbRow>(
      `select * from epcis_events where idempotency_key = $1${tenantClause} limit 1`,
      params,
      client,
    );
    return rows[0] ? mapEventRow(rows[0] as DbRow) : null;
  }

  async listEventsByShipmentId(
    shipmentId: string,
    client?: Queryable,
  ): Promise<EpcisEventRecord[]> {
    const { rows } = await this.pg.query<DbRow>(
      `select * from epcis_events where shipment_id = $1 order by event_time asc, created_at asc`,
      [shipmentId],
      client,
    );
    return rows.map((r: DbRow) => mapEventRow(r));
  }

  async updateEventProcessing(
    eventId: string,
    patch: Partial<
      Pick<
        EpcisEventRecord,
        | "processingStage"
        | "processingError"
        | "notarizationConfirmedAt"
        | "moveUpdatedAt"
        | "finalizedAt"
        | "moveTxDigest"
      >
    >,
    client?: Queryable,
  ): Promise<EpcisEventRecord | null> {
    const fields: string[] = [];
    const values: unknown[] = [];
    let i = 1;
    const set = (column: string, value: unknown) => {
      fields.push(`${column} = $${i++}`);
      values.push(value);
    };
    if ("processingStage" in patch) set("processing_stage", patch.processingStage);
    if ("processingError" in patch) set("processing_error", patch.processingError);
    if ("notarizationConfirmedAt" in patch)
      set("notarization_confirmed_at", patch.notarizationConfirmedAt);
    if ("moveUpdatedAt" in patch) set("move_updated_at", patch.moveUpdatedAt);
    if ("finalizedAt" in patch) set("finalized_at", patch.finalizedAt);
    if ("moveTxDigest" in patch) set("move_tx_digest", patch.moveTxDigest);
    if (fields.length === 0) return this.getEventById(eventId, client);
    values.push(eventId);
    const { rows } = await this.pg.query<DbRow>(
      `update epcis_events set ${fields.join(", ")} where id = $${i} returning *`,
      values,
      client,
    );
    return rows[0] ? mapEventRow(rows[0] as DbRow) : null;
  }

  async createOrReplaceProof(input: CreateProofRecordInput, client?: Queryable): Promise<ProofRecord> {
    const { rows } = await this.pg.query<DbRow>(
      `
      insert into proofs (
        epcis_event_id, method, notarization_object_id, tx_digest,
        anchored_hash, anchored_at, verify_status, checked_at
      ) values ($1,$2,$3,$4,$5,$6::timestamptz,$7,$8::timestamptz)
      on conflict (epcis_event_id) do update set
        method = excluded.method,
        notarization_object_id = excluded.notarization_object_id,
        tx_digest = excluded.tx_digest,
        anchored_hash = excluded.anchored_hash,
        anchored_at = excluded.anchored_at,
        verify_status = excluded.verify_status,
        checked_at = excluded.checked_at
      returning *
      `,
      [
        input.epcisEventId,
        input.method,
        input.notarizationObjectId,
        input.txDigest,
        input.anchoredHash,
        input.anchoredAt,
        input.verifyStatus ?? "PENDING",
        input.checkedAt ?? null,
      ],
      client,
    );
    return mapProofRow(rows[0] as DbRow);
  }

  async updateProofByEventId(
    epcisEventId: string,
    patch: Partial<ProofRecord>,
    client?: Queryable,
  ): Promise<ProofRecord | null> {
    const fields: string[] = [];
    const values: unknown[] = [];
    let i = 1;
    const set = (column: string, value: unknown) => {
      fields.push(`${column} = $${i++}`);
      values.push(value);
    };

    if ("verifyStatus" in patch) set("verify_status", patch.verifyStatus);
    if ("checkedAt" in patch) set("checked_at", patch.checkedAt);
    if ("anchoredAt" in patch) set("anchored_at", patch.anchoredAt);
    if ("txDigest" in patch) set("tx_digest", patch.txDigest);

    if (fields.length === 0) {
      return this.getProofByEventId(epcisEventId, client);
    }

    values.push(epcisEventId);
    const { rows } = await this.pg.query<DbRow>(
      `update proofs set ${fields.join(", ")} where epcis_event_id = $${i} returning *`,
      values,
      client,
    );
    return rows[0] ? mapProofRow(rows[0] as DbRow) : null;
  }

  async getProofByEventId(epcisEventId: string, client?: Queryable): Promise<ProofRecord | null> {
    const { rows } = await this.pg.query<DbRow>(
      `select * from proofs where epcis_event_id = $1 limit 1`,
      [epcisEventId],
      client,
    );
    return rows[0] ? mapProofRow(rows[0] as DbRow) : null;
  }

  async listProofsByShipmentId(shipmentId: string, client?: Queryable): Promise<ProofRecord[]> {
    const { rows } = await this.pg.query<DbRow>(
      `
      select p.* from proofs p
      join epcis_events e on e.id = p.epcis_event_id
      where e.shipment_id = $1
      order by e.event_time asc
      `,
      [shipmentId],
      client,
    );
    return rows.map((r: DbRow) => mapProofRow(r));
  }

  async enqueueOutbox(input: CreateOutboxJobInput, client?: Queryable): Promise<OutboxJobRecord> {
    if (!input.dedupeKey) {
      const { rows } = await this.pg.query<DbRow>(
        `
        insert into outbox_jobs (kind, shipment_id, epcis_event_id, dedupe_key)
        values ($1,$2,$3,null)
        returning *
        `,
        [input.kind, input.shipmentId, input.epcisEventId],
        client,
      );
      return mapOutboxRow(rows[0] as DbRow);
    }

    const { rows } = await this.pg.query<DbRow>(
      `
      insert into outbox_jobs (kind, shipment_id, epcis_event_id, dedupe_key)
      values ($1,$2,$3,$4)
      on conflict (dedupe_key) where dedupe_key is not null do update set
        updated_at = now()
      returning *
      `,
      [input.kind, input.shipmentId, input.epcisEventId, input.dedupeKey],
      client,
    );
    return mapOutboxRow(rows[0] as DbRow);
  }

  async claimNextOutboxJob(
    kind?: OutboxJobRecord["kind"],
    client?: Queryable,
  ): Promise<OutboxJobRecord | null> {
    const params: unknown[] = [];
    const kindFilter = kind ? `and kind = $1` : "";
    if (kind) params.push(kind);
    const { rows } = await this.pg.query<DbRow>(
      `
      with next_job as (
        select id
        from outbox_jobs
        where status = 'PENDING'
          and next_attempt_at <= now()
        ${kindFilter}
        order by created_at asc
        for update skip locked
        limit 1
      )
      update outbox_jobs o
      set status = 'IN_PROGRESS',
          attempts = o.attempts + 1,
          updated_at = now()
      from next_job
      where o.id = next_job.id
      returning o.*
      `,
      params,
      client,
    );
    return rows[0] ? mapOutboxRow(rows[0] as DbRow) : null;
  }

  async completeOutboxJob(id: string, client?: Queryable): Promise<void> {
    await this.pg.query(
      `update outbox_jobs set status = 'DONE', updated_at = now() where id = $1`,
      [id],
      client,
    );
  }

  async failOutboxJob(id: string, errorMessage: string, client?: Queryable): Promise<void> {
    await this.pg.query(
      `update outbox_jobs set status = 'FAILED', last_error = $2, updated_at = now() where id = $1`,
      [id, errorMessage],
      client,
    );
  }

  async requeueOutboxJob(id: string, errorMessage: string, client?: Queryable): Promise<void> {
    await this.pg.query(
      `update outbox_jobs
       set status = 'PENDING',
           last_error = $2,
           next_attempt_at = now() + make_interval(secs => least(300, greatest(2, attempts * 2))),
           updated_at = now()
       where id = $1`,
      [id, errorMessage],
      client,
    );
  }

  async stageAttachmentUpload(
    input: StageAttachmentInput,
    client?: Queryable,
  ): Promise<StagedAttachmentRecord> {
    const { rows } = await this.pg.query<DbRow>(
      `
      insert into staged_attachments (
        tenant_id, sha256, object_store_key, type, mime, size_bytes, source_file_name
      ) values ($1,$2,$3,$4,$5,$6,$7)
      on conflict (tenant_id, sha256) do update set
        object_store_key = excluded.object_store_key,
        type = excluded.type,
        mime = excluded.mime,
        size_bytes = excluded.size_bytes,
        source_file_name = excluded.source_file_name,
        uploaded_at = now()
      returning *
      `,
      [
        input.tenantId,
        input.sha256,
        input.objectStoreKey,
        input.type,
        input.mime,
        input.sizeBytes,
        input.sourceFileName,
      ],
      client,
    );
    return mapStagedAttachmentRow(rows[0] as DbRow);
  }

  async getStagedAttachmentBySha256(
    sha256: string,
    tenantId: string,
    client?: Queryable,
  ): Promise<StagedAttachmentRecord | null> {
    const { rows } = await this.pg.query<DbRow>(
      `select * from staged_attachments where sha256 = $1 and tenant_id = $2 limit 1`,
      [sha256, tenantId],
      client,
    );
    return rows[0] ? mapStagedAttachmentRow(rows[0] as DbRow) : null;
  }

  async listStagedAttachmentsBySha256(
    hashes: string[],
    tenantId: string,
    client?: Queryable,
  ): Promise<StagedAttachmentRecord[]> {
    if (hashes.length === 0) return [];
    const { rows } = await this.pg.query<DbRow>(
      `select * from staged_attachments where sha256 = any($1::text[]) and tenant_id = $2`,
      [hashes, tenantId],
      client,
    );
    return rows.map((r: DbRow) => mapStagedAttachmentRow(r));
  }

  async createAttachmentForEvent(
    epcisEventId: string,
    attachment: {
      tenantId: string;
      type: string;
      objectStoreKey: string;
      sha256: string;
      mime: string | null;
      sizeBytes: number | null;
    },
    client?: Queryable,
  ): Promise<AttachmentRecord> {
    const { rows } = await this.pg.query<DbRow>(
      `
      insert into attachments (tenant_id, epcis_event_id, type, object_store_key, sha256, mime, size_bytes)
      values ($1,$2,$3,$4,$5,$6,$7)
      on conflict (epcis_event_id, sha256) do update set
        tenant_id = excluded.tenant_id,
        type = excluded.type,
        object_store_key = excluded.object_store_key,
        mime = excluded.mime,
        size_bytes = excluded.size_bytes
      returning *
      `,
      [
        attachment.tenantId,
        epcisEventId,
        attachment.type,
        attachment.objectStoreKey,
        attachment.sha256,
        attachment.mime,
        attachment.sizeBytes,
      ],
      client,
    );
    return mapAttachmentRow(rows[0] as DbRow);
  }

  async listAttachmentsByEventId(epcisEventId: string, client?: Queryable): Promise<AttachmentRecord[]> {
    const { rows } = await this.pg.query<DbRow>(
      `select * from attachments where epcis_event_id = $1 order by created_at asc`,
      [epcisEventId],
      client,
    );
    return rows.map((r: DbRow) => mapAttachmentRow(r));
  }

  async appendAuditLog(input: CreateAuditLogInput, client?: Queryable): Promise<AuditLogRecord> {
    const { rows } = await this.pg.query<DbRow>(
      `
      insert into audit_log (
        tenant_id, actor_type, actor_id, action, shipment_id, epcis_event_id, details
      ) values (
        $1,$2,$3,$4,$5,$6,$7::jsonb
      )
      returning *
      `,
      [
        input.tenantId,
        input.actorType,
        input.actorId,
        input.action,
        input.shipmentId,
        input.epcisEventId,
        input.details ? JSON.stringify(input.details) : null,
      ],
      client,
    );
    const record = mapAuditLogRow(rows[0] as DbRow);
    // Best-effort mirror to an immutable archive collector (WORM sink).
    // Skip inside an open DB transaction to avoid archiving rows that could still roll back.
    if (!client) {
      void this.mirrorAuditLogToWorm(record);
    }
    return record;
  }

  async listAuditLogsByShipmentId(
    shipmentId: string,
    tenantId?: string,
    client?: Queryable,
  ): Promise<AuditLogRecord[]> {
    const query =
      tenantId && tenantId.trim()
        ? `select * from audit_log where shipment_id = $1 and tenant_id = $2 order by created_at asc`
        : `select * from audit_log where shipment_id = $1 order by created_at asc`;
    const params = tenantId && tenantId.trim() ? [shipmentId, tenantId] : [shipmentId];
    const { rows } = await this.pg.query<DbRow>(query, params, client);
    return rows.map((r: DbRow) => mapAuditLogRow(r));
  }

  async createReconciliationAlert(
    input: CreateReconciliationAlertInput,
    client?: Queryable,
  ): Promise<ReconciliationAlertRecord> {
    const { rows } = await this.pg.query<DbRow>(
      `
      insert into reconciliation_alerts (
        tenant_id, shipment_id, epcis_event_id, severity, code, message, details
      ) values (
        $1,$2,$3,$4,$5,$6,$7::jsonb
      )
      returning *
      `,
      [
        input.tenantId,
        input.shipmentId,
        input.epcisEventId,
        input.severity,
        input.code,
        input.message,
        input.details ? JSON.stringify(input.details) : null,
      ],
      client,
    );
    return mapReconciliationAlertRow(rows[0] as DbRow);
  }

  async listShipmentsForReconciliation(
    limit = 50,
    client?: Queryable,
  ): Promise<ShipmentRecord[]> {
    const { rows } = await this.pg.query<DbRow>(
      `
      select *
      from shipments
      where move_object_id is not null
      order by coalesce(last_reconciled_at, to_timestamp(0)) asc, updated_at asc
      limit $1
      `,
      [limit],
      client,
    );
    return rows.map((r: DbRow) => mapShipmentRow(r));
  }

  async createAdminActionRequest(
    input: CreateAdminActionRequestInput,
    client?: Queryable,
  ): Promise<AdminActionRequestRecord> {
    const { rows } = await this.pg.query<DbRow>(
      `
      insert into admin_action_requests (
        tenant_id, shipment_id, action, reason, payload,
        requester_subject, requester_actor_id
      ) values (
        $1,$2,$3,$4,$5::jsonb,$6,$7
      )
      returning *
      `,
      [
        input.tenantId,
        input.shipmentId,
        input.action,
        input.reason,
        JSON.stringify(input.payload),
        input.requesterSubject,
        input.requesterActorId,
      ],
      client,
    );
    return mapAdminActionRequestRow(rows[0] as DbRow);
  }

  async getAdminActionRequestById(
    id: string,
    tenantId?: string,
    client?: Queryable,
  ): Promise<AdminActionRequestRecord | null> {
    const params: unknown[] = [id];
    const tenantClause = tenantId ? ` and tenant_id = $2` : "";
    if (tenantId) params.push(tenantId);
    const { rows } = await this.pg.query<DbRow>(
      `select * from admin_action_requests where id = $1${tenantClause} limit 1`,
      params,
      client,
    );
    return rows[0] ? mapAdminActionRequestRow(rows[0] as DbRow) : null;
  }

  async updateAdminActionRequest(
    id: string,
    patch: Partial<
      Pick<
        AdminActionRequestRecord,
        | "status"
        | "approverSubject"
        | "approverActorId"
        | "approvalNote"
        | "rejectNote"
        | "approvedAt"
        | "rejectedAt"
        | "executedAt"
        | "txDigest"
      >
    >,
    client?: Queryable,
  ): Promise<AdminActionRequestRecord | null> {
    const fields: string[] = [];
    const values: unknown[] = [];
    let i = 1;
    const set = (column: string, value: unknown) => {
      fields.push(`${column} = $${i++}`);
      values.push(value);
    };
    if ("status" in patch) set("status", patch.status);
    if ("approverSubject" in patch) set("approver_subject", patch.approverSubject);
    if ("approverActorId" in patch) set("approver_actor_id", patch.approverActorId);
    if ("approvalNote" in patch) set("approval_note", patch.approvalNote);
    if ("rejectNote" in patch) set("reject_note", patch.rejectNote);
    if ("approvedAt" in patch) set("approved_at", patch.approvedAt);
    if ("rejectedAt" in patch) set("rejected_at", patch.rejectedAt);
    if ("executedAt" in patch) set("executed_at", patch.executedAt);
    if ("txDigest" in patch) set("tx_digest", patch.txDigest);
    if (fields.length === 0) return this.getAdminActionRequestById(id, undefined, client);
    set("updated_at", new Date());
    values.push(id);
    const { rows } = await this.pg.query<DbRow>(
      `update admin_action_requests set ${fields.join(", ")} where id = $${i} returning *`,
      values,
      client,
    );
    return rows[0] ? mapAdminActionRequestRow(rows[0] as DbRow) : null;
  }

  async getOpsMetrics(client?: Queryable): Promise<{
    outbox: {
      pending: number;
      inProgress: number;
      failed: number;
      retrying: number;
      maxLagSeconds: number;
      retriesLastHour: number;
    };
    reconciliation: {
      openAlerts: number;
      criticalOpenAlerts: number;
      mismatchesLast24h: number;
      failuresLastHour: number;
    };
    shipments: {
      blocked: number;
      provisioningFailed: number;
    };
  }> {
    const [outboxRes, reconRes, shipRes] = await Promise.all([
      this.pg.query<DbRow>(
        `
        select
          count(*) filter (where status = 'PENDING')::int as pending,
          count(*) filter (where status = 'IN_PROGRESS')::int as in_progress,
          count(*) filter (where status = 'FAILED')::int as failed,
          count(*) filter (where attempts > 1 and status in ('PENDING','IN_PROGRESS'))::int as retrying,
          coalesce(max(extract(epoch from (now() - created_at))) filter (where status = 'PENDING'), 0)::int as max_lag_seconds,
          count(*) filter (where attempts > 1 and updated_at > now() - interval '1 hour')::int as retries_last_hour
        from outbox_jobs
        `,
        [],
        client,
      ),
      this.pg.query<DbRow>(
        `
        select
          count(*) filter (where status = 'OPEN')::int as open_alerts,
          count(*) filter (where status = 'OPEN' and severity = 'CRITICAL')::int as critical_open_alerts,
          count(*) filter (where code like '%MISMATCH%' and created_at > now() - interval '24 hour')::int as mismatches_last_24h,
          count(*) filter (where code in ('CHAIN_UNAVAILABLE','PROOF_MISSING') and created_at > now() - interval '1 hour')::int as failures_last_hour
        from reconciliation_alerts
        `,
        [],
        client,
      ),
      this.pg.query<DbRow>(
        `
        select
          count(*) filter (where operations_blocked = true)::int as blocked,
          count(*) filter (where status = 'PROVISIONING_FAILED')::int as provisioning_failed
        from shipments
        `,
        [],
        client,
      ),
    ]);

    const o = (outboxRes.rows[0] ?? {}) as DbRow;
    const r = (reconRes.rows[0] ?? {}) as DbRow;
    const s = (shipRes.rows[0] ?? {}) as DbRow;

    return {
      outbox: {
        pending: Number(o.pending ?? 0),
        inProgress: Number(o.in_progress ?? 0),
        failed: Number(o.failed ?? 0),
        retrying: Number(o.retrying ?? 0),
        maxLagSeconds: Number(o.max_lag_seconds ?? 0),
        retriesLastHour: Number(o.retries_last_hour ?? 0),
      },
      reconciliation: {
        openAlerts: Number(r.open_alerts ?? 0),
        criticalOpenAlerts: Number(r.critical_open_alerts ?? 0),
        mismatchesLast24h: Number(r.mismatches_last_24h ?? 0),
        failuresLastHour: Number(r.failures_last_hour ?? 0),
      },
      shipments: {
        blocked: Number(s.blocked ?? 0),
        provisioningFailed: Number(s.provisioning_failed ?? 0),
      },
    };
  }

  private async mirrorAuditLogToWorm(record: AuditLogRecord): Promise<void> {
    const cfg = getResolvedAppConfig();
    const url = cfg.audit.wormArchiveUrl;
    if (!url) return;
    try {
      await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          stream: "audit_log",
          immutableKey: `tenant=${record.tenantId}/date=${record.createdAt.slice(0, 10)}/${record.id}.json`,
          record,
        }),
      });
    } catch (error) {
      this.logger.warn(
        `Audit WORM mirror failed for ${record.id}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }
}
