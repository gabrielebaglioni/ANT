import { useEffect, useState } from "react";
import {
  approveAdminActionRequest,
  executeAdminActionRequest,
  getAdminActionRequest,
  rejectAdminActionRequest,
  requestAdminAction,
  type AdminActionRequestRecord,
  type AdminActionRequestResponse,
} from "../../api/admin";
import { getOpsMetrics, type OpsMetricsResponse } from "../../api/ops";
import { useShipmentStore } from "../../store/shipmentStore";
import { getErrorMessage } from "../../utils/errors";
import { formatDateTime } from "../../utils/time";
import { deriveWorkspaceCapabilities } from "../../workspace/authz";
import { parseShipmentQr } from "../../epcis/qr";

export function AdminPage() {
  const workspaceSession = useShipmentStore((s) => s.workspaceSession);
  const sharedShipmentCodeInput = useShipmentStore((s) => s.sharedShipmentCodeInput);
  const setSharedShipmentCodeInput = useShipmentStore((s) => s.setSharedShipmentCodeInput);
  const syncShipmentCodeEverywhere = useShipmentStore((s) => s.syncShipmentCodeEverywhere);
  const capabilities = deriveWorkspaceCapabilities(workspaceSession);

  const readabilityIssues = [
    {
      id: "MISSING_RECEIVER_CONFIRMATION",
      sampleShipmentCode: "ANT-DEMO-PEND1",
      severity: "medium",
      operatorTitle: "In attesa conferma destinatario",
      adminTitle: "Missing receiver confirmation",
      operatorText:
        "Il destinatario deve ancora confermare la ricezione. Controlla il partner e lo stato handover.",
      adminText:
        "Receiver confirmation pending. Monitor SLA e verifica mismatch receiver/tenant o integrazione.",
      nextOperator: "Contatta il destinatario",
      nextAdmin: "Monitor SLA / invia reminder / verifica ruoli",
    },
    {
      id: "SLA_BREACH",
      sampleShipmentCode: "ANT-DEMO-SLA1",
      severity: "high",
      operatorTitle: "Tempo di consegna superato",
      adminTitle: "SLA breach detected",
      operatorText:
        "La consegna ha superato il tempo previsto. Verifica ritardi o mancanza di eventi registrati.",
      adminText:
        "Delivery SLA exceeded. Review timeline/outbox and evaluate compensation or customer notification.",
      nextOperator: "Aggiorna stato e avvisa supervisore",
      nextAdmin: "Valuta escalation / compensazione",
    },
    {
      id: "PROOF_MISMATCH",
      sampleShipmentCode: "ANT-DEMO-MISMATCH1",
      severity: "critical",
      operatorTitle: "Errore verifica integrità",
      adminTitle: "Reconciliation mismatch / proof verification failed",
      operatorText:
        "Proof non coerente con l'evento. Non procedere e contatta immediatamente il supervisore.",
      adminText:
        "Potential tampering or system inconsistency. Keep operations blocked, start forensic review and dispute flow.",
      nextOperator: "STOP e contatta supervisore",
      nextAdmin: "Open dispute / forensic review / maintain block",
    },
  ] as const;

  const [opsMetrics, setOpsMetrics] = useState<OpsMetricsResponse | null>(null);
  const [opsLoading, setOpsLoading] = useState(false);
  const [opsError, setOpsError] = useState("");

  const [adminReason, setAdminReason] = useState("Mismatch operativo rilevato, blocco cautelativo in attesa verifica.");
  const [actionResult, setActionResult] = useState<AdminActionRequestResponse | null>(null);
  const [actionBusy, setActionBusy] = useState(false);
  const [actionError, setActionError] = useState("");

  const [requestId, setRequestId] = useState("");
  const [requestRecord, setRequestRecord] = useState<AdminActionRequestRecord | null>(null);
  const [requestBusy, setRequestBusy] = useState(false);
  const [requestError, setRequestError] = useState("");
  const [reviewNote, setReviewNote] = useState("Verifica completata, approvazione concessa.");
  const [rejectNote, setRejectNote] = useState("Richiesta respinta: evidenze insufficienti.");

  const loadMetrics = async () => {
    setOpsLoading(true);
    setOpsError("");
    try {
      const metrics = await getOpsMetrics();
      setOpsMetrics(metrics);
    } catch (e) {
      setOpsError(getErrorMessage(e));
      setOpsMetrics(null);
    } finally {
      setOpsLoading(false);
    }
  };

  useEffect(() => {
    if (capabilities.canViewOpsMetrics) {
      void loadMetrics();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [capabilities.canViewOpsMetrics, workspaceSession.tenantId]);

  const submitAdminRequest = async (action: "open-dispute" | "suspend") => {
    const code = parseShipmentQr(sharedShipmentCodeInput) ?? sharedShipmentCodeInput.trim();
    if (!code) {
      setActionError("Inserisci o incolla uno shipment code prima di creare una richiesta admin.");
      return;
    }
    setActionBusy(true);
    setActionError("");
    setActionResult(null);
    try {
      syncShipmentCodeEverywhere(code);
      const res = await requestAdminAction(code, action, { reason: adminReason });
      setActionResult(res);
      if (res.requestId) setRequestId(res.requestId);
    } catch (e) {
      setActionError(getErrorMessage(e));
    } finally {
      setActionBusy(false);
    }
  };

  const fetchRequest = async () => {
    if (!requestId.trim()) return;
    setRequestBusy(true);
    setRequestError("");
    try {
      const record = await getAdminActionRequest(requestId.trim());
      setRequestRecord(record);
    } catch (e) {
      setRequestRecord(null);
      setRequestError(getErrorMessage(e));
    } finally {
      setRequestBusy(false);
    }
  };

  const runRequestAction = async (action: "approve" | "reject" | "execute") => {
    if (!requestId.trim()) return;
    setRequestBusy(true);
    setRequestError("");
    try {
      if (action === "approve") {
        await approveAdminActionRequest(requestId.trim(), reviewNote);
      } else if (action === "reject") {
        await rejectAdminActionRequest(requestId.trim(), rejectNote);
      } else {
        await executeAdminActionRequest(requestId.trim());
      }
      await fetchRequest();
      await loadMetrics();
    } catch (e) {
      setRequestError(getErrorMessage(e));
    } finally {
      setRequestBusy(false);
    }
  };

  if (!capabilities.canViewAdmin) {
    return (
      <div className="card">
        <h2>Admin Console</h2>
        <p className="error">
          Questa vista è riservata a supervisor/auditor. Cambia persona nel Workspace Session panel.
        </p>
      </div>
    );
  }

  return (
    <div className="panel-grid">
      <div className="card">
        <h2>Admin / Control Tower</h2>
        <p className="muted">
          Vista per supervisor e auditor: monitoraggio, governance e compensazioni. Nessun rollback
          distruttivo on-chain: solo richieste tracciate e azioni compensative.
        </p>
      </div>

      <div className="panel-grid two">
        <div className="card">
          <div className="actions" style={{ justifyContent: "space-between" }}>
            <h3 style={{ margin: 0 }}>Ops Metrics</h3>
            <button type="button" className="btn" disabled={opsLoading} onClick={() => void loadMetrics()}>
              {opsLoading ? "Loading..." : "Refresh metrics"}
            </button>
          </div>
          {opsError && <p className="error">{opsError}</p>}
          {opsMetrics ? (
            <>
              <p className="field-hint">
                {formatDateTime(opsMetrics.timestamp)} • {opsMetrics.runtime} • IOTA{" "}
                {opsMetrics.iota.network}/{opsMetrics.iota.mode}
              </p>
              <div className="summary-grid">
                <div className="summary-tile">
                  <span>Outbox Pending</span>
                  <strong>{opsMetrics.metrics.outbox.pending}</strong>
                </div>
                <div className="summary-tile">
                  <span>Outbox Failed</span>
                  <strong>{opsMetrics.metrics.outbox.failed}</strong>
                </div>
                <div className="summary-tile">
                  <span>Max Lag (s)</span>
                  <strong>{opsMetrics.metrics.outbox.maxLagSeconds}</strong>
                </div>
                <div className="summary-tile">
                  <span>Open Alerts</span>
                  <strong>{opsMetrics.metrics.reconciliation.openAlerts}</strong>
                </div>
                <div className="summary-tile">
                  <span>Critical Alerts</span>
                  <strong>{opsMetrics.metrics.reconciliation.criticalOpenAlerts}</strong>
                </div>
                <div className="summary-tile">
                  <span>Blocked Shipments</span>
                  <strong>{opsMetrics.metrics.shipments.blocked}</strong>
                </div>
              </div>
            </>
          ) : (
            !opsError && <p className="muted">No metrics loaded yet.</p>
          )}
        </div>

        <div className="card">
          <h3>Compensation / Governance Requests</h3>
          <p className="field-hint">
            Usa queste azioni per aprire dispute o sospendere operazioni in modo tracciato. In
            produzione: dual control obbligatorio.
          </p>
          <div className="form-grid">
            <div className="field">
              <label>Shipment code</label>
              <input
                value={sharedShipmentCodeInput}
                onChange={(e) => setSharedShipmentCodeInput(e.target.value)}
                placeholder="ANT-XXXX"
              />
            </div>
            <div className="field">
              <label>Reason</label>
              <textarea
                rows={4}
                value={adminReason}
                onChange={(e) => setAdminReason(e.target.value)}
              />
            </div>
            <div className="actions">
              <button
                type="button"
                className="btn warn"
                disabled={actionBusy || !capabilities.canRequestAdminActions}
                onClick={() => void submitAdminRequest("open-dispute")}
              >
                Request open dispute
              </button>
              <button
                type="button"
                className="btn"
                disabled={actionBusy || !capabilities.canRequestAdminActions}
                onClick={() => void submitAdminRequest("suspend")}
              >
                Request suspend
              </button>
            </div>
            {!capabilities.canRequestAdminActions && (
              <p className="muted">Auditor mode: read-only. Puoi consultare metriche e richieste.</p>
            )}
            {actionError && <p className="error">{actionError}</p>}
            {actionResult && (
              <p className="success">
                Richiesta registrata. Request ID: {actionResult.requestId ?? "—"} • status:{" "}
                {actionResult.status ?? "—"}
              </p>
            )}
          </div>
        </div>
      </div>

      <div className="card">
        <h3>Problem Readability Library (Operator vs Admin)</h3>
        <p className="field-hint">
          Pattern portato dal Figma Make: stesso problema, wording diverso per operatore e supervisor/admin, con next action chiaro.
        </p>
        <div className="admin-bottleneck-library">
          {readabilityIssues.map((issue) => (
            <div key={issue.id} className={`admin-bottleneck-pair severity-${issue.severity}`}>
              <div className="admin-bottleneck-card">
                <div className="admin-bottleneck-card-head">
                  <strong>{issue.operatorTitle}</strong>
                  <span className="code-pill">Operator</span>
                </div>
                <p className="muted">{issue.operatorText}</p>
                <div className="admin-bottleneck-next">
                  <span>Next action</span>
                  <strong>{issue.nextOperator}</strong>
                </div>
                <p className="field-hint">
                  Issue code: <code>{issue.id}</code> • Shipment code:{" "}
                  <code>{issue.sampleShipmentCode}</code>
                </p>
              </div>
              <div className="admin-bottleneck-card">
                <div className="admin-bottleneck-card-head">
                  <strong>{issue.adminTitle}</strong>
                  <span className="code-pill">Admin</span>
                </div>
                <p className="muted">{issue.adminText}</p>
                <div className="admin-bottleneck-next">
                  <span>Governance action</span>
                  <strong>{issue.nextAdmin}</strong>
                </div>
                <div className="actions" style={{ marginTop: 8 }}>
                  <button
                    type="button"
                    className="btn"
                    onClick={() => syncShipmentCodeEverywhere(issue.sampleShipmentCode)}
                  >
                    Load sample code
                  </button>
                  <button type="button" className="btn" onClick={() => void loadMetrics()} disabled={opsLoading}>
                    Refresh ops
                  </button>
                </div>
                <p className="field-hint">
                  Issue code: <code>{issue.id}</code> • Shipment code:{" "}
                  <code>{issue.sampleShipmentCode}</code>
                </p>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="card">
        <h3>Action Request Review / Execution</h3>
        <div className="form-grid two">
          <div className="field">
            <label>Request ID</label>
            <input value={requestId} onChange={(e) => setRequestId(e.target.value)} placeholder="UUID" />
          </div>
          <div className="actions" style={{ alignItems: "end" }}>
            <button type="button" className="btn primary" disabled={requestBusy || !requestId} onClick={() => void fetchRequest()}>
              Load request
            </button>
          </div>
          <div className="field">
            <label>Approve note</label>
            <input value={reviewNote} onChange={(e) => setReviewNote(e.target.value)} />
          </div>
          <div className="field">
            <label>Reject note</label>
            <input value={rejectNote} onChange={(e) => setRejectNote(e.target.value)} />
          </div>
        </div>
        <div className="actions" style={{ marginTop: 10 }}>
          <button
            type="button"
            className="btn"
            disabled={requestBusy || !capabilities.canApproveAdminActions || !requestId}
            onClick={() => void runRequestAction("approve")}
          >
            Approve
          </button>
          <button
            type="button"
            className="btn"
            disabled={requestBusy || !capabilities.canApproveAdminActions || !requestId}
            onClick={() => void runRequestAction("reject")}
          >
            Reject
          </button>
          <button
            type="button"
            className="btn warn"
            disabled={requestBusy || !capabilities.canExecuteAdminActions || !requestId}
            onClick={() => void runRequestAction("execute")}
          >
            Execute approved action
          </button>
        </div>
        {requestError && <p className="error">{requestError}</p>}
        {requestRecord && (
          <div className="admin-request-box">
            <p>
              <strong>{requestRecord.action}</strong> • <span className="code-pill">{requestRecord.status}</span>
            </p>
            <p className="muted">
              Created: {formatDateTime(requestRecord.createdAt)} • Updated:{" "}
              {formatDateTime(requestRecord.updatedAt)}
            </p>
            <p className="muted">Reason: {requestRecord.reason}</p>
            <details>
              <summary style={{ cursor: "pointer" }}>Payload / audit details</summary>
              <pre className="json-block">{JSON.stringify(requestRecord, null, 2)}</pre>
            </details>
          </div>
        )}
      </div>
    </div>
  );
}
