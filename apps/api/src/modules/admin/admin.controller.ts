import { Body, Controller, Get, Inject, Param, Post } from "@nestjs/common";
import { AppError } from "../../lib/errors";
import { CurrentAuth, RequireRoles } from "../auth/auth.decorators";
import type { AuthContext } from "../auth/auth.types";
import { AdminService } from "./admin.service";

@Controller("admin")
@RequireRoles("supervisor")
export class AdminController {
  constructor(@Inject(AdminService) private readonly adminService: AdminService) {}

  @Post("shipments/:code/open-dispute")
  openDispute(@Param("code") code: string, @Body() body: unknown, @CurrentAuth() auth?: AuthContext) {
    return this.adminService.openDispute(code, body, auth);
  }

  @Post("shipments/:code/suspend")
  suspend(@Param("code") code: string, @Body() body: unknown, @CurrentAuth() auth?: AuthContext) {
    return this.adminService.suspend(code, body, auth);
  }

  @Post("shipments/:code/corrective-handover")
  correctiveHandover(
    @Param("code") code: string,
    @Body() body: unknown,
    @CurrentAuth() auth?: AuthContext,
  ) {
    return this.adminService.correctiveHandover(code, body, auth);
  }

  @Post("shipments/:code/:action/request")
  requestAction(
    @Param("code") code: string,
    @Param("action") action: string,
    @Body() body: unknown,
    @CurrentAuth() auth?: AuthContext,
  ) {
    return this.adminService.requestAction(
      code,
      this.normalizeAction(action),
      body,
      auth,
    );
  }

  @Get("action-requests/:id")
  getActionRequest(@Param("id") id: string, @CurrentAuth() auth?: AuthContext) {
    return this.adminService.getActionRequest(id, auth);
  }

  @Post("action-requests/:id/approve")
  approveActionRequest(
    @Param("id") id: string,
    @Body() body: unknown,
    @CurrentAuth() auth?: AuthContext,
  ) {
    return this.adminService.approveActionRequest(id, body, auth);
  }

  @Post("action-requests/:id/reject")
  rejectActionRequest(
    @Param("id") id: string,
    @Body() body: unknown,
    @CurrentAuth() auth?: AuthContext,
  ) {
    return this.adminService.rejectActionRequest(id, body, auth);
  }

  @Post("action-requests/:id/execute")
  executeActionRequest(@Param("id") id: string, @CurrentAuth() auth?: AuthContext) {
    return this.adminService.executeApprovedActionRequest(id, auth);
  }

  private normalizeAction(action: string): "OPEN_DISPUTE" | "SUSPEND" | "CORRECTIVE_HANDOVER" {
    const normalized = action.trim().replace(/-/g, "_").toUpperCase();
    if (
      normalized !== "OPEN_DISPUTE" &&
      normalized !== "SUSPEND" &&
      normalized !== "CORRECTIVE_HANDOVER"
    ) {
      throw new AppError(`Unsupported admin action: ${action}`, 400);
    }
    return normalized;
  }
}
