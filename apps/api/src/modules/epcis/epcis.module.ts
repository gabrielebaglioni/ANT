import { Module } from "@nestjs/common";
import { EpcisCaptureService } from "./epcis.capture.service";
import { EpcisController } from "./epcis.controller";
import { EpcisQueryService } from "./epcis.query.service";

@Module({
  controllers: [EpcisController],
  providers: [EpcisCaptureService, EpcisQueryService],
  exports: [EpcisCaptureService, EpcisQueryService],
})
export class EpcisModule {}
