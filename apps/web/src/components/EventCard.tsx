import type { EpcisEventReadModel } from "@ant/shared";
import { formatDateTime } from "../utils/time";
import { ProofBadge } from "./ProofBadge";
import { actorLabelFromDid, actorRoleHintFromDid } from "../utils/actorLabels";

interface EventCardProps {
  event: EpcisEventReadModel;
  previousEvent?: EpcisEventReadModel | null;
  nextEvent?: EpcisEventReadModel | null;
}

function cbvLabel(uri: string): string {
  if (!uri) return "—";
  if (uri.includes("/cbv/")) {
    const tail = uri.split("/").pop() ?? uri;
    return tail.replace(/^(BizStep|Disp)-/i, "").replace(/_/g, " ");
  }
  return (uri.split(":").pop() ?? uri).replace(/_/g, " ");
}

function stageSummary(stage: EpcisEventReadModel["processingStage"]) {
  switch (stage) {
    case "EVENT_CAPTURED":
      return {
        label: "Captured (DB)",
        detail: "Evento validato e salvato off-chain. In attesa di notarization/Move update.",
      };
    case "NOTARIZATION_CONFIRMED":
      return {
        label: "Notarized",
        detail: "Proof notarizzata su IOTA confermata. Aggiornamento Move in corso o completato.",
      };
    case "MOVE_UPDATED":
      return {
        label: "Move updated",
        detail: "Stato di custodia on-chain aggiornato. In finalizzazione/verifiche ultime.",
      };
    case "FINALIZED":
      return {
        label: "Finalized",
        detail: "Evento completo: DB + notarization + stato Move coerenti.",
      };
    case "FAILED":
      return {
        label: "Failed",
        detail: "Pipeline non completata. Richiesta verifica tecnica o compensazione.",
      };
  }
}

export function EventCard({ event, previousEvent, nextEvent }: EventCardProps) {
  return <EventCardInternal event={event} previousEvent={previousEvent} nextEvent={nextEvent} />;
}

function EventCardInternal({ event, previousEvent, nextEvent }: EventCardProps) {
  const stage = stageSummary(event.processingStage);
  const ant = getAntMeta(event);
  const narrative = buildHumanNarrative(event, ant);
  const custodyNote = buildCustodyDurationNote(event, previousEvent ?? null, nextEvent ?? null);
  return (
    <article className="event-card">
      <div className="event-meta">
        <strong>{event.type}</strong>
        <span className="code-pill">{event.action}</span>
        <span className={`code-pill stage-pill stage-${event.processingStage.toLowerCase()}`} title="Finalization stage">
          {stage.label}
        </span>
        <ProofBadge proof={event.proof} />
      </div>
      <p style={{ margin: "2px 0 8px", fontWeight: 600, lineHeight: 1.35 }}>{narrative}</p>
      {custodyNote && (
        <p className="field-hint" style={{ margin: "0 0 8px" }}>
          {custodyNote}
        </p>
      )}
      <p className="field-hint" style={{ margin: "0 0 8px" }}>
        Pipeline: {stage.detail}
      </p>
      <div className="event-grid">
        <div>
          <strong>When</strong> {formatDateTime(event.eventTime)}
        </div>
        <div>
          <strong>Why</strong> {cbvLabel(event.bizStep)} / {cbvLabel(event.disposition)}
        </div>
        <div>
          <strong>Where (scan point)</strong> {event.readPoint}
        </div>
        <div>
          <strong>Where (site)</strong> {event.bizLocation}
        </div>
        <div>
          <strong>What</strong> {event.whatSummary}
        </div>
        <div>
          <strong>Hash</strong> {event.payloadHash.slice(0, 12)}...
        </div>
      </div>
      {event.processingError && <p className="error">Processing error: {event.processingError}</p>}
      <p className="field-hint" style={{ marginTop: 8 }}>
        Technical stage code: <code>{event.processingStage}</code>
        {event.notarizationConfirmedAt ? ` • notarized ${formatDateTime(event.notarizationConfirmedAt)}` : ""}
        {event.moveUpdatedAt ? ` • move updated ${formatDateTime(event.moveUpdatedAt)}` : ""}
        {event.finalizedAt ? ` • finalized ${formatDateTime(event.finalizedAt)}` : ""}
      </p>
      <details>
        <summary style={{ marginTop: 10, cursor: "pointer" }}>Payload JSON</summary>
        <pre className="json-block">{JSON.stringify(event.payload, null, 2)}</pre>
      </details>
    </article>
  );
}

function getAntMeta(event: EpcisEventReadModel) {
  const payload = (event.payload ?? {}) as Record<string, unknown>;
  const extensions = (payload.extensions ?? {}) as Record<string, unknown>;
  const ant = (extensions.ant ?? {}) as Record<string, unknown>;
  return {
    handover: typeof ant.handover === "string" ? ant.handover : null,
    actorDid: typeof ant.actorDid === "string" ? ant.actorDid : null,
    nextActorDid: typeof ant.nextActorDid === "string" ? ant.nextActorDid : null,
    finalDelivery: ant.finalDelivery === true,
    attachments: Array.isArray(ant.attachments) ? ant.attachments : [],
  };
}

function buildHumanNarrative(
  event: EpcisEventReadModel,
  ant: {
    handover: string | null;
    actorDid: string | null;
    nextActorDid: string | null;
    finalDelivery: boolean;
    attachments: unknown[];
  },
): string {
  const actorName = actorLabelFromDid(ant.actorDid);
  const nextActorName = actorLabelFromDid(ant.nextActorDid);
  const when = formatDateTime(event.eventTime);
  const where = simplifyLocation(event.bizLocation || event.readPoint);
  const attachmentsOk = ant.attachments.length > 0 ? "con allegati/prove" : "senza anomalie dichiarate";

  if (ant.handover === "OUT") {
    return `${actorName} (${actorRoleHintFromDid(ant.actorDid)}) ha registrato l'uscita / consegna alle ${when} da ${where} verso ${nextActorName}. Esito dichiarato: ${attachmentsOk}.`;
  }
  if (ant.handover === "IN") {
    if (ant.finalDelivery) {
      return `${actorName} (${actorRoleHintFromDid(ant.actorDid)}) ha completato la consegna finale alle ${when} presso ${where}. Esito dichiarato: ${attachmentsOk}.`;
    }
    return `${actorName} (${actorRoleHintFromDid(ant.actorDid)}) ha preso in carico la shipment alle ${when} presso ${where}. Esito dichiarato: ${attachmentsOk}.`;
  }

  return `${actorName} ha registrato un evento ${cbvLabel(event.bizStep)} alle ${when} presso ${where}.`;
}

function buildCustodyDurationNote(
  event: EpcisEventReadModel,
  previousEvent: EpcisEventReadModel | null,
  nextEvent: EpcisEventReadModel | null,
): string | null {
  const ant = getAntMeta(event);
  if (ant.handover !== "OUT" || !previousEvent) return null;
  const prevAnt = getAntMeta(previousEvent);
  if (prevAnt.handover !== "IN") return null;
  if (prevAnt.actorDid && ant.actorDid && prevAnt.actorDid !== ant.actorDid) return null;
  const start = new Date(previousEvent.eventTime).getTime();
  const end = new Date(event.eventTime).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return null;
  return `Tempo in custodia prima del rilascio: ${formatDurationMs(end - start)} (da ${actorLabelFromDid(ant.actorDid)}).`;
}

function formatDurationMs(ms: number): string {
  const totalMinutes = Math.max(0, Math.floor(ms / 60000));
  const days = Math.floor(totalMinutes / (60 * 24));
  const hours = Math.floor((totalMinutes % (60 * 24)) / 60);
  const minutes = totalMinutes % 60;
  if (days > 0) return `${days}g ${hours}h ${minutes}m`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

function simplifyLocation(value: string): string {
  if (!value) return "sito non indicato";
  if (value.length <= 42) return value;
  return `${value.slice(0, 20)}…${value.slice(-12)}`;
}
