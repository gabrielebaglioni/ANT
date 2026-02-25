import { Module } from "@nestjs/common";
import { EpcisModule } from "../epcis/epcis.module";
import { ShipmentsModule } from "../shipments/shipments.module";
import { VerifyController } from "./verify.controller";

@Module({
  imports: [ShipmentsModule, EpcisModule],
  controllers: [VerifyController],
})
export class VerifyModule {}
