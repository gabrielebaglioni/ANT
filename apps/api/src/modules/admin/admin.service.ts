import { Inject, Injectable } from "@nestjs/common";
import { z } from "zod";
import { getResolvedAppConfig } from "../../config/env";
import { AppError } from "../../lib/errors";
import { PgStoreService } from "../../store/pg-store.service";
import type { AdminActionType, AdminActionRequestRecord } from "../../store/store.types";
import type { AuthContext } from "../auth/auth.types";
import { ShipmentsRepoPg } from "../shipments/shipments.repo.pg";
import { IotaGateway } from "../iota/iota.gateway";

const OpenDisputeSchema = z.object({
  reason: z.string().min(3),
});

const SuspendSchema = z.object({
  reason: z.string().min(3),
});

const CorrectiveHandoverSchema = z.object({
  reason: z.string().min(3),
  receiverDid: z.string().min(1),
  payloadHash: z.string().regex(/^[a-f0-9]{64}$/i),
  notarizationObjectId: z.string().min(1),
  note: z.string().min(3).optional(),
});

const ApproveSchema = z.object({
  note: z.string().min(3).optional(),
});

const RejectSchema = z.object({
  note: z.string().min(3),
});

type ParsedActionPayload =
  | { action: "OPEN_DISPUTE"; reason: string; payload: Record<string, unknown> }
  | { action: "SUSPEND"; reason: string; payload: Record<string, unknown> }
  | { action: "CORRECTIVE_HANDOVER"; reason: string; payload: Record<string, unknown> };

@Injectable()
export class AdminService {
  constructor(
    @Inject(ShipmentsRepoPg) private readonly shipmentsRepo: ShipmentsRepoPg,
    @Inject(PgStoreService) private readonly store: PgStoreService,
    @Inject(IotaGateway) private readonly iotaGateway: IotaGateway,
  ) {}

  async openDispute(code: string, body: unknown, auth?: AuthContext) {
    const parsed = this.parseActionPayload("OPEN_DISPUTE", body);
    return this.requestOrExecuteDirect(code, parsed, auth);
  }

  async suspend(code: string, body: unknown, auth?: AuthContext) {
    const parsed = this.parseActionPayload("SUSPEND", body);
    return this.requestOrExecuteDirect(code, parsed, auth);
  }

  async correctiveHandover(code: string, body: unknown, auth?: AuthContext) {
    const parsed = this.parseActionPayload("CORRECTIVE_HANDOVER", body);
    return this.requestOrExecuteDirect(code, parsed, auth);
  }

  async requestAction(code: string, action: AdminActionType, body: unknown, auth?: AuthContext) {
    const parsed = this.parseActionPayload(action, body);
    const requester = this.requireSupervisor(auth);
    const shipment = await this.shipmentsRepo.getByCodeOrThrow(code, requester.tenantId);
    const request = await this.store.createAdminActionRequest({
      tenantId: shipment.tenantId,
      shipmentId: shipment.id,
      action: parsed.action,
      reason: parsed.reason,
      payload: parsed.payload,
      requesterSubject: requester.subject,
      requesterActorId: requester.actorId,
    });

    await this.store.appendAuditLog({
      tenantId: shipment.tenantId,
      actorType: "SUPERVISOR",
      actorId: requester.actorId,
      action: "ADMIN_ACTION_REQUESTED",
      shipmentId: shipment.id,
      epcisEventId: null,
      details: {
        requestId: request.id,
        requestedAction: request.action,
        reason: request.reason,
      },
    });

    return {
      ok: true,
      approvalRequired: true,
      requestId: request.id,
      status: request.status,
      action: request.action,
    };
  }

  async getActionRequest(requestId: string, auth?: AuthContext) {
    const actor = this.requireSupervisor(auth);
    const request = await this.store.getAdminActionRequestById(requestId, actor.tenantId);
    if (!request) {
      throw new AppError(`Admin action request not found: ${requestId}`, 404);
    }
    return request;
  }

  async approveActionRequest(requestId: string, body: unknown, auth?: AuthContext) {
    const actor = this.requireSupervisor(auth);
    const payload = ApproveSchema.parse(body ?? {});
    const request = await this.requireActionRequest(requestId, actor.tenantId);
    if (request.status !== "PENDING_APPROVAL") {
      throw new AppError(`Request not awaiting approval (status=${request.status})`, 409);
    }
    this.assertDifferentSupervisor(request, actor);

    const updated = await this.store.updateAdminActionRequest(request.id, {
      status: "APPROVED",
      approverSubject: actor.subject,
      approverActorId: actor.actorId,
      approvalNote: payload.note ?? null,
      approvedAt: new Date().toISOString(),
    });
    if (!updated) {
      throw new AppError("Failed to approve admin action request", 500);
    }

    await this.store.appendAuditLog({
      tenantId: updated.tenantId,
      actorType: "SUPERVISOR",
      actorId: actor.actorId,
      action: "ADMIN_ACTION_APPROVED",
      shipmentId: updated.shipmentId,
      epcisEventId: null,
      details: {
        requestId: updated.id,
        requestedAction: updated.action,
      },
    });
    return { ok: true, requestId: updated.id, status: updated.status };
  }

  async rejectActionRequest(requestId: string, body: unknown, auth?: AuthContext) {
    const actor = this.requireSupervisor(auth);
    const payload = RejectSchema.parse(body ?? {});
    const request = await this.requireActionRequest(requestId, actor.tenantId);
    if (request.status !== "PENDING_APPROVAL") {
      throw new AppError(`Request not awaiting approval (status=${request.status})`, 409);
    }
    this.assertDifferentSupervisor(request, actor);

    const updated = await this.store.updateAdminActionRequest(request.id, {
      status: "REJECTED",
      approverSubject: actor.subject,
      approverActorId: actor.actorId,
      rejectNote: payload.note,
      rejectedAt: new Date().toISOString(),
    });
    if (!updated) {
      throw new AppError("Failed to reject admin action request", 500);
    }

    await this.store.appendAuditLog({
      tenantId: updated.tenantId,
      actorType: "SUPERVISOR",
      actorId: actor.actorId,
      action: "ADMIN_ACTION_REJECTED",
      shipmentId: updated.shipmentId,
      epcisEventId: null,
      details: {
        requestId: updated.id,
        requestedAction: updated.action,
      },
    });
    return { ok: true, requestId: updated.id, status: updated.status };
  }

  async executeApprovedActionRequest(requestId: string, auth?: AuthContext) {
    const actor = this.requireSupervisor(auth);
    const request = await this.requireActionRequest(requestId, actor.tenantId);
    if (request.status !== "APPROVED") {
      throw new AppError(`Request not approved (status=${request.status})`, 409);
    }

    const shipment = await this.store.getShipmentById(request.shipmentId);
    if (!shipment || shipment.tenantId !== actor.tenantId) {
      throw new AppError("Shipment not found for approved admin action request", 404);
    }

    const execution = await this.executeActionAgainstShipment(shipment, request.action, request.payload, actor);

    const updated = await this.store.updateAdminActionRequest(request.id, {
      status: "EXECUTED",
      executedAt: new Date().toISOString(),
      txDigest: execution.txDigest,
    });
    if (!updated) {
      throw new AppError("Failed to mark admin action request as executed", 500);
    }

    await this.store.appendAuditLog({
      tenantId: shipment.tenantId,
      actorType: "SUPERVISOR",
      actorId: actor.actorId,
      action: "ADMIN_ACTION_EXECUTED",
      shipmentId: shipment.id,
      epcisEventId: null,
      details: {
        requestId: request.id,
        requestedAction: request.action,
        txDigest: execution.txDigest,
      },
    });

    return {
      ok: true,
      requestId: request.id,
      status: "EXECUTED",
      action: request.action,
      txDigest: execution.txDigest,
    };
  }

  private async requestOrExecuteDirect(
    code: string,
    parsed: ParsedActionPayload,
    auth?: AuthContext,
  ) {
    const cfg = getResolvedAppConfig();
    if (cfg.adminCompensationRequireApproval) {
      return this.requestAction(code, parsed.action, parsed.payload, auth);
    }

    const actor = this.requireSupervisor(auth);
    const shipment = await this.shipmentsRepo.getByCodeOrThrow(code, actor.tenantId);
    const execution = await this.executeActionAgainstShipment(shipment, parsed.action, parsed.payload, actor);
    return { ok: true, action: parsed.action, txDigest: execution.txDigest };
  }

  private parseActionPayload(action: AdminActionType, body: unknown): ParsedActionPayload {
    if (action === "OPEN_DISPUTE") {
      const parsed = OpenDisputeSchema.parse(body);
      return { action, reason: parsed.reason, payload: parsed };
    }
    if (action === "SUSPEND") {
      const parsed = SuspendSchema.parse(body);
      return { action, reason: parsed.reason, payload: parsed };
    }
    const parsed = CorrectiveHandoverSchema.parse(body);
    return { action, reason: parsed.reason, payload: parsed };
  }

  private async executeActionAgainstShipment(
    shipment: {
      id: string;
      tenantId: string;
      moveObjectId: string | null;
      status: string;
      shipmentCode: string;
    },
    action: AdminActionType,
    payload: Record<string, unknown>,
    actor: AuthContext,
  ): Promise<{ txDigest: string | null }> {
    if (action === "OPEN_DISPUTE") {
      const reason = String(payload.reason ?? "");
      const tx = shipment.moveObjectId
        ? await this.iotaGateway.adminOpenDispute({
            moveObjectId: shipment.moveObjectId,
            reason,
          })
        : { txDigest: null };
      await this.store.updateShipment(shipment.id, {
        status: "DISPUTE",
        operationsBlocked: true,
        blockReason: "SUPERVISOR_OPEN_DISPUTE",
      });
      await this.store.appendAuditLog({
        tenantId: shipment.tenantId,
        actorType: "SUPERVISOR",
        actorId: actor.actorId,
        action: "ADMIN_OPEN_DISPUTE",
        shipmentId: shipment.id,
        epcisEventId: null,
        details: { reason, txDigest: tx.txDigest },
      });
      return tx;
    }

    if (action === "SUSPEND") {
      const reason = String(payload.reason ?? "");
      const tx = shipment.moveObjectId
        ? await this.iotaGateway.adminSuspend({
            moveObjectId: shipment.moveObjectId,
            reason,
          })
        : { txDigest: null };
      await this.store.updateShipment(shipment.id, {
        operationsBlocked: true,
        blockReason: "SUPERVISOR_SUSPEND",
      });
      await this.store.appendAuditLog({
        tenantId: shipment.tenantId,
        actorType: "SUPERVISOR",
        actorId: actor.actorId,
        action: "ADMIN_SUSPEND_SHIPMENT",
        shipmentId: shipment.id,
        epcisEventId: null,
        details: { reason, txDigest: tx.txDigest },
      });
      return tx;
    }

    if (!shipment.moveObjectId) {
      throw new AppError("Shipment has no on-chain object yet", 409);
    }
    const receiverDid = String(payload.receiverDid ?? "");
    const payloadHash = String(payload.payloadHash ?? "");
    const notarizationObjectId = String(payload.notarizationObjectId ?? "");
    const tx = await this.iotaGateway.adminCorrectiveHandover({
      moveObjectId: shipment.moveObjectId,
      receiverDid,
      payloadHash,
      notarizationObjectId,
    });
    await this.store.appendAuditLog({
      tenantId: shipment.tenantId,
      actorType: "SUPERVISOR",
      actorId: actor.actorId,
      action: "ADMIN_CORRECTIVE_HANDOVER",
      shipmentId: shipment.id,
      epcisEventId: null,
      details: { ...payload, txDigest: tx.txDigest },
    });
    return tx;
  }

  private requireSupervisor(auth?: AuthContext): AuthContext {
    if (!auth || auth.source === "anonymous") {
      throw new AppError("Authentication required", 401);
    }
    if (!auth.roles.includes("supervisor")) {
      throw new AppError("Supervisor role required", 403);
    }
    return auth;
  }

  private async requireActionRequest(requestId: string, tenantId: string) {
    const request = await this.store.getAdminActionRequestById(requestId, tenantId);
    if (!request) {
      throw new AppError(`Admin action request not found: ${requestId}`, 404);
    }
    return request;
  }

  private assertDifferentSupervisor(request: AdminActionRequestRecord, approver: AuthContext): void {
    const approverIdentity = approver.subject ?? approver.actorId;
    const requesterIdentity = request.requesterSubject ?? request.requesterActorId;
    if (approverIdentity && requesterIdentity && approverIdentity === requesterIdentity) {
      throw new AppError(
        "Dual control violation: requester and approver must be different supervisors",
        409,
      );
    }
  }
}
