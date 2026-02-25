import { useEffect, useMemo, useState } from "react";
import {
  CreateShipmentRequestSchema,
  type CreateShipmentRequest,
  type CreateShipmentResponse,
} from "@ant/shared";
import { createShipment } from "../../api/shipments";
import { useShipmentStore } from "../../store/shipmentStore";
import { getErrorMessage } from "../../utils/errors";

interface Props {
  onCreated: (
    response: CreateShipmentResponse,
    meta: { shipmentDisplayName: string; shipmentTitle: string },
  ) => void;
}

type WizardStepKey = "what" | "where" | "policy" | "participants" | "route" | "review";
type RouteStepType =
  | "CARRIER"
  | "WAREHOUSE"
  | "HUB"
  | "RETAIL"
  | "FINAL_RECEIVER"
  | "CUSTOM";
type RoutePlanStep = {
  stepType: RouteStepType;
  actorDid: string;
  label?: string;
  maxStepHours?: number;
};

const trackingTypeLabels: Record<CreateShipmentRequest["trackingUnitType"], string> = {
  LOGISTIC_UNIT: "Logistic unit (pallet / collo / container)",
  LOT: "Lot / batch (lotto)",
  ITEM: "Single item (seriale)",
};

const CREATE_STEPS: Array<{
  key: WizardStepKey;
  title: string;
  subtitle: string;
}> = [
  {
    key: "what",
    title: "Cosa stai tracciando",
    subtitle: "Tipo unità e identificatore (WHAT)",
  },
  {
    key: "where",
    title: "Origine e destinazione",
    subtitle: "Punti GS1/SGLN per eventi EPCIS (WHERE)",
  },
  {
    key: "policy",
    title: "Policy e controlli",
    subtitle: "SLA, ritardo massimo e condizioni minime",
  },
  {
    key: "participants",
    title: "Partecipanti",
    subtitle: "DID di producer, carrier e receiver",
  },
  {
    key: "route",
    title: "Percorso multi-hop",
    subtitle: "Corrieri / magazzini / hub in sequenza prima dell'arrivo finale",
  },
  {
    key: "review",
    title: "Review e creazione",
    subtitle: "Controllo finale prima della create shipment",
  },
];

function isPositiveInt(value: number): boolean {
  return Number.isFinite(value) && Number.isInteger(value) && value > 0;
}

function buildShipmentDisplayName(form: CreateShipmentRequest): string {
  const origin = form.origin.label?.trim() || "Origine";
  const destination = form.destination.label?.trim() || "Destinazione";
  return `${origin} → ${destination}`;
}

function buildShipmentTitle(form: CreateShipmentRequest): string {
  if (form.trackingUnitType === "LOT" && form.lotNumber?.trim()) return `LOT ${form.lotNumber.trim()}`;
  if (form.trackingUnitType === "ITEM") return "Shipment ITEM";
  return "Shipment LOGISTIC_UNIT";
}

function defaultRoutePlanFromParticipants(form: CreateShipmentRequest): RoutePlanStep[] {
  return [
    {
      stepType: "CARRIER",
      actorDid: form.participants.carrierDid,
      label: "Trasporto iniziale",
    },
    {
      stepType: "FINAL_RECEIVER",
      actorDid: form.participants.receiverDid,
      label: form.destination.label?.trim() || "Hub / ricevente finale",
    },
  ];
}

function getRoutePlan(form: CreateShipmentRequest): RoutePlanStep[] {
  const routePlan = form.conditions?.routePlan;
  if (!Array.isArray(routePlan) || routePlan.length === 0) {
    return defaultRoutePlanFromParticipants(form);
  }
  return routePlan as RoutePlanStep[];
}

export function CreateShipmentForm({ onCreated }: Props) {
  const form = useShipmentStore((s) => s.createShipmentDraft);
  const patchDraft = useShipmentStore((s) => s.patchCreateShipmentDraft);
  const resetCreateShipmentDraft = useShipmentStore((s) => s.resetCreateShipmentDraft);
  const storedWizardStepIndex = useShipmentStore((s) => s.createShipmentWizardStepIndex);
  const setStoredWizardStepIndex = useShipmentStore((s) => s.setCreateShipmentWizardStepIndex);
  const resetWizardStepIndex = useShipmentStore((s) => s.resetCreateShipmentWizardStepIndex);
  const workspaceSession = useShipmentStore((s) => s.workspaceSession);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const currentStepIndex = Math.min(
    Math.max(storedWizardStepIndex ?? 0, 0),
    CREATE_STEPS.length - 1,
  );

  useEffect(() => {
    if (storedWizardStepIndex !== currentStepIndex) {
      setStoredWizardStepIndex(currentStepIndex);
    }
  }, [currentStepIndex, setStoredWizardStepIndex, storedWizardStepIndex]);

  const currentStep = CREATE_STEPS[currentStepIndex];
  const isLastStep = currentStepIndex === CREATE_STEPS.length - 1;
  const progressPct = ((currentStepIndex + 1) / CREATE_STEPS.length) * 100;

  const patch = <K extends keyof CreateShipmentRequest>(key: K, value: CreateShipmentRequest[K]) =>
    patchDraft(key, value);
  const routePlan = getRoutePlan(form);
  const routeOpenDynamicEnabled = form.conditions?.routeOpenDynamic !== false;

  const patchConditions = (patchValue: Partial<NonNullable<CreateShipmentRequest["conditions"]>>) => {
    patch("conditions", {
      ...(form.conditions ?? {}),
      ...patchValue,
    });
  };

  const setRoutePlan = (nextPlan: RoutePlanStep[]) => {
    patchConditions({ routePlan: nextPlan, routeActors: nextPlan.map((s) => s.actorDid).filter(Boolean) });
  };

  const resetRoutePlanFromParticipants = () => {
    setRoutePlan(defaultRoutePlanFromParticipants(form));
    setError("");
  };

  const updateRoutePlanStep = (index: number, patchValue: Partial<RoutePlanStep>) => {
    const next = routePlan.map((step, i) => (i === index ? { ...step, ...patchValue } : step));
    setRoutePlan(next);
  };

  const addIntermediateRouteStep = (stepType: RouteStepType) => {
    const finalStep = routePlan[routePlan.length - 1];
    const intermediate = routePlan.slice(0, -1);
    const nextLabel =
      stepType === "WAREHOUSE"
        ? `Magazzino ${intermediate.filter((s) => s.stepType === "WAREHOUSE").length + 1}`
        : stepType === "CARRIER"
          ? `Corriere ${intermediate.filter((s) => s.stepType === "CARRIER").length + 1}`
          : stepType === "HUB"
            ? `Hub ${intermediate.filter((s) => s.stepType === "HUB").length + 1}`
            : "Step intermedio";
    const newStep: RoutePlanStep = {
      stepType,
      actorDid: "",
      label: nextLabel,
    };
    setRoutePlan([...intermediate, newStep, finalStep ?? defaultRoutePlanFromParticipants(form)[1]]);
    setError("");
  };

  const removeRoutePlanStep = (index: number) => {
    const step = routePlan[index];
    if (!step) return;
    if (step.stepType === "FINAL_RECEIVER") return;
    const next = routePlan.filter((_, i) => i !== index);
    setRoutePlan(next.length > 0 ? next : defaultRoutePlanFromParticipants(form));
    setError("");
  };

  const resetDemoValues = () => {
    resetCreateShipmentDraft();
    resetWizardStepIndex();
    setError("");
  };

  const applySessionDidToParticipant = () => {
    const actorDid = workspaceSession.actorDid.trim();
    if (!actorDid) return;
    if (workspaceSession.primaryPersona === "PRODUCER_OPERATOR") {
      patch("participants", { ...form.participants, producerDid: actorDid });
      return;
    }
    if (workspaceSession.primaryPersona === "CARRIER_OPERATOR") {
      patch("participants", { ...form.participants, carrierDid: actorDid });
      return;
    }
    if (workspaceSession.primaryPersona === "RECEIVER_OPERATOR") {
      patch("participants", { ...form.participants, receiverDid: actorDid });
    }
  };

  useEffect(() => {
    if (!Array.isArray(form.conditions?.routePlan) || form.conditions.routePlan.length === 0) return;
    const next = [...form.conditions.routePlan] as RoutePlanStep[];
    const finalIndex = next.length - 1;
    const finalStep = next[finalIndex];
    if (!finalStep) return;
    const desiredActor = form.participants.receiverDid;
    const desiredLabel = form.destination.label?.trim() || "Hub / ricevente finale";
    const changed =
      finalStep.stepType !== "FINAL_RECEIVER" ||
      finalStep.actorDid !== desiredActor ||
      (finalStep.label ?? "") === "" ||
      finalStep.label === "Hub / ricevente finale";
    if (!changed) return;
    next[finalIndex] = {
      ...finalStep,
      stepType: "FINAL_RECEIVER",
      actorDid: desiredActor,
      label: finalStep.label?.trim() ? finalStep.label : desiredLabel,
    };
    setRoutePlan(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.participants.receiverDid, form.destination.label]);

  useEffect(() => {
    if (form.conditions?.routeOpenDynamic !== undefined) return;
    patchConditions({ routeOpenDynamic: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const validateStep = (stepKey: WizardStepKey): boolean => {
    if (stepKey === "what") {
      if (!form.trackingId.trim()) {
        setError("Inserisci un Tracking ID (SSCC / lotto / seriale).");
        return false;
      }
      if (form.trackingUnitType === "LOT") {
        if (!form.lotNumber?.trim()) {
          setError("Per tracking type LOT devi inserire il numero lotto.");
          return false;
        }
        if (!form.epcClass?.trim()) {
          setError("Per tracking type LOT devi inserire EPC class.");
          return false;
        }
      }
      setError("");
      return true;
    }

    if (stepKey === "where") {
      if (!form.origin.readPointId.trim() || !form.origin.bizLocationId.trim()) {
        setError("Compila read point e business location dell'origine.");
        return false;
      }
      if (!form.destination.readPointId.trim() || !form.destination.bizLocationId.trim()) {
        setError("Compila read point e business location della destinazione.");
        return false;
      }
      setError("");
      return true;
    }

    if (stepKey === "policy") {
      if (!isPositiveInt(form.slaHours)) {
        setError("SLA hours deve essere un numero intero positivo.");
        return false;
      }
      if (!isPositiveInt(form.maxDelayHours)) {
        setError("Max delay hours deve essere un numero intero positivo.");
        return false;
      }
      const tempMin = form.conditions?.tempMin;
      const tempMax = form.conditions?.tempMax;
      if (
        tempMin !== undefined &&
        tempMax !== undefined &&
        Number.isFinite(tempMin) &&
        Number.isFinite(tempMax) &&
        tempMin > tempMax
      ) {
        setError("Temp min non può essere maggiore di temp max.");
        return false;
      }
      setError("");
      return true;
    }

    if (stepKey === "participants") {
      if (!form.participants.producerDid.trim()) {
        setError("Inserisci il Producer DID.");
        return false;
      }
      if (!form.participants.carrierDid.trim()) {
        setError("Inserisci il Carrier DID.");
        return false;
      }
      if (!form.participants.receiverDid.trim()) {
        setError("Inserisci il Receiver DID.");
        return false;
      }
      setError("");
      return true;
    }

    if (stepKey === "route") {
      if (routeOpenDynamicEnabled) {
        setError("");
        return true;
      }
      const plan = routePlan;
      if (!plan.length) {
        setError("Definisci almeno uno step di route (es. corriere).");
        return false;
      }
      for (const [index, step] of plan.entries()) {
        if (!step.actorDid?.trim()) {
          setError(`Inserisci Actor DID per lo step ${index + 1}.`);
          return false;
        }
      }
      const finalStep = plan[plan.length - 1];
      if (finalStep?.stepType !== "FINAL_RECEIVER") {
        setError("L'ultimo step deve essere FINAL_RECEIVER.");
        return false;
      }
      if (finalStep.actorDid.trim() !== form.participants.receiverDid.trim()) {
        setError(
          "L'ultimo step della route deve usare lo stesso DID del Receiver finale nei participants.",
        );
        return false;
      }
      setError("");
      return true;
    }

    try {
      const normalized: CreateShipmentRequest = {
        ...form,
        conditions: {
          ...(form.conditions ?? {}),
          routeOpenDynamic: routeOpenDynamicEnabled,
        },
      };
      CreateShipmentRequestSchema.parse(normalized);
      setError("");
      return true;
    } catch (e) {
      setError(getErrorMessage(e));
      return false;
    }
  };

  const goNext = () => {
    if (!validateStep(currentStep.key)) return;
    setStoredWizardStepIndex(currentStepIndex + 1);
  };

  const goBack = () => {
    setError("");
    setStoredWizardStepIndex(currentStepIndex - 1);
  };

  const submit = async () => {
    if (!validateStep("review")) return;
    setBusy(true);
    setError("");
    try {
      const normalized: CreateShipmentRequest = {
        ...form,
        conditions: {
          ...(form.conditions ?? {}),
          routeOpenDynamic: routeOpenDynamicEnabled,
        },
      };
      const parsed = CreateShipmentRequestSchema.parse(normalized);
      const response = await createShipment(parsed);
      onCreated(response, {
        shipmentDisplayName: buildShipmentDisplayName(parsed),
        shipmentTitle: buildShipmentTitle(parsed),
      });
    } catch (e) {
      setError(getErrorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const reviewSummary = useMemo(
    () => ({
      shipmentDisplayName: buildShipmentDisplayName(form),
      shipmentTitle: buildShipmentTitle(form),
    }),
    [form],
  );

  return (
    <div className="card create-wizard-card">
      <div className="create-wizard-head">
        <div>
          <h2>Create Shipment</h2>
          <p className="muted">
            Wizard guidato step-by-step: meno errori, più velocità operativa su mobile.
          </p>
        </div>
        <div className="create-wizard-step-pill">
          Step {currentStepIndex + 1}/{CREATE_STEPS.length}
        </div>
      </div>

      <div className="create-wizard-progress" aria-hidden>
        <div className="create-wizard-progress-bar" style={{ width: `${progressPct}%` }} />
      </div>
      <div className="create-wizard-step-list" role="tablist" aria-label="Create shipment steps">
        {CREATE_STEPS.map((step, index) => (
          <button
            key={step.key}
            type="button"
            className={
              index === currentStepIndex
                ? "create-step-chip is-active"
                : index < currentStepIndex
                  ? "create-step-chip is-done"
                  : "create-step-chip"
            }
            aria-selected={index === currentStepIndex}
            aria-current={index === currentStepIndex ? "step" : undefined}
            onClick={() => {
              if (index <= currentStepIndex) {
                setStoredWizardStepIndex(index);
                setError("");
              }
            }}
            disabled={busy || index > currentStepIndex}
          >
            <span>{index + 1}</span>
            <small>{step.title}</small>
          </button>
        ))}
      </div>

      <div className="create-wizard-step-header">
        <h3>{currentStep.title}</h3>
        <p className="field-hint">{currentStep.subtitle}</p>
      </div>

      {currentStep.key === "what" && (
        <>
          <div className="form-grid two">
            <div className="field">
              <label>What are you tracking? (Tipo unità tracciata)</label>
              <select
                value={form.trackingUnitType}
                onChange={(e) =>
                  patch("trackingUnitType", e.target.value as CreateShipmentRequest["trackingUnitType"])
                }
              >
                <option value="LOGISTIC_UNIT">{trackingTypeLabels.LOGISTIC_UNIT}</option>
                <option value="LOT">{trackingTypeLabels.LOT}</option>
                <option value="ITEM">{trackingTypeLabels.ITEM}</option>
              </select>
              <small className="field-hint">
                Scegli come vuoi tracciare la spedizione: pallet/collo, lotto o singolo pezzo.
              </small>
            </div>
            <div className="field">
              <label>Tracking ID (SSCC / lotto / seriale)</label>
              <input
                value={form.trackingId}
                onChange={(e) => patch("trackingId", e.target.value)}
                placeholder="SSCC / lot key / serial"
              />
              <small className="field-hint">
                Identificatore principale usato negli eventi EPCIS (WHAT).
              </small>
            </div>
          </div>

          {form.trackingUnitType === "LOT" && (
            <div className="form-grid two">
              <div className="field">
                <label>Lot number (numero lotto)</label>
                <input
                  value={form.lotNumber ?? ""}
                  onChange={(e) => patch("lotNumber", e.target.value)}
                  placeholder="LOT-2026-0021"
                />
              </div>
              <div className="field">
                <label>EPC class (classe prodotto / GTIN class)</label>
                <input
                  value={form.epcClass ?? ""}
                  onChange={(e) => patch("epcClass", e.target.value)}
                  placeholder="urn:epc:class:lgtin:..."
                />
              </div>
            </div>
          )}

          <div className="create-wizard-note">
            <strong>Nome shipment (display):</strong> {reviewSummary.shipmentDisplayName}
            <br />
            <span className="field-hint">
              Verrà usato nella schermata finale del QR (nome + codice ANT).
            </span>
          </div>
        </>
      )}

      {currentStep.key === "where" && (
        <div className="form-grid two">
          <div className="card">
            <h3>Origin (WHERE) • Punto di partenza</h3>
            <div className="form-grid">
              <div className="field">
                <label>Origin name (nome visibile)</label>
                <input
                  value={form.origin.label ?? ""}
                  onChange={(e) => patch("origin", { ...form.origin, label: e.target.value })}
                  placeholder="Es. Magazzino Milano - Baia 2"
                />
              </div>
              <div className="field">
                <label>Scan point ID (GS1 SGLN / Read Point)</label>
                <input
                  value={form.origin.readPointId}
                  onChange={(e) => patch("origin", { ...form.origin, readPointId: e.target.value })}
                />
              </div>
              <div className="field">
                <label>Business location ID (GS1 SGLN)</label>
                <input
                  value={form.origin.bizLocationId}
                  onChange={(e) => patch("origin", { ...form.origin, bizLocationId: e.target.value })}
                />
              </div>
            </div>
          </div>

          <div className="card">
            <h3>Destination (WHERE) • Destinazione</h3>
            <div className="form-grid">
              <div className="field">
                <label>Destination name (nome visibile)</label>
                <input
                  value={form.destination.label ?? ""}
                  onChange={(e) => patch("destination", { ...form.destination, label: e.target.value })}
                  placeholder="Es. Ricevimento Roma - Dock A"
                />
              </div>
              <div className="field">
                <label>Scan point ID (GS1 SGLN / Read Point)</label>
                <input
                  value={form.destination.readPointId}
                  onChange={(e) =>
                    patch("destination", { ...form.destination, readPointId: e.target.value })
                  }
                />
              </div>
              <div className="field">
                <label>Business location ID (GS1 SGLN)</label>
                <input
                  value={form.destination.bizLocationId}
                  onChange={(e) =>
                    patch("destination", { ...form.destination, bizLocationId: e.target.value })
                  }
                />
              </div>
            </div>
          </div>
        </div>
      )}

      {currentStep.key === "policy" && (
        <>
          <div className="form-grid two">
            <div className="field">
              <label>Target transit time (SLA, ore)</label>
              <input
                type="number"
                min={1}
                inputMode="numeric"
                value={form.slaHours}
                onChange={(e) => patch("slaHours", Number(e.target.value))}
              />
              <small className="field-hint">Tempo target complessivo della spedizione.</small>
            </div>
            <div className="field">
              <label>Alert threshold (nessun evento per X ore)</label>
              <input
                type="number"
                min={1}
                inputMode="numeric"
                value={form.maxDelayHours}
                onChange={(e) => patch("maxDelayHours", Number(e.target.value))}
              />
              <small className="field-hint">
                Soglia oltre cui la dashboard segnala un bottleneck.
              </small>
            </div>
          </div>

          <div className="form-grid two">
            <div className="field">
              <label>Temperatura minima (opzionale)</label>
              <input
                type="number"
                inputMode="decimal"
                value={form.conditions?.tempMin ?? ""}
                onChange={(e) =>
                  patch("conditions", {
                    ...(form.conditions ?? {}),
                    tempMin: e.target.value === "" ? undefined : Number(e.target.value),
                  })
                }
                placeholder="Es. 2"
              />
            </div>
            <div className="field">
              <label>Temperatura massima (opzionale)</label>
              <input
                type="number"
                inputMode="decimal"
                value={form.conditions?.tempMax ?? ""}
                onChange={(e) =>
                  patch("conditions", {
                    ...(form.conditions ?? {}),
                    tempMax: e.target.value === "" ? undefined : Number(e.target.value),
                  })
                }
                placeholder="Es. 8"
              />
            </div>
          </div>

          <div className="field">
            <label className="checkbox-line">
              <input
                type="checkbox"
                checked={Boolean(form.conditions?.sealRequired)}
                onChange={(e) =>
                  patch("conditions", {
                    ...(form.conditions ?? {}),
                    sealRequired: e.target.checked,
                  })
                }
              />{" "}
              Richiedi prova sigillo (seal photo/doc) per i controlli di condizione
            </label>
            <small className="field-hint">
              Se attivo, il bottleneck engine segnala una violazione se manca una prova allegata.
            </small>
          </div>
        </>
      )}

      {currentStep.key === "participants" && (
        <>
          <div className="card">
            <h3>Participants (DID) • Attori della spedizione</h3>
            <p className="field-hint" style={{ marginTop: -4 }}>
              In development usiamo DID demo. In testnet li sostituiremo con DID/address reali.
            </p>
            <div className="actions" style={{ marginBottom: 10 }}>
              <button
                type="button"
                className="btn"
                onClick={applySessionDidToParticipant}
                disabled={!workspaceSession.actorDid}
              >
                Apply current session DID to{" "}
                {workspaceSession.primaryPersona.replaceAll("_", " ").toLowerCase()}
              </button>
              <span className="field-hint">
                Current session actor: <strong>{workspaceSession.actorDid || "—"}</strong>
              </span>
            </div>

            <div className="form-grid two">
              <div className="field">
                <label>Producer DID (chi produce/prepara)</label>
                <input
                  value={form.participants.producerDid}
                  onChange={(e) =>
                    patch("participants", {
                      ...form.participants,
                      producerDid: e.target.value,
                    })
                  }
                />
              </div>
              <div className="field">
                <label>Carrier DID (trasportatore/custode iniziale)</label>
                <input
                  value={form.participants.carrierDid}
                  onChange={(e) =>
                    patch("participants", {
                      ...form.participants,
                      carrierDid: e.target.value,
                    })
                  }
                />
              </div>
            </div>

            <div className="field">
              <label>Receiver DID (ricevente che conferma l&apos;handover IN)</label>
              <input
                value={form.participants.receiverDid}
                onChange={(e) =>
                  patch("participants", {
                    ...form.participants,
                    receiverDid: e.target.value,
                  })
                }
              />
            </div>
          </div>
        </>
      )}

      {currentStep.key === "route" && (
        <>
          <div className="card">
            <h3>Percorso di custodia (multi-hop)</h3>
            <p className="field-hint" style={{ marginTop: -4 }}>
              Puoi pianificare una route completa oppure usare una route dinamica (consigliata se
              non conosci in anticipo quanti corrieri/magazzini interverranno).
            </p>

            <div className="card" style={{ marginBottom: 12 }}>
              <div className="actions" style={{ justifyContent: "space-between", alignItems: "center" }}>
                <div>
                  <strong>Percorso aperto (dinamico)</strong>
                  <div className="field-hint">
                    Il producer conosce solo il primo corriere. Gli step successivi verranno
                    ricostruiti dai passaggi di presa in carico via codice ANT.
                  </div>
                </div>
                <label className="checkbox-row" style={{ margin: 0 }}>
                  <input
                    type="checkbox"
                    checked={routeOpenDynamicEnabled}
                    onChange={(e) => patchConditions({ routeOpenDynamic: e.target.checked })}
                  />
                  Route dinamica
                </label>
              </div>
            </div>

            {!routeOpenDynamicEnabled && (
              <>
                <div className="actions" style={{ marginBottom: 10, flexWrap: "wrap" }}>
              <button type="button" className="btn" onClick={resetRoutePlanFromParticipants}>
                Reset route (Carrier → Final receiver)
              </button>
              <button
                type="button"
                className="btn"
                onClick={() => addIntermediateRouteStep("CARRIER")}
              >
                + Corriere
              </button>
              <button
                type="button"
                className="btn"
                onClick={() => addIntermediateRouteStep("WAREHOUSE")}
              >
                + Magazzino
              </button>
              <button type="button" className="btn" onClick={() => addIntermediateRouteStep("HUB")}>
                + Hub
              </button>
              <button
                type="button"
                className="btn"
                onClick={() => addIntermediateRouteStep("CUSTOM")}
              >
                + Step custom
              </button>
                </div>

                <div className="form-grid">
              {routePlan.map((step, index) => {
                const isFinal = step.stepType === "FINAL_RECEIVER";
                return (
                  <div key={`route-step-${index}-${step.stepType}`} className="card">
                    <div className="actions" style={{ justifyContent: "space-between" }}>
                      <div>
                        <strong>
                          Step {index + 1} {isFinal ? "• Arrivo finale" : "• Passaggio intermedio"}
                        </strong>
                        <div className="field-hint">
                          {index === 0
                            ? "Primo attore che prende in carico dal producer"
                            : "Questo step prende in carico dal precedente e chiude il passaggio"}
                        </div>
                      </div>
                      {!isFinal && (
                        <button
                          type="button"
                          className="btn"
                          onClick={() => removeRoutePlanStep(index)}
                        >
                          Rimuovi
                        </button>
                      )}
                    </div>

                    <div className="form-grid two">
                      <div className="field">
                        <label>Tipo step</label>
                        <select
                          value={step.stepType}
                          disabled={isFinal}
                          onChange={(e) =>
                            updateRoutePlanStep(index, { stepType: e.target.value as RouteStepType })
                          }
                        >
                          <option value="CARRIER">CARRIER (trasporto)</option>
                          <option value="WAREHOUSE">WAREHOUSE (magazzino)</option>
                          <option value="HUB">HUB (hub logistico)</option>
                          <option value="RETAIL">RETAIL (negozio)</option>
                          <option value="CUSTOM">CUSTOM</option>
                          <option value="FINAL_RECEIVER">FINAL_RECEIVER</option>
                        </select>
                      </div>
                      <div className="field">
                        <label>Label step (opzionale)</label>
                        <input
                          value={step.label ?? ""}
                          onChange={(e) => updateRoutePlanStep(index, { label: e.target.value })}
                          placeholder={isFinal ? "Arrivo finale" : "Es. Magazzino Nord / Corriere 2"}
                        />
                      </div>
                    </div>

                    <div className="form-grid two">
                      <div className="field">
                        <label>Actor DID (custode di questo step)</label>
                        <input
                          value={step.actorDid}
                          onChange={(e) => updateRoutePlanStep(index, { actorDid: e.target.value })}
                          disabled={isFinal}
                        />
                        {isFinal && (
                          <small className="field-hint">
                            Lo step finale usa il DID del Receiver finale definito nei participants.
                          </small>
                        )}
                      </div>
                      <div className="field">
                        <label>Tempo massimo step (ore, opzionale)</label>
                        <input
                          type="number"
                          inputMode="numeric"
                          min={1}
                          value={step.maxStepHours ?? ""}
                          onChange={(e) =>
                            updateRoutePlanStep(index, {
                              maxStepHours: e.target.value === "" ? undefined : Number(e.target.value),
                            })
                          }
                          placeholder="Es. 12"
                        />
                      </div>
                    </div>
                  </div>
                );
              })}
                </div>
              </>
            )}

            {routeOpenDynamicEnabled && (
              <div className="create-wizard-note">
                <strong>Route dinamica attiva:</strong> il primo ritiro parte dal corriere nei
                participants. I passaggi successivi (altri corrieri, magazzini, hub, final
                receiver) saranno registrati quando gli attori inseriscono il codice ANT e
                confermano la presa in carico.
              </div>
            )}

            <div className="create-wizard-note">
              <strong>Regola di fase 2:</strong> ogni step successivo prende in carico via codice ANT
              e chiude il passaggio precedente. In production raffineremo ruoli/policy per step.
            </div>
          </div>
        </>
      )}

      {currentStep.key === "review" && (
        <div className="create-review-grid">
          <div className="card">
            <h3>Shipment preview</h3>
            <div className="summary-grid">
              <div className="summary-tile">
                <span>Display name</span>
                <strong>{reviewSummary.shipmentDisplayName}</strong>
              </div>
              <div className="summary-tile">
                <span>Tracking type</span>
                <strong>{form.trackingUnitType}</strong>
              </div>
              <div className="summary-tile">
                <span>Tracking ID</span>
                <strong className="monospace">{form.trackingId}</strong>
              </div>
              <div className="summary-tile">
                <span>SLA / Max delay</span>
                <strong>
                  {form.slaHours}h / {form.maxDelayHours}h
                </strong>
              </div>
            </div>

            <div className="create-review-block">
              <h4>Origin → Destination</h4>
              <p>
                <strong>{form.origin.label || "Origine"}</strong> →{" "}
                <strong>{form.destination.label || "Destinazione"}</strong>
              </p>
              <p className="field-hint">
                {form.origin.readPointId} • {form.destination.readPointId}
              </p>
            </div>

            <div className="create-review-block">
              <h4>Participants</h4>
              <ul className="create-review-list">
                <li>
                  Producer: <code>{form.participants.producerDid}</code>
                </li>
                <li>
                  Carrier: <code>{form.participants.carrierDid}</code>
                </li>
                <li>
                  Receiver: <code>{form.participants.receiverDid}</code>
                </li>
              </ul>
            </div>

            <div className="create-review-block">
              <h4>Conditions</h4>
              <p className="field-hint">
                Seal required: <strong>{form.conditions?.sealRequired ? "Yes" : "No"}</strong>
                {" • "}
                Temp range:{" "}
                <strong>
                  {form.conditions?.tempMin ?? "—"} / {form.conditions?.tempMax ?? "—"}
                </strong>
              </p>
            </div>

            <div className="create-review-block">
              <h4>Route plan (multi-hop)</h4>
              {routeOpenDynamicEnabled ? (
                <p className="field-hint">
                  <strong>OPEN DYNAMIC</strong> • Il producer definisce il primo corriere e il
                  ricevente finale. I passaggi intermedi verranno ricostruiti dagli eventi di presa
                  in carico lungo la filiera.
                </p>
              ) : (
                <ol className="create-review-list">
                  {routePlan.map((step, index) => (
                    <li key={`review-route-${index}-${step.stepType}`}>
                      <strong>{step.stepType}</strong>
                      {step.label ? ` (${step.label})` : ""}: <code>{step.actorDid}</code>
                      {step.maxStepHours ? ` • max ${step.maxStepHours}h` : ""}
                    </li>
                  ))}
                </ol>
              )}
            </div>
          </div>

          <div className="card create-review-side">
            <h3>Output finale</h3>
            <p className="muted">
              Dopo la create vedrai:
              <br />• `ANT code` (shipmentCode)
              <br />• QR pronto da scaricare
              <br />• titolo con codice + nome shipment (display)
            </p>
            <p className="field-hint">
              La create usa saga sicura (`PROVISIONING → ACTIVE`) e non blocca la UI.
            </p>
          </div>
        </div>
      )}

      {error && <p className="error">{error}</p>}

      <div className="create-wizard-footer">
        <div className="actions">
          <button type="button" className="btn" disabled={busy} onClick={resetDemoValues}>
            Reset demo values
          </button>
          {currentStepIndex > 0 && (
            <button type="button" className="btn" disabled={busy} onClick={goBack}>
              Indietro
            </button>
          )}
        </div>
        <div className="actions">
          {!isLastStep ? (
            <button type="button" className="btn primary" disabled={busy} onClick={goNext}>
              Conferma step e continua
            </button>
          ) : (
            <button type="button" className="btn primary" disabled={busy} onClick={submit}>
              {busy ? "Creating..." : "Create shipment"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
