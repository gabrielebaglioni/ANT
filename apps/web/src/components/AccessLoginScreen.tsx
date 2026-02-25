import { useEffect, useMemo, useState } from "react";
import {
  ANT_DEMO_MULTI_ENTITY_TENANT_ID,
  isValidTenantId,
  TENANT_ID_NAMING_PATTERN,
} from "@ant/shared";
import { DEV_ACCESS_PROFILES, mapProfileToWorkspaceSession } from "../config/devAccessProfiles";
import { useShipmentStore } from "../store/shipmentStore";
import { organizationTypeLabel, personaLabel } from "../workspace/authz";

interface AccessLoginScreenProps {
  onAccessGranted?: () => void;
}

type HandshakeStepKey = "oidc" | "wallet" | "did";
type AccessFlowStep = "splash" | "profile" | "identity" | "handshake" | "success";
type HandshakeStatus = "pending" | "loading" | "done";

function personaTone(profileId: string): string {
  if (profileId.startsWith("producer")) return "producer";
  if (profileId.startsWith("carrier")) return "carrier";
  if (profileId.startsWith("receiver")) return "receiver";
  if (profileId.startsWith("supervisor")) return "supervisor";
  return "auditor";
}

function personaGlyph(profileId: string): string {
  if (profileId.startsWith("producer")) return "◌";
  if (profileId.startsWith("carrier")) return "⇄";
  if (profileId.startsWith("receiver")) return "✓";
  if (profileId.startsWith("supervisor")) return "⌘";
  return "◎";
}

function roleAccent(tone: string): string {
  if (tone === "producer") return "#10b981";
  if (tone === "carrier") return "#0d7377";
  if (tone === "receiver") return "#f59e0b";
  if (tone === "supervisor") return "#f43f5e";
  return "#64748b";
}

function maskMiddle(value: string, keep = 6): string {
  if (!value) return "";
  if (value.length <= keep * 2 + 3) return value;
  return `${value.slice(0, keep)}...${value.slice(-keep)}`;
}

export function AccessLoginScreen({ onAccessGranted }: AccessLoginScreenProps) {
  const workspaceSession = useShipmentStore((s) => s.workspaceSession);
  const setWorkspaceSession = useShipmentStore((s) => s.setWorkspaceSession);
  const completeWorkspaceOnboarding = useShipmentStore((s) => s.completeWorkspaceOnboarding);
  const setLastAccessProfileId = useShipmentStore((s) => s.setLastAccessProfileId);
  const lastAccessProfileId = useShipmentStore((s) => s.lastAccessProfileId);
  const syncScanContextFromWorkspaceSession = useShipmentStore((s) => s.syncScanContextFromWorkspaceSession);

  const [flowStep, setFlowStep] = useState<AccessFlowStep>("splash");
  const [selectedProfileId, setSelectedProfileId] = useState(
    lastAccessProfileId ?? DEV_ACCESS_PROFILES[1]?.id ?? DEV_ACCESS_PROFILES[0]?.id ?? "",
  );
  const [tenantId, setTenantId] = useState("");
  const [organizationName, setOrganizationName] = useState("");
  const [identityLabel, setIdentityLabel] = useState("");
  const [actorDid, setActorDid] = useState("");
  const [subject, setSubject] = useState("");
  const [authMode, setAuthMode] = useState<"dev_headers" | "iota_identity_preview">("dev_headers");
  const [pin, setPin] = useState("");
  const [rememberDevice, setRememberDevice] = useState(true);
  const [showAdvanced, setShowAdvanced] = useState(true);
  const [mockTokenPreview, setMockTokenPreview] = useState("");
  const [mockWalletAddress, setMockWalletAddress] = useState("");
  const [step1, setStep1] = useState<HandshakeStatus>("pending");
  const [step2, setStep2] = useState<HandshakeStatus>("pending");
  const [step3, setStep3] = useState<HandshakeStatus>("pending");
  const [error, setError] = useState("");

  useEffect(() => {
    const t = window.setTimeout(() => setFlowStep("profile"), 2400);
    return () => window.clearTimeout(t);
  }, []);

  const selectedProfile = useMemo(
    () => DEV_ACCESS_PROFILES.find((p) => p.id === selectedProfileId) ?? DEV_ACCESS_PROFILES[0],
    [selectedProfileId],
  );

  const tone = personaTone(selectedProfile?.id ?? "");
  const accent = roleAccent(tone);

  useEffect(() => {
    if (!selectedProfile) return;
    setTenantId(selectedProfile.tenantId);
    setOrganizationName(selectedProfile.orgName);
    setIdentityLabel(selectedProfile.identityLabel);
    setActorDid(selectedProfile.actorDid);
    setSubject(selectedProfile.subject);
    setAuthMode(selectedProfile.authMode);
    setPin(selectedProfile.pin);
    setShowAdvanced(true);
    setMockTokenPreview("");
    setMockWalletAddress("");
    setStep1("pending");
    setStep2("pending");
    setStep3("pending");
    setError("");
  }, [selectedProfile]);

  useEffect(() => {
    if (!selectedProfileId) return;
    if (rememberDevice) setLastAccessProfileId(selectedProfileId);
    else setLastAccessProfileId(null);
  }, [rememberDevice, selectedProfileId, setLastAccessProfileId]);

  const handshakeSteps: Array<{ key: HandshakeStepKey; title: string; status: HandshakeStatus }> = [
    { key: "oidc", title: "Login", status: step1 },
    { key: "wallet", title: "Wallet", status: step2 },
    { key: "did", title: "Bind DID", status: step3 },
  ];
  const handshakeDoneCount = handshakeSteps.filter((s) => s.status === "done").length;
  const allStepsDone = step1 === "done" && step2 === "done" && step3 === "done";
  const normalizedTenantId = tenantId.trim();
  const tenantIdValid = normalizedTenantId.length > 0 && isValidTenantId(normalizedTenantId);
  const accessReady =
    allStepsDone &&
    Boolean(tenantIdValid && organizationName.trim() && identityLabel.trim() && actorDid.trim());

  const capabilitiesPreview = [
    { glyph: "▣", text: "Creare nuove shipment" },
    { glyph: "⌁", text: "Scansionare e firmare QR" },
    { glyph: "≋", text: "Visualizzare timeline eventi" },
    { glyph: "✓", text: "Verificare proof on-chain" },
  ];

  const runMockOidcLogin = async () => {
    // Mock OIDC handshake: replace with real OIDC redirect/token exchange in testnet.
    if (!selectedProfile) return;
    setError("");
    setStep1("loading");
    await new Promise((r) => window.setTimeout(r, 900));
    const tokenPreview = `mock.${btoa(
      JSON.stringify({
        sub: subject.trim() || selectedProfile.subject,
        tenant: tenantId.trim() || selectedProfile.tenantId,
        roles: selectedProfile.rolesCsv.split(","),
      }),
    )
      .replace(/=+$/, "")
      .slice(0, 36)}.sig`;
    setMockTokenPreview(tokenPreview);
    setStep1("done");
    if (step2 === "pending") setStep2("pending");
  };

  const runMockWalletConnect = async () => {
    // Mock wallet connect: replace with real wallet SDK connect/request accounts.
    if (step1 !== "done") {
      setError("Completa prima il login OIDC mock.");
      return;
    }
    setError("");
    setStep2("loading");
    await new Promise((r) => window.setTimeout(r, 900));
    const seed = (actorDid.trim() || selectedProfile?.actorDid || "did:iota:demo").toLowerCase();
    let hash = 0x811c9dc5;
    for (let i = 0; i < seed.length; i += 1) {
      hash ^= seed.charCodeAt(i);
      hash = Math.imul(hash, 0x01000193);
    }
    const hex = (hash >>> 0).toString(16).padStart(8, "0");
    setMockWalletAddress(`0x${hex}${hex}${hex}${hex}${hex}`);
    setStep2("done");
  };

  const runMockDidBinding = async () => {
    // Mock DID binding challenge: replace with server challenge + wallet signature verification.
    if (step1 !== "done" || step2 !== "done") {
      setError("Completa prima login OIDC e wallet connect.");
      return;
    }
    setError("");
    setStep3("loading");
    await new Promise((r) => window.setTimeout(r, 900));
    setStep3("done");
  };

  const validateIdentityStep = (): boolean => {
    if (!tenantId.trim() || !organizationName.trim() || !identityLabel.trim() || !actorDid.trim()) {
      setError("Completa i campi obbligatori prima di continuare.");
      return false;
    }
    if (!isValidTenantId(tenantId)) {
      setError(
        `Tenant ID non valido. Usa il formato ${TENANT_ID_NAMING_PATTERN} (esempio: ${ANT_DEMO_MULTI_ENTITY_TENANT_ID}).`,
      );
      return false;
    }
    if (pin.trim().length < 4) {
      setError("Inserisci il PIN demo (minimo 4 cifre).");
      return false;
    }
    setError("");
    return true;
  };

  const finalizeAccess = () => {
    if (!selectedProfile) return;
    if (pin.trim() !== selectedProfile.pin) {
      setError("PIN demo non corretto per il profilo selezionato.");
      setFlowStep("identity");
      return;
    }
    if (!accessReady) {
      setError("Completa tutte le verifiche di sicurezza prima di accedere.");
      setFlowStep("handshake");
      return;
    }

    const mapped = mapProfileToWorkspaceSession(workspaceSession, selectedProfile);
    setWorkspaceSession({
      ...mapped,
      tenantId: tenantId.trim(),
      organizationName: organizationName.trim(),
      identityLabel: identityLabel.trim(),
      actorDid: actorDid.trim(),
      actorId: actorDid.trim(),
      subject: subject.trim() || selectedProfile.subject,
      authMode,
      onboardingComplete: true,
    });
    if (rememberDevice) {
      setLastAccessProfileId(selectedProfile.id);
    } else {
      setLastAccessProfileId(null);
    }
    completeWorkspaceOnboarding();
    syncScanContextFromWorkspaceSession();
    setError("");
    onAccessGranted?.();
  };

  const commonScreenClass = "fig-mobile-screen";

  if (flowStep === "splash") {
    return (
      <div className={`${commonScreenClass} fig-splash`}>
        <div className="fig-glow fig-glow-teal" aria-hidden />
        <div className="fig-glow fig-glow-amber" aria-hidden />
        <div className="fig-splash-content">
          <div className="fig-logo-xl"><span>A</span></div>
          <h1 className="fig-splash-title">ANT</h1>
          <p className="fig-splash-subtitle">Traceability Workspace</p>
          <p className="fig-splash-copy">Integrità notarizzata su IOTA, dati sensibili off-chain</p>
          <div className="fig-dot-loader" aria-hidden>
            <span />
            <span />
            <span />
          </div>
          <div className="fig-progress-track" aria-hidden>
            <div className="fig-progress-bar" />
          </div>
          <p className="fig-footer-note">Caricamento profili e policy locali...</p>
          <button type="button" className="fig-link-btn" onClick={() => setFlowStep("profile")}>Salta</button>
        </div>
        <div className="fig-bottom-fade" aria-hidden />
      </div>
    );
  }

  if (flowStep === "profile") {
    return (
      <div className={commonScreenClass}>
        <div className="fig-header sticky">
          <div className="fig-header-brand">
            <div className="fig-logo-sm"><span>A</span></div>
            <h1>ANT</h1>
          </div>
        </div>

        <div className="fig-content">
          <h2 className="fig-screen-title">Scegli chi sei</h2>
          <p className="fig-screen-subtitle">
            Seleziona organizzazione, identità e ruolo per entrare nella tua area
          </p>

          <div className="fig-card-stack">
            {DEV_ACCESS_PROFILES.map((profile) => {
              const selected = profile.id === selectedProfileId;
              const profileTone = personaTone(profile.id);
              const profileAccent = roleAccent(profileTone);
              return (
                <button
                  key={profile.id}
                  type="button"
                  className={selected ? `fig-profile-card is-selected tone-${profileTone}` : `fig-profile-card tone-${profileTone}`}
                  onClick={() => setSelectedProfileId(profile.id)}
                >
                  <div className="fig-profile-icon" style={{ backgroundColor: profileAccent }}>
                    <span>{personaGlyph(profile.id)}</span>
                  </div>
                  <div className="fig-profile-meta">
                    <div className="fig-profile-meta-row">
                      <span className="fig-profile-name">{profile.identityLabel}</span>
                      <span className="fig-role-pill" style={{ backgroundColor: profileAccent }}>
                        {personaLabel(profile.persona).replace(" Operator", "")}
                      </span>
                    </div>
                    <p className="fig-profile-org">{profile.orgName}</p>
                    <div className="fig-chip-row">
                      <span className="fig-chip">{profile.tenantId}</span>
                      <span className="fig-chip">{profile.rolesCsv}</span>
                    </div>
                  </div>
                  {selected && <div className="fig-selected-check">✓</div>}
                </button>
              );
            })}
          </div>

          <p className="fig-center-note">Profilo memorizzato su questo dispositivo</p>
          {error && <p className="fig-error-inline">{error}</p>}
          <button type="button" className="fig-btn-primary" onClick={() => setFlowStep("identity")}>
            Continua
          </button>
        </div>
      </div>
    );
  }

  if (flowStep === "identity") {
    return (
      <div className={commonScreenClass}>
        <div className="fig-header sticky with-step">
          <button type="button" className="fig-icon-btn" onClick={() => setFlowStep("profile")}>
            ‹
          </button>
          <div className="fig-header-center"><h1>Setup Accesso</h1></div>
          <div className="fig-step-pill">2/3</div>
        </div>

        <div className="fig-content fig-section-stack">
          <div className="fig-card">
            <div className="fig-selected-profile-head">
              <div className="fig-profile-icon" style={{ backgroundColor: accent }}>
                <span>{identityLabel.trim()?.[0]?.toUpperCase() ?? personaGlyph(selectedProfile.id)}</span>
              </div>
              <div className="fig-profile-meta" style={{ minWidth: 0 }}>
                <h3 className="fig-card-title">Profilo selezionato</h3>
                <div className="fig-chip-row">
                  <span className={`fig-soft-pill tone-${tone}`}>{personaLabel(selectedProfile.persona).replace(" Operator", "")}</span>
                  <span className="fig-chip">{selectedProfile.rolesCsv}</span>
                </div>
              </div>
            </div>
            <div className="fig-summary-grid-2">
              <div className="fig-summary-tile"><small>Organizzazione</small><strong>{organizationName}</strong></div>
              <div className="fig-summary-tile"><small>Identità</small><strong>{identityLabel}</strong></div>
              <div className="fig-summary-tile full"><small>DID operativo</small><code>{maskMiddle(actorDid, 10)}</code></div>
            </div>
          </div>

          <div className="fig-card">
            <label className="fig-field-label">PIN dispositivo (demo)</label>
            <input
              type="password"
              value={pin}
              onChange={(e) => setPin(e.target.value)}
              placeholder="••••••"
              maxLength={6}
              className="fig-pin-input"
              inputMode="numeric"
            />
            <p className="fig-card-note">Inserisci il PIN per sbloccare le credenziali locali</p>
          </div>

          <button type="button" className="fig-collapse-btn" onClick={() => setShowAdvanced((v) => !v)}>
            <span>Mostra dettagli avanzati</span>
            <span>{showAdvanced ? "▴" : "▾"}</span>
          </button>

          {showAdvanced && (
            <div className="fig-card fig-section-stack compact-gap">
              <h4 className="fig-card-title">Dettagli avanzati</h4>

              <div className="fig-form-field">
                <label>Organization name</label>
                <input value={organizationName} onChange={(e) => setOrganizationName(e.target.value)} className="fig-input" />
              </div>
              <div className="fig-form-field">
                <label>Tenant ID</label>
                <input value={tenantId} onChange={(e) => setTenantId(e.target.value)} className="fig-input monospace" />
                <p
                  className={tenantId.trim() && !tenantIdValid ? "fig-card-note fig-tenant-note error" : "fig-card-note fig-tenant-note"}
                >
                  Naming: <code>{TENANT_ID_NAMING_PATTERN}</code> • esempio workspace ANT:{" "}
                  <code>{ANT_DEMO_MULTI_ENTITY_TENANT_ID}</code>
                </p>
              </div>
              <div className="fig-form-field">
                <label>Identity label</label>
                <input value={identityLabel} onChange={(e) => setIdentityLabel(e.target.value)} className="fig-input" />
              </div>
              <div className="fig-form-field">
                <label>OIDC Subject (preview)</label>
                <div className="fig-input-static monospace">{subject || "sub:demo@example.com"}</div>
              </div>
              <div className="fig-form-field">
                <label>IOTA DID (actor)</label>
                <div className="fig-input-static monospace break">{actorDid}</div>
              </div>
              <div className="fig-form-field">
                <label>Auth mode</label>
                <select className="fig-input" value={authMode} onChange={(e) => setAuthMode(e.target.value as typeof authMode)}>
                  <option value="dev_headers">OIDC + Wallet (mock via dev headers)</option>
                  <option value="iota_identity_preview">IOTA Identity preview</option>
                </select>
              </div>
            </div>
          )}

          {error && <p className="fig-error-inline">{error}</p>}
          <button
            type="button"
            className={pin.length >= 4 ? "fig-btn-primary" : "fig-btn-primary is-disabled"}
            onClick={() => {
              if (!validateIdentityStep()) return;
              setFlowStep("handshake");
            }}
          >
            Continua al login sicuro
          </button>
        </div>
      </div>
    );
  }

  if (flowStep === "handshake") {
    return (
      <div className={commonScreenClass}>
        <div className="fig-header sticky with-step">
          <button type="button" className="fig-icon-btn" onClick={() => setFlowStep("identity")}>
            ‹
          </button>
          <div className="fig-header-center"><h1>Handshake sicurezza</h1></div>
          <div className="fig-step-pill">3/3</div>
        </div>

        <div className="fig-content fig-section-stack">
          <div className="fig-info-card">
            <p>
              Il sistema esegue tre verifiche per garantire l&apos;accesso sicuro: <strong>login OIDC</strong>, <strong>connessione wallet</strong> e <strong>binding DID</strong>.
            </p>
          </div>

          <div className="fig-progress-lines" aria-hidden>
            {handshakeSteps.map((s) => (
              <span
                key={s.key}
                className={
                  s.status === "done"
                    ? "line done"
                    : s.status === "loading"
                      ? "line loading"
                      : "line"
                }
              />
            ))}
          </div>

          <div className="fig-section-stack compact-gap">
            <div className={step1 === "done" ? "fig-step-card done" : step1 === "loading" ? "fig-step-card loading" : "fig-step-card"}>
              <div className="fig-step-number">1</div>
              <div className="fig-step-body">
                <h3>OIDC Login</h3>
                <p>Autenticazione con provider esterno (mock)</p>
                {step1 === "done" && <div className="fig-token-preview monospace">token: {mockTokenPreview || "mock...sig"}</div>}
                {step1 === "pending" && (
                  <button type="button" className="fig-btn-inline" onClick={runMockOidcLogin}>Avvia login OIDC</button>
                )}
              </div>
              <div className="fig-step-status" aria-hidden>
                {step1 === "done" ? "✓" : step1 === "loading" ? "◌" : "○"}
              </div>
            </div>

            <div className={step2 === "done" ? "fig-step-card done" : step2 === "loading" ? "fig-step-card loading" : "fig-step-card"}>
              <div className="fig-step-number">2</div>
              <div className="fig-step-body">
                <h3>Wallet Connect</h3>
                <p>Connessione al wallet IOTA (mock)</p>
                {step2 === "done" && <div className="fig-token-preview monospace">wallet: {maskMiddle(mockWalletAddress, 6)}</div>}
                {step2 === "pending" && step1 !== "done" && <p className="fig-inline-note">In attesa del completamento del login...</p>}
                {step2 === "pending" && step1 === "done" && (
                  <button type="button" className="fig-btn-inline" onClick={runMockWalletConnect}>Connetti wallet</button>
                )}
              </div>
              <div className="fig-step-status" aria-hidden>
                {step2 === "done" ? "✓" : step2 === "loading" ? "◌" : "○"}
              </div>
            </div>

            <div className={step3 === "done" ? "fig-step-card done" : step3 === "loading" ? "fig-step-card loading" : "fig-step-card"}>
              <div className="fig-step-number">3</div>
              <div className="fig-step-body">
                <h3>DID Binding</h3>
                <p>Binding OIDC subject → DID (mock challenge)</p>
                {step3 === "done" && (
                  <div className="fig-token-preview">
                    <div className="monospace">Subject: {maskMiddle(subject || "sub:demo", 10)}</div>
                    <div className="monospace">DID: {maskMiddle(actorDid, 10)}</div>
                  </div>
                )}
                {step3 === "pending" && step2 !== "done" && <p className="fig-inline-note">In attesa della connessione wallet...</p>}
                {step3 === "pending" && step2 === "done" && (
                  <button type="button" className="fig-btn-inline" onClick={runMockDidBinding}>Esegui binding</button>
                )}
              </div>
              <div className="fig-step-status" aria-hidden>
                {step3 === "done" ? "✓" : step3 === "loading" ? "◌" : "○"}
              </div>
            </div>
          </div>

          <label className="fig-card fig-check-row">
            <input type="checkbox" checked={rememberDevice} onChange={(e) => setRememberDevice(e.target.checked)} />
            <span>Ricorda questo profilo su questo dispositivo</span>
          </label>

          {error && <p className="fig-error-inline">{error}</p>}
          <button
            type="button"
            className={allStepsDone ? "fig-btn-primary" : "fig-btn-primary is-disabled"}
            onClick={() => {
              if (!allStepsDone) {
                setError("Completa tutte le verifiche di sicurezza.");
                return;
              }
              setError("");
              setFlowStep("success");
            }}
          >
            Accedi al workspace
          </button>
          <p className="fig-center-note">{handshakeDoneCount}/3 verifiche completate</p>
        </div>
      </div>
    );
  }

  return (
    <div className={commonScreenClass}>
      <div className="fig-success-wrap">
        <div className="fig-success-icon">✓</div>
        <h1 className="fig-screen-title centered">Accesso completato</h1>
        <p className="fig-screen-subtitle centered" style={{ marginTop: 6 }}>Workspace pronto</p>

        <div className="fig-card fig-section-stack compact-gap">
          <div className="fig-summary-grid-2">
            <div className="fig-summary-tile"><small>Identità</small><strong>{identityLabel}</strong></div>
            <div className="fig-summary-tile"><small>Organizzazione</small><strong>{organizationName}</strong></div>
            <div className="fig-summary-tile"><small>Tenant</small><code>{tenantId}</code></div>
            <div className="fig-summary-tile"><small>Persona</small><strong style={{ color: accent }}>{personaLabel(selectedProfile.persona).replace(" Operator", "")}</strong></div>
            <div className="fig-summary-tile full"><small>DID</small><code>{maskMiddle(actorDid, 10)}</code></div>
          </div>
        </div>

        <div className="fig-card fig-cap-list-card">
          <h3 className="fig-card-title">Cosa puoi fare ora</h3>
          <div className="fig-cap-list">
            {capabilitiesPreview.map((cap) => (
              <div key={cap.text} className="fig-cap-item">
                <div className="fig-cap-icon">{cap.glyph}</div>
                <p>{cap.text}</p>
              </div>
            ))}
          </div>
        </div>

        {error && <p className="fig-error-inline">{error}</p>}

        <div className="fig-section-stack compact-gap">
          <button type="button" className="fig-btn-primary" onClick={finalizeAccess}>Apri dashboard</button>
          <button type="button" className="fig-btn-secondary" onClick={() => setFlowStep("profile")}>Cambia profilo</button>
        </div>

        <p className="fig-center-note">{organizationTypeLabel(selectedProfile.organizationType)} • {authMode}</p>
      </div>
    </div>
  );
}
