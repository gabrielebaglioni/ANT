import { useEffect, useMemo, useState } from "react";
import { CreateShipmentPage } from "./pages/CreateShipment";
import { ScanSignPage } from "./pages/ScanSign";
import { TimelinePage } from "./pages/Timeline";
import { VerifyPage } from "./pages/Verify";
import { AdminPage } from "./pages/Admin";
import { WorkspaceHomePage } from "./pages/Home";
import { AccessLoginScreen } from "./components/AccessLoginScreen";
import { useShipmentStore } from "./store/shipmentStore";
import {
  deriveWorkspaceCapabilities,
  organizationTypeLabel,
  personaLabel,
  type AppTabKey,
} from "./workspace/authz";

const runtime = import.meta.env.VITE_APP_RUNTIME ?? "development";
const iotaNetwork = import.meta.env.VITE_IOTA_NETWORK ?? "local";
const envLabel = import.meta.env.VITE_ENV_LABEL ?? `${runtime} / ${iotaNetwork}`;

const tabCatalog: Array<{ key: AppTabKey; label: string; description: string }> = [
  { key: "home", label: "Workspace", description: "Area dedicata per ruolo" },
  { key: "create", label: "Create", description: "Nuova shipment + QR" },
  { key: "scan", label: "Scan & Sign", description: "Handover OUT / IN" },
  { key: "timeline", label: "Timeline", description: "Eventi + bottleneck" },
  { key: "verify", label: "Verify", description: "Audit read-only" },
  { key: "admin", label: "Admin", description: "Ops + governance" },
];

export default function App() {
  const workspaceSession = useShipmentStore((s) => s.workspaceSession);
  const resetWorkspaceOnboarding = useShipmentStore((s) => s.resetWorkspaceOnboarding);
  const syncScanContextFromWorkspaceSession = useShipmentStore((s) => s.syncScanContextFromWorkspaceSession);
  const sharedShipmentCodeInput = useShipmentStore((s) => s.sharedShipmentCodeInput);
  const activeShipmentCode = useShipmentStore((s) => s.activeShipmentCode);
  const currentContextCode = activeShipmentCode || sharedShipmentCodeInput;

  const capabilities = useMemo(() => deriveWorkspaceCapabilities(workspaceSession), [workspaceSession]);
  const [tab, setTab] = useState<AppTabKey>("home");
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [profileMenuOpen, setProfileMenuOpen] = useState(false);
  const [headerVisible, setHeaderVisible] = useState(true);
  const [mobileBottomNavVisible, setMobileBottomNavVisible] = useState(true);
  const [isMobileViewport, setIsMobileViewport] = useState(
    typeof window !== "undefined" ? window.innerWidth <= 900 : false,
  );

  useEffect(() => {
    const onResize = () => setIsMobileViewport(window.innerWidth <= 900);
    onResize();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  useEffect(() => {
    if (!workspaceSession.onboardingComplete) {
      setTab("home");
      return;
    }
    if (!capabilities.visibleTabs.includes(tab)) {
      setTab(capabilities.defaultTab);
    }
  }, [workspaceSession.onboardingComplete, capabilities, tab]);

  useEffect(() => {
    setMobileNavOpen(false);
    setProfileMenuOpen(false);
  }, [tab, workspaceSession.onboardingComplete]);

  useEffect(() => {
    if (!workspaceSession.onboardingComplete) {
      setHeaderVisible(false);
      setMobileBottomNavVisible(false);
      return;
    }
    setHeaderVisible(true);
    setMobileBottomNavVisible(true);
  }, [workspaceSession.onboardingComplete, isMobileViewport]);

  useEffect(() => {
    if (!workspaceSession.onboardingComplete) return;
    if (isMobileViewport) {
      // Mobile UX requirement: no sticky-hide/reappear behavior for top elements.
      setHeaderVisible(true);
      setMobileBottomNavVisible(true);
      return;
    }

    let previousY = window.scrollY;
    let raf = 0;

    const updateHeaderVisibility = () => {
      const currentY = window.scrollY;
      const delta = currentY - previousY;

      if (Math.abs(delta) < 6) return;

      if (currentY <= 16) {
        setHeaderVisible(true);
        setMobileBottomNavVisible(true);
      } else if (delta > 0 && currentY > 72) {
        setHeaderVisible(false);
        setMobileBottomNavVisible(false);
        setProfileMenuOpen(false);
      } else if (delta < 0) {
        // Bottom nav may return quickly while scrolling up; header returns only near the top
        // to avoid overlaying content mid-read on mobile.
        setMobileBottomNavVisible(true);
        if (currentY <= 120) {
          setHeaderVisible(true);
        } else {
          setHeaderVisible(false);
        }
      }

      previousY = currentY;
    };

    const onScroll = () => {
      if (raf) return;
      raf = window.requestAnimationFrame(() => {
        updateHeaderVisibility();
        raf = 0;
      });
    };

    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      if (raf) window.cancelAnimationFrame(raf);
    };
  }, [workspaceSession.onboardingComplete, isMobileViewport]);

  const visibleTabs = tabCatalog.filter((t) => capabilities.visibleTabs.includes(t.key));
  const mobileBottomTabs = visibleTabs.filter((t) =>
    ["home", "scan", "create", "timeline", "verify"].includes(t.key),
  );
  const mobileBottomNavShown = isMobileViewport
    ? true
    : mobileBottomNavVisible || mobileNavOpen || profileMenuOpen;

  return (
    <div
      className={
        workspaceSession.onboardingComplete
          ? `app-shell has-auth-header ${headerVisible ? "header-visible" : "header-hidden"} ${
              mobileBottomNavShown ? "bottomnav-visible" : "bottomnav-hidden"
            }`
          : "app-shell no-auth-header"
      }
    >
      {workspaceSession.onboardingComplete && (
      <header className={headerVisible ? "app-topbar" : "app-topbar is-hidden-on-scroll"}>
        <div className="topbar-left">
          <div className="brand-mark" aria-hidden>
            <span>A</span>
          </div>
          <button
            type="button"
            className="icon-btn mobile-only"
            aria-label="Open navigation menu"
            aria-expanded={mobileNavOpen}
            onClick={() => setMobileNavOpen((v) => !v)}
          >
            ☰
          </button>
          <div className="brand-block">
            <p className="eyebrow" style={{ marginBottom: 4 }}>
              ANT Traceability MVP
            </p>
            <strong className="topbar-title">
              {workspaceSession.onboardingComplete
                ? `${workspaceSession.organizationName} • ${personaLabel(workspaceSession.primaryPersona)}`
                : "Accedi con organizzazione, identità e ruolo"}
            </strong>
            <p className="field-hint" style={{ margin: "2px 0 0" }}>
              {envLabel} • IOTA {iotaNetwork}
              {workspaceSession.onboardingComplete && currentContextCode
                ? ` • Shipment ${currentContextCode}`
                : ""}
            </p>
          </div>
        </div>

        <div className="topbar-right">
          <div className="hero-chip-row desktop-only">
            <span className="code-pill">{workspaceSession.tenantId || "no-tenant"}</span>
            <span className="code-pill">{workspaceSession.authMode}</span>
          </div>
          <button
            type="button"
            className="profile-trigger"
            aria-label="Open profile menu"
            aria-expanded={profileMenuOpen}
            onClick={() => setProfileMenuOpen((v) => !v)}
          >
            <span className="profile-avatar" aria-hidden>
              {workspaceSession.identityLabel?.trim()?.[0]?.toUpperCase() ?? "A"}
            </span>
            <span className="desktop-only profile-label">
              {workspaceSession.identityLabel || "Profile"}
            </span>
          </button>
        </div>
      </header>
      )}

      {workspaceSession.onboardingComplete && profileMenuOpen && (
        <div className="profile-menu card">
          <h3 style={{ marginBottom: 8 }}>Profilo & Sessione</h3>
          <p className="muted" style={{ marginTop: 0 }}>
            {workspaceSession.identityLabel} • {personaLabel(workspaceSession.primaryPersona)}
          </p>
          <p className="field-hint">
            Org: <strong>{workspaceSession.organizationName}</strong>
            <br />
            Tenant: <strong>{workspaceSession.tenantId}</strong>
            <br />
            DID: <strong>{workspaceSession.actorDid || "—"}</strong>
            <br />
            Roles: <strong>{workspaceSession.rolesCsv || "—"}</strong>
            <br />
            Auth: <strong>{workspaceSession.authMode}</strong>
            <br />
            Org type: <strong>{organizationTypeLabel(workspaceSession.organizationType)}</strong>
          </p>
          <div className="actions">
            <button
              type="button"
              className="btn"
              onClick={() => {
                syncScanContextFromWorkspaceSession();
                setProfileMenuOpen(false);
              }}
            >
              Sync actor to Scan & Sign
            </button>
            <button
              type="button"
              className="btn"
              onClick={() => {
                resetWorkspaceOnboarding();
                setTab("home");
                setProfileMenuOpen(false);
              }}
            >
              Change access profile
            </button>
          </div>
        </div>
      )}

      {!workspaceSession.onboardingComplete ? (
        <main className="page-frame pre-auth-page-frame">
          <AccessLoginScreen
            onAccessGranted={() => {
              const next = deriveWorkspaceCapabilities(useShipmentStore.getState().workspaceSession);
              setTab(next.defaultTab);
              window.scrollTo({ top: 0, behavior: "auto" });
            }}
          />
        </main>
      ) : (
        <>
          <div
            className={mobileNavOpen ? "mobile-drawer-overlay is-open" : "mobile-drawer-overlay"}
            aria-hidden={!mobileNavOpen}
            onClick={() => setMobileNavOpen(false)}
          >
            <aside
              className={mobileNavOpen ? "mobile-drawer is-open" : "mobile-drawer"}
              onClick={(e) => e.stopPropagation()}
            >
              <div className="mobile-drawer-head">
                <div>
                  <p className="eyebrow" style={{ marginBottom: 4 }}>
                    Navigation
                  </p>
                  <strong>{workspaceSession.organizationName}</strong>
                  <p className="field-hint" style={{ margin: "4px 0 0" }}>
                    {personaLabel(workspaceSession.primaryPersona)}
                  </p>
                </div>
                <button
                  type="button"
                  className="icon-btn"
                  aria-label="Close navigation menu"
                  onClick={() => setMobileNavOpen(false)}
                >
                  ✕
                </button>
              </div>
              <div className="mobile-drawer-list">
                {visibleTabs.map((t) => (
                  <button
                    key={`drawer-${t.key}`}
                    type="button"
                    className={tab === t.key ? "tab is-active" : "tab"}
                    onClick={() => {
                      setTab(t.key);
                      setMobileNavOpen(false);
                    }}
                  >
                    <span>{t.label}</span>
                    <small>{t.description}</small>
                  </button>
                ))}
              </div>
            </aside>
          </div>

          <nav
            className={mobileNavOpen ? "tabs app-tabs is-mobile-open" : "tabs app-tabs"}
            aria-label="ANT pages"
          >
            {visibleTabs.map((t) => (
              <button
                key={t.key}
                type="button"
                className={tab === t.key ? "tab is-active" : "tab"}
                onClick={() => {
                  setTab(t.key);
                  setMobileNavOpen(false);
                }}
              >
                <span>{t.label}</span>
                <small>{t.description}</small>
              </button>
            ))}
          </nav>

          <main className="page-frame app-page-frame">
            <section hidden={tab !== "home"} aria-hidden={tab !== "home"}>
              <WorkspaceHomePage onNavigate={setTab} />
            </section>
            <section hidden={tab !== "create"} aria-hidden={tab !== "create"}>
              {capabilities.canCreateShipment ? (
                <CreateShipmentPage />
              ) : (
                <div className="card">
                  <h2>Create Shipment</h2>
                  <p className="error">
                    La persona attuale non ha accesso alla creazione shipment. Usa un profilo
                    `Producer operator` (oppure assegna un ruolo operatore adeguato).
                  </p>
                </div>
              )}
            </section>
            <section hidden={tab !== "scan"} aria-hidden={tab !== "scan"}>
              {capabilities.canScanSign ? (
                <ScanSignPage />
              ) : (
                <div className="card">
                  <h2>Scan & Sign</h2>
                  <p className="error">
                    Accesso non previsto per la persona attuale. Questa area è dedicata a carrier e
                    receiver operator.
                  </p>
                </div>
              )}
            </section>
            <section hidden={tab !== "timeline"} aria-hidden={tab !== "timeline"}>
              <TimelinePage />
            </section>
            <section hidden={tab !== "verify"} aria-hidden={tab !== "verify"}>
              <VerifyPage />
            </section>
            <section hidden={tab !== "admin"} aria-hidden={tab !== "admin"}>
              <AdminPage />
            </section>
          </main>

          <nav
            className={mobileBottomNavShown ? "mobile-bottom-nav" : "mobile-bottom-nav is-hidden-on-scroll"}
            aria-label="ANT quick navigation"
          >
            {mobileBottomTabs.slice(0, 5).map((t) => (
              <button
                key={`bottom-${t.key}`}
                type="button"
                className={tab === t.key ? "mobile-bottom-item is-active" : "mobile-bottom-item"}
                onClick={() => setTab(t.key)}
              >
                <span className="mobile-bottom-icon" aria-hidden>
                  {t.key === "home"
                    ? "⌂"
                    : t.key === "scan"
                      ? "◫"
                      : t.key === "create"
                        ? "+"
                        : t.key === "timeline"
                          ? "≋"
                          : "✓"}
                </span>
                <small>{t.label}</small>
              </button>
            ))}
            <button
              type="button"
              className={mobileNavOpen ? "mobile-bottom-item is-active" : "mobile-bottom-item"}
              aria-label="Open full menu"
              onClick={() => setMobileNavOpen((v) => !v)}
            >
              <span className="mobile-bottom-icon" aria-hidden>
                ☰
              </span>
              <small>Menu</small>
            </button>
          </nav>
        </>
      )}
    </div>
  );
}
