import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  Post,
  Query,
} from "@nestjs/common";
import { CurrentAuth, RequireRoles } from "../auth/auth.decorators";
import type { AuthContext } from "../auth/auth.types";
import { ShipmentsService } from "./shipments.service";

@Controller("shipments")
export class ShipmentsController {
  constructor(@Inject(ShipmentsService) private readonly shipmentsService: ShipmentsService) {}

  @Post()
  @HttpCode(HttpStatus.ACCEPTED)
  @RequireRoles("operator", "supervisor", "service")
  createShipment(
    @Body() body: unknown,
    @Headers("idempotency-key") idempotencyKey?: string,
    @CurrentAuth() auth?: AuthContext,
  ) {
    return this.shipmentsService.createShipment(body, idempotencyKey, auth);
  }

  @Get()
  @RequireRoles("operator", "supervisor", "auditor", "service")
  listShipments(
    @Query("limit") limit?: string,
    @CurrentAuth() auth?: AuthContext,
  ) {
    return this.shipmentsService.listRecentShipments(auth, limit);
  }

  @Get(":code/state")
  @RequireRoles("operator", "supervisor", "auditor", "service")
  getState(@Param("code") code: string, @CurrentAuth() auth?: AuthContext) {
    return this.shipmentsService.getState(code, auth);
  }

  @Get(":code/timeline")
  @RequireRoles("operator", "supervisor", "auditor", "service")
  getTimeline(@Param("code") code: string, @CurrentAuth() auth?: AuthContext) {
    return this.shipmentsService.getTimeline(code, auth);
  }

  @Get(":code/issues")
  @RequireRoles("operator", "supervisor", "auditor", "service")
  getIssueHistory(@Param("code") code: string, @CurrentAuth() auth?: AuthContext) {
    return this.shipmentsService.getIssueHistory(code, auth);
  }

  @Get(":code/bottleneck")
  @RequireRoles("operator", "supervisor", "auditor", "service")
  getBottleneck(@Param("code") code: string, @CurrentAuth() auth?: AuthContext) {
    return this.shipmentsService.getBottleneck(code, auth);
  }

  @Post(":code/scan/resolve")
  @HttpCode(HttpStatus.OK)
  @RequireRoles("operator", "supervisor", "service")
  scanResolve(@Param("code") code: string, @CurrentAuth() auth?: AuthContext) {
    return this.shipmentsService.scanResolve(code, auth);
  }

  @Post(":code/scan/confirm")
  @HttpCode(HttpStatus.ACCEPTED)
  @RequireRoles("operator", "supervisor", "service")
  scanConfirm(
    @Param("code") code: string,
    @Body() body: unknown,
    @Headers("idempotency-key") idempotencyKey?: string,
    @CurrentAuth() auth?: AuthContext,
  ) {
    return this.shipmentsService.scanConfirm(code, body, idempotencyKey, auth);
  }

  @Post(":code/issues")
  @HttpCode(HttpStatus.ACCEPTED)
  @RequireRoles("operator", "supervisor", "service")
  reportIssue(
    @Param("code") code: string,
    @Body() body: unknown,
    @CurrentAuth() auth?: AuthContext,
  ) {
    return this.shipmentsService.reportIssue(code, body, auth);
  }

  @Post(":code/handover/out")
  @HttpCode(HttpStatus.ACCEPTED)
  @RequireRoles("operator", "supervisor", "service")
  handoverOut(
    @Param("code") code: string,
    @Body() body: unknown,
    @Headers("idempotency-key") idempotencyKey?: string,
    @CurrentAuth() auth?: AuthContext,
  ) {
    return this.shipmentsService.handoverOut(code, body, idempotencyKey, auth);
  }

  @Post(":code/handover/in")
  @HttpCode(HttpStatus.ACCEPTED)
  @RequireRoles("operator", "supervisor", "service")
  handoverIn(
    @Param("code") code: string,
    @Body() body: unknown,
    @Headers("idempotency-key") idempotencyKey?: string,
    @CurrentAuth() auth?: AuthContext,
  ) {
    return this.shipmentsService.handoverIn(code, body, idempotencyKey, auth);
  }
}
