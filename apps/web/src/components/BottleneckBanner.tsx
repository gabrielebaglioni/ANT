import { useMemo, useState } from "react";
import type { BottleneckResult } from "@ant/shared";

interface BottleneckBannerProps {
  bottleneck: BottleneckResult;
  shipmentCode?: string;
  onAction?: () => void;
}

type Severity = "none" | "low" | "medium" | "high" | "critical";

function mapBottleneckDetails(bottleneck: BottleneckResult) {
  if (bottleneck.type === "MISSING_RECEIVER_CONFIRMATION") {
    return {
      severity: "medium" as Severity,
      titleOperator: "In attesa conferma destinatario",
      titleAdmin: "Missing receiver confirmation",
      descriptionOperator:
        "Il destinatario deve ancora confermare la ricezione della shipment. Controlla lo stato e ricontatta il partner.",
      descriptionAdmin:
        "Receiver confirmation pending. Rischio SLA breach se non risolto. Verificare ruolo, tenant e receiver atteso.",
      operatorAction: "Contatta il destinatario / invia reminder",
      adminAction: "Monitor SLA e controlla mismatch receiver atteso",
      defaultTone: "pending" as const,
    };
  }
  if (bottleneck.type === "SLA_BREACH") {
    return {
      severity: "high" as Severity,
      titleOperator: "Tempo di consegna superato",
      titleAdmin: "SLA breach detected",
      descriptionOperator:
        "La consegna ha superato la soglia prevista. Verifica dove si è fermato il flusso e aggiorna la timeline.",
      descriptionAdmin:
        "Delivery SLA exceeded. Revisionare timeline/outbox/integrazione e valutare escalation o notifica cliente.",
      operatorAction: "Verifica ritardo e comunica al supervisore",
      adminAction: "Valuta compensazione / customer notification",
      defaultTone: "alert" as const,
    };
  }
  if (bottleneck.type === "CONDITION_VIOLATION") {
    return {
      severity: "high" as Severity,
      titleOperator: "Documento o prova richiesta mancante",
      titleAdmin: "Condition violation / missing evidence",
      descriptionOperator:
        "La policy richiede una prova (es. foto sigillo/documento). Caricala prima di procedere con l'operazione.",
      descriptionAdmin:
        "Required evidence missing or policy condition failed. Shipment may need suspension until compliance is restored.",
      operatorAction: "Carica prova richiesta o segnala eccezione",
      adminAction: "Valuta sospensione/disputa e raccogli evidenze",
      defaultTone: "alert" as const,
    };
  }

  if (bottleneck.type === "NONE") {
    const provisioning = /provision/i.test(bottleneck.message);
    if (provisioning) {
      return {
        severity: "low" as Severity,
        titleOperator: "Provisioning on-chain in corso",
        titleAdmin: "Move object provisioning in progress",
        descriptionOperator:
          "La shipment è stata accettata e il provisioning on-chain è in corso. Attendere pochi secondi e aggiornare.",
        descriptionAdmin:
          "MOVE_CREATE outbox in progress. Monitorare job se supera la soglia attesa o resta in retry.",
        operatorAction: "Attendi e aggiorna lo stato",
        adminAction: "Monitor outbox MOVE_CREATE",
        defaultTone: "info" as const,
      };
    }

    return {
      severity: "none" as Severity,
      titleOperator: "Nessun problema rilevato",
      titleAdmin: "No bottlenecks detected",
      descriptionOperator: "Il flusso eventi e lo stato operativo risultano coerenti.",
      descriptionAdmin: "Nessuna anomalia rilevata su stato, proof o progression della shipment.",
      operatorAction: "Continua con la normale operatività",
      adminAction: "Nessuna azione richiesta",
      defaultTone: "ok" as const,
    };
  }

  return {
    severity: "critical" as Severity,
    titleOperator: "Errore verifica integrità",
    titleAdmin: "Reconciliation / proof mismatch",
    descriptionOperator:
      "Il sistema ha rilevato una differenza tra evento e proof. Non procedere e contatta subito il supervisore.",
    descriptionAdmin:
      "Mismatch detected during proof verification/reconciliation. Potential tampering or system inconsistency. Operations must remain blocked.",
    operatorAction: "STOP e contatta supervisore immediatamente",
    adminAction: "Apri dispute / forensic review / blocca operazioni",
    defaultTone: "alert" as const,
  };
}

function severityStyles(severity: Severity) {
  switch (severity) {
    case "critical":
      return { wrapper: "fig-bottleneck severity-critical", badge: "critical" };
    case "high":
      return { wrapper: "fig-bottleneck severity-high", badge: "high" };
    case "medium":
      return { wrapper: "fig-bottleneck severity-medium", badge: "medium" };
    case "low":
      return { wrapper: "fig-bottleneck severity-low", badge: "low" };
    case "none":
      return { wrapper: "fig-bottleneck severity-none", badge: "none" };
  }
}

export function BottleneckBanner({ bottleneck, shipmentCode, onAction }: BottleneckBannerProps) {
  const [showTechnical, setShowTechnical] = useState(false);
  const [audience, setAudience] = useState<"operator" | "admin">("operator");

  const details = useMemo(() => mapBottleneckDetails(bottleneck), [bottleneck]);
  const styles = severityStyles(details.severity);

  const isOperator = audience === "operator";
  const title = isOperator ? details.titleOperator : details.titleAdmin;
  const description = isOperator ? details.descriptionOperator : details.descriptionAdmin;
  const nextAction = isOperator ? details.operatorAction : details.adminAction;

  return (
    <div className={`${styles.wrapper} ${bottleneck.type === "NONE" ? "is-ok" : ""}`}>
      <div className="fig-bottleneck-head">
        <div className="fig-bottleneck-head-left">
          <div className="fig-bottleneck-icon" aria-hidden>
            {details.severity === "critical" ? "✕" : details.severity === "none" ? "✓" : "!"}
          </div>
          <div>
            <h3>{title}</h3>
            <p>{description}</p>
          </div>
        </div>
        <div className="fig-bottleneck-head-right">
          <span className={`fig-severity-badge ${styles.badge}`}>{details.severity}</span>
          <div className="fig-audience-toggle" role="tablist" aria-label="Audience wording">
            <button
              type="button"
              className={audience === "operator" ? "is-active" : ""}
              onClick={() => setAudience("operator")}
            >
              Operator
            </button>
            <button
              type="button"
              className={audience === "admin" ? "is-active" : ""}
              onClick={() => setAudience("admin")}
            >
              Admin
            </button>
          </div>
        </div>
      </div>

      <div className="fig-bottleneck-meta">
        <span>{bottleneck.since ? `Since ${bottleneck.since}` : "Since —"}</span>
        <code>{bottleneck.type}</code>
        {shipmentCode && <code>{shipmentCode}</code>}
      </div>

      <div className="fig-bottleneck-next">
        <small>{isOperator ? "Next action" : "Governance action"}</small>
        <strong>{nextAction}</strong>
      </div>

      <div className="fig-bottleneck-actions-row">
        {bottleneck.suggestedAction && onAction && (
          <button
            type="button"
            className={details.severity === "high" || details.severity === "critical" ? "btn warn" : "btn"}
            onClick={onAction}
          >
            {bottleneck.suggestedAction}
          </button>
        )}
        <button type="button" className="btn" onClick={() => setShowTechnical((v) => !v)}>
          {showTechnical ? "Hide technical details" : "Show technical details"}
        </button>
      </div>

      {showTechnical && (
        <div className="fig-bottleneck-technical">
          <p>{bottleneck.message || "No additional technical message"}</p>
          <p>Technical code: {bottleneck.type}</p>
          <p>Shipment code: {shipmentCode || "—"}</p>
          <p>Suggested action: {bottleneck.suggestedAction || "—"}</p>
        </div>
      )}
    </div>
  );
}
