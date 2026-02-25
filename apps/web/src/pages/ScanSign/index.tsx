import { useEffect, useMemo, useRef, useState } from "react";
import type { ShipmentStateReadModel } from "@ant/shared";
import { AttachmentUploader } from "../../components/AttachmentUploader";
import {
  confirmShipmentScan,
  getShipmentState,
  reportShipmentIssue,
  resolveShipmentScan,
} from "../../api/shipments";
import { useShipmentStore } from "../../store/shipmentStore";
import { formatDateTime, nowIso } from "../../utils/time";
import { getErrorMessage } from "../../utils/errors";
import { parseShipmentQr } from "../../epcis/qr";
import type { WorkspacePersona } from "../../store/shipmentStore";

function getStateGuidance(state: ShipmentStateReadModel) {
  if (state.operationsBlocked) {
    return {
      tone: "error" as const,
      title: "Operazioni bloccate su questa spedizione",
      message:
        "ANT ha bloccato le operazioni per evitare scritture incoerenti o rischiose. Non eseguire OUT/IN finché il blocco non viene chiarito.",
      adminHint: `Motivo blocco: ${state.blockReason ?? "SECURITY_HOLD"} • reconciliation: ${state.reconciliationStatus ?? "UNKNOWN"}`,
    };
  }
  if (state.status === "PROVISIONING") {
    return {
      tone: "muted" as const,
      title: "Provisioning on-chain in corso",
      message:
        "La spedizione è stata creata e il QR è già valido, ma l'oggetto Move è ancora in creazione. Attendi prima di eseguire handover.",
      adminHint: "Controllare outbox MOVE_CREATE se resta in provisioning troppo a lungo.",
    };
  }
  if (state.status === "PROVISIONING_FAILED") {
    return {
      tone: "error" as const,
      title: "Provisioning fallito",
      message:
        "La spedizione non è pronta per operazioni di campo. Serve verifica supervisor/admin prima di riprovare.",
      adminHint: "Analizzare errore worker/IOTA e valutare nuova create o compensazione.",
    };
  }
  if (state.status === "PENDING_RECEIVER") {
    return {
      tone: "warning" as const,
      title: "Handover aperto: conferma ricevente mancante",
      message:
        "Il mittente ha registrato l'uscita, ma la custodia resta pending finché il ricevente non conferma l'IN.",
      adminHint: "Verificare DID ricevente atteso e coerenza tenant/ruoli se la conferma non compare.",
    };
  }
  if (state.status === "DELIVERED") {
    return {
      tone: "ok" as const,
      title: "Consegna finale completata",
      message:
        "La shipment è arrivata al ricevente finale. Non sono previsti altri passaggi di consegna: usa Verify per QR finale, timeline e documentazione.",
      adminHint: "Flusso chiuso. Eventuali anomalie post-consegna vanno gestite come issue/disputa supervisor.",
    };
  }
  return {
    tone: "ok" as const,
    title: "Spedizione pronta",
    message: "Stato operativo coerente. Procedi con OUT/IN solo se il ruolo e la custodia sono corretti.",
    adminHint: "Nessun blocco. Monitorare proof/outbox solo in caso di latenze anomale.",
  };
}

type ScanIssueCategory =
  | "DAMAGED"
  | "TEMPERATURE"
  | "SEAL"
  | "MISMATCH"
  | "DELAY"
  | "WEATHER"
  | "INCIDENT"
  | "TRANSPORT"
  | "STORAGE"
  | "QUALITY"
  | "NOTICE"
  | "OTHER";

type ScanIssuePreset = {
  id: string;
  label: string;
  title: string;
  category: ScanIssueCategory;
  subcategory?: string;
  severity: "LOW" | "MEDIUM" | "HIGH";
  damaged: boolean;
  notifyNextActor?: boolean;
  descriptionHint: string;
};

function getPickupIssuePresets(persona: WorkspacePersona): ScanIssuePreset[] {
  if (persona === "CARRIER_OPERATOR") {
    return [
      {
        id: "pickup-delay-traffic",
        label: "Ritardo ritiro (traffico)",
        title: "Ritardo ritiro per traffico / congestione",
        category: "DELAY",
        subcategory: "TRAFFIC",
        severity: "LOW",
        damaged: false,
        notifyNextActor: true,
        descriptionHint: "Indica stima ritardo e impatto su SLA.",
      },
      {
        id: "pickup-seal-anomaly",
        label: "Sigillo anomalo",
        title: "Anomalia sigillo rilevata al ritiro",
        category: "SEAL",
        subcategory: "PICKUP_SEAL_CHECK",
        severity: "HIGH",
        damaged: true,
        descriptionHint: "Descrivi sigillo, foto, e se la spedizione è ancora utilizzabile.",
      },
      {
        id: "pickup-packaging-damage",
        label: "Imballo danneggiato",
        title: "Imballo danneggiato rilevato al ritiro",
        category: "DAMAGED",
        subcategory: "PICKUP_PACKAGING",
        severity: "HIGH",
        damaged: true,
        descriptionHint: "Descrivi danno visibile prima del ritiro.",
      },
    ];
  }
  if (persona === "RECEIVER_OPERATOR") {
    return [
      {
        id: "receipt-damage",
        label: "Danno all'arrivo",
        title: "Danno rilevato in presa in carico",
        category: "DAMAGED",
        subcategory: "RECEIPT_DAMAGE",
        severity: "HIGH",
        damaged: true,
        descriptionHint: "Descrivi danno e stato prodotto all'arrivo.",
      },
      {
        id: "receipt-temp",
        label: "Temperatura non conforme",
        title: "Temperatura non conforme alla ricezione",
        category: "TEMPERATURE",
        subcategory: "RECEIPT_TEMP",
        severity: "HIGH",
        damaged: true,
        descriptionHint: "Inserisci valori misurati e range richiesto.",
      },
      {
        id: "receipt-delay-acceptance",
        label: "Accettazione con riserva",
        title: "Accettazione con riserva per ritardo",
        category: "DELAY",
        subcategory: "LATE_RECEIPT",
        severity: "MEDIUM",
        damaged: false,
        notifyNextActor: true,
        descriptionHint: "Specifica ritardo e se il prodotto resta utilizzabile.",
      },
    ];
  }
  return [
    {
      id: "generic-mismatch",
      label: "Anomalia generica",
      title: "Anomalia operativa da verificare",
      category: "OTHER",
      subcategory: "GENERIC",
      severity: "MEDIUM",
      damaged: false,
      descriptionHint: "Descrivi il problema riscontrato prima della presa in carico.",
    },
  ];
}

function getCustodyIssuePresets(persona: WorkspacePersona): ScanIssuePreset[] {
  if (persona === "CARRIER_OPERATOR") {
    return [
      {
        id: "transit-delay",
        label: "Preavviso ritardo",
        title: "Preavviso ritardo in transito",
        category: "DELAY",
        subcategory: "TRANSIT_DELAY",
        severity: "MEDIUM",
        damaged: false,
        notifyNextActor: true,
        descriptionHint: "Es. traffico, coda porto, volo in ritardo. Inserisci ETA aggiornata.",
      },
      {
        id: "weather-delay",
        label: "Maltempo",
        title: "Ritardo / rischio per maltempo",
        category: "WEATHER",
        subcategory: "WEATHER_DELAY",
        severity: "MEDIUM",
        damaged: false,
        notifyNextActor: true,
        descriptionHint: "Descrivi area colpita e nuovo orario previsto.",
      },
      {
        id: "transport-incident",
        label: "Incidente trasporto",
        title: "Incidente durante il trasporto",
        category: "INCIDENT",
        subcategory: "TRANSPORT_INCIDENT",
        severity: "HIGH",
        damaged: true,
        notifyNextActor: true,
        descriptionHint: "Descrivi incidente, danni e se il prodotto è ancora utilizzabile.",
      },
      {
        id: "transit-damage",
        label: "Danno in transito",
        title: "Danno causato durante il trasporto",
        category: "TRANSPORT",
        subcategory: "TRANSIT_DAMAGE",
        severity: "HIGH",
        damaged: true,
        notifyNextActor: true,
        descriptionHint: "Descrivi danno, cause, foto/evidenze.",
      },
    ];
  }
  if (persona === "RECEIVER_OPERATOR") {
    return [
      {
        id: "storage-delay",
        label: "Ritardo in magazzino",
        title: "Ritardo operativo in magazzino / hub",
        category: "DELAY",
        subcategory: "STORAGE_DELAY",
        severity: "MEDIUM",
        damaged: false,
        notifyNextActor: true,
        descriptionHint: "Es. saturazione banchina, fermo inventario, ritardo ripartenza.",
      },
      {
        id: "storage-damage",
        label: "Danno in storage",
        title: "Danno causato durante lo storage",
        category: "STORAGE",
        subcategory: "STORAGE_DAMAGE",
        severity: "HIGH",
        damaged: true,
        notifyNextActor: true,
        descriptionHint: "Descrivi danno in magazzino e se il prodotto è recuperabile.",
      },
      {
        id: "quality-hold",
        label: "Quarantena / qualità",
        title: "Quarantena per controllo qualità",
        category: "QUALITY",
        subcategory: "QUALITY_HOLD",
        severity: "MEDIUM",
        damaged: false,
        notifyNextActor: true,
        descriptionHint: "Indica motivo hold, controlli richiesti e tempi previsti.",
      },
      {
        id: "notice-next",
        label: "Avviso al prossimo ricevente",
        title: "Preavviso operativo al prossimo ricevente",
        category: "NOTICE",
        subcategory: "NEXT_RECEIVER_NOTICE",
        severity: "LOW",
        damaged: false,
        notifyNextActor: true,
        descriptionHint: "Messaggio operativo (ETA, handling, documenti, attenzione speciale).",
      },
    ];
  }
  return [
    {
      id: "manual-notice",
      label: "Avviso operativo",
      title: "Avviso operativo",
      category: "NOTICE",
      subcategory: "GENERIC_NOTICE",
      severity: "LOW",
      damaged: false,
      notifyNextActor: true,
      descriptionHint: "Messaggio per il prossimo attore.",
    },
  ];
}

export function ScanSignPage() {
  const activeShipmentCode = useShipmentStore((s) => s.activeShipmentCode);
  const sharedShipmentCodeInput = useShipmentStore((s) => s.sharedShipmentCodeInput);
  const setSharedShipmentCodeInput = useShipmentStore((s) => s.setSharedShipmentCodeInput);
  const syncShipmentCodeEverywhere = useShipmentStore((s) => s.syncShipmentCodeEverywhere);
  const lastCreatedShipmentCode = useShipmentStore((s) => s.lastCreatedShipmentCode);
  const scanOperatorContext = useShipmentStore((s) => s.scanOperatorContext);
  const setScanOperatorContext = useShipmentStore((s) => s.setScanOperatorContext);
  const workspaceSession = useShipmentStore((s) => s.workspaceSession);
  const [state, setState] = useState<ShipmentStateReadModel | null>(null);
  const [scanResolution, setScanResolution] = useState<{
    recommendedAction:
      | "NONE"
      | "WAIT"
      | "SCAN_TAKE_CUSTODY"
      | "SCAN_CONFIRM_IN"
      | "SCAN_RELEASE_TO_NEXT"
      | "NOT_AUTHORIZED";
    message: string;
    nextActorDid: string | null;
    policy: {
      slaHours: number;
      maxDelayHours: number;
      sealRequired: boolean;
      tempMin: number | null;
      tempMax: number | null;
      routeActors?: string[];
      routeOpenDynamic?: boolean;
      routePlan?: Array<{
        stepType: string;
        actorDid: string;
        label?: string;
        maxStepHours?: number;
      }>;
    };
    route?: { mode?: "OPEN_DYNAMIC" | "PLANNED"; actors: string[]; currentIndex: number };
    debugMode: boolean;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [attachmentHashes, setAttachmentHashes] = useState<string[]>([]);
  const scanSubmitLockRef = useRef(false);
  const [lastSubmittedScanFingerprint, setLastSubmittedScanFingerprint] = useState<string | null>(null);
  const [pickupConfirmationLock, setPickupConfirmationLock] = useState<{
    code: string;
    actorDid: string;
  } | null>(null);
  const [showAdvancedScanContext, setShowAdvancedScanContext] = useState(false);
  const [issueFormOpen, setIssueFormOpen] = useState(false);
  const [issueBusy, setIssueBusy] = useState(false);
  const [issueResult, setIssueResult] = useState("");
  const [issuePresetId, setIssuePresetId] = useState<string | null>(null);
  const [issueTitle, setIssueTitle] = useState("");
  const [issueDescription, setIssueDescription] = useState("");
  const [issueSeverity, setIssueSeverity] = useState<"LOW" | "MEDIUM" | "HIGH" | "CRITICAL">(
    "MEDIUM",
  );
  const [issueDamaged, setIssueDamaged] = useState(false);
  const [issueNotifyNextActor, setIssueNotifyNextActor] = useState(false);
  const actorDidForScan = workspaceSession.actorDid || scanOperatorContext.actorDid;

  useEffect(() => {
    const nextActorDid = workspaceSession.actorDid || workspaceSession.actorId || "";
    if (!nextActorDid) return;
    if (scanOperatorContext.actorDid === nextActorDid) return;
    setScanOperatorContext({ actorDid: nextActorDid });
  }, [
    scanOperatorContext.actorDid,
    setScanOperatorContext,
    workspaceSession.actorDid,
    workspaceSession.actorId,
  ]);

  const resetIssueComposer = () => {
    setIssueFormOpen(false);
    setIssuePresetId(null);
    setIssueResult("");
  };

  const loadState = async (
    code: string,
    opts?: { preserveSuccess?: boolean; keepPickupLock?: boolean },
  ) => {
    const parsedCode = parseShipmentQr(code) ?? code.trim();
    if (!parsedCode) return;
    setBusy(true);
    setError("");
    if (!opts?.preserveSuccess) setSuccess("");
    if (!opts?.keepPickupLock) {
      setPickupConfirmationLock(null);
      setLastSubmittedScanFingerprint(null);
    }
    try {
      const next = await getShipmentState(parsedCode);
      const resolution = await resolveShipmentScan(parsedCode);
      setState(next);
      setScanResolution(resolution);
      syncShipmentCodeEverywhere(parsedCode);
    } catch (e) {
      setError(getErrorMessage(e));
      setState(null);
      setScanResolution(null);
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    if (activeShipmentCode) {
      void loadState(activeShipmentCode);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeShipmentCode]);

  const confirmScanTakeCustody = async () => {
    if (!activeShipmentCode) return;
    if (scanSubmitLockRef.current) return;
    scanSubmitLockRef.current = true;
    setBusy(true);
    setError("");
    setSuccess("");
    try {
      const routePlan = Array.isArray(scanResolution?.policy.routePlan)
        ? scanResolution.policy.routePlan
        : [];
      const isLikelyFinalReceiverTakeover =
        workspaceSession.primaryPersona === "RECEIVER_OPERATOR" &&
        (routePlan.some(
          (step) =>
            step.actorDid === actorDidForScan &&
            String(step.stepType).toUpperCase() === "FINAL_RECEIVER",
        ) ||
          actorDidForScan.includes("final-receiver"));
      const currentFingerprint = buildScanActionFingerprint(
        activeShipmentCode,
        state,
        scanResolution,
        actorDidForScan,
      );
      const body = {
        who: { actorDid: actorDidForScan },
        where: {
          readPointId: scanOperatorContext.readPointId,
          bizLocationId: scanOperatorContext.bizLocationId,
        },
        when: nowIso(),
        attachments: attachmentHashes,
      };
      await confirmShipmentScan(activeShipmentCode, body, {
        idempotencyKey: buildScanConfirmIdempotencyKey(currentFingerprint),
      });
      setLastSubmittedScanFingerprint(currentFingerprint);
      setPickupConfirmationLock({ code: activeShipmentCode, actorDid: actorDidForScan });
      resetIssueComposer();
      setSuccess(
        isLikelyFinalReceiverTakeover
          ? "Prodotto arrivato al final receiver. ANT sta finalizzando la chiusura della shipment: apri Verify per scaricare il QR finale e la storia del prodotto."
          : "Hai preso in carico questa shipment. ANT ha chiuso automaticamente il passaggio precedente e registrato il tuo ingresso (flow scan-first development).",
      );
      await loadState(activeShipmentCode, { preserveSuccess: true, keepPickupLock: true });
    } catch (e) {
      setError(getErrorMessage(e));
    } finally {
      scanSubmitLockRef.current = false;
      setBusy(false);
    }
  };

  const openIssueWithPreset = (preset: ScanIssuePreset) => {
    if (issueFormOpen && issuePresetId === preset.id) {
      resetIssueComposer();
      return;
    }
    setIssuePresetId(preset.id);
    setIssueTitle(preset.title);
    setIssueDescription("");
    setIssueSeverity(preset.severity);
    setIssueDamaged(preset.damaged);
    setIssueNotifyNextActor(Boolean(preset.notifyNextActor));
    setIssueResult("");
    setIssueFormOpen(true);
    setError("");
  };

  const submitIssue = async () => {
    if (!activeShipmentCode) return;
    if (!issueDescription.trim()) {
      setError("Inserisci una descrizione testuale dell'issue / preavviso.");
      return;
    }
    setIssueBusy(true);
    setError("");
    setIssueResult("");
    try {
      const normalizedTitle = issueTitle.trim() || issueDescription.trim().slice(0, 90);
      const result = await reportShipmentIssue(activeShipmentCode, {
        title: normalizedTitle,
        description: issueDescription.trim(),
        category: issueNotifyNextActor ? "NOTICE" : "OTHER",
        subcategory: undefined,
        severity: issueSeverity,
        damaged: issueDamaged,
        notifyNextActor: issueNotifyNextActor,
        attachments: attachmentHashes,
      });
      setIssueResult(`${result.issueId} • ${result.message}`);
      await loadState(activeShipmentCode, { preserveSuccess: true });
    } catch (e) {
      setError(getErrorMessage(e));
    } finally {
      setIssueBusy(false);
    }
  };

  const showSingleScanConfirm =
    scanResolution?.recommendedAction === "SCAN_TAKE_CUSTODY" ||
    scanResolution?.recommendedAction === "SCAN_CONFIRM_IN";
  const scanActionFingerprint = useMemo(
    () => buildScanActionFingerprint(activeShipmentCode, state, scanResolution, actorDidForScan),
    [activeShipmentCode, state, scanResolution, actorDidForScan],
  );
  const hideScanConfirmBecauseAlreadySubmitted =
    Boolean(lastSubmittedScanFingerprint) && lastSubmittedScanFingerprint === scanActionFingerprint;
  const hideScanConfirmBecausePickupCompleted =
    pickupConfirmationLock?.code === activeShipmentCode &&
    pickupConfirmationLock?.actorDid === actorDidForScan;
  const operatorSessionMismatch =
    Boolean(workspaceSession.actorDid) &&
    Boolean(actorDidForScan) &&
    workspaceSession.actorDid !== actorDidForScan;
  const guidance = state ? getStateGuidance(state) : null;
  const attachmentRequiredForPickup =
    Boolean(scanResolution?.policy.sealRequired) &&
    showSingleScanConfirm &&
    !hideScanConfirmBecauseAlreadySubmitted &&
    !hideScanConfirmBecausePickupCompleted;
  const pickupBlockedByMissingAttachment = attachmentRequiredForPickup && attachmentHashes.length === 0;
  const isCurrentCustodian =
    Boolean(state?.currentCustodianDid) && state?.currentCustodianDid === actorDidForScan;
  const isFinalReceiverActor = workspaceSession.primaryPersona === "RECEIVER_OPERATOR";
  const routePlanMarksFinalReceiver = Boolean(
    actorDidForScan &&
      scanResolution?.policy.routePlan?.some(
        (step) =>
          step.actorDid === actorDidForScan &&
          String(step.stepType).toUpperCase() === "FINAL_RECEIVER",
      ),
  );
  const isLikelyFinalReceiverActor =
    isFinalReceiverActor &&
    (routePlanMarksFinalReceiver || actorDidForScan.includes("final-receiver"));
  const isFinalReceiverCurrentCustodian =
    Boolean(
      state &&
        scanResolution &&
        state.currentCustodianDid === actorDidForScan &&
        !scanResolution.nextActorDid &&
        isLikelyFinalReceiverActor,
    );
  const isFinalReceiverTerminalState = Boolean(
    state &&
      isLikelyFinalReceiverActor &&
      state.currentCustodianDid === actorDidForScan &&
      (state.status === "DELIVERED" || (state.status !== "PENDING_RECEIVER" && !scanResolution?.nextActorDid)),
  );
  const isFinalReceiverCompletionPending =
    Boolean(
      pickupConfirmationLock?.code === activeShipmentCode &&
        pickupConfirmationLock?.actorDid === actorDidForScan &&
        isLikelyFinalReceiverActor,
    ) && state?.status !== "DELIVERED";
  const showFinalReceiverTerminalExperience =
    isFinalReceiverTerminalState || isFinalReceiverCompletionPending;
  const showPickupIssueShortcuts =
    Boolean(state) &&
    showSingleScanConfirm &&
    !hideScanConfirmBecauseAlreadySubmitted &&
    !hideScanConfirmBecausePickupCompleted;
  const showCustodyIssueShortcuts =
    Boolean(state) &&
    !showSingleScanConfirm &&
    !hideScanConfirmBecauseAlreadySubmitted &&
    isCurrentCustodian &&
    !state?.operationsBlocked &&
    !isFinalReceiverTerminalState;
  const showPickupCompletedNotice =
    Boolean(success) &&
    (hideScanConfirmBecausePickupCompleted || hideScanConfirmBecauseAlreadySubmitted);

  return (
    <div className="panel-grid two">
      <div className="panel-grid">
        <div className="card">
          <h2>Scan & Sign</h2>
          <p className="muted">
            Development mode: usa solo il codice `ANT-...` per il passaggio di consegna
            (scanner camera disattivato).
          </p>
          <div className="actions" style={{ marginBottom: 10 }}>
            <input
              style={{ flex: 1, minWidth: 240 }}
              value={sharedShipmentCodeInput}
              onChange={(e) => setSharedShipmentCodeInput(e.target.value)}
              placeholder="Inserisci codice shipment ANT-XXXX"
            />
            <button
              type="button"
              className="btn primary"
              disabled={busy || !sharedShipmentCodeInput.trim()}
              onClick={() => void loadState(sharedShipmentCodeInput)}
            >
              Load
            </button>
            {lastCreatedShipmentCode && (
              <button
                type="button"
                className="btn"
                disabled={busy}
                onClick={() => setSharedShipmentCodeInput(lastCreatedShipmentCode)}
              >
                Use last created
              </button>
            )}
          </div>
          <p className="field-hint" style={{ marginTop: 6 }}>
            In fase di development il flusso di presa in carico usa solo l&apos;immissione del codice
            ANT (senza scanner camera). In produzione riattiveremo la lettura QR.
          </p>
        </div>
        <div className="card">
          <h3>Contesto operatore (sessione)</h3>
          <p className="field-hint" style={{ marginTop: -4 }}>
            ANT usa sempre il DID del profilo attivo per la presa in carico. In development puoi
            modificare solo il punto di scansione se serve simulare una sede diversa.
          </p>
          {operatorSessionMismatch && (
            <p className="error">
              Incoerenza tra DID sessione e contesto scansione rilevata: ANT userà comunque il DID
              della sessione attiva per evitare prese in carico sbagliate.
            </p>
          )}
          <div className="form-grid">
            <div className="status-panel muted">
              <strong>{workspaceSession.identityLabel || "Operatore"}</strong>
              <p style={{ marginBottom: 4 }}>
                DID operativo: <code>{actorDidForScan || "—"}</code>
              </p>
              <p className="field-hint" style={{ margin: 0 }}>
                Tenant: <strong>{workspaceSession.tenantId}</strong> • Ruolo:{" "}
                <strong>{workspaceSession.rolesCsv || "operator"}</strong>
              </p>
            </div>

            <div className="actions" style={{ justifyContent: "space-between", alignItems: "center" }}>
              <button
                type="button"
                className="btn"
                onClick={() => setShowAdvancedScanContext((v) => !v)}
                aria-expanded={showAdvancedScanContext}
              >
                {showAdvancedScanContext ? "Nascondi dettagli scan" : "Dettagli scan (dev)"}
              </button>
            </div>

            {showAdvancedScanContext && (
              <div className="form-grid two">
                <div className="field">
                  <label>Read Point (dev)</label>
                  <input
                    value={scanOperatorContext.readPointId}
                    onChange={(e) => setScanOperatorContext({ readPointId: e.target.value })}
                  />
                </div>
                <div className="field">
                  <label>Biz Location (dev)</label>
                  <input
                    value={scanOperatorContext.bizLocationId}
                    onChange={(e) => setScanOperatorContext({ bizLocationId: e.target.value })}
                  />
                </div>
              </div>
            )}
          </div>
        </div>
        {(showAdvancedScanContext || attachmentRequiredForPickup || issueFormOpen) &&
          !isFinalReceiverTerminalState && (
          <AttachmentUploader value={attachmentHashes} onChange={setAttachmentHashes} />
        )}
      </div>

      <div className="panel-grid">
        <div className="card">
          <h2>Shipment State</h2>
          {!state && <p className="muted">Scan or paste a shipment QR payload to begin.</p>}
          {state && (
            showFinalReceiverTerminalExperience ? (
              <div className="form-grid">
                <div className="status-panel ok">
                  <strong>
                    {state.status === "DELIVERED"
                      ? "Prodotto arrivato con successo al final receiver"
                      : "Consegna finale registrata"}
                  </strong>
                  <p>
                    {state.status === "DELIVERED"
                      ? "La shipment è chiusa. Ora ti serve solo il QR finale con la history del prodotto e la documentazione di filiera."
                      : "Hai confermato la presa in carico finale. ANT sta finalizzando notarization e chiusura della shipment."}
                  </p>
                  <p className="field-hint" style={{ margin: 0 }}>
                    Prossimo step: apri la tab <strong>Verify</strong> per scaricare il QR finale,
                    stampare l&apos;etichetta e consultare timeline/foto/evidenze.
                  </p>
                </div>

                <div className="form-grid two">
                  <div>
                    <strong>Shipment</strong>
                    <p style={{ margin: "4px 0 0" }}>
                      <span className="code-pill">{state.shipmentCode}</span>
                    </p>
                  </div>
                  <div>
                    <strong>Stato</strong>
                    <p style={{ margin: "4px 0 0" }}>{state.status}</p>
                  </div>
                  <div>
                    <strong>Custode finale</strong>
                    <p style={{ margin: "4px 0 0" }}>{state.currentCustodianDid ?? "—"}</p>
                  </div>
                  <div>
                    <strong>Proof</strong>
                    <p style={{ margin: "4px 0 0" }}>
                      {state.lastProof?.notarizationObjectId ? "Notarization OK" : "In finalizzazione..."}
                    </p>
                  </div>
                </div>

                <div className="actions">
                  <button
                    type="button"
                    className="btn primary"
                    disabled={busy}
                    onClick={() => void loadState(state.shipmentCode, { preserveSuccess: true, keepPickupLock: true })}
                  >
                    {busy ? "Aggiornamento..." : "Aggiorna stato finale"}
                  </button>
                  <button
                    type="button"
                    className="btn"
                    onClick={() => {
                      setSharedShipmentCodeInput(state.shipmentCode);
                      syncShipmentCodeEverywhere(state.shipmentCode);
                    }}
                  >
                    Mantieni codice per Verify
                  </button>
                </div>
              </div>
            ) : (
            <div className="form-grid">
              {guidance && (
                <div className={`status-panel ${guidance.tone}`}>
                  <strong>{guidance.title}</strong>
                  <p>{guidance.message}</p>
                  <p className="field-hint" style={{ margin: 0 }}>
                    Admin note: {guidance.adminHint}
                  </p>
                </div>
              )}
              <p>
                Code: <span className="code-pill">{state.shipmentCode}</span>
              </p>
              <p>Status: {state.status}</p>
              {(state.reconciliationStatus || state.operationsBlocked) && (
                <p className={state.operationsBlocked ? "error" : "muted"}>
                  Reconciliation check: {state.reconciliationStatus ?? "UNKNOWN"}
                  {state.operationsBlocked && state.blockReason
                    ? ` • BLOCKED (${state.blockReason})`
                    : ""}
                </p>
              )}
              <p className="muted">
                Current custodian: {state.currentCustodianDid ?? "—"}
                <br />
                Expected next actor: {state.expectedReceiverDid ?? "—"}
              </p>
              {scanResolution && (
                <div className="status-panel muted">
                  <strong>Scan action: {scanResolution.recommendedAction}</strong>
                  <p>{scanResolution.message}</p>
                  <p className="field-hint" style={{ margin: 0 }}>
                    Next actor: {scanResolution.nextActorDid ?? "—"} • SLA max delay{" "}
                    {scanResolution.policy.maxDelayHours}h
                    {scanResolution.policy.sealRequired ? " • Seal required" : ""}
                    {scanResolution.policy.tempMin !== null || scanResolution.policy.tempMax !== null
                      ? ` • Temp ${scanResolution.policy.tempMin ?? "?"}..${scanResolution.policy.tempMax ?? "?"}`
                      : ""}
                  </p>
                  {scanResolution.policy.routeOpenDynamic && (
                    <p className="field-hint" style={{ marginTop: 6 }}>
                      Route mode: <strong>OPEN DYNAMIC</strong> • I passaggi intermedi vengono
                      ricostruiti dalle prese in carico successive.
                    </p>
                  )}
                  {Array.isArray(scanResolution.policy.routePlan) &&
                    scanResolution.policy.routePlan.length > 0 && (
                      <div style={{ marginTop: 10 }}>
                        <p className="field-hint" style={{ marginBottom: 6 }}>
                          Percorso multi-hop (scan code `ANT-...` per presa in carico step-by-step)
                        </p>
                        <div className="role-chip-row">
                          {scanResolution.policy.routePlan.map((step, index) => {
                            const isCurrentCustody = step.actorDid === state.currentCustodianDid;
                            const isNextActor = step.actorDid === scanResolution.nextActorDid;
                            const isAwaitingConfirm =
                              state.status === "PENDING_RECEIVER" &&
                              step.actorDid === state.expectedReceiverDid;
                            const cls = isCurrentCustody
                              ? "role-chip success"
                              : isAwaitingConfirm
                                ? "role-chip warn"
                                : isNextActor
                                  ? "role-chip active"
                                  : "role-chip";
                            return (
                              <span key={`${step.actorDid}-${index}`} className={cls}>
                                {index + 1}. {step.label?.trim() || step.stepType} · {step.stepType}
                                {step.maxStepHours ? ` (${step.maxStepHours}h)` : ""}
                              </span>
                            );
                          })}
                        </div>
                      </div>
                    )}
                </div>
              )}
              <p className="muted">
                Last proof: {state.lastProof?.notarizationObjectId ?? "pending"}
                <br />
                Anchored at: {formatDateTime(state.lastProof?.anchoredAt)}
              </p>
              <p className="muted">
                Attachment refs queued: {attachmentHashes.length}
              </p>
              {attachmentRequiredForPickup && (
                <p className={pickupBlockedByMissingAttachment ? "error" : "field-hint"}>
                  Questa shipment richiede almeno un allegato di evidenza (es. foto sigillo /
                  foto stato imballo) prima della presa in carico.
                </p>
              )}
              <div className="actions">
                {showSingleScanConfirm &&
                  !hideScanConfirmBecauseAlreadySubmitted &&
                  !hideScanConfirmBecausePickupCompleted && (
                  <button
                    type="button"
                    className="btn warn"
                    disabled={busy || pickupBlockedByMissingAttachment}
                    onClick={() => void confirmScanTakeCustody()}
                  >
                    Conferma presa in carico
                  </button>
                )}
              </div>
              {showPickupCompletedNotice && (
                <div className="status-panel ok">
                  <strong>Presa in carico registrata</strong>
                  <p>
                    Hai preso in carico questa shipment. Il bottone è stato nascosto per evitare
                    doppi invii dello stesso passaggio.
                  </p>
                  <p className="field-hint" style={{ margin: 0 }}>
                    Se stai facendo debug e vuoi ricalcolare lo stato, premi di nuovo{" "}
                    <strong>Load</strong>.
                  </p>
                </div>
              )}
              {showPickupIssueShortcuts && !isFinalReceiverTerminalState && (
                <div className="status-panel muted">
                  <strong>Issue / preavviso prima della presa in carico</strong>
                  <p>
                    Se riscontri un problema prima di prendere in carico, apri una segnalazione con
                    descrizione libera e severità.
                  </p>
                  <div className="role-chip-row">
                    <button
                      type="button"
                      className="btn"
                      disabled={busy || issueBusy}
                      onClick={() =>
                        openIssueWithPreset({
                          id: "pickup-issue-generic",
                          label: "Apri issue",
                          title: "",
                          category: "OTHER",
                          severity: "MEDIUM",
                          damaged: false,
                          descriptionHint:
                            "Descrivi il problema rilevato al ritiro / alla ricezione (es. ritardo, sigillo, imballo, qualità).",
                        })
                      }
                    >
                      Apri issue
                    </button>
                    <button
                      type="button"
                      className="btn"
                      disabled={busy || issueBusy}
                      onClick={() =>
                        openIssueWithPreset({
                          id: "pickup-notice-generic",
                          label: "Apri preavviso",
                          title: "",
                          category: "NOTICE",
                          severity: "LOW",
                          damaged: false,
                          notifyNextActor: true,
                          descriptionHint:
                            "Scrivi un preavviso per il prossimo attore (ritardo, ETA, condizioni operative).",
                        })
                      }
                    >
                      Apri preavviso
                    </button>
                  </div>
                </div>
              )}
              {scanResolution && !showSingleScanConfirm && !isFinalReceiverTerminalState && state?.status !== "DELIVERED" && (
                <p className="muted">
                  Nessuna azione di presa in carico disponibile per questo attore in questo momento.
                  Controlla stato shipment e profilo attivo (il DID usato è quello della sessione).
                </p>
              )}
              {hideScanConfirmBecauseAlreadySubmitted && !showPickupCompletedNotice && (
                <p className="muted">
                  Presa in carico già inviata da questa schermata. Attendi l&apos;aggiornamento dello
                  stato oppure ricarica con Load se stai facendo debug.
                </p>
              )}
              {showCustodyIssueShortcuts && (
                <div className="status-panel muted">
                  <strong>Issue / preavvisi durante la custodia</strong>
                  <p>
                    Apri una segnalazione libera (testo + severità) oppure un preavviso al prossimo
                    ricevente mentre la shipment è in tuo carico.
                  </p>
                  <div className="role-chip-row">
                    <button
                      type="button"
                      className="btn"
                      disabled={busy || issueBusy}
                      onClick={() =>
                        openIssueWithPreset({
                          id: "manual-generic-issue",
                          label: "Apri issue",
                          title: "",
                          category: "OTHER",
                          severity: "MEDIUM",
                          damaged: false,
                          notifyNextActor: false,
                          descriptionHint: "Descrivi il problema operativo (ritardo, danno, qualità, altro).",
                        })
                      }
                    >
                      Apri issue
                    </button>
                    <button
                      type="button"
                      className="btn"
                      disabled={busy || issueBusy}
                      onClick={() =>
                        openIssueWithPreset({
                          id: "manual-notice-issue",
                          label: "Apri preavviso",
                          title: "",
                          category: "NOTICE",
                          severity: "LOW",
                          damaged: false,
                          notifyNextActor: true,
                          descriptionHint:
                            "Scrivi un preavviso per il prossimo ricevente (ETA, handling, condizioni, ritardi).",
                        })
                      }
                    >
                      Apri preavviso
                    </button>
                  </div>
                </div>
              )}
              {isFinalReceiverCurrentCustodian && (
                <div className="status-panel ok">
                  <strong>Consegna finale presa in carico</strong>
                  <p>
                    Se tutto è OK non serve aprire issue. Vai nella tab <strong>Verify</strong> per
                    scaricare il QR finale / stampare l&apos;etichetta del prodotto.
                  </p>
                  <p className="field-hint" style={{ margin: 0 }}>
                    ANT non mostra più passaggi IN/OUT né raccolta allegati in questa schermata
                    perché il ricevente finale chiude il flusso operativo.
                  </p>
                </div>
              )}
              {issueFormOpen && !isFinalReceiverTerminalState && (
                <div className="card">
                  <div className="actions" style={{ justifyContent: "space-between", alignItems: "center" }}>
                    <h3 style={{ margin: 0 }}>Apri issue / preavviso</h3>
                    <button
                      type="button"
                      className="btn"
                      disabled={issueBusy}
                      onClick={resetIssueComposer}
                    >
                      Chiudi pannello
                    </button>
                  </div>
                  <p className="field-hint" style={{ marginTop: -4 }}>
                    Descrizione libera + severità. Le issue <strong>piccole/medie</strong> non
                    bloccano la shipment; <strong>grandi/altissime</strong> possono aprire blocco /
                    disputa.
                  </p>
                  <div className="form-grid">
                    <div className="field">
                      <label>Titolo breve (opzionale)</label>
                      <input
                        value={issueTitle}
                        onChange={(e) => setIssueTitle(e.target.value)}
                        placeholder="Es. Ritardo per traffico / Danno in magazzino / Preavviso ETA"
                      />
                    </div>
                    <div className="field">
                      <label>Severità impatto</label>
                      <select
                        value={issueSeverity}
                        onChange={(e) =>
                          setIssueSeverity(
                            e.target.value as "LOW" | "MEDIUM" | "HIGH" | "CRITICAL",
                          )
                        }
                      >
                        <option value="LOW">Piccolo (non blocca)</option>
                        <option value="MEDIUM">Medio (non blocca)</option>
                        <option value="HIGH">Grande (blocca)</option>
                        <option value="CRITICAL">Altissimo (blocca)</option>
                      </select>
                    </div>
                    <div className="field full">
                      <label>Descrizione issue / preavviso (obbligatoria)</label>
                      <textarea
                        rows={3}
                        value={issueDescription}
                        onChange={(e) => setIssueDescription(e.target.value)}
                        placeholder="Descrivi causa, impatto sul prodotto, ETA aggiornata, azioni intraprese, istruzioni per il prossimo attore."
                      />
                    </div>
                    <label className="checkbox-row">
                      <input
                        type="checkbox"
                        checked={issueDamaged}
                        onChange={(e) => setIssueDamaged(e.target.checked)}
                      />
                      Il prodotto è danneggiato / potenzialmente non utilizzabile
                    </label>
                    <label className="checkbox-row">
                      <input
                        type="checkbox"
                        checked={issueNotifyNextActor}
                        onChange={(e) => setIssueNotifyNextActor(e.target.checked)}
                      />
                      Invia preavviso al prossimo ricevente (notice / handoff warning)
                    </label>
                    <div className="actions">
                      <button
                        type="button"
                        className="btn warn"
                        disabled={issueBusy || !issueDescription.trim()}
                        onClick={() => void submitIssue()}
                      >
                        {issueBusy ? "Invio issue..." : "Invia issue"}
                      </button>
                      <button
                        type="button"
                        className="btn"
                        disabled={issueBusy}
                        onClick={resetIssueComposer}
                      >
                        Chiudi
                      </button>
                      {issueResult && <span className="field-hint">{issueResult}</span>}
                    </div>
                  </div>
                </div>
              )}
            </div>
            )
          )}
          {busy && <p className="muted">Working...</p>}
          {success && <p className="success">{success}</p>}
          {error && <p className="error">{error}</p>}
        </div>
      </div>
    </div>
  );
}

function buildScanActionFingerprint(
  shipmentCode: string,
  state: ShipmentStateReadModel | null,
  resolution:
    | {
        recommendedAction:
          | "NONE"
          | "WAIT"
          | "SCAN_TAKE_CUSTODY"
          | "SCAN_CONFIRM_IN"
          | "SCAN_RELEASE_TO_NEXT"
          | "NOT_AUTHORIZED";
        nextActorDid: string | null;
      }
    | null,
  actorDid: string,
): string {
  return [
    shipmentCode || "no-code",
    actorDid || "no-actor",
    state?.status ?? "no-state",
    state?.currentCustodianDid ?? "no-custodian",
    state?.expectedReceiverDid ?? "no-expected",
    resolution?.recommendedAction ?? "no-action",
    resolution?.nextActorDid ?? "no-next",
  ].join("|");
}

function buildScanConfirmIdempotencyKey(fingerprint: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < fingerprint.length; i += 1) {
    hash ^= fingerprint.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return `scan-confirm-${(hash >>> 0).toString(16)}`;
}
