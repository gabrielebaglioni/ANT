import { Module } from "@nestjs/common";
import { ShipmentsModule } from "../shipments/shipments.module";
import { AdminController } from "./admin.controller";
import { AdminService } from "./admin.service";

@Module({
  imports: [ShipmentsModule],
  controllers: [AdminController],
  providers: [AdminService],
})
export class AdminModule {}
