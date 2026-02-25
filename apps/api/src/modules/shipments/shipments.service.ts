import {
  BottleneckResultSchema,
  CreateShipmentRequestSchema,
  HandoverRequestSchema,
  type ShipmentIssueHistory,
  type BottleneckResult,
  type CreateShipmentResponse,
  type HandoverRequest,
  type ShipmentStateReadModel,
  type ShipmentWorkspaceList,
} from "@ant/shared";
import { z } from "zod";
import { Inject, Injectable } from "@nestjs/common";
import { AppError } from "../../lib/errors";
import { newShipmentCode } from "../../lib/id";
import { PgStoreService } from "../../store/pg-store.service";
import type { AuthContext } from "../auth/auth.types";
import { EpcisCaptureService } from "../epcis/epcis.capture.service";
import { EpcisQueryService } from "../epcis/epcis.query.service";
import { buildHandoverInEvent, buildHandoverOutEvent } from "../epcis/epcis.mapper";
import { AttachmentsService } from "../attachments/attachments.service";
import { ShipmentsRepoPg } from "./shipments.repo.pg";
import { getResolvedAppConfig } from "../../config/env";

const ReportShipmentIssueSchema = z.object({
  title: z.string().min(3).optional(),
  description: z.string().min(3).max(4000),
  category: z
    .enum([
      "DAMAGED",
      "TEMPERATURE",
      "SEAL",
      "MISMATCH",
      "DELAY",
      "WEATHER",
      "INCIDENT",
      "TRANSPORT",
      "STORAGE",
      "QUALITY",
      "NOTICE",
      "OTHER",
    ])
    .default("DAMAGED"),
  subcategory: z.string().min(2).max(120).optional(),
  severity: z.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"]).default("MEDIUM"),
  damaged: z.boolean().default(false),
  notifyNextActor: z.boolean().default(false),
  attachments: z.array(z.string().regex(/^[a-f0-9]{64}$/i)).default([]),
});

@Injectable()
export class ShipmentsService {
  constructor(
    @Inject(ShipmentsRepoPg) private readonly shipmentsRepo: ShipmentsRepoPg,
    @Inject(PgStoreService) private readonly store: PgStoreService,
    @Inject(EpcisCaptureService)
    private readonly epcisCaptureService: EpcisCaptureService,
    @Inject(EpcisQueryService) private readonly epcisQueryService: EpcisQueryService,
    @Inject(AttachmentsService) private readonly attachmentsService: AttachmentsService,
  ) {}

  async createShipment(
    body: unknown,
    idempotencyKey?: string,
    auth?: AuthContext,
  ): Promise<CreateShipmentResponse> {
    const tenantId = auth?.tenantId ?? "default";
    const safeIdempotencyKey = this.scopedIdempotencyKey(
      tenantId,
      this.requireIdempotencyKey(idempotencyKey, "create shipment"),
    );
    const existing = await this.store.getShipmentByCreateIdempotencyKey(safeIdempotencyKey, tenantId);
    if (existing) {
      return this.mapCreateShipmentResponse(existing);
    }

    const request = CreateShipmentRequestSchema.parse(body);
    const initialNextActorDid = this.resolveInitialNextActorDid(request);
    const shipmentCode = newShipmentCode();
    const shipment = await this.store.withTransaction(async (tx) => {
      const row = await this.store.createShipment(
        {
          tenantId,
          createIdempotencyKey: safeIdempotencyKey,
          shipmentCode,
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
          currentCustodianDid: request.participants.producerDid,
          expectedReceiverDid: initialNextActorDid,
          operationsBlocked: false,
          blockReason: null,
          reconciliationStatus: "UNKNOWN",
          lastReconciledAt: null,
        },
        tx,
      );

      await this.store.enqueueOutbox(
        {
          kind: "MOVE_CREATE",
          shipmentId: row.id,
          epcisEventId: null,
          dedupeKey: `shipment:${row.id}:move-create`,
        },
        tx,
      );

      await this.store.appendAuditLog(
        {
          tenantId: row.tenantId,
          actorType: "OPERATOR",
          actorId: request.participants.producerDid,
          action: "CREATE_SHIPMENT_ACCEPTED",
          shipmentId: row.id,
          epcisEventId: null,
          details: {
            shipmentCode: row.shipmentCode,
            createIdempotencyKey: idempotencyKey ?? null,
            status: row.status,
          },
        },
        tx,
      );

      return row;
    });

    return this.mapCreateShipmentResponse(shipment);
  }

  async listRecentShipments(auth?: AuthContext, limitRaw?: string): Promise<ShipmentWorkspaceList> {
    const tenantId = auth?.tenantId ?? "default";
    const limit = this.parseListLimit(limitRaw);
    const rows = await this.store.listShipmentsByTenant(tenantId, { limit });
    return rows.map((row) => ({
      shipmentCode: row.shipmentCode,
      trackingUnitType: row.trackingUnitType,
      trackingId: row.trackingId,
      originReadPoint: row.originReadPoint,
      originBizLocation: row.originBizLocation,
      destinationReadPoint: row.destinationReadPoint,
      destinationBizLocation: row.destinationBizLocation,
      conditions: row.conditions ?? null,
      producerDid: row.producerDid,
      carrierDid: row.carrierDid,
      receiverDid: row.receiverDid,
      status: row.status,
      currentCustodianDid: row.currentCustodianDid,
      expectedReceiverDid: row.expectedReceiverDid,
      operationsBlocked: row.operationsBlocked,
      blockReason: row.blockReason,
      reconciliationStatus: row.reconciliationStatus,
      moveObjectId: row.moveObjectId,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    }));
  }

  async getState(shipmentCode: string, auth?: AuthContext): Promise<ShipmentStateReadModel> {
    const shipment = await this.shipmentsRepo.getByCodeOrThrow(shipmentCode, auth?.tenantId);
    const events = await this.store.listEventsByShipmentId(shipment.id);
    const lastEvent = events[events.length - 1] ?? null;
    const lastProof = lastEvent ? await this.store.getProofByEventId(lastEvent.id) : null;

    return {
      shipmentCode: shipment.shipmentCode,
      status: shipment.status,
      operationsBlocked: shipment.operationsBlocked,
      blockReason: shipment.blockReason,
      reconciliationStatus: shipment.reconciliationStatus,
      currentCustodianDid: shipment.currentCustodianDid,
      expectedReceiverDid: shipment.expectedReceiverDid,
      moveObjectId: shipment.moveObjectId,
      lastProof: lastProof
        ? {
            notarizationObjectId: lastProof.notarizationObjectId,
            anchoredAt: lastProof.anchoredAt,
            verifyStatus: lastProof.verifyStatus,
          }
        : null,
    };
  }

  async scanResolve(shipmentCode: string, auth?: AuthContext) {
    const tenantId = auth?.tenantId ?? "default";
    const actorDid = auth?.actorId ?? null;
    const shipment = await this.shipmentsRepo.getByCodeOrThrow(shipmentCode, tenantId);
    const openDynamicRoute = this.isOpenDynamicRoute(shipment.conditions ?? null);
    const nextActorDid = this.resolveNextRouteActorDid(shipment);
    const policy = {
      slaHours: shipment.slaHours,
      maxDelayHours: shipment.maxDelayHours,
      sealRequired: Boolean((shipment.conditions ?? {}).sealRequired),
      tempMin:
        typeof (shipment.conditions ?? {}).tempMin === "number"
          ? Number((shipment.conditions ?? {}).tempMin)
          : null,
      tempMax:
        typeof (shipment.conditions ?? {}).tempMax === "number"
          ? Number((shipment.conditions ?? {}).tempMax)
          : null,
      routeActors: this.getRouteActors(shipment).slice(1),
      routePlan: Array.isArray((shipment.conditions ?? {}).routePlan)
        ? ((shipment.conditions ?? {}).routePlan as unknown[])
        : [],
      routeOpenDynamic: openDynamicRoute,
    };

    let recommendedAction:
      | "NONE"
      | "WAIT"
      | "SCAN_TAKE_CUSTODY"
      | "SCAN_CONFIRM_IN"
      | "SCAN_RELEASE_TO_NEXT"
      | "NOT_AUTHORIZED" = "NONE";
    let message = "Shipment loaded.";

    if (shipment.operationsBlocked) {
      recommendedAction = "WAIT";
      message = `Shipment is blocked: ${shipment.blockReason ?? "SECURITY_HOLD"}`;
    } else if (shipment.status === "PROVISIONING" || shipment.status === "PROVISIONING_FAILED") {
      recommendedAction = "WAIT";
      message = `Shipment not operational yet (status=${shipment.status}).`;
    } else if (shipment.status === "DELIVERED") {
      recommendedAction = "NONE";
      message =
        "Final delivery completed. No further handover is expected: use Verify to review the full journey and download/print the final QR label.";
    } else if (
      actorDid &&
      actorDid === shipment.receiverDid &&
      actorDid === shipment.currentCustodianDid &&
      shipment.status !== "PENDING_RECEIVER" &&
      !nextActorDid
    ) {
      recommendedAction = "NONE";
      message =
        "Final receiver already has custody. No further handover is expected: use Verify to review the journey and download/print the final QR label.";
    } else if (actorDid && shipment.status === "PENDING_RECEIVER" && actorDid === shipment.expectedReceiverDid) {
      recommendedAction = "SCAN_CONFIRM_IN";
      message = "You are the expected next actor. Confirm takeover to close previous custody step.";
    } else if (actorDid && shipment.status !== "PENDING_RECEIVER" && actorDid === shipment.currentCustodianDid) {
      recommendedAction = nextActorDid ? "SCAN_RELEASE_TO_NEXT" : "NONE";
      message = nextActorDid
        ? `You are the current custodian. Release to next actor (${nextActorDid}).`
        : openDynamicRoute
          ? "You are the current custodian. Route is dynamic: the next actor will take custody by scanning the ANT code."
          : "You are the current custodian. No next actor configured in route.";
    } else if (actorDid && shipment.status !== "PENDING_RECEIVER" && actorDid === nextActorDid) {
      recommendedAction = "SCAN_TAKE_CUSTODY";
      message =
        "Debug mode: taking custody via scan will auto-close the previous handover and confirm your takeover.";
    } else if (
      actorDid &&
      openDynamicRoute &&
      shipment.status !== "PENDING_RECEIVER" &&
      actorDid !== shipment.currentCustodianDid
    ) {
      recommendedAction = "SCAN_TAKE_CUSTODY";
      message =
        "Route dinamica: questo attore può prendere in carico la shipment e ANT registrerà il passaggio chiudendo il precedente.";
    } else if (actorDid) {
      recommendedAction = "NOT_AUTHORIZED";
      message = "This shipment is not waiting for your actor DID at the current step.";
    }

    return {
      shipmentCode: shipment.shipmentCode,
      status: shipment.status,
      currentCustodianDid: shipment.currentCustodianDid,
      expectedReceiverDid: shipment.expectedReceiverDid,
      nextActorDid,
      operationsBlocked: shipment.operationsBlocked,
      blockReason: shipment.blockReason,
      reconciliationStatus: shipment.reconciliationStatus,
      route: {
        actors: this.getRouteActors(shipment),
        currentIndex: this.getRouteActors(shipment).findIndex((did) => did === shipment.currentCustodianDid),
        mode: openDynamicRoute ? "OPEN_DYNAMIC" : "PLANNED",
      },
      policy,
      recommendedAction,
      message,
      debugMode: getResolvedAppConfig().runtime === "development",
    };
  }

  async scanConfirm(
    shipmentCode: string,
    body: unknown,
    idempotencyKey?: string,
    auth?: AuthContext,
  ) {
    const cfg = getResolvedAppConfig();
    const tenantId = auth?.tenantId ?? "default";
    const actorDid = auth?.actorId ?? null;
    if (!actorDid) throw new AppError("Missing actor DID in auth context", 401);
    const request = HandoverRequestSchema.parse(body);
    if (request.who.actorDid !== actorDid) {
      throw new AppError("Scan confirm actor DID must match authenticated actor", 403);
    }

    const shipment = await this.shipmentsRepo.getByCodeOrThrow(shipmentCode, tenantId);
    const openDynamicRoute = this.isOpenDynamicRoute(shipment.conditions ?? null);
    this.assertShipmentAcceptsOperationalWrites(shipment);

    if (shipment.status === "PENDING_RECEIVER" && actorDid === shipment.expectedReceiverDid) {
      this.requireIdempotencyKey(idempotencyKey, "scan confirm");
      const semanticScanKey = this.buildScanSemanticKey(
        tenantId,
        shipment.shipmentCode,
        actorDid,
        shipment.status,
        shipment.currentCustodianDid,
        shipment.expectedReceiverDid,
      );
      const result = await this.handoverIn(shipmentCode, request, `${semanticScanKey}:confirm-in`, auth);
      return {
        mode: "CONFIRM_IN",
        shipmentCode,
        accepted: result,
      };
    }

    const nextActorDid = this.resolveNextRouteActorDid(shipment);
    const actorCanTakeDynamic =
      openDynamicRoute && shipment.status !== "PENDING_RECEIVER" && actorDid !== shipment.currentCustodianDid;
    if ((!nextActorDid || nextActorDid !== actorDid) && !actorCanTakeDynamic) {
      throw new AppError(
        "Shipment is not ready for pickup by this actor at the current route step",
        409,
      );
    }

    if (cfg.runtime !== "development") {
      throw new AppError(
        "Scan-based auto pickup confirmation is only enabled in development. Use explicit release + confirm flows in production.",
        403,
      );
    }

    this.requireIdempotencyKey(idempotencyKey, "scan confirm");
    const semanticScanKey = this.buildScanSemanticKey(
      tenantId,
      shipment.shipmentCode,
      actorDid,
      shipment.status,
      shipment.currentCustodianDid,
      shipment.expectedReceiverDid,
    );
    const baseKey = this.scopedIdempotencyKey(tenantId, semanticScanKey);
    const outRequest: HandoverRequest = {
      ...request,
      who: { actorDid: shipment.currentCustodianDid ?? shipment.producerDid },
      attachments: [],
    };
    const outEvent = buildHandoverOutEvent(shipment, outRequest, { destinationDid: actorDid });
    const outResult = await this.epcisCaptureService.captureEvent({
      event: outEvent,
      shipmentCode,
      previousEventId: null,
      idempotencyKey: `${baseKey}:scan-auto-out`,
      tenantId,
    });

    await this.waitForShipmentState(
      shipmentCode,
      tenantId,
      (state) => state.status === "PENDING_RECEIVER" && state.expectedReceiverDid === actorDid,
      15000,
    );

    const inResult = await this.handoverIn(
      shipmentCode,
      request,
      `${semanticScanKey}:scan-auto-in`,
      auth,
    );

    return {
      mode: "SCAN_TAKE_CUSTODY_DEBUG",
      shipmentCode,
      outAccepted: outResult,
      inAccepted: inResult,
    };
  }

  async reportIssue(
    shipmentCode: string,
    body: unknown,
    auth?: AuthContext,
  ): Promise<{
    issueId: string;
    shipmentCode: string;
    status: string;
    operationsBlocked: boolean;
    message: string;
  }> {
    const tenantId = auth?.tenantId ?? "default";
    const actorDid = auth?.actorId ?? null;
    if (!actorDid) throw new AppError("Missing actor DID in auth context", 401);
    const shipment = await this.shipmentsRepo.getByCodeOrThrow(shipmentCode, tenantId);
    const issue = ReportShipmentIssueSchema.parse(body);
    await this.attachmentsService.assertStagedAttachmentsExist(issue.attachments, tenantId);

    const issueId = `ISS-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
    // Shipping continues for small/medium issues; block only for severe/critical incidents.
    const shouldBlock = issue.severity === "HIGH" || issue.severity === "CRITICAL";

    await this.store.withTransaction(async (tx) => {
      if (shouldBlock) {
        await this.store.updateShipment(
          shipment.id,
          {
            status: "DISPUTE",
            operationsBlocked: true,
            blockReason: `ISSUE_REPORTED:${issue.category}`,
          },
          tx,
        );
      }

      await this.store.appendAuditLog(
        {
          tenantId: shipment.tenantId,
          actorType: "OPERATOR",
          actorId: actorDid,
          action: "SHIPMENT_ISSUE_REPORTED",
          shipmentId: shipment.id,
          epcisEventId: null,
          details: {
            issueId,
            category: issue.category,
            severity: issue.severity,
            damaged: issue.damaged,
            subcategory: issue.subcategory ?? null,
            notifyNextActor: issue.notifyNextActor,
            title: issue.title,
            description: issue.description ?? null,
            attachments: issue.attachments,
          },
        },
        tx,
      );
    });

    const updated = await this.shipmentsRepo.getByCodeOrThrow(shipmentCode, tenantId);
    return {
      issueId,
      shipmentCode: updated.shipmentCode,
      status: updated.status,
      operationsBlocked: updated.operationsBlocked,
      message: shouldBlock
        ? "Issue registrato. Shipment messa in DISPUTE / blocco operativo in attesa di review."
        : "Issue registrato correttamente.",
    };
  }

  async getTimeline(shipmentCode: string, auth?: AuthContext) {
    await this.shipmentsRepo.getByCodeOrThrow(shipmentCode, auth?.tenantId);
    return this.epcisQueryService.getTimeline(shipmentCode, auth?.tenantId);
  }

  async getIssueHistory(shipmentCode: string, auth?: AuthContext): Promise<ShipmentIssueHistory> {
    const tenantId = auth?.tenantId ?? "default";
    const shipment = await this.shipmentsRepo.getByCodeOrThrow(shipmentCode, tenantId);
    const logs = await this.store.listAuditLogsByShipmentId(shipment.id, tenantId);

    const issueLogs = logs.filter((log) => log.action === "SHIPMENT_ISSUE_REPORTED");
    return Promise.all(
      issueLogs.map(async (log) => {
        const details = (log.details ?? {}) as Record<string, unknown>;
        const attachments = Array.isArray(details.attachments) ? details.attachments : [];
        const attachmentHashes = attachments.filter((a): a is string => typeof a === "string");
        const attachmentRefs = await this.attachmentsService.getStagedAttachmentRefs(
          attachmentHashes,
          tenantId,
        );
        const severityRaw = details.severity;
        const severity =
          severityRaw === "LOW" ||
          severityRaw === "MEDIUM" ||
          severityRaw === "HIGH" ||
          severityRaw === "CRITICAL"
            ? severityRaw
            : "MEDIUM";
        const damaged = Boolean(details.damaged);
        return {
          issueId: typeof details.issueId === "string" ? details.issueId : log.id,
          createdAt: log.createdAt,
          actorType: log.actorType,
          actorId: log.actorId,
          title:
            typeof details.title === "string" && details.title.trim()
              ? details.title
              : "Segnalazione operativa",
          description:
            typeof details.description === "string" && details.description.trim()
              ? details.description
              : null,
          category:
            typeof details.category === "string" && details.category.trim()
              ? details.category
              : "OTHER",
          subcategory:
            typeof details.subcategory === "string" && details.subcategory.trim()
              ? details.subcategory
              : null,
          severity,
          damaged,
          notifyNextActor: Boolean(details.notifyNextActor),
          attachmentsCount: attachmentHashes.length,
          attachments: attachmentRefs,
          blockingImpact: severity === "HIGH" || severity === "CRITICAL",
        };
      }),
    );
  }

  async getBottleneck(shipmentCode: string, auth?: AuthContext): Promise<BottleneckResult> {
    const shipment = await this.shipmentsRepo.getByCodeOrThrow(shipmentCode, auth?.tenantId);
    const events = await this.store.listEventsByShipmentId(shipment.id);
    const lastEvent = events[events.length - 1] ?? null;

    if (shipment.status === "PROVISIONING") {
      return BottleneckResultSchema.parse({
        type: "NONE",
        message: "Shipment is provisioning on-chain (Move object creation queued).",
        since: shipment.createdAt,
        suggestedAction: "Wait for provisioning completion",
      });
    }

    if (shipment.status === "PROVISIONING_FAILED") {
      return BottleneckResultSchema.parse({
        type: "CONDITION_VIOLATION",
        message: "Shipment provisioning failed. Supervisor review required before operations.",
        since: shipment.updatedAt,
        suggestedAction: "Escalate to supervisor",
      });
    }

    if (shipment.status === "PENDING_RECEIVER") {
      return BottleneckResultSchema.parse({
        type: "MISSING_RECEIVER_CONFIRMATION",
        message: "Shipment handover is pending receiver confirmation.",
        since: lastEvent?.eventTime ?? shipment.updatedAt,
        suggestedAction: "Send confirm link",
      });
    }

    if (lastEvent) {
      const ageMs = Date.now() - new Date(lastEvent.eventTime).getTime();
      const thresholdMs = shipment.maxDelayHours * 60 * 60 * 1000;
      if (ageMs > thresholdMs) {
        return BottleneckResultSchema.parse({
          type: "SLA_BREACH",
          message: `No event within maxDelayHours (${shipment.maxDelayHours}h).`,
          since: lastEvent.eventTime,
          suggestedAction: "Notify carrier",
        });
      }
    }

    const sealRequired = Boolean((shipment.conditions ?? {}).sealRequired);
    if (sealRequired && lastEvent) {
      const ant = (((lastEvent.payload.extensions ?? {}) as Record<string, unknown>).ant ??
        {}) as Record<string, unknown>;
      const attachments = Array.isArray(ant.attachments) ? ant.attachments : [];
      if (attachments.length === 0) {
        return BottleneckResultSchema.parse({
          type: "CONDITION_VIOLATION",
          message: "Seal proof attachment is required but missing on latest event.",
          since: lastEvent.eventTime,
          suggestedAction: "Request seal photo",
        });
      }
    }

    return BottleneckResultSchema.parse({
      type: "NONE",
      message: "No bottleneck detected",
      since: null,
      suggestedAction: null,
    });
  }

  async handoverOut(
    shipmentCode: string,
    body: unknown,
    idempotencyKey?: string,
    auth?: AuthContext,
  ) {
    const tenantId = auth?.tenantId ?? "default";
    const shipment = await this.shipmentsRepo.getByCodeOrThrow(shipmentCode, tenantId);
    this.assertShipmentAcceptsOperationalWrites(shipment);
    const request = HandoverRequestSchema.parse(body);
    const safeIdempotencyKey = this.scopedIdempotencyKey(
      tenantId,
      this.requireIdempotencyKey(idempotencyKey, "handover OUT"),
    );
    await this.attachmentsService.assertStagedAttachmentsExist(request.attachments, tenantId);

    if (request.who.actorDid !== shipment.currentCustodianDid) {
      throw new AppError("Only current custodian can sign OUT", 403);
    }

    const nextReceiverDid = this.resolveNextRouteActorDid(shipment);
    if (!nextReceiverDid) {
      throw new AppError("No next route actor configured for handover OUT", 409);
    }

    const event = buildHandoverOutEvent(shipment, request, { destinationDid: nextReceiverDid });
    const result = await this.epcisCaptureService.captureEvent({
      event,
      shipmentCode,
      previousEventId: null,
      idempotencyKey: safeIdempotencyKey,
      tenantId,
    });
    await this.attachmentsService.linkStagedAttachmentsToEvent(
      result.eventId,
      request.attachments,
      tenantId,
    );
    return result;
  }

  async handoverIn(
    shipmentCode: string,
    body: unknown,
    idempotencyKey?: string,
    auth?: AuthContext,
  ) {
    const tenantId = auth?.tenantId ?? "default";
    const shipment = await this.shipmentsRepo.getByCodeOrThrow(shipmentCode, tenantId);
    this.assertShipmentAcceptsOperationalWrites(shipment);
    const request = HandoverRequestSchema.parse(body);
    const safeIdempotencyKey = this.scopedIdempotencyKey(
      tenantId,
      this.requireIdempotencyKey(idempotencyKey, "handover IN"),
    );
    await this.attachmentsService.assertStagedAttachmentsExist(request.attachments, tenantId);

    const expectedInActorDid = shipment.expectedReceiverDid ?? shipment.receiverDid;
    if (!expectedInActorDid || request.who.actorDid !== expectedInActorDid) {
      throw new AppError("Only expected next actor can confirm IN", 403);
    }
    if (
      shipment.status !== "PENDING_RECEIVER" &&
      shipment.status !== "CREATED" &&
      shipment.status !== "ACTIVE"
    ) {
      throw new AppError(
        `Shipment not awaiting receiver confirmation (status=${shipment.status})`,
        409,
      );
    }

    const events = await this.store.listEventsByShipmentId(shipment.id);
    const previousOut = [...events]
      .reverse()
      .find((e) => ((e.payload.extensions as Record<string, unknown> | undefined)?.ant as
        | Record<string, unknown>
        | undefined)?.handover === "OUT");

    const event = buildHandoverInEvent(shipment, request, previousOut?.id);
    const result = await this.epcisCaptureService.captureEvent({
      event,
      shipmentCode,
      previousEventId: previousOut?.id ?? null,
      idempotencyKey: safeIdempotencyKey,
      tenantId,
    });
    await this.attachmentsService.linkStagedAttachmentsToEvent(
      result.eventId,
      request.attachments,
      tenantId,
    );
    return result;
  }

  private requireIdempotencyKey(value: string | undefined, operation: string): string {
    const key = value?.trim();
    if (!key) {
      throw new AppError(`Idempotency-Key header is required for ${operation}`, 400);
    }
    return key;
  }

  private scopedIdempotencyKey(tenantId: string, rawKey: string): string {
    return `tenant:${tenantId}:${rawKey}`;
  }

  private buildScanSemanticKey(
    tenantId: string,
    shipmentCode: string,
    actorDid: string,
    status: string,
    currentCustodianDid: string | null,
    expectedReceiverDid: string | null,
  ): string {
    const raw = [
      "scan-confirm",
      tenantId,
      shipmentCode,
      actorDid,
      status,
      currentCustodianDid ?? "none",
      expectedReceiverDid ?? "none",
    ].join("|");
    let hash = 0x811c9dc5;
    for (let i = 0; i < raw.length; i += 1) {
      hash ^= raw.charCodeAt(i);
      hash = Math.imul(hash, 0x01000193);
    }
    return `scan-${(hash >>> 0).toString(16)}`;
  }

  private parseListLimit(limitRaw: string | undefined): number {
    if (!limitRaw) return 25;
    const limit = Number(limitRaw);
    if (!Number.isFinite(limit)) return 25;
    return Math.max(1, Math.min(Math.trunc(limit), 200));
  }

  private resolveInitialNextActorDid(request: z.infer<typeof CreateShipmentRequestSchema>): string | null {
    if (this.isOpenDynamicRoute(request.conditions ?? null)) {
      return request.participants.carrierDid ?? null;
    }
    const routeActors = this.extractRouteActorsFromConditions(request.conditions ?? null);
    if (routeActors.length > 0) {
      return routeActors[0] ?? null;
    }
    return request.participants.carrierDid ?? null;
  }

  private getRouteActors(shipment: {
    producerDid: string;
    carrierDid: string;
    receiverDid: string;
    conditions: Record<string, unknown> | null;
  }): string[] {
    if (this.isOpenDynamicRoute(shipment.conditions ?? null)) {
      const base = [shipment.producerDid, shipment.carrierDid].filter(Boolean);
      return [...new Set(base)];
    }
    const routeActors = this.extractRouteActorsFromConditions(shipment.conditions ?? null);

    const sequence = [shipment.producerDid, ...routeActors];
    if (routeActors.length === 0 || routeActors[routeActors.length - 1] !== shipment.receiverDid) {
      sequence.push(shipment.carrierDid, shipment.receiverDid);
    }

    const deduped: string[] = [];
    for (const did of sequence) {
      if (!did) continue;
      if (deduped[deduped.length - 1] !== did) deduped.push(did);
    }
    return deduped;
  }

  private extractRouteActorsFromConditions(conditions: Record<string, unknown> | null): string[] {
    const routePlanRaw = conditions?.routePlan;
    const routePlanActors = Array.isArray(routePlanRaw)
      ? routePlanRaw
          .map((item) => {
            if (!item || typeof item !== "object") return null;
            const actorDid = (item as Record<string, unknown>).actorDid;
            return typeof actorDid === "string" ? actorDid.trim() : null;
          })
          .filter((v): v is string => Boolean(v))
      : [];
    if (routePlanActors.length > 0) return routePlanActors;

    const routeActorsRaw = conditions?.routeActors;
    return Array.isArray(routeActorsRaw)
      ? routeActorsRaw
          .filter((v): v is string => typeof v === "string")
          .map((v) => v.trim())
          .filter(Boolean)
      : [];
  }

  private resolveNextRouteActorDid(shipment: {
    producerDid: string;
    carrierDid: string;
    receiverDid: string;
    currentCustodianDid: string | null;
    conditions: Record<string, unknown> | null;
  }): string | null {
    if (this.isOpenDynamicRoute(shipment.conditions ?? null)) {
      if (!shipment.currentCustodianDid) return shipment.carrierDid ?? null;
      if (shipment.currentCustodianDid === shipment.producerDid) return shipment.carrierDid ?? null;
      return null; // dynamic: next actor chosen at scan time
    }
    const route = this.getRouteActors(shipment);
    const current = shipment.currentCustodianDid;
    if (!current) return route[0] ?? null;
    const index = route.findIndex((did) => did === current);
    if (index < 0) return shipment.receiverDid ?? null;
    return route[index + 1] ?? null;
  }

  private isOpenDynamicRoute(conditions: Record<string, unknown> | null): boolean {
    // Default to dynamic route unless explicitly disabled.
    // This matches real operations where the producer often cannot predefine all future hops.
    if (conditions?.routeOpenDynamic === false) return false;
    return true;
  }

  private async waitForShipmentState(
    shipmentCode: string,
    tenantId: string,
    predicate: (state: ShipmentStateReadModel) => boolean,
    timeoutMs: number,
  ): Promise<ShipmentStateReadModel> {
    const startedAt = Date.now();
    while (Date.now() - startedAt <= timeoutMs) {
      const state = await this.getState(shipmentCode, { tenantId } as AuthContext);
      if (predicate(state)) return state;
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
    throw new AppError("Timed out waiting for shipment state transition after scan confirm", 504);
  }

  private assertShipmentAcceptsOperationalWrites(shipment: {
    status: string;
    operationsBlocked: boolean;
    blockReason: string | null;
  }) {
    if (shipment.operationsBlocked) {
      throw new AppError(
        `Shipment is blocked for operations: ${shipment.blockReason ?? "SECURITY_HOLD"}`,
        409,
      );
    }
    if (shipment.status === "PROVISIONING") {
      throw new AppError(
        "Shipment provisioning is still in progress. Wait for on-chain creation to complete.",
        409,
      );
    }
    if (shipment.status === "PROVISIONING_FAILED") {
      throw new AppError(
        "Shipment provisioning failed. Supervisor review is required before operations continue.",
        409,
      );
    }
    if (shipment.status === "DELIVERED") {
      throw new AppError(
        "Shipment has already reached final delivery. No further handover operations are allowed.",
        409,
      );
    }
  }

  private mapCreateShipmentResponse(
    shipment: { shipmentCode: string; moveObjectId: string | null; status: string },
  ): CreateShipmentResponse {
    const provisioningStatus =
      shipment.status === "PROVISIONING_FAILED"
        ? "PROVISIONING_FAILED"
        : shipment.status === "ACTIVE"
          ? "ACTIVE"
          : "PROVISIONING";
    return {
      shipmentCode: shipment.shipmentCode,
      moveObjectId: shipment.moveObjectId,
      qrPayload: this.buildQrPayload(shipment.shipmentCode),
      provisioning: {
        status: provisioningStatus,
        message:
          provisioningStatus === "ACTIVE"
            ? "On-chain shipment object created and ready."
            : provisioningStatus === "PROVISIONING_FAILED"
              ? "On-chain creation failed. Supervisor intervention required."
              : "Shipment accepted. On-chain creation queued.",
      },
    };
  }

  private buildQrPayload(shipmentCode: string): string {
    const version = "1";
    const checksum = this.buildQrChecksum(shipmentCode, version);
    return `ant://shipment/${encodeURIComponent(shipmentCode)}?v=${version}&chk=${checksum}`;
  }

  private buildQrChecksum(shipmentCode: string, version: string): string {
    // QR checksum is only for scan/paste typo detection. Integrity is enforced by notarization.
    const material = `ANT|SHIPMENT|v${version}|${shipmentCode.toUpperCase()}`;
    let hash = 0x811c9dc5;
    for (let i = 0; i < material.length; i += 1) {
      hash ^= material.charCodeAt(i);
      hash = Math.imul(hash, 0x01000193);
    }
    return (hash >>> 0).toString(36).toUpperCase().padStart(7, "0").slice(-7);
  }
}
