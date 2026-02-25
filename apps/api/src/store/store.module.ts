import { Global, Module } from "@nestjs/common";
import { PgStoreService } from "./pg-store.service";

@Global()
@Module({
  providers: [PgStoreService],
  exports: [PgStoreService],
})
export class StoreModule {}
