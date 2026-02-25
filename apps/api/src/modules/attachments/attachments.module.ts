import { Global, Module } from "@nestjs/common";
import { AttachmentsController } from "./attachments.controller";
import { AttachmentsService } from "./attachments.service";
import { MinioStorageService } from "./minio-storage.service";

@Global()
@Module({
  controllers: [AttachmentsController],
  providers: [AttachmentsService, MinioStorageService],
  exports: [AttachmentsService, MinioStorageService],
})
export class AttachmentsModule {}
