import { Injectable, Logger } from "@nestjs/common";
import { Client as MinioClient } from "minio";
import { getRawApiEnv } from "../../config/env";

@Injectable()
export class MinioStorageService {
  private readonly logger = new Logger(MinioStorageService.name);
  private readonly client: MinioClient;
  private readonly bucket: string;
  private bucketReady = false;

  constructor() {
    const env = getRawApiEnv();
    const endPoint = env.MINIO_ENDPOINT;
    const port = env.MINIO_PORT;
    const useSSL = env.MINIO_USE_SSL === "1" || env.MINIO_USE_SSL === "true";
    this.bucket = env.MINIO_BUCKET;

    this.client = new MinioClient({
      endPoint,
      port,
      useSSL,
      accessKey: env.MINIO_ACCESS_KEY,
      secretKey: env.MINIO_SECRET_KEY,
    });
  }

  async putObject(params: {
    objectKey: string;
    data: Buffer;
    contentType?: string;
    metadata?: Record<string, string>;
  }): Promise<void> {
    await this.ensureBucket();
    await this.client.putObject(
      this.bucket,
      params.objectKey,
      params.data,
      params.data.byteLength,
      {
        "Content-Type": params.contentType ?? "application/octet-stream",
        ...(params.metadata ?? {}),
      },
    );
  }

  async presignedGetUrl(objectKey: string, expirySeconds = 3600): Promise<string | null> {
    try {
      await this.ensureBucket();
      return await this.client.presignedGetObject(this.bucket, objectKey, expirySeconds);
    } catch (error) {
      this.logger.warn(
        `Failed to create presigned URL for ${objectKey}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return null;
    }
  }

  private async ensureBucket(): Promise<void> {
    if (this.bucketReady) return;
    const exists = await this.client.bucketExists(this.bucket);
    if (!exists) {
      const env = getRawApiEnv();
      await this.client.makeBucket(this.bucket, env.MINIO_REGION);
    }
    this.bucketReady = true;
  }
}
