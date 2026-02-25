import { Module } from "@nestjs/common";
import { OpsController } from "./ops.controller";
import { MonitoringWorker } from "./monitoring.worker";

@Module({
  controllers: [OpsController],
  providers: [MonitoringWorker],
})
export class OpsModule {}

