import "dotenv/config";

type HeadersMap = Record<string, string>;

const API_BASE = process.env.ANT_SMOKE_API_BASE ?? "http://127.0.0.1:3000";
const TENANT_ID = process.env.ANT_SMOKE_TENANT_ID ?? "tenant-ant-multientity-network";
const FLOW_MODE = process.env.ANT_SMOKE_FLOW === "direct" ? "direct" : "multi";

const producer = {
  actorDid: "did:iota:producer-demo",
  subject: "dev-producer-operator",
  rolesCsv: "operator",
};

const carrier = {
  actorDid: "did:iota:carrier-demo",
  subject: "dev-carrier-operator",
  rolesCsv: "operator",
};

const warehouse = {
  actorDid: "did:iota:warehouse-demo",
  subject: "dev-warehouse-operator",
  rolesCsv: "operator",
};

const carrier2 = {
  actorDid: "did:iota:carrier-2-demo",
  subject: "dev-carrier-2-operator",
  rolesCsv: "operator",
};

const supervisor = {
  actorDid: "did:iota:supervisor-demo",
  subject: "dev-supervisor",
  rolesCsv: "supervisor,auditor",
};

const receiverParticipantDid =
  process.env.ANT_SMOKE_RECEIVER_PARTICIPANT_DID ?? "did:iota:receiver-demo";

const receiver = {
  actorDid: process.env.ANT_SMOKE_FINAL_RECEIVER_DID ?? receiverParticipantDid,
  subject: process.env.ANT_SMOKE_FINAL_RECEIVER_SUB ?? "dev-final-receiver-operator",
  rolesCsv: "operator",
};

function authHeaders(ctx: { actorDid: string; subject: string; rolesCsv: string }): HeadersMap {
  return {
    "x-ant-tenant-id": TENANT_ID,
    "x-ant-role": ctx.rolesCsv,
    "x-ant-actor-id": ctx.actorDid,
    "x-ant-sub": ctx.subject,
  };
}

async function api<T>(
  path: string,
  init?: RequestInit & { headers?: HeadersMap },
): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      ...(init?.body ? { "content-type": "application/json" } : {}),
      ...(init?.headers ?? {}),
    },
  });
  const contentType = response.headers.get("content-type") ?? "";
  const payload = contentType.includes("application/json")
    ? await response.json()
    : await response.text();
  if (!response.ok) {
    throw new Error(
      `${init?.method ?? "GET"} ${path} failed (${response.status}): ${
        typeof payload === "string" ? payload : JSON.stringify(payload)
      }`,
    );
  }
  return payload as T;
}

async function sleep(ms: number) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function pollShipmentState(code: string, expectedStatus: string, timeoutMs = 20000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const state = await api<any>(`/shipments/${encodeURIComponent(code)}/state`, {
      headers: authHeaders(supervisor),
    });
    if (state.status === expectedStatus) return state;
    await sleep(1000);
  }
  throw new Error(`Timed out waiting for ${code} to reach status=${expectedStatus}`);
}

async function pollCustodian(code: string, expectedActorDid: string, timeoutMs = 20000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const state = await api<any>(`/shipments/${encodeURIComponent(code)}/state`, {
      headers: authHeaders(supervisor),
    });
    if (
      (state.status === "IN_TRANSIT" || state.status === "DELIVERED") &&
      state.currentCustodianDid === expectedActorDid
    ) {
      return state;
    }
    await sleep(1000);
  }
  throw new Error(`Timed out waiting for ${code} custody=${expectedActorDid}`);
}

function summarizeForRole(shipments: any[]) {
  const producerView = shipments
    .filter((s) => s.producerDid === producer.actorDid)
    .slice(0, 5)
    .map((s) => ({ code: s.shipmentCode, status: s.status }));

  const carrierView = shipments
    .filter(
      (s) =>
        s.carrierDid === carrier.actorDid ||
        s.currentCustodianDid === carrier.actorDid ||
        s.expectedReceiverDid === carrier.actorDid,
    )
    .slice(0, 5)
    .map((s) => ({
      code: s.shipmentCode,
      status: s.status,
      currentCustodianDid: s.currentCustodianDid,
      expectedReceiverDid: s.expectedReceiverDid,
    }));

  const receiverPending = shipments
    .filter((s) => s.receiverDid === receiver.actorDid && s.status === "PENDING_RECEIVER")
    .slice(0, 5)
    .map((s) => ({ code: s.shipmentCode, status: s.status }));

  return { producerView, carrierView, receiverPending };
}

async function main() {
  console.log("== Health ==");
  const health = await api("/health");
  console.log(health);

  console.log("\n== Workspace list (before create) ==");
  const beforeList = await api<any[]>("/shipments?limit=20", {
    headers: authHeaders(supervisor),
  });
  console.log(`tenant=${TENANT_ID} shipments=${beforeList.length}`);

  const routePlan =
    FLOW_MODE === "direct"
      ? [
          { stepType: "CARRIER", actorDid: carrier.actorDid, label: "Corriere 1" },
          {
            stepType: "FINAL_RECEIVER",
            actorDid: receiver.actorDid,
            label: "Final Receiver",
            maxStepHours: 8,
          },
        ]
      : [
          { stepType: "CARRIER", actorDid: carrier.actorDid, label: "Corriere 1" },
          { stepType: "WAREHOUSE", actorDid: warehouse.actorDid, label: "Magazzino 1", maxStepHours: 12 },
          { stepType: "CARRIER", actorDid: carrier2.actorDid, label: "Corriere 2" },
          {
            stepType: "FINAL_RECEIVER",
            actorDid: receiver.actorDid,
            label: "Receiver Hub Dock",
            maxStepHours: 8,
          },
        ];

  const createBody = {
    trackingUnitType: "LOGISTIC_UNIT",
    trackingId: `urn:epc:id:sscc:1234567.${String(Date.now()).slice(-10)}`,
    origin: {
      readPointId: "urn:epc:id:sgln:9521141.54321.0",
      bizLocationId: "urn:epc:id:sgln:9521141.54377.0",
      label: "Origin Dock",
    },
    destination: {
      readPointId: "urn:epc:id:sgln:9521141.11111.0",
      bizLocationId: "urn:epc:id:sgln:9521141.11111.0",
      label: "Receiver Hub Dock",
    },
    slaHours: 24,
    maxDelayHours: 6,
    conditions: {
      sealRequired: true,
      routePlan,
    },
    participants: {
      producerDid: producer.actorDid,
      carrierDid: carrier.actorDid,
      receiverDid: receiverParticipantDid,
    },
  };

  console.log("\n== Producer creates shipment ==");
  const createRes = await api<any>("/shipments", {
    method: "POST",
    headers: {
      ...authHeaders(producer),
      "Idempotency-Key": `smoke-create-${Date.now()}`,
    },
    body: JSON.stringify(createBody),
  });
  console.log(createRes);
  const code = String(createRes.shipmentCode);

  console.log("\n== Poll state until ACTIVE (MOVE_CREATE done) ==");
  const activeState = await pollShipmentState(code, "ACTIVE");
  console.log(activeState);

  console.log("\n== Verify and timeline immediately after create (expected empty EPCIS timeline) ==");
  const timelineBefore = await api<any[]>(`/shipments/${encodeURIComponent(code)}/timeline`, {
    headers: authHeaders(producer),
  });
  const verifyBefore = await api<any>(`/verify/${encodeURIComponent(code)}`, {
    headers: authHeaders(producer),
  });
  console.log({ timelineEvents: timelineBefore.length, verifyEvents: verifyBefore.events.length });

  console.log("\n== Workspace list after create (same tenant, role-derived views) ==");
  const afterCreateList = await api<any[]>("/shipments?limit=50", {
    headers: authHeaders(supervisor),
  });
  const afterCreateRoleViews = summarizeForRole(afterCreateList);
  console.log(afterCreateRoleViews);

  const hopActors =
    FLOW_MODE === "direct"
      ? ([
          {
            name: "Carrier 1",
            ctx: carrier,
            where: {
              readPointId: "urn:epc:id:sgln:9521141.54321.0",
              bizLocationId: "urn:epc:id:sgln:9521141.54377.0",
            },
          },
          {
            name: "Final Receiver",
            ctx: receiver,
            where: {
              readPointId: "urn:epc:id:sgln:9521141.11111.0",
              bizLocationId: "urn:epc:id:sgln:9521141.11111.0",
            },
          },
        ] as const)
      : ([
          {
            name: "Carrier 1",
            ctx: carrier,
            where: {
              readPointId: "urn:epc:id:sgln:9521141.54321.0",
              bizLocationId: "urn:epc:id:sgln:9521141.54377.0",
            },
          },
          {
            name: "Warehouse 1",
            ctx: warehouse,
            where: {
              readPointId: "urn:epc:id:sgln:9521141.77777.0",
              bizLocationId: "urn:epc:id:sgln:9521141.77777.0",
            },
          },
          {
            name: "Carrier 2",
            ctx: carrier2,
            where: {
              readPointId: "urn:epc:id:sgln:9521141.88888.0",
              bizLocationId: "urn:epc:id:sgln:9521141.88888.0",
            },
          },
          {
            name: "Final Receiver",
            ctx: receiver,
            where: {
              readPointId: "urn:epc:id:sgln:9521141.11111.0",
              bizLocationId: "urn:epc:id:sgln:9521141.11111.0",
            },
          },
        ] as const);

  let lastHopState = activeState;
  for (const [index, hop] of hopActors.entries()) {
    console.log(`\n== ${hop.name} scan/resolve (manual ANT code only) ==`);
    const resolve = await api<any>(`/shipments/${encodeURIComponent(code)}/scan/resolve`, {
      method: "POST",
      headers: authHeaders(hop.ctx),
      body: JSON.stringify({}),
    });
    console.log(resolve);

    console.log(`\n== ${hop.name} scan/confirm (debug auto-close + take custody) ==`);
    const confirm = await api<any>(`/shipments/${encodeURIComponent(code)}/scan/confirm`, {
      method: "POST",
      headers: {
        ...authHeaders(hop.ctx),
        "Idempotency-Key": `smoke-scan-${index + 1}-${Date.now()}`,
      },
      body: JSON.stringify({
        who: { actorDid: hop.ctx.actorDid },
        where: hop.where,
        when: new Date().toISOString(),
        attachments: [],
      }),
    });
    console.log(confirm);

    console.log(`\n== Poll custody -> ${hop.name} ==`);
    lastHopState = await pollCustodian(code, hop.ctx.actorDid);
    console.log(lastHopState);

    const hopTimeline = await api<any[]>(`/shipments/${encodeURIComponent(code)}/timeline`, {
      headers: authHeaders(hop.ctx),
    });
    const hopVerify = await api<any>(`/verify/${encodeURIComponent(code)}`, {
      headers: authHeaders(hop.ctx),
    });
    console.log({
      hop: hop.name,
      timelineEvents: hopTimeline.length,
      verifyEvents: hopVerify.events.length,
      proofsValid: hopVerify.verificationSummary?.proofsValid,
    });
  }

  console.log("\n== Bottleneck after final receiver pickup ==");
  const bottleneck = await api<any>(`/shipments/${encodeURIComponent(code)}/bottleneck`, {
    headers: authHeaders(supervisor),
  });
  console.log(bottleneck);

  console.log("\n== Workspace list after multi-hop route (Producer / Carrier / Receiver) ==");
  const afterCarrierPickupList = await api<any[]>("/shipments?limit=50", {
    headers: authHeaders(supervisor),
  });
  const roleViewsAfterCarrierPickup = summarizeForRole(afterCarrierPickupList);
  console.log(roleViewsAfterCarrierPickup);

  console.log("\n== Workspace list after handover IN (Producer / Carrier / Receiver) ==");
  const afterInList = await api<any[]>("/shipments?limit=50", {
    headers: authHeaders(supervisor),
  });
  const roleViewsAfterIn = summarizeForRole(afterInList);
  console.log(roleViewsAfterIn);

  console.log("\n== Result summary ==");
  console.log({
    createdShipmentCode: code,
    producerSeesCreated: roleViewsAfterCarrierPickup.producerView.some((s) => s.code === code),
    carrierSeesShipment: roleViewsAfterCarrierPickup.carrierView.some((s) => s.code === code),
    receiverSeesPendingBeforeReceiverPickup: roleViewsAfterCarrierPickup.receiverPending.some(
      (s) => s.code === code,
    ),
    statusAfterCarrierPickup: "IN_TRANSIT",
    statusAfterIn: lastHopState.status,
    receiverIsCustodianAfterIn: lastHopState.currentCustodianDid === receiver.actorDid,
    receiverPendingClearedAfterIn: !roleViewsAfterIn.receiverPending.some((s) => s.code === code),
  });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
