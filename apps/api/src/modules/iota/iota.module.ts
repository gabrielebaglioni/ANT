import { Global, Module } from "@nestjs/common";
import { IotaGateway } from "./iota.gateway";

@Global()
@Module({
  providers: [IotaGateway],
  exports: [IotaGateway],
})
export class IotaModule {}
