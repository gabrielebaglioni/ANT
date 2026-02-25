import { useMemo, useState } from "react";
import {
  useShipmentStore,
  type OrganizationType,
  type WorkspacePersona,
  type WorkspaceSessionPreset,
} from "../store/shipmentStore";

function rolesForPersona(persona: WorkspacePersona): string {
  if (persona === "SUPERVISOR") return "supervisor,auditor";
  if (persona === "AUDITOR") return "auditor";
  return "operator";
}

function orgTypeForPersona(persona: WorkspacePersona): OrganizationType {
  if (persona === "PRODUCER_OPERATOR") return "PRODUCER";
  if (persona === "CARRIER_OPERATOR") return "CARRIER";
  if (persona === "RECEIVER_OPERATOR") return "RECEIVER";
  if (persona === "AUDITOR") return "AUDITOR";
  return "MULTI_ENTITY";
}

function presetForPersona(persona: WorkspacePersona): WorkspaceSessionPreset {
  if (persona === "PRODUCER_OPERATOR") return "producer_operator";
  if (persona === "CARRIER_OPERATOR") return "carrier_operator";
  if (persona === "RECEIVER_OPERATOR") return "receiver_operator";
  if (persona === "SUPERVISOR") return "supervisor";
  return "auditor";
}

interface WorkspaceOnboardingProps {
  onDone?: () => void;
}

export function WorkspaceOnboarding({ onDone }: WorkspaceOnboardingProps) {
  const workspaceSession = useShipmentStore((s) => s.workspaceSession);
  const setWorkspaceSession = useShipmentStore((s) => s.setWorkspaceSession);
  const applyWorkspaceSessionPreset = useShipmentStore((s) => s.applyWorkspaceSessionPreset);
  const completeWorkspaceOnboarding = useShipmentStore((s) => s.completeWorkspaceOnboarding);
  const syncScanContextFromWorkspaceSession = useShipmentStore((s) => s.syncScanContextFromWorkspaceSession);
  const [localError, setLocalError] = useState("");

  const personaOptions: Array<{ value: WorkspacePersona; label: string; hint: string }> = [
    {
      value: "PRODUCER_OPERATOR",
      label: "Producer operator",
      hint: "Crea shipment e prepara handover iniziale",
    },
    {
      value: "CARRIER_OPERATOR",
      label: "Carrier operator",
      hint: "Scansiona, verifica stato e firma handover OUT",
    },
    {
      value: "RECEIVER_OPERATOR",
      label: "Receiver operator",
      hint: "Conferma handover IN e raccoglie evidenze in ricevimento",
    },
    {
      value: "SUPERVISOR",
      label: "Supervisor / Admin",
      hint: "Ops metrics, governance, compensazioni con dual control",
    },
    {
      value: "AUDITOR",
      label: "Auditor",
      hint: "Vista read-only su verify/timeline e metriche di controllo",
    },
  ];

  const canEnter = useMemo(() => {
    return Boolean(
      workspaceSession.tenantId.trim() &&
        workspaceSession.organizationName.trim() &&
        workspaceSession.identityLabel.trim() &&
        workspaceSession.subject.trim() &&
        workspaceSession.actorDid.trim(),
    );
  }, [workspaceSession]);

  const applyPersona = (persona: WorkspacePersona) => {
    const preset = presetForPersona(persona);
    applyWorkspaceSessionPreset(preset);
    setWorkspaceSession({
      primaryPersona: persona,
      organizationType: orgTypeForPersona(persona),
      rolesCsv: rolesForPersona(persona),
    });
    setLocalError("");
  };

  const enterWorkspace = () => {
    if (!canEnter) {
      setLocalError("Completa organizzazione, identità e DID prima di entrare.");
      return;
    }
    setWorkspaceSession({
      rolesCsv: rolesForPersona(workspaceSession.primaryPersona),
      organizationType: orgTypeForPersona(workspaceSession.primaryPersona),
    });
    completeWorkspaceOnboarding();
    syncScanContextFromWorkspaceSession();
    setLocalError("");
    onDone?.();
  };

  return (
    <div className="card onboarding-shell">
      <div className="onboarding-header">
        <div>
          <p className="eyebrow">Workspace Access</p>
          <h2>Connetti la tua organizzazione ad ANT</h2>
          <p className="muted">
            Prima scegli organizzazione, identità e ruolo. ANT apre poi solo le aree utili a quel
            profilo, con permessi coerenti e tenant-scoping.
          </p>
        </div>
        <div className="onboarding-preview">
          <div className="hero-metric">
            <span>Tenant</span>
            <strong>{workspaceSession.tenantId || "—"}</strong>
          </div>
          <div className="hero-metric">
            <span>Persona</span>
            <strong>{workspaceSession.primaryPersona.replace(/_/g, " ")}</strong>
          </div>
          <div className="hero-metric">
            <span>Actor DID</span>
            <strong>{workspaceSession.actorDid || "—"}</strong>
          </div>
        </div>
      </div>

      <div className="onboarding-grid">
        <div className="onboarding-step">
          <h3>1. Organizzazione</h3>
          <p className="field-hint">
            Ogni chiamata API è tenant-scoped. Il tenant identifica l&apos;ente che opera.
          </p>
          <div className="form-grid">
            <div className="field">
              <label>Organization name</label>
              <input
                value={workspaceSession.organizationName}
                onChange={(e) => setWorkspaceSession({ organizationName: e.target.value })}
                placeholder="ACME Logistics"
              />
            </div>
            <div className="field">
              <label>Tenant ID (slug tecnico)</label>
              <input
                value={workspaceSession.tenantId}
                onChange={(e) => setWorkspaceSession({ tenantId: e.target.value })}
                placeholder="acme-logistics"
              />
            </div>
            <div className="field">
              <label>Organization type</label>
              <select
                value={workspaceSession.organizationType}
                onChange={(e) =>
                  setWorkspaceSession({ organizationType: e.target.value as OrganizationType })
                }
              >
                <option value="PRODUCER">Producer / Shipper</option>
                <option value="CARRIER">Carrier / Logistics</option>
                <option value="RECEIVER">Receiver / Consignee</option>
                <option value="MULTI_ENTITY">Control Tower (multi-entity)</option>
                <option value="AUDITOR">Audit / Compliance</option>
              </select>
            </div>
          </div>
        </div>

        <div className="onboarding-step">
          <h3>2. Identità</h3>
          <p className="field-hint">
            In dev usi un&apos;identità simulata. In testnet sarà OIDC + IOTA DID binding.
          </p>
          <div className="form-grid">
            <div className="field">
              <label>Identity label (nome persona/servizio)</label>
              <input
                value={workspaceSession.identityLabel}
                onChange={(e) => setWorkspaceSession({ identityLabel: e.target.value })}
                placeholder="Mario Rossi"
              />
            </div>
            <div className="field">
              <label>Subject (OIDC preview)</label>
              <input
                value={workspaceSession.subject}
                onChange={(e) => setWorkspaceSession({ subject: e.target.value })}
                placeholder="oidc-subject-or-user-id"
              />
            </div>
            <div className="field">
              <label>IOTA DID (actor operativo)</label>
              <input
                value={workspaceSession.actorDid}
                onChange={(e) =>
                  setWorkspaceSession({ actorDid: e.target.value, actorId: e.target.value })
                }
                placeholder="did:iota:..."
              />
            </div>
          </div>
        </div>

        <div className="onboarding-step">
          <h3>3. Ruolo / Persona</h3>
          <p className="field-hint">
            La persona determina cosa vedi e quali azioni ANT ti propone come default.
          </p>
          <div className="persona-list">
            {personaOptions.map((option) => {
              const active = workspaceSession.primaryPersona === option.value;
              return (
                <button
                  key={option.value}
                  type="button"
                  className={active ? "persona-option is-active" : "persona-option"}
                  onClick={() => applyPersona(option.value)}
                >
                  <strong>{option.label}</strong>
                  <small>{option.hint}</small>
                </button>
              );
            })}
          </div>
          <div className="field">
            <label>Auth mode</label>
            <select
              value={workspaceSession.authMode}
              onChange={(e) =>
                setWorkspaceSession({ authMode: e.target.value as "dev_headers" | "iota_identity_preview" })
              }
            >
              <option value="dev_headers">Development headers (x-ant-*)</option>
              <option value="iota_identity_preview">IOTA Identity preview (UX only)</option>
            </select>
          </div>
          <p className="field-hint">
            Roles CSV sarà normalizzato automaticamente dalla persona scelta:{" "}
            <strong>{rolesForPersona(workspaceSession.primaryPersona)}</strong>
          </p>
        </div>
      </div>

      {localError && <p className="error">{localError}</p>}

      <div className="actions" style={{ marginTop: 12 }}>
        <button
          type="button"
          className="btn"
          onClick={() => applyWorkspaceSessionPreset("producer_operator")}
        >
          Quick preset: Producer
        </button>
        <button
          type="button"
          className="btn"
          onClick={() => applyWorkspaceSessionPreset("carrier_operator")}
        >
          Quick preset: Carrier
        </button>
        <button
          type="button"
          className="btn"
          onClick={() => applyWorkspaceSessionPreset("receiver_operator")}
        >
          Quick preset: Receiver
        </button>
        <button type="button" className="btn primary" disabled={!canEnter} onClick={enterWorkspace}>
          Enter workspace
        </button>
      </div>
    </div>
  );
}

