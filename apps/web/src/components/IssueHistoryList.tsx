import type { ShipmentIssueHistory } from "@ant/shared";
import { actorLabelFromDid } from "../utils/actorLabels";
import { formatDateTime } from "../utils/time";

interface Props {
  issues: ShipmentIssueHistory;
  title?: string;
  subtitle?: string;
  emptyText?: string;
}

function severityClass(severity: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL") {
  if (severity === "CRITICAL" || severity === "HIGH") return "role-chip warn";
  if (severity === "MEDIUM") return "role-chip active";
  return "role-chip";
}

function severityLabel(severity: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL") {
  if (severity === "LOW") return "Piccolo";
  if (severity === "MEDIUM") return "Medio";
  if (severity === "HIGH") return "Grande";
  return "Altissimo";
}

export function IssueHistoryList({
  issues,
  title = "Issue & Preavvisi",
  subtitle,
  emptyText = "Nessuna issue / preavviso registrato.",
}: Props) {
  return (
    <div className="card">
      <h3>{title}</h3>
      {subtitle && (
        <p className="field-hint" style={{ marginTop: -4 }}>
          {subtitle}
        </p>
      )}
      {issues.length === 0 ? (
        <p className="muted">{emptyText}</p>
      ) : (
        <div className="role-list-stack compact">
          {issues
            .slice()
            .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
            .map((issue) => {
              const actor = actorLabelFromDid(issue.actorId);
              return (
                <div key={issue.issueId} className="role-approval-item">
                  <div>
                    <p className="title">{issue.title}</p>
                    <p className="sub">
                      {actor} • {formatDateTime(issue.createdAt)}
                    </p>
                    {issue.description && (
                      <p className="field-hint" style={{ margin: "6px 0 0" }}>
                        {issue.description}
                      </p>
                    )}
                    <div className="role-chip-row" style={{ marginTop: 8 }}>
                      <span className={severityClass(issue.severity)}>
                        Severità: {severityLabel(issue.severity)}
                      </span>
                      {issue.damaged && <span className="role-chip warn">Prodotto danneggiato</span>}
                      {issue.notifyNextActor && <span className="role-chip active">Preavviso al prossimo attore</span>}
                      {issue.attachmentsCount > 0 && (
                        <span className="role-chip">{issue.attachmentsCount} allegati</span>
                      )}
                      {issue.blockingImpact && <span className="role-chip warn">Possibile DISPUTE / blocco</span>}
                      <span className="code-pill">{issue.issueId}</span>
                    </div>
                    {issue.attachments.length > 0 && (
                      <div className="role-list-stack compact" style={{ marginTop: 8 }}>
                        {issue.attachments.map((att) => (
                          <div key={`${issue.issueId}-${att.sha256}`} className="role-approval-item">
                            <div>
                              <p className="title">
                                Allegato {att.type || "FILE"} • {att.sourceFileName || att.sha256.slice(0, 12)}
                              </p>
                              <p className="sub">
                                {att.mime || "unknown mime"}
                                {typeof att.sizeBytes === "number" ? ` • ${att.sizeBytes} bytes` : ""}
                              </p>
                              <div className="role-chip-row" style={{ marginTop: 6 }}>
                                <span className="code-pill">{att.sha256.slice(0, 12)}...</span>
                                {att.downloadUrl && (
                                  <a className="btn" href={att.downloadUrl} target="_blank" rel="noreferrer">
                                    Apri / scarica
                                  </a>
                                )}
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
        </div>
      )}
    </div>
  );
}
