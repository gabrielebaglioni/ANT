import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "../src/app.module";
import { ShipmentsService } from "../src/modules/shipments/shipments.service";
import { OutboxWorker } from "../src/modules/outbox/outbox.worker";
import { AdminService } from "../src/modules/admin/admin.service";
import { PgStoreService } from "../src/store/pg-store.service";

const authOperator = {
  source: "dev_headers",
  subject: "sup-A",
  actorId: "sup-A",
  tenantId: "default",
  roles: ["operator", "supervisor", "auditor"],
  claims: null,
} as const;

const authSupervisorB = {
  source: "dev_headers",
  subject: "sup-B",
  actorId: "sup-B",
  tenantId: "default",
  roles: ["supervisor"],
  claims: null,
} as const;

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: false });
  try {
    const shipments = app.get(ShipmentsService);
    const outbox = app.get(OutboxWorker);
    const admin = app.get(AdminService);
    const store = app.get(PgStoreService);

    const createRes = await shipments.createShipment(
      {
        trackingUnitType: "LOGISTIC_UNIT",
        trackingId: "urn:epc:id:sscc:1234567.0000009902",
        origin: {
          readPointId: "urn:epc:id:sgln:9521141.54321.0",
          bizLocationId: "urn:epc:id:sgln:9521141.54377.0",
        },
        destination: {
          readPointId: "urn:epc:id:sgln:9521141.11111.0",
          bizLocationId: "urn:epc:id:sgln:9521141.11111.0",
        },
        slaHours: 24,
        maxDelayHours: 6,
        participants: {
          producerDid: "did:iota:producer-demo",
          carrierDid: "did:iota:carrier-demo",
          receiverDid: "did:iota:receiver-demo",
        },
      },
      `smoke-enterprise-${Date.now()}`,
      authOperator as any,
    );

    const code = createRes.shipmentCode;
    const stateBefore = await shipments.getState(code, authOperator as any);
    await outbox.drain(10);
    const stateAfter = await shipments.getState(code, authOperator as any);

    const req = await admin.requestAction(
      code,
      "OPEN_DISPUTE",
      { reason: "Smoke incident validation" },
      authOperator as any,
    );
    const approve = await admin.approveActionRequest(
      req.requestId,
      { note: "Approved by second supervisor" },
      authSupervisorB as any,
    );
    const execute = await admin.executeApprovedActionRequest(req.requestId, authSupervisorB as any);
    const stateFinal = await shipments.getState(code, authOperator as any);
    const metrics = await store.getOpsMetrics();

    console.log(
      JSON.stringify(
        {
          createRes,
          stateBefore,
          stateAfter,
          admin: { req, approve, execute },
          stateFinal,
          metrics,
        },
        null,
        2,
      ),
    );
  } finally {
    await app.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

