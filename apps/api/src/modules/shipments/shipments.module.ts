import { Module } from "@nestjs/common";
import { EpcisModule } from "../epcis/epcis.module";
import { ShipmentsController } from "./shipments.controller";
import { ShipmentsRepoPg } from "./shipments.repo.pg";
import { ShipmentsService } from "./shipments.service";

@Module({
  imports: [EpcisModule],
  controllers: [ShipmentsController],
  providers: [ShipmentsRepoPg, ShipmentsService],
  exports: [ShipmentsRepoPg, ShipmentsService],
})
export class ShipmentsModule {}
