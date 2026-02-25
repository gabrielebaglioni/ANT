import { useMemo, useState } from "react";
import type { ShipmentIssueHistory, VerifyResponse } from "@ant/shared";
import { getVerifyShipment } from "../../api/verify";
import { EventCard } from "../../components/EventCard";
import { QRCodeView } from "../../components/QRCodeView";
import { IssueHistoryList } from "../../components/IssueHistoryList";
import { useShipmentStore } from "../../store/shipmentStore";
import { getErrorMessage } from "../../utils/errors";
import { parseShipmentQr } from "../../epcis/qr";
import { actorLabelFromDid } from "../../utils/actorLabels";
import { getShipmentIssueHistory, reportShipmentIssue } from "../../api/shipments";

function buildJourneyNarrative(event: VerifyResponse["events"][number]) {
  const payload = (event.payload ?? {}) as Record<string, unknown>;
  const extensions = (payload.extensions ?? {}) as Record<string, unknown>;
  const ant = (extensions.ant ?? {}) as Record<string, unknown>;
  const handover = typeof ant.handover === "string" ? ant.handover : null;
  const actorDid = typeof ant.actorDid === "string" ? ant.actorDid : null;
  const nextActorDid = typeof ant.nextActorDid === "string" ? ant.nextActorDid : null;
  const finalDelivery = ant.finalDelivery === true;
  const actor = actorLabelFromDid(actorDid);
  const nextActor = actorLabelFromDid(nextActorDid);
  const when = new Date(event.eventTime).toLocaleString();
  if (handover === "OUT") {
    return `${actor} ha consegnato / rilasciato la shipment alle ${when} verso ${nextActor}.`;
  }
  if (handover === "IN") {
    if (finalDelivery) {
      return `${actor} ha completato la consegna finale alle ${when}.`;
    }
    return `${actor} ha preso in carico la shipment alle ${when}.`;
  }
  return `${actor} ha registrato un evento ${event.action} (${event.bizStep}) alle ${when}.`;
}

function buildFinalReceiverLabelPayload(data: VerifyResponse, issueHistory: ShipmentIssueHistory): string {
  const conditions = (data.shipment.conditions ?? {}) as Record<string, unknown>;
  const routePlan = Array.isArray(conditions.routePlan) ? conditions.routePlan : [];
  const timelineSummary = data.events.map((event) => {
    const payload = (event.payload ?? {}) as Record<string, unknown>;
    const extensions = (payload.extensions ?? {}) as Record<string, unknown>;
    const ant = (extensions.ant ?? {}) as Record<string, unknown>;
    return {
      t: event.eventTime,
      h: typeof ant.handover === "string" ? ant.handover : null,
      f: ant.finalDelivery === true ? 1 : 0,
      a: actorLabelFromDid(typeof ant.actorDid === "string" ? ant.actorDid : null),
      n: actorLabelFromDid(typeof ant.nextActorDid === "string" ? ant.nextActorDid : null),
      p: event.proof?.status ?? null,
    };
  });

  return JSON.stringify({
    schema: "ANT_FINAL_LABEL_V1",
    generatedAt: new Date().toISOString(),
    shipment: {
      code: data.shipment.shipmentCode,
      status: data.shipment.status,
      trackingUnitType: data.shipment.trackingUnitType ?? null,
      trackingId: data.shipment.trackingId ?? null,
      lotNumber: data.shipment.lotNumber ?? null,
      epcClass: data.shipment.epcClass ?? null,
      origin: data.shipment.origin ?? null,
      destination: data.shipment.destination ?? null,
    },
    policy: {
      slaHours: data.shipment.slaHours ?? null,
      maxDelayHours: data.shipment.maxDelayHours ?? null,
      sealRequired: Boolean(conditions.sealRequired),
      tempMin: typeof conditions.tempMin === "number" ? Number(conditions.tempMin) : null,
      tempMax: typeof conditions.tempMax === "number" ? Number(conditions.tempMax) : null,
    },
    route: routePlan.map((step) => {
      const s = step as Record<string, unknown>;
      return {
        t: typeof s.stepType === "string" ? s.stepType : "CUSTOM",
        l: typeof s.label === "string" ? s.label : undefined,
        a: actorLabelFromDid(typeof s.actorDid === "string" ? s.actorDid : null),
        h: typeof s.maxStepHours === "number" ? Number(s.maxStepHours) : undefined,
      };
    }),
    verification: data.verificationSummary,
    journey: timelineSummary,
    issues: issueHistory.map((issue) => ({
      id: issue.issueId,
      t: issue.createdAt,
      s: issue.severity,
      d: issue.damaged,
      n: issue.notifyNextActor,
      title: issue.title,
      desc: issue.description ?? undefined,
      attachments: issue.attachments.map((a) => ({
        h: a.sha256,
        n: a.sourceFileName ?? undefined,
        u: a.downloadUrl ?? undefined,
      })),
    })),
  });
}

export function VerifyPage() {
  const shipmentCode = useShipmentStore((s) => s.sharedShipmentCodeInput);
  const setShipmentCode = useShipmentStore((s) => s.setSharedShipmentCodeInput);
  const syncShipmentCodeEverywhere = useShipmentStore((s) => s.syncShipmentCodeEverywhere);
  const lastCreatedShipmentCode = useShipmentStore((s) => s.lastCreatedShipmentCode);
  const workspaceSession = useShipmentStore((s) => s.workspaceSession);
  const [data, setData] = useState<VerifyResponse | null>(null);
  const [issueHistory, setIssueHistory] = useState<ShipmentIssueHistory>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [issueBusy, setIssueBusy] = useState(false);
  const [issueResult, setIssueResult] = useState<string>("");
  const [issueTitle, setIssueTitle] = useState("Prodotto arrivato danneggiato");
  const [issueDescription, setIssueDescription] = useState("");
  const [issueSeverity, setIssueSeverity] = useState<"LOW" | "MEDIUM" | "HIGH" | "CRITICAL">("HIGH");

  const load = async () => {
    if (!shipmentCode) return;
    const parsedCode = parseShipmentQr(shipmentCode) ?? shipmentCode.trim();
    syncShipmentCodeEverywhere(parsedCode);
    setBusy(true);
    setError("");
    try {
      const [result, issues] = await Promise.all([
        getVerifyShipment(parsedCode),
        getShipmentIssueHistory(parsedCode),
      ]);
      setData(result);
      setIssueHistory(issues);
    } catch (e) {
      setData(null);
      setIssueHistory([]);
      setError(getErrorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const isFinalReceiverForLoadedShipment =
    Boolean(data) && workspaceSession.actorDid === data?.shipment.participants.receiverDid;
  const finalLabelPayload = useMemo(
    () => (data ? buildFinalReceiverLabelPayload(data, issueHistory) : ""),
    [data, issueHistory],
  );

  const openIssue = async () => {
    if (!data) return;
    if (!issueDescription.trim()) {
      setError("Inserisci una descrizione testuale dell'issue.");
      return;
    }
    setIssueBusy(true);
    setIssueResult("");
    setError("");
    try {
      const result = await reportShipmentIssue(data.shipment.shipmentCode, {
        title: issueTitle || undefined,
        description: issueDescription,
        category: "OTHER",
        severity: issueSeverity,
        damaged: true,
        attachments: [],
      });
      setIssueResult(`${result.issueId} • ${result.message}`);
      const [refreshed, issues] = await Promise.all([
        getVerifyShipment(data.shipment.shipmentCode),
        getShipmentIssueHistory(data.shipment.shipmentCode),
      ]);
      setData(refreshed);
      setIssueHistory(issues);
    } catch (e) {
      setError(getErrorMessage(e));
    } finally {
      setIssueBusy(false);
    }
  };

  return (
    <div className="panel-grid">
      <div className="card">
        <h2>Verify (Read-only, shareable)</h2>
        <p className="field-hint" style={{ marginTop: -4 }}>
          Vista audit/read-only per tenant <strong>{workspaceSession.tenantId}</strong>. Accetta
          sia QR payload completi sia solo shipment code.
        </p>
        <div className="actions">
          <input
            style={{ flex: 1, minWidth: 240 }}
            value={shipmentCode}
            onChange={(e) => setShipmentCode(e.target.value)}
            placeholder="ANT-8F2A oppure ant://shipment/ANT-8F2A?v=1&chk=XXXXXXX"
          />
          <button type="button" className="btn primary" disabled={busy} onClick={() => void load()}>
            {busy ? "Verifying..." : "Verify shipment"}
          </button>
          {lastCreatedShipmentCode && (
            <button
              type="button"
              className="btn"
              disabled={busy}
              onClick={() => setShipmentCode(lastCreatedShipmentCode)}
            >
              Use last created
            </button>
          )}
        </div>
        {error && <p className="error">{error}</p>}
      </div>

      {data && (
        <>
          <div className="card">
            <h3>Verification Summary</h3>
            <div className="summary-grid">
              <div className="summary-tile">
                <span>Events Verified</span>
                <strong>{data.verificationSummary.eventsVerified}</strong>
              </div>
              <div className="summary-tile">
                <span>Signatures Valid</span>
                <strong>{data.verificationSummary.signaturesValid}</strong>
              </div>
              <div className="summary-tile">
                <span>Proofs Valid</span>
                <strong>{data.verificationSummary.proofsValid}</strong>
              </div>
            </div>
            <p className="muted" style={{ marginTop: 10 }}>
              Shipment {data.shipment.shipmentCode} • {data.shipment.status}
            </p>
            {data.shipment.trackingId && (
              <p className="field-hint" style={{ marginTop: 6 }}>
                Tracking: <code>{data.shipment.trackingId}</code>
                {data.shipment.conditions &&
                typeof (data.shipment.conditions as Record<string, unknown>).sealRequired === "boolean"
                  ? ` • Seal required: ${String(
                      Boolean((data.shipment.conditions as Record<string, unknown>).sealRequired),
                    )}`
                  : ""}
              </p>
            )}
          </div>

          <div className="card">
            <h3>Journey Summary (leggibile)</h3>
            <p className="field-hint" style={{ marginTop: -4 }}>
              Sequenza descritta in linguaggio operativo: chi ha preso in carico / consegnato, quando e con proof.
            </p>
            <div className="role-list-stack compact">
              {data.events.length === 0 ? (
                <p className="muted">Nessun evento ancora registrato.</p>
              ) : (
                data.events.map((event, index) => (
                  <div key={`journey-${event.eventId}`} className="role-approval-item">
                    <div>
                      <p className="title">{index + 1}. {buildJourneyNarrative(event)}</p>
                      <p className="sub">
                        Proof {event.proof?.status ?? "—"} · Stage {event.processingStage}
                      </p>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          <IssueHistoryList
            issues={issueHistory}
            title="Issue & Preavvisi (audit trail)"
            subtitle="Segnalazioni operative e preavvisi registrati dagli attori della filiera."
          />

          {isFinalReceiverForLoadedShipment && data.events.length > 0 && (
            <>
              <QRCodeView
                value={finalLabelPayload}
                title={data.shipment.shipmentCode}
                subtitle="Final receiver label QR (passaggi + policy + verify)"
                downloadFileName={`final-label-${data.shipment.shipmentCode}`}
                payloadHint="QR finale (dev) con riepilogo passaggi, condizioni prodotto e stato verify. Può essere stampato come etichetta interna."
              />
              <div className="card">
                <h3>Final Receiver Actions</h3>
                <p className="field-hint" style={{ marginTop: -4 }}>
                  Usa il QR finale per stampa etichetta interna e apri un issue se il prodotto arriva danneggiato.
                </p>
                <div className="actions">
                  <button type="button" className="btn" onClick={() => window.print()}>
                    Stampa etichetta (pagina)
                  </button>
                </div>
                <div className="form-grid" style={{ marginTop: 8 }}>
                  <div className="field">
                    <label>Titolo issue</label>
                    <input value={issueTitle} onChange={(e) => setIssueTitle(e.target.value)} />
                  </div>
                  <div className="field">
                    <label>Severità impatto</label>
                    <select
                      value={issueSeverity}
                      onChange={(e) =>
                        setIssueSeverity(e.target.value as "LOW" | "MEDIUM" | "HIGH" | "CRITICAL")
                      }
                    >
                      <option value="LOW">Piccolo</option>
                      <option value="MEDIUM">Medio</option>
                      <option value="HIGH">Grande</option>
                      <option value="CRITICAL">Altissimo</option>
                    </select>
                  </div>
                  <div className="field full">
                    <label>Descrizione issue (obbligatoria)</label>
                    <textarea
                      rows={3}
                      value={issueDescription}
                      onChange={(e) => setIssueDescription(e.target.value)}
                      placeholder="Es. imballo bagnato, confezione schiacciata, temperatura non conforme..."
                    />
                  </div>
                  <div className="actions">
                      <button
                        type="button"
                        className="btn warn"
                        disabled={issueBusy || !issueDescription.trim()}
                        onClick={() => void openIssue()}
                      >
                      {issueBusy ? "Invio issue..." : "Apri issue danno"}
                    </button>
                    {issueResult && <span className="field-hint">{issueResult}</span>}
                  </div>
                </div>
              </div>
            </>
          )}

          <section className="timeline">
            {data.events.map((event, index) => (
              <EventCard
                key={event.eventId}
                event={event}
                previousEvent={data.events[index - 1] ?? null}
                nextEvent={data.events[index + 1] ?? null}
              />
            ))}
          </section>
        </>
      )}
    </div>
  );
}
