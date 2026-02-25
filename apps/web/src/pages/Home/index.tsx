import type { ShipmentWorkspaceItem } from "@ant/shared";
import { useEffect, useMemo, useState } from "react";
import { listWorkspaceShipments } from "../../api/shipments";
import {
  deriveWorkspaceCapabilities,
  organizationTypeLabel,
  personaLabel,
  type AppTabKey,
} from "../../workspace/authz";
import { useShipmentStore } from "../../store/shipmentStore";

interface WorkspaceHomePageProps {
  onNavigate: (tab: AppTabKey) => void;
}

function personaTone(persona: string): string {
  if (persona === "PRODUCER_OPERATOR") return "producer";
  if (persona === "CARRIER_OPERATOR") return "carrier";
  if (persona === "RECEIVER_OPERATOR") return "receiver";
  if (persona === "SUPERVISOR") return "supervisor";
  return "auditor";
}

function personaGlyph(persona: string): string {
  if (persona === "PRODUCER_OPERATOR") return "◌";
  if (persona === "CARRIER_OPERATOR") return "⇄";
  if (persona === "RECEIVER_OPERATOR") return "✓";
  if (persona === "SUPERVISOR") return "⌘";
  return "◎";
}

function personaAccent(persona: string): string {
  if (persona === "PRODUCER_OPERATOR") return "#10b981";
  if (persona === "CARRIER_OPERATOR") return "#0d7377";
  if (persona === "RECEIVER_OPERATOR") return "#f59e0b";
  if (persona === "SUPERVISOR") return "#f43f5e";
  return "#64748b";
}

function shipmentStatusLabel(status: ShipmentWorkspaceItem["status"]): string {
  if (status === "PROVISIONING") return "Provisioning";
  if (status === "PROVISIONING_FAILED") return "Provisioning Failed";
  if (status === "PENDING_RECEIVER") return "Pending Receiver";
  if (status === "IN_TRANSIT") return "In Transit";
  if (status === "DELIVERED") return "Delivered";
  if (status === "DISPUTE") return "Dispute";
  if (status === "ACTIVE") return "Active";
  return "Created";
}

function shipmentStatusChipClass(status: ShipmentWorkspaceItem["status"]): string {
  if (status === "IN_TRANSIT" || status === "ACTIVE") return "role-status-chip green";
  if (status === "PENDING_RECEIVER") return "role-status-chip amber";
  if (status === "PROVISIONING") return "role-status-chip";
  if (status === "PROVISIONING_FAILED" || status === "DISPUTE") return "role-status-chip danger";
  return "role-status-chip";
}

function shortDid(value: string | null | undefined): string {
  if (!value) return "n/a";
  if (value.length <= 20) return value;
  return `${value.slice(0, 14)}…${value.slice(-4)}`;
}

function isSealRequired(item: ShipmentWorkspaceItem): boolean {
  return Boolean((item.conditions ?? {}).sealRequired);
}

type RoutePlanStep = {
  stepType: string;
  actorDid: string;
  label?: string;
  maxStepHours?: number;
};

function getRoutePlan(item: ShipmentWorkspaceItem): RoutePlanStep[] {
  const raw = (item.conditions ?? {}).routePlan;
  if (!Array.isArray(raw)) return [];
  const parsed: RoutePlanStep[] = [];
  for (const step of raw) {
    if (!step || typeof step !== "object") continue;
    const obj = step as Record<string, unknown>;
    const actorDid = typeof obj.actorDid === "string" ? obj.actorDid.trim() : "";
    const stepType = typeof obj.stepType === "string" ? obj.stepType.trim() : "CUSTOM";
    if (!actorDid) continue;
    parsed.push({
      stepType,
      actorDid,
      label: typeof obj.label === "string" ? obj.label.trim() : undefined,
      maxStepHours:
        typeof obj.maxStepHours === "number" && Number.isFinite(obj.maxStepHours)
          ? Number(obj.maxStepHours)
          : undefined,
    });
  }
  return parsed;
}

function getCurrentRouteStep(item: ShipmentWorkspaceItem): RoutePlanStep | null {
  if (!item.currentCustodianDid) return null;
  return getRoutePlan(item).find((step) => step.actorDid === item.currentCustodianDid) ?? null;
}

function getNextRouteStep(item: ShipmentWorkspaceItem): RoutePlanStep | null {
  const plan = getRoutePlan(item);
  if (!plan.length) return null;
  if (item.expectedReceiverDid) {
    return plan.find((step) => step.actorDid === item.expectedReceiverDid) ?? null;
  }
  if (!item.currentCustodianDid) return plan[0] ?? null;
  const index = plan.findIndex((step) => step.actorDid === item.currentCustodianDid);
  if (index < 0) return plan[0] ?? null;
  return plan[index + 1] ?? null;
}

function routeStepLabel(step: RoutePlanStep | null): string {
  if (!step) return "—";
  return step.label?.trim() || step.stepType;
}

function formatDateTimeShort(value: string | null | undefined): string {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString([], {
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatRemainingMs(ms: number): string {
  const abs = Math.abs(ms);
  const totalMinutes = Math.max(0, Math.floor(abs / 60000));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
}

function getCustodyDeadlineInfo(item: ShipmentWorkspaceItem) {
  const currentStep = getCurrentRouteStep(item);
  if (!currentStep?.maxStepHours) return null;
  const updatedAtMs = new Date(item.updatedAt).getTime();
  if (Number.isNaN(updatedAtMs)) return null;
  const deadlineMs = updatedAtMs + currentStep.maxStepHours * 60 * 60 * 1000;
  return {
    currentStep,
    deadlineIso: new Date(deadlineMs).toISOString(),
    remainingMs: deadlineMs - Date.now(),
    overdue: deadlineMs - Date.now() < 0,
  };
}

function roleProgressText(item: ShipmentWorkspaceItem): string {
  if (item.operationsBlocked) {
    return `Operazioni bloccate (${item.blockReason ?? "SECURITY_HOLD"})`;
  }
  if (item.status === "PROVISIONING") return "Provisioning on-chain in corso";
  if (item.status === "PROVISIONING_FAILED") return "Provisioning fallito";
  if (item.status === "PENDING_RECEIVER") {
    return `In attesa conferma da ${shortDid(item.expectedReceiverDid)}`;
  }
  const next = getNextRouteStep(item);
  if (next) return `Prossimo passaggio: ${routeStepLabel(next)}`;
  return "Passaggi route completati";
}

function compareByUpdatedDesc(a: ShipmentWorkspaceItem, b: ShipmentWorkspaceItem): number {
  return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
}

export function WorkspaceHomePage({ onNavigate }: WorkspaceHomePageProps) {
  const workspaceSession = useShipmentStore((s) => s.workspaceSession);
  const lastCreatedShipmentCode = useShipmentStore((s) => s.lastCreatedShipmentCode);
  const sharedShipmentCodeInput = useShipmentStore((s) => s.sharedShipmentCodeInput);
  const setSharedShipmentCodeInput = useShipmentStore((s) => s.setSharedShipmentCodeInput);
  const syncShipmentCodeEverywhere = useShipmentStore((s) => s.syncShipmentCodeEverywhere);
  const capabilities = deriveWorkspaceCapabilities(workspaceSession);
  const [auditNotes, setAuditNotes] = useState("");
  const [workspaceShipments, setWorkspaceShipments] = useState<ShipmentWorkspaceItem[]>([]);
  const [workspaceLoading, setWorkspaceLoading] = useState(true);
  const [workspaceLoadError, setWorkspaceLoadError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let firstLoad = true;
    const load = async () => {
      try {
        if (firstLoad) setWorkspaceLoading(true);
        const data = await listWorkspaceShipments(50);
        if (cancelled) return;
        setWorkspaceShipments(data);
        setWorkspaceLoadError(null);
      } catch (error) {
        if (cancelled) return;
        setWorkspaceLoadError(error instanceof Error ? error.message : "Load failed");
      } finally {
        if (!cancelled) setWorkspaceLoading(false);
        firstLoad = false;
      }
    };
    void load();
    const timer = window.setInterval(() => {
      void load();
    }, 4000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [
    workspaceSession.tenantId,
    workspaceSession.actorDid,
    workspaceSession.primaryPersona,
    workspaceSession.rolesCsv,
  ]);

  const tone = personaTone(workspaceSession.primaryPersona);
  const accent = personaAccent(workspaceSession.primaryPersona);
  const avatar = workspaceSession.identityLabel?.trim()?.[0]?.toUpperCase() || "A";
  const shipmentCode = sharedShipmentCodeInput || "ANT-DEMO-OK1";
  const actorDid = workspaceSession.actorDid;
  const producerShipments = useMemo(
    () => workspaceShipments.filter((item) => item.producerDid === actorDid),
    [workspaceShipments, actorDid],
  );
  const carrierShipments = useMemo(
    () =>
      workspaceShipments.filter(
        (item) =>
          item.carrierDid === actorDid ||
          item.currentCustodianDid === actorDid ||
          item.expectedReceiverDid === actorDid,
      ),
    [workspaceShipments, actorDid],
  );
  const carrierCustodyShipments = useMemo(
    () =>
      carrierShipments.filter(
        (item) =>
          item.currentCustodianDid === actorDid ||
          (item.status === "PENDING_RECEIVER" && item.carrierDid === actorDid),
      ),
    [carrierShipments, actorDid],
  );
  const receiverShipments = useMemo(
    () => workspaceShipments.filter((item) => item.receiverDid === actorDid),
    [workspaceShipments, actorDid],
  );
  const receiverPendingShipments = useMemo(
    () => receiverShipments.filter((item) => item.status === "PENDING_RECEIVER"),
    [receiverShipments],
  );
  const issueShipments = useMemo(
    () =>
      workspaceShipments.filter(
        (item) =>
          item.operationsBlocked ||
          item.reconciliationStatus === "MISMATCH" ||
          item.reconciliationStatus === "ERROR" ||
          item.status === "PENDING_RECEIVER" ||
          item.status === "PROVISIONING_FAILED",
      ),
    [workspaceShipments],
  );
  const latestProducerShipment =
    (lastCreatedShipmentCode
      ? producerShipments.find((item) => item.shipmentCode === lastCreatedShipmentCode)
      : undefined) ?? producerShipments[0] ?? null;
  const producerCurrentWaitingShipment = useMemo(
    () =>
      producerShipments
        .filter(
          (item) =>
            item.currentCustodianDid === item.producerDid &&
            ["ACTIVE", "PROVISIONING", "CREATED"].includes(item.status),
        )
        .sort(compareByUpdatedDesc)[0] ?? null,
    [producerShipments],
  );
  const producerShipmentHistory = useMemo(
    () =>
      producerShipments
        .filter((item) => item.shipmentCode !== producerCurrentWaitingShipment?.shipmentCode)
        .sort(compareByUpdatedDesc),
    [producerShipments, producerCurrentWaitingShipment?.shipmentCode],
  );
  const carrierPrimaryShipment =
    carrierCustodyShipments.find((item) =>
      ["PENDING_RECEIVER", "IN_TRANSIT", "ACTIVE", "PROVISIONING"].includes(item.status),
    ) ??
    carrierCustodyShipments[0] ??
    null;
  const carrierCurrentShipment = useMemo(
    () =>
      carrierShipments.find((item) => item.currentCustodianDid === actorDid) ??
      carrierShipments.find((item) => item.expectedReceiverDid === actorDid) ??
      null,
    [carrierShipments, actorDid],
  );
  const carrierShipmentHistory = useMemo(
    () =>
      carrierShipments
        .filter((item) => item.shipmentCode !== carrierCurrentShipment?.shipmentCode)
        .sort(compareByUpdatedDesc),
    [carrierShipments, carrierCurrentShipment?.shipmentCode],
  );
  const receiverCurrentShipment = useMemo(
    () => receiverShipments.find((item) => item.currentCustodianDid === actorDid) ?? null,
    [receiverShipments, actorDid],
  );
  const receiverShipmentHistory = useMemo(
    () =>
      receiverShipments
        .filter(
          (item) =>
            item.shipmentCode !== receiverCurrentShipment?.shipmentCode &&
            item.status !== "PENDING_RECEIVER",
        )
        .sort(compareByUpdatedDesc),
    [receiverShipments, receiverCurrentShipment?.shipmentCode],
  );

  const openVerifyForCode = (code: string) => {
    syncShipmentCodeEverywhere(code);
    onNavigate("verify");
  };
  const openTimelineForCode = (code: string) => {
    syncShipmentCodeEverywhere(code);
    onNavigate("timeline");
  };

  const rootClass = `role-dashboard role-${tone}`;

  if (workspaceSession.primaryPersona === "PRODUCER_OPERATOR") {
    const checks = [
      { label: "Verify producer/carrier/receiver DID", done: true },
      { label: "Confirm origin/destination SGLN", done: true },
      { label: "Keep sensitive data off QR", done: false },
    ];

    return (
      <div className={rootClass}>
        <RoleHeaderBar
          title={workspaceSession.organizationName}
          persona={personaLabel(workspaceSession.primaryPersona)}
          personaColor={accent}
          avatar={avatar}
        />

        <div className="role-screen-content">
          <div className="role-card role-card-sm">
            <div className="role-mini-grid two">
              <div>
                <small>Identity</small>
                <p>{workspaceSession.identityLabel}</p>
              </div>
              <div>
                <small>Tenant</small>
                <p className="monospace">{workspaceSession.tenantId}</p>
              </div>
            </div>
          </div>

          <div className="role-card role-gradient-soft">
            <small>Current shipment (in attesa di ritiro)</small>
            {producerCurrentWaitingShipment ? (
              <>
                <div className="role-inline-row" style={{ marginTop: 6 }}>
                  <p className="monospace" style={{ margin: 0, fontWeight: 700 }}>
                    {producerCurrentWaitingShipment.shipmentCode}
                  </p>
                  <span className={shipmentStatusChipClass(producerCurrentWaitingShipment.status)}>
                    {shipmentStatusLabel(producerCurrentWaitingShipment.status)}
                  </span>
                </div>
                <p style={{ marginTop: 8 }}>
                  Prossimo attore: {shortDid(producerCurrentWaitingShipment.expectedReceiverDid)}
                  <br />
                  Prossimo step: {routeStepLabel(getNextRouteStep(producerCurrentWaitingShipment))}
                  <br />
                  Carrier: {shortDid(producerCurrentWaitingShipment.carrierDid)} · Receiver:{" "}
                  {shortDid(producerCurrentWaitingShipment.receiverDid)}
                </p>
                {producerCurrentWaitingShipment.currentCustodianDid ===
                  producerCurrentWaitingShipment.producerDid &&
                  producerCurrentWaitingShipment.status === "ACTIVE" && (
                    <p className="muted" style={{ marginTop: 6 }}>
                      Shipment creata e pronta. Questa card cambia solo quando il prossimo attore
                      scannerizza il QR / inserisce il codice ANT e prende in carico la consegna.
                    </p>
                  )}
                {producerCurrentWaitingShipment.status === "PENDING_RECEIVER" && (
                  <p className="muted" style={{ marginTop: 6 }}>
                    Passaggio consegna aperto: in attesa di conferma presa in carico dal prossimo attore.
                  </p>
                )}
                <div className="role-chip-row" style={{ marginTop: 8 }}>
                  {isSealRequired(producerCurrentWaitingShipment) && (
                    <span className="role-chip required">Seal required</span>
                  )}
                  <span className="role-chip">
                    {producerCurrentWaitingShipment.moveObjectId ? "Move active" : "Move pending"}
                  </span>
                  <span className="role-chip">
                    Ultimo update {formatDateTimeShort(producerCurrentWaitingShipment.updatedAt)}
                  </span>
                </div>
              </>
            ) : (
              <p>
                {workspaceLoading
                  ? "Caricamento shipment..."
                  : "Nessuna shipment in attesa di ritiro. Crea una shipment e comparirà qui finché il corriere non la prende in carico."}
              </p>
            )}
          </div>

          <div className="role-card role-gradient-solid producer">
            <div className="role-hero-action-head">
              <div className="role-hero-icon">▣</div>
              <div>
                <h3>Create Shipment + QR</h3>
                <p>Crea shipment container e avvia secure provisioning</p>
              </div>
            </div>
            <button className="role-cta-white" type="button" onClick={() => onNavigate("create")}>Nuova shipment</button>
          </div>

          <div className="role-card">
            <div className="role-action-row">
              <div className="role-icon-box">⌕</div>
              <div>
                <h4>Verify / Audit rapido</h4>
                <p>Controlla proof e timeline di una shipment</p>
              </div>
            </div>
            <button className="role-cta-outline" type="button" onClick={() => onNavigate("verify")}>Apri Verify</button>
          </div>

          <ChecklistCard title="Controlli prima di creare" items={checks} />

          <div className="role-card role-gradient-soft warning">
            <div className="role-action-row">
              <div className="role-icon-box">!</div>
              <div>
                <h4>ANT + IOTA</h4>
                <p>
                  Payload privati restano off-chain. Solo proof di integrità sono notarizzati on-chain su IOTA.
                </p>
              </div>
            </div>
          </div>

          {producerShipmentHistory.length > 0 ? (
            <div className="role-card">
              <div className="role-inline-row">
                <h4 style={{ margin: 0 }}>Storico shipment (già ritirate / in filiera)</h4>
                <span className="role-badge-count">{producerShipmentHistory.length}</span>
              </div>
              <div className="role-list-stack compact">
                {producerShipmentHistory.slice(0, 6).map((item) => (
                  <div key={item.shipmentCode} className="role-approval-item">
                    <div>
                      <p className="title">{item.shipmentCode}</p>
                      <p className="sub">
                        {shipmentStatusLabel(item.status)} · {item.trackingUnitType} · {roleProgressText(item)}
                      </p>
                    </div>
                    <div className="role-inline-row">
                      <button
                        type="button"
                        className="role-link-btn"
                        onClick={() => openTimelineForCode(item.shipmentCode)}
                      >
                        Timeline →
                      </button>
                      <button
                        type="button"
                        className="role-link-btn"
                        onClick={() => openVerifyForCode(item.shipmentCode)}
                      >
                        Verify →
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="role-card role-empty-state">
              <div className="role-empty-circle">◌</div>
              <h4>{workspaceLoading ? "Caricamento shipment..." : "Nessuna shipment recente"}</h4>
              <p>
                {workspaceLoadError
                  ? `Errore workspace: ${workspaceLoadError}`
                  : "Le tue shipment appariranno qui"}
              </p>
            </div>
          )}
        </div>
      </div>
    );
  }

  if (workspaceSession.primaryPersona === "CARRIER_OPERATOR") {
    const safetyChecks = [
      { label: "Confirm actor DID matches current custodian", done: true },
      { label: "Do not sign if status/QR mismatch", done: false },
      { label: "Upload evidence if seal required", done: false },
    ];

    return (
      <div className={rootClass}>
        <RoleHeaderBar
          title={workspaceSession.organizationName}
          persona={personaLabel(workspaceSession.primaryPersona)}
          personaColor={accent}
          avatar={avatar}
        />

        <div className="role-screen-content">
          <div className="role-card role-gradient-solid carrier">
            <small>Current shipment in carico (corriere)</small>
            {carrierCurrentShipment ? (
              <>
                <div className="role-inline-row" style={{ marginTop: 6 }}>
                  <h3 style={{ margin: 0 }}>{carrierCurrentShipment.shipmentCode}</h3>
                  <span className="role-status-chip on-dark">
                    {shipmentStatusLabel(carrierCurrentShipment.status)}
                  </span>
                </div>
                <div className="role-mini-grid two on-dark" style={{ marginTop: 12 }}>
                  <div>
                    <small>Custodian</small>
                    <p>
                      {carrierCurrentShipment.currentCustodianDid === actorDid
                        ? "Tu (presa in carico confermata)"
                        : shortDid(carrierCurrentShipment.currentCustodianDid)}
                    </p>
                  </div>
                  <div>
                    <small>Prossimo attore</small>
                    <p>{shortDid(getNextRouteStep(carrierCurrentShipment)?.actorDid)}</p>
                  </div>
                  <div>
                    <small>Prossimo step</small>
                    <p>{routeStepLabel(getNextRouteStep(carrierCurrentShipment))}</p>
                  </div>
                  <div>
                    <small>Ultimo update</small>
                    <p>{formatDateTimeShort(carrierCurrentShipment.updatedAt)}</p>
                  </div>
                  <div className="full">
                    <small>Move / Reconciliation</small>
                    <p className="monospace">
                      {carrierCurrentShipment.moveObjectId ? "Move active" : "Move pending"} ·{" "}
                      {carrierCurrentShipment.reconciliationStatus ?? "UNKNOWN"}
                    </p>
                  </div>
                </div>
                {(() => {
                  const deadline = getCustodyDeadlineInfo(carrierCurrentShipment);
                  if (!deadline) return null;
                  return (
                    <div
                      className={deadline.overdue ? "role-alert-panel danger" : "role-alert-panel warning"}
                      style={{ marginTop: 12 }}
                    >
                      <div className="role-alert-icon">{deadline.overdue ? "✕" : "⏱"}</div>
                      <div>
                        <h4>
                          {deadline.overdue
                            ? "Tempo massimo step superato"
                            : "Tempo residuo per consegnare al prossimo attore"}
                        </h4>
                        <p>
                          Step corrente: {routeStepLabel(deadline.currentStep)} · Deadline{" "}
                          {formatDateTimeShort(deadline.deadlineIso)}
                        </p>
                        <div className="role-chip-row">
                          <span className="role-chip">
                            {deadline.overdue ? "Overdue" : "Tempo residuo"} {formatRemainingMs(deadline.remainingMs)}
                          </span>
                          <span className="role-chip">
                            Next {shortDid(getNextRouteStep(carrierCurrentShipment)?.actorDid)}
                          </span>
                        </div>
                      </div>
                    </div>
                  );
                })()}
                <div className="role-chip-row" style={{ marginTop: 10 }}>
                  {isSealRequired(carrierCurrentShipment) && (
                    <span className="role-chip required">Seal photo required</span>
                  )}
                  {carrierCurrentShipment.operationsBlocked && (
                    <span className="role-chip">Blocked</span>
                  )}
                </div>
              </>
            ) : (
              <p style={{ marginTop: 8 }}>
                {workspaceLoading
                  ? "Caricamento shipment..."
                  : "Nessuna shipment in carico. Vai su Scan, inserisci il codice ANT e prendi in carico il passaggio."}
              </p>
            )}
          </div>

          <div className="role-card role-hero-focus">
            <div className="role-hero-action-head">
              <div className="role-hero-icon carrier">⌁</div>
              <div>
                <h3>Scan codice ANT e presa in carico</h3>
                <p>Development: inserisci il codice ANT e conferma il passaggio di consegna</p>
              </div>
            </div>
            <button className="role-cta-gradient" type="button" onClick={() => onNavigate("scan")}>Apri Scan</button>
          </div>

          <div className="role-grid-2">
            <button className="role-quick-btn" type="button" onClick={() => onNavigate("timeline")}>
              <span className="role-quick-icon">≋</span>
              <span>Timeline</span>
            </button>
            <button className="role-quick-btn" type="button" onClick={() => onNavigate("verify")}>
              <span className="role-quick-icon">⌕</span>
              <span>Verify</span>
            </button>
          </div>

          {carrierShipments.find((item) => item.status === "PENDING_RECEIVER") ? (
            <div className="role-alert-panel warning">
              <div className="role-alert-icon">!</div>
              <div>
                <h4>Pending receiver confirmation</h4>
                <p>Il receiver deve confermare l&apos;ingresso per completare il handover</p>
                <div className="role-chip-row">
                  <span className="role-chip">
                    Shipment {carrierShipments.find((item) => item.status === "PENDING_RECEIVER")?.shipmentCode}
                  </span>
                  <span className="role-chip">Issue MISSING_RECEIVER_CONFIRMATION</span>
                </div>
                <button
                  type="button"
                  className="role-link-btn"
                  onClick={() =>
                    openVerifyForCode(
                      carrierShipments.find((item) => item.status === "PENDING_RECEIVER")?.shipmentCode ??
                        shipmentCode,
                    )
                  }
                >
                  Cerca in Verify →
                </button>
              </div>
            </div>
          ) : (
            <div className="role-card role-gradient-soft info">
              <p>
                Nessun handover in attesa di conferma. Le shipment `OUT` compariranno qui finché il receiver non conferma.
              </p>
            </div>
          )}

          <div className="role-card">
            <div className="role-action-row">
              <div className="role-icon-box warning">◫</div>
              <div>
                <h4>Attachments richiesti</h4>
                <p>Policy richiede upload di foto sigillo/documenti al momento del handover</p>
              </div>
            </div>
            <div className="role-chip-row">
              <span className="role-chip">
                {carrierCurrentShipment?.shipmentCode ?? carrierPrimaryShipment?.shipmentCode ?? shipmentCode}
              </span>
              {(carrierCurrentShipment ?? carrierPrimaryShipment) &&
              isSealRequired((carrierCurrentShipment ?? carrierPrimaryShipment) as ShipmentWorkspaceItem) ? (
                <span className="role-chip required">seal_photo.jpg required</span>
              ) : (
                <span className="role-chip">No mandatory seal photo</span>
              )}
            </div>
          </div>

          {carrierShipmentHistory.length > 0 && (
            <div className="role-card">
              <div className="role-inline-row">
                <h4 style={{ margin: 0 }}>Storico passaggi (corriere)</h4>
                <span className="role-badge-count">{carrierShipmentHistory.length}</span>
              </div>
              <div className="role-list-stack compact">
                {carrierShipmentHistory.slice(0, 6).map((item) => (
                  <div key={item.shipmentCode} className="role-approval-item">
                    <div>
                      <p className="title">{item.shipmentCode}</p>
                      <p className="sub">
                        {shipmentStatusLabel(item.status)} · {roleProgressText(item)}
                      </p>
                    </div>
                    <div className="role-inline-row">
                      <button
                        type="button"
                        className="role-link-btn"
                        onClick={() => openTimelineForCode(item.shipmentCode)}
                      >
                        Timeline →
                      </button>
                      <button
                        type="button"
                        className="role-link-btn"
                        onClick={() => openVerifyForCode(item.shipmentCode)}
                      >
                        Verify →
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          <ChecklistCard title="Safety checklist" items={safetyChecks} />

          <div className="role-card role-gradient-soft info">
            <p>
              <strong>Field-first workflow:</strong> tutto disponibile in 1-2 tap. Controlla sempre DID attuale prima di firmare.
            </p>
          </div>
        </div>
      </div>
    );
  }

  if (workspaceSession.primaryPersona === "RECEIVER_OPERATOR") {
    const pendingShipments = receiverPendingShipments.map((item) => ({
      code: item.shipmentCode,
      carrier: shortDid(item.carrierDid),
      status: shipmentStatusLabel(item.status),
    }));
    const receiverIssueShipment = receiverShipments.find(
      (item) =>
        item.operationsBlocked ||
        item.reconciliationStatus === "MISMATCH" ||
        item.reconciliationStatus === "ERROR",
    );
    const checks = [
      { label: "Match DID atteso", done: true },
      { label: "Check shipment code and status", done: false },
      { label: "Document exceptions before confirming", done: false },
    ];
    const isFinalReceiverProfile = workspaceSession.actorDid.includes("final-receiver");

    return (
      <div className={rootClass}>
        <RoleHeaderBar
          title={workspaceSession.organizationName}
          persona={personaLabel(workspaceSession.primaryPersona)}
          personaColor={accent}
          avatar={avatar}
        />

        <div className="role-screen-content">
          <div className="role-card">
            <div className="role-inline-row">
              <h3 style={{ margin: 0 }}>In attesa di conferma</h3>
              <span className="role-badge-count">{pendingShipments.length}</span>
            </div>
            {pendingShipments.length > 0 ? (
              <div className="role-list-stack">
                {pendingShipments.map((item) => (
                  <div key={`${item.code}-${item.carrier}`} className="role-queue-item warning">
                    <div>
                      <p className="title">{item.code}</p>
                      <p className="sub">Da: {item.carrier}</p>
                    </div>
                    <span className="role-status-chip amber">{item.status}</span>
                  </div>
                ))}
              </div>
            ) : (
              <p style={{ marginTop: 10 }}>
                {workspaceLoading ? "Caricamento..." : "Nessuna shipment in attesa di conferma"}
              </p>
            )}
          </div>

          <div className="role-card role-gradient-soft">
            <small>Current shipment in carico (magazzino / receiver)</small>
            {receiverCurrentShipment ? (
              <>
                <div className="role-inline-row" style={{ marginTop: 6 }}>
                  <p className="monospace" style={{ margin: 0, fontWeight: 700 }}>
                    {receiverCurrentShipment.shipmentCode}
                  </p>
                  <span className={shipmentStatusChipClass(receiverCurrentShipment.status)}>
                    {shipmentStatusLabel(receiverCurrentShipment.status)}
                  </span>
                </div>
                <p style={{ marginTop: 8 }}>
                  Hai preso in carico questa shipment. {roleProgressText(receiverCurrentShipment)}
                </p>
                {(() => {
                  const deadline = getCustodyDeadlineInfo(receiverCurrentShipment);
                  if (!deadline) return null;
                  return (
                    <div
                      className={deadline.overdue ? "role-alert-panel danger" : "role-alert-panel warning"}
                      style={{ marginTop: 10 }}
                    >
                      <div className="role-alert-icon">{deadline.overdue ? "✕" : "⏱"}</div>
                      <div>
                        <h4>
                          {deadline.overdue
                            ? "Tempo massimo step superato"
                            : "Tempo residuo prima del prossimo passaggio"}
                        </h4>
                        <p>
                          Step: {routeStepLabel(deadline.currentStep)} · Deadline{" "}
                          {formatDateTimeShort(deadline.deadlineIso)}
                        </p>
                      </div>
                    </div>
                  );
                })()}
                <div className="role-chip-row" style={{ marginTop: 8 }}>
                  {isSealRequired(receiverCurrentShipment) && (
                    <span className="role-chip required">Seal / quality evidence</span>
                  )}
                  <span className="role-chip">
                    Next: {shortDid(getNextRouteStep(receiverCurrentShipment)?.actorDid)}
                  </span>
                </div>
              </>
            ) : (
              <p style={{ marginTop: 10 }}>
                {workspaceLoading
                  ? "Caricamento..."
                  : "Nessuna shipment attualmente in carico. Dopo lo Scan comparirà qui la shipment presa in carico."}
              </p>
            )}
          </div>

          <div className="role-card role-gradient-solid receiver">
            <div className="role-hero-action-head">
              <div className="role-hero-icon">✓</div>
              <div>
                <h3>Confirm IN</h3>
                <p>Conferma ricezione sicura della shipment</p>
              </div>
            </div>
            <button className="role-cta-white" type="button" onClick={() => onNavigate("scan")}>Apri Scan & Sign</button>
          </div>

          {isFinalReceiverProfile && (
            <div className="role-card role-gradient-soft info">
              <div className="role-action-row">
                <div className="role-icon-box">▦</div>
                <div>
                  <h4>QR label finale + issue danno</h4>
                  <p>
                    Dopo la presa in carico finale, vai su Verify per scaricare il QR con passaggi/policy e aprire un issue se il prodotto è danneggiato.
                  </p>
                </div>
              </div>
              <button className="role-cta-outline" type="button" onClick={() => onNavigate("verify")}>
                Apri Verify (label / issue)
              </button>
            </div>
          )}

          <div className="role-card">
            <div className="role-action-row">
              <div className="role-icon-box">⌕</div>
              <div>
                <h4>Controlla proof e timeline</h4>
                <p>Verifica prima della conferma per evitare dispute</p>
              </div>
            </div>
            <div className="role-grid-2 compact">
              <button className="role-cta-outline" type="button" onClick={() => onNavigate("timeline")}>Timeline</button>
              <button className="role-cta-outline" type="button" onClick={() => onNavigate("verify")}>Verify</button>
            </div>
          </div>

          {receiverShipments.some(
            (item) => item.expectedReceiverDid && item.expectedReceiverDid !== actorDid,
          ) && (
            <div className="role-alert-panel danger">
              <div className="role-alert-icon">✕</div>
              <div>
                <h4>Wrong expected receiver DID</h4>
                <p>Il DID atteso non corrisponde. Verifica prima di confermare.</p>
                <div className="role-chip-row">
                  <span className="role-chip">Issue WRONG_EXPECTED_RECEIVER_DID</span>
                </div>
                <button
                  type="button"
                  className="role-link-btn"
                  onClick={() =>
                    openVerifyForCode(
                      receiverShipments.find(
                        (item) => item.expectedReceiverDid && item.expectedReceiverDid !== actorDid,
                      )?.shipmentCode ?? shipmentCode,
                    )
                  }
                >
                  Cerca in Verify →
                </button>
              </div>
            </div>
          )}
          {receiverIssueShipment ? (
            <div className="role-alert-panel warning">
              <div className="role-alert-icon">!</div>
              <div>
                <h4>Problema da verificare prima della conferma</h4>
                <p>{roleProgressText(receiverIssueShipment)}</p>
                <div className="role-chip-row">
                  <span className="role-chip">Shipment {receiverIssueShipment.shipmentCode}</span>
                  <span className="role-chip">
                    Issue{" "}
                    {receiverIssueShipment.reconciliationStatus === "MISMATCH" ||
                    receiverIssueShipment.reconciliationStatus === "ERROR"
                      ? "PROOF_MISMATCH"
                      : receiverIssueShipment.operationsBlocked
                        ? "SECURITY_HOLD"
                        : "CHECK_REQUIRED"}
                  </span>
                </div>
                <button
                  type="button"
                  className="role-link-btn"
                  onClick={() => openVerifyForCode(receiverIssueShipment.shipmentCode)}
                >
                  Cerca in Verify →
                </button>
              </div>
            </div>
          ) : (
            <div className="role-card role-gradient-soft info">
              <p>
                Nessun problema critico rilevato sulle tue shipment. Verifica comunque proof e timeline prima della conferma.
              </p>
            </div>
          )}

          {receiverShipmentHistory.length > 0 && (
            <div className="role-card">
              <div className="role-inline-row">
                <h4 style={{ margin: 0 }}>Storico passaggi (magazzino / receiver)</h4>
                <span className="role-badge-count">{receiverShipmentHistory.length}</span>
              </div>
              <div className="role-list-stack compact">
                {receiverShipmentHistory.slice(0, 6).map((item) => (
                  <div key={item.shipmentCode} className="role-approval-item">
                    <div>
                      <p className="title">{item.shipmentCode}</p>
                      <p className="sub">{shipmentStatusLabel(item.status)} · {roleProgressText(item)}</p>
                    </div>
                    <div className="role-inline-row">
                      <button
                        type="button"
                        className="role-link-btn"
                        onClick={() => openTimelineForCode(item.shipmentCode)}
                      >
                        Timeline →
                      </button>
                      <button
                        type="button"
                        className="role-link-btn"
                        onClick={() => openVerifyForCode(item.shipmentCode)}
                      >
                        Verify →
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          <ChecklistCard title="Checklist obbligatoria" items={checks} />

          <div className="role-card role-gradient-soft warning">
            <p>
              <strong>Prevenzione dispute:</strong> la tua conferma completa il handover. Non confermare se rilevi anomalie o mismatch nei proof.
            </p>
          </div>
        </div>
      </div>
    );
  }

  if (workspaceSession.primaryPersona === "SUPERVISOR") {
    const pendingConfirmations = workspaceShipments.filter(
      (item) => item.status === "PENDING_RECEIVER",
    ).length;
    const mismatchCount = workspaceShipments.filter(
      (item) =>
        item.reconciliationStatus === "MISMATCH" ||
        item.reconciliationStatus === "ERROR" ||
        item.operationsBlocked,
    ).length;
    const failedProvisioning = workspaceShipments.filter(
      (item) => item.status === "PROVISIONING_FAILED",
    ).length;
    const kpis = [
      { label: "Pending confirmations", value: String(pendingConfirmations), color: "#f59e0b", glyph: "⏱" },
      { label: "Workspace shipments", value: String(workspaceShipments.length), color: "#10b981", glyph: "◫" },
      { label: "Reconciliation mismatches", value: String(mismatchCount), color: "#dc2626", glyph: "✕" },
      { label: "Provisioning failed", value: String(failedProvisioning), color: "#64748b", glyph: "!" },
    ];
    const alerts = [
      ...issueShipments.slice(0, 6).map((item) => ({
        title: item.operationsBlocked
          ? "Operations blocked / supervisor review"
          : item.reconciliationStatus === "MISMATCH" || item.reconciliationStatus === "ERROR"
            ? "Reconciliation mismatch detected"
            : item.status === "PENDING_RECEIVER"
              ? "Pending receiver confirmation"
              : "Provisioning failed",
        severity:
          item.operationsBlocked ||
          item.reconciliationStatus === "MISMATCH" ||
          item.reconciliationStatus === "ERROR" ||
          item.status === "PROVISIONING_FAILED"
            ? ("high" as const)
            : ("medium" as const),
        time: new Date(item.updatedAt).toLocaleString(),
        code: item.shipmentCode,
      })),
      { title: "Pending approval request (compensation)", severity: "low" as const, time: "queue", code: "REQ-089" },
    ];
    const approvalQueue = [
      { action: "Suspend shipment", code: "ANT-DEMO-MISMATCH1", status: "requested" },
      { action: "Compensation event", code: "COMP-034", status: "approved" },
    ];

    return (
      <div className={rootClass}>
        <RoleHeaderBar
          title={workspaceSession.organizationName}
          persona="Supervisor"
          personaColor={accent}
          avatar={avatar}
          secondaryTag="Control Tower"
        />

        <div className="role-screen-content">
          <div className="role-kpi-grid">
            {kpis.map((kpi) => (
              <div key={kpi.label} className="role-kpi-card">
                <div className="role-kpi-icon" style={{ color: kpi.color, backgroundColor: `${kpi.color}15` }}>{kpi.glyph}</div>
                <p className="value" style={{ color: kpi.color }}>{kpi.value}</p>
                <p className="label">{kpi.label}</p>
              </div>
            ))}
          </div>

          <div className="role-card">
            <div className="role-inline-row">
              <h3 style={{ margin: 0 }}>Alerts prioritized</h3>
              <span className="role-badge-count danger">{alerts.length}</span>
            </div>
            <div className="role-list-stack">
              {alerts.map((alert) => (
                <div key={`${alert.code}-${alert.title}`} className={`role-alert-item ${alert.severity}`}>
                  <div className="role-inline-row top">
                    <p className="title">{alert.title}</p>
                    <span className={`role-severity-pill ${alert.severity}`}>{alert.severity}</span>
                  </div>
                  <div className="role-inline-row meta">
                    <span>{alert.time}</span>
                    <code>{alert.code}</code>
                  </div>
                  {alert.code.startsWith("ANT-") && (
                    <button
                      type="button"
                      className="role-link-btn"
                      onClick={() => openVerifyForCode(alert.code)}
                    >
                      Cerca in Verify →
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>

          <div className="role-card role-gradient-soft supervisor">
            <h4>Governance quick actions</h4>
            <div className="role-list-stack compact">
              <button className="role-list-action" type="button" onClick={() => onNavigate("admin")}>Open dispute</button>
              <button className="role-list-action" type="button" onClick={() => onNavigate("admin")}>Suspend shipment</button>
              <button className="role-list-action" type="button" onClick={() => onNavigate("admin")}>Review action requests</button>
            </div>
          </div>

          <div className="role-card role-gradient-soft info">
            <div className="role-action-row">
              <div className="role-icon-box">⌘</div>
              <div>
                <h4>Dual-control governance</h4>
                <p>No rollback on-chain: usa compensations con approval workflow per correzioni auditabili</p>
              </div>
            </div>
          </div>

          <div className="role-card">
            <h4>Approval queue</h4>
            <div className="role-list-stack compact">
              {approvalQueue.map((item) => (
                <div key={`${item.action}-${item.code}`} className="role-approval-item">
                  <div>
                    <p className="title">{item.action}</p>
                    <code>{item.code}</code>
                  </div>
                  <span className={item.status === "requested" ? "role-status-chip amber" : "role-status-chip green"}>
                    {item.status === "requested" ? "Requested" : "Approved"}
                  </span>
                </div>
              ))}
            </div>
          </div>

          <button className="role-cta-gradient supervisor" type="button" onClick={() => onNavigate("admin")}>Apri Admin Console completa</button>
        </div>
      </div>
    );
  }

  return (
    <div className={rootClass}>
      <RoleHeaderBar
        title={workspaceSession.organizationName}
        persona="Auditor"
        personaColor={accent}
        avatar={avatar}
        secondaryTag="Read-only"
      />

      <div className="role-screen-content">
        <div className="role-card">
          <label className="fig-field-label">Cerca shipment code</label>
          <div className="role-search-wrap">
            <input
              type="text"
              className="fig-input"
              placeholder="ANT-DEMO-OK1"
              value={sharedShipmentCodeInput}
              onChange={(e) => setSharedShipmentCodeInput(e.target.value)}
            />
            <button type="button" className="role-search-apply" onClick={() => syncShipmentCodeEverywhere(sharedShipmentCodeInput || "ANT-DEMO-OK1")}>⌕</button>
          </div>
        </div>

        <div className="role-grid-2">
          <button className="role-card role-quick-tile dark-teal" type="button" onClick={() => onNavigate("timeline")}>
            <span className="role-quick-icon">≋</span>
            <strong>Timeline</strong>
          </button>
          <button className="role-card role-quick-tile dark-slate" type="button" onClick={() => onNavigate("verify")}>
            <span className="role-quick-icon">⌕</span>
            <strong>Verify</strong>
          </button>
        </div>

        <div className="role-card">
          <div className="role-action-row">
            <div className="role-icon-box ok">◎</div>
            <div>
              <h4>Verification summary</h4>
              <p>{shipmentCode}</p>
            </div>
          </div>
          <div className="role-list-stack compact">
            <SummaryCheckRow label="Events verified" ok count="12/12" />
            <SummaryCheckRow label="Signatures valid" ok count="12/12" />
            <SummaryCheckRow label="Proofs valid" ok={false} count="11/12" />
          </div>
        </div>

        <div className="role-alert-panel danger">
          <div className="role-alert-icon">!</div>
          <div>
            <h4>Proof mismatch found</h4>
            <p>Event #8 presenta un mismatch tra payload hash e proof on-chain</p>
            <div className="role-chip-row">
              <span className="role-chip">Shipment ANT-DEMO-MISMATCH1</span>
              <span className="role-chip">Issue PROOF_MISMATCH</span>
              <span className="role-chip">Event #8</span>
            </div>
            <button type="button" className="role-link-btn" onClick={() => openVerifyForCode("ANT-DEMO-MISMATCH1")}>
              Cerca in Verify / event details →
            </button>
          </div>
        </div>

        <div className="role-card role-gradient-soft auditor">
          <div className="role-action-row">
            <div className="role-icon-box">◎</div>
            <div>
              <h4>Read-only access</h4>
              <p>Nessuna azione operativa disponibile. Per dispute o correzioni, escalare al Supervisor.</p>
              <p className="role-footnote">Escalation path: supervisor@supply-chain-hq</p>
            </div>
          </div>
        </div>

        <div className="role-card">
          <h4>Audit notes (local annotation)</h4>
          <textarea
            className="fig-input role-textarea"
            rows={4}
            value={auditNotes}
            onChange={(e) => setAuditNotes(e.target.value)}
            placeholder="Aggiungi note di audit (salvate solo localmente)..."
          />
          <p className="role-footnote">Le note non vengono salvate nel sistema centrale</p>
        </div>

        <div className="role-card role-gradient-soft info">
          <p>
            <strong>Clarity first:</strong> modalità audit fornisce accesso completo a timeline, proof e verification senza possibilità di modifica.
          </p>
        </div>
      </div>
    </div>
  );
}

function RoleHeaderBar({
  title,
  persona,
  personaColor,
  avatar,
  secondaryTag,
}: {
  title: string;
  persona: string;
  personaColor: string;
  avatar: string;
  secondaryTag?: string;
}) {
  return (
    <div className="role-header">
      <div className="role-header-top">
        <div className="role-header-brand">
          <div className="fig-logo-sm"><span>A</span></div>
          <div>
            <h1>ANT</h1>
            <p>{title}</p>
          </div>
        </div>
        <div className="role-avatar" style={{ background: `linear-gradient(135deg, ${personaColor}, ${personaColor}cc)` }}>
          {avatar}
        </div>
      </div>
      <div className="role-header-tags">
        <span className="role-persona-tag" style={{ color: personaColor, background: `${personaColor}12`, borderColor: `${personaColor}33` }}>
          {persona}
        </span>
        {secondaryTag && <span className="role-secondary-tag">{secondaryTag}</span>}
      </div>
    </div>
  );
}

function ChecklistCard({ title, items }: { title: string; items: Array<{ label: string; done: boolean }> }) {
  return (
    <div className="role-card">
      <h4>{title}</h4>
      <div className="role-list-stack compact">
        {items.map((item) => (
          <div key={item.label} className="role-check-item">
            <span className={item.done ? "role-check-dot done" : "role-check-dot"}>{item.done ? "✓" : ""}</span>
            <p className={item.done ? "done" : ""}>{item.label}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

function SummaryCheckRow({ label, ok, count }: { label: string; ok: boolean; count: string }) {
  return (
    <div className={ok ? "role-summary-check ok" : "role-summary-check danger"}>
      <div className="role-inline-row">
        <span className="role-summary-icon">{ok ? "✓" : "✕"}</span>
        <span>{label}</span>
      </div>
      <strong>{count}</strong>
    </div>
  );
}
