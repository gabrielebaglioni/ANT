import { Module } from "@nestjs/common";
import { DatabaseModule } from "./db/database.module";
import { StoreModule } from "./store/store.module";
import { HealthController } from "./common/health.controller";
import { ShipmentsModule } from "./modules/shipments/shipments.module";
import { EpcisModule } from "./modules/epcis/epcis.module";
import { VerifyModule } from "./modules/verify/verify.module";
import { ProofModule } from "./modules/proof/proof.module";
import { IotaModule } from "./modules/iota/iota.module";
import { OutboxModule } from "./modules/outbox/outbox.module";
import { AttachmentsModule } from "./modules/attachments/attachments.module";
import { ReconciliationModule } from "./modules/reconciliation/reconciliation.module";
import { AdminModule } from "./modules/admin/admin.module";
import { AuthModule } from "./modules/auth/auth.module";
import { OpsModule } from "./modules/ops/ops.module";

@Module({
  imports: [
    AuthModule,
    DatabaseModule,
    StoreModule,
    ProofModule,
    IotaModule,
    AttachmentsModule,
    EpcisModule,
    ShipmentsModule,
    VerifyModule,
    OutboxModule,
    ReconciliationModule,
    AdminModule,
    OpsModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
