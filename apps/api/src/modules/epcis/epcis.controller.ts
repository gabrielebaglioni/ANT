import { Body, Controller, Headers, HttpCode, HttpStatus, Inject, Post } from "@nestjs/common";
import { CurrentAuth, RequireRoles } from "../auth/auth.decorators";
import type { AuthContext } from "../auth/auth.types";
import { EpcisCaptureService } from "./epcis.capture.service";

@Controller("epcis")
export class EpcisController {
  constructor(
    @Inject(EpcisCaptureService)
    private readonly epcisCaptureService: EpcisCaptureService,
  ) {}

  @Post("events")
  @HttpCode(HttpStatus.ACCEPTED)
  @RequireRoles("operator", "supervisor", "service")
  createEvent(
    @Body() body: unknown,
    @Headers("idempotency-key") idempotencyKey?: string,
    @CurrentAuth() auth?: AuthContext,
  ) {
    const tenantId = auth?.tenantId ?? "default";
    const raw = idempotencyKey?.trim();
    const scopedIdempotencyKey = raw
      ? raw.startsWith(`tenant:${tenantId}:`)
        ? raw
        : `tenant:${tenantId}:${raw}`
      : undefined;
    return this.epcisCaptureService.captureEvent({
      event: body,
      idempotencyKey: scopedIdempotencyKey,
      tenantId,
    });
  }
}
