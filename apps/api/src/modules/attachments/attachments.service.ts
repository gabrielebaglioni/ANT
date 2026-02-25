import { Inject, Injectable } from "@nestjs/common";
import { createHash } from "node:crypto";
import { extname } from "node:path";
import { AppError } from "../../lib/errors";
import { PgStoreService } from "../../store/pg-store.service";
import { MinioStorageService } from "./minio-storage.service";

export interface UploadedAttachmentResult {
  sha256: string;
  objectStoreKey: string;
  type: string;
  mime: string | null;
  sizeBytes: number;
  downloadUrl: string | null;
}

export interface StagedAttachmentRef {
  sha256: string;
  type: string;
  mime: string | null;
  sizeBytes: number | null;
  sourceFileName: string | null;
  downloadUrl: string | null;
}

@Injectable()
export class AttachmentsService {
  constructor(
    @Inject(PgStoreService) private readonly store: PgStoreService,
    @Inject(MinioStorageService) private readonly minio: MinioStorageService,
  ) {}

  async uploadStagedAttachment(input: {
    tenantId: string;
    fileBuffer: Buffer;
    originalName?: string;
    mime?: string;
    type?: string;
  }): Promise<UploadedAttachmentResult> {
    if (!input.fileBuffer?.byteLength) {
      throw new AppError("Empty file upload", 400);
    }

    const sha256 = createHash("sha256").update(input.fileBuffer).digest("hex");
    const type = input.type ?? "PHOTO_SEAL";
    const date = new Date();
    const y = String(date.getUTCFullYear());
    const m = String(date.getUTCMonth() + 1).padStart(2, "0");
    const d = String(date.getUTCDate()).padStart(2, "0");
    const ext = extname(input.originalName ?? "").toLowerCase();
    const tenantPrefix = input.tenantId.replace(/[^a-zA-Z0-9._-]/g, "_");
    const objectStoreKey = `tenants/${tenantPrefix}/uploads/${y}/${m}/${d}/${sha256}${ext || ""}`;

    await this.minio.putObject({
      objectKey: objectStoreKey,
      data: input.fileBuffer,
      contentType: input.mime,
      metadata: {
        "x-amz-meta-ant-sha256": sha256,
        "x-amz-meta-ant-type": type,
      },
    });

    await this.store.stageAttachmentUpload({
      tenantId: input.tenantId,
      sha256,
      objectStoreKey,
      type,
      mime: input.mime ?? null,
      sizeBytes: input.fileBuffer.byteLength,
      sourceFileName: input.originalName ?? null,
    });

    return {
      sha256,
      objectStoreKey,
      type,
      mime: input.mime ?? null,
      sizeBytes: input.fileBuffer.byteLength,
      downloadUrl: await this.minio.presignedGetUrl(objectStoreKey),
    };
  }

  async assertStagedAttachmentsExist(hashes: string[], tenantId: string): Promise<void> {
    if (hashes.length === 0) return;
    const rows = await this.store.listStagedAttachmentsBySha256(hashes, tenantId);
    const found = new Set(rows.map((r) => r.sha256));
    const missing = hashes.filter((h) => !found.has(h));
    if (missing.length > 0) {
      throw new AppError("Missing staged attachment(s)", 400, { missing });
    }
  }

  async linkStagedAttachmentsToEvent(
    eventId: string,
    hashes: string[],
    tenantId: string,
  ): Promise<void> {
    if (hashes.length === 0) return;
    const rows = await this.store.listStagedAttachmentsBySha256(hashes, tenantId);
    const byHash = new Map(rows.map((r) => [r.sha256, r]));

    for (const hash of hashes) {
      const row = byHash.get(hash);
      if (!row) {
        throw new AppError("Missing staged attachment(s)", 400, { missing: [hash] });
      }
      await this.store.createAttachmentForEvent(eventId, {
        tenantId,
        type: row.type,
        objectStoreKey: row.objectStoreKey,
        sha256: row.sha256,
        mime: row.mime,
        sizeBytes: row.sizeBytes,
      });
    }
  }

  async getStagedAttachmentRefs(hashes: string[], tenantId: string): Promise<StagedAttachmentRef[]> {
    if (hashes.length === 0) return [];
    const rows = await this.store.listStagedAttachmentsBySha256(hashes, tenantId);
    const byHash = new Map(rows.map((r) => [r.sha256, r]));
    const ordered = hashes.map((hash) => byHash.get(hash)).filter(Boolean);
    return Promise.all(
      ordered.map(async (row) => ({
        sha256: row!.sha256,
        type: row!.type,
        mime: row!.mime,
        sizeBytes: row!.sizeBytes,
        sourceFileName: row!.sourceFileName,
        downloadUrl: await this.minio.presignedGetUrl(row!.objectStoreKey),
      })),
    );
  }
}
