import { useState } from "react";
import type { BottleneckResult, EpcisEventReadModel, ShipmentIssueHistory } from "@ant/shared";
import { getShipmentBottleneck, getShipmentIssueHistory, getShipmentTimeline } from "../../api/shipments";
import { EventCard } from "../../components/EventCard";
import { BottleneckBanner } from "../../components/BottleneckBanner";
import { IssueHistoryList } from "../../components/IssueHistoryList";
import { useShipmentStore } from "../../store/shipmentStore";
import { getErrorMessage } from "../../utils/errors";
import { parseShipmentQr } from "../../epcis/qr";

export function TimelinePage() {
  const shipmentCode = useShipmentStore((s) => s.sharedShipmentCodeInput);
  const setShipmentCode = useShipmentStore((s) => s.setSharedShipmentCodeInput);
  const syncShipmentCodeEverywhere = useShipmentStore((s) => s.syncShipmentCodeEverywhere);
  const lastCreatedShipmentCode = useShipmentStore((s) => s.lastCreatedShipmentCode);
  const clearActiveShipmentCode = useShipmentStore((s) => s.clearActiveShipmentCode);
  const workspaceSession = useShipmentStore((s) => s.workspaceSession);
  const [timeline, setTimeline] = useState<EpcisEventReadModel[]>([]);
  const [issues, setIssues] = useState<ShipmentIssueHistory>([]);
  const [bottleneck, setBottleneck] = useState<BottleneckResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const normalizedShipmentCode = shipmentCode ? parseShipmentQr(shipmentCode) ?? shipmentCode.trim() : "";

  const load = async () => {
    if (!shipmentCode) return;
    const parsedCode = parseShipmentQr(shipmentCode) ?? shipmentCode.trim();
    syncShipmentCodeEverywhere(parsedCode);
    setBusy(true);
    setError("");
    try {
      const [t, b, i] = await Promise.all([
        getShipmentTimeline(parsedCode),
        getShipmentBottleneck(parsedCode),
        getShipmentIssueHistory(parsedCode),
      ]);
      setTimeline(t);
      setBottleneck(b);
      setIssues(i);
    } catch (e) {
      setError(getErrorMessage(e));
      setTimeline([]);
      setIssues([]);
      setBottleneck(null);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="panel-grid">
      <div className="card">
        <h2>Timeline & Bottleneck Finder</h2>
        <p className="field-hint" style={{ marginTop: -4 }}>
          Richieste filtrate per tenant <strong>{workspaceSession.tenantId}</strong>. Il codice
          shipment resta condiviso tra tab (`Scan`, `Timeline`, `Verify`).
        </p>
        <div className="actions">
          <input
            style={{ flex: 1, minWidth: 240 }}
            value={shipmentCode}
            onChange={(e) => setShipmentCode(e.target.value)}
            placeholder="ANT-8F2A oppure ant://shipment/ANT-8F2A?v=1&chk=XXXXXXX"
          />
          <button type="button" className="btn primary" disabled={busy} onClick={() => void load()}>
            {busy ? "Loading..." : "Load timeline"}
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
          <button
            type="button"
            className="btn"
            disabled={busy || !shipmentCode}
            onClick={() => {
              clearActiveShipmentCode();
              setTimeline([]);
              setIssues([]);
              setBottleneck(null);
              setError("");
            }}
          >
            Clear
          </button>
        </div>
        {error && <p className="error">{error}</p>}
      </div>

      {bottleneck && <BottleneckBanner bottleneck={bottleneck} shipmentCode={normalizedShipmentCode} />}

      <IssueHistoryList
        issues={issues}
        title="Issue & Preavvisi (storia operativa)"
        subtitle="Segnalazioni aperte dagli attori della filiera (ritardi, danni, notice al prossimo ricevente)."
      />

      <section className="timeline">
        {timeline.length === 0 ? (
          <div className="card">
            <p className="muted">No events loaded yet.</p>
          </div>
        ) : (
          timeline.map((event, index) => (
            <EventCard
              key={event.eventId}
              event={event}
              previousEvent={timeline[index - 1] ?? null}
              nextEvent={timeline[index + 1] ?? null}
            />
          ))
        )}
      </section>
    </div>
  );
}
