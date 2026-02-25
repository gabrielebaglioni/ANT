import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Inject,
  Post,
  UploadedFile,
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { memoryStorage } from "multer";
import { z } from "zod";
import { AppError } from "../../lib/errors";
import { CurrentAuth, RequireRoles } from "../auth/auth.decorators";
import type { AuthContext } from "../auth/auth.types";
import { AttachmentsService } from "./attachments.service";

const UploadBodySchema = z.object({
  type: z.string().min(1).optional(),
});

@Controller("attachments")
export class AttachmentsController {
  constructor(
    @Inject(AttachmentsService) private readonly attachmentsService: AttachmentsService,
  ) {}

  @Post("upload")
  @HttpCode(HttpStatus.CREATED)
  @RequireRoles("operator", "supervisor", "service")
  @UseInterceptors(
    FileInterceptor("file", {
      storage: memoryStorage(),
      limits: {
        fileSize: 10 * 1024 * 1024,
      },
    }),
  )
  async upload(
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body() body: Record<string, unknown>,
    @CurrentAuth() auth?: AuthContext,
  ) {
    const parsed = UploadBodySchema.parse(body);
    if (!file) {
      throw new AppError("file is required", 400);
    }
    return this.attachmentsService.uploadStagedAttachment({
      tenantId: auth?.tenantId ?? "default",
      fileBuffer: file.buffer,
      originalName: file.originalname,
      mime: file.mimetype,
      type: parsed.type,
    });
  }
}
