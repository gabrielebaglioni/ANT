import type {
  OrganizationType,
  WorkspacePersona,
  WorkspaceSessionContext,
} from "../store/shipmentStore";

export type AppTabKey = "home" | "create" | "scan" | "timeline" | "verify" | "admin";

export interface WorkspaceCapabilities {
  visibleTabs: AppTabKey[];
  defaultTab: AppTabKey;
  canCreateShipment: boolean;
  canScanSign: boolean;
  canViewTimeline: boolean;
  canVerify: boolean;
  canViewAdmin: boolean;
  canRequestAdminActions: boolean;
  canApproveAdminActions: boolean;
  canExecuteAdminActions: boolean;
  canViewOpsMetrics: boolean;
}

export function parseRolesCsv(rolesCsv: string): string[] {
  return rolesCsv
    .split(",")
    .map((r) => r.trim().toLowerCase())
    .filter(Boolean);
}

export function personaLabel(persona: WorkspacePersona): string {
  switch (persona) {
    case "PRODUCER_OPERATOR":
      return "Producer Operator";
    case "CARRIER_OPERATOR":
      return "Carrier Operator";
    case "RECEIVER_OPERATOR":
      return "Warehouse / Receiver Operator";
    case "SUPERVISOR":
      return "Supervisor";
    case "AUDITOR":
      return "Auditor";
  }
}

export function organizationTypeLabel(type: OrganizationType): string {
  switch (type) {
    case "PRODUCER":
      return "Producer / Shipper";
    case "CARRIER":
      return "Carrier / Logistics";
    case "RECEIVER":
      return "Warehouse / Receiver Hub";
    case "MULTI_ENTITY":
      return "Multi-Entity Control Tower";
    case "AUDITOR":
      return "Audit / Compliance";
  }
}

export function deriveWorkspaceCapabilities(session: WorkspaceSessionContext): WorkspaceCapabilities {
  const roles = new Set(parseRolesCsv(session.rolesCsv));
  const isSupervisor = session.primaryPersona === "SUPERVISOR" || roles.has("supervisor");
  const isAuditor = session.primaryPersona === "AUDITOR" || roles.has("auditor");
  const isOperator = roles.has("operator");

  const canCreateShipment =
    isOperator &&
    (session.primaryPersona === "PRODUCER_OPERATOR" ||
      session.organizationType === "PRODUCER" ||
      session.organizationType === "MULTI_ENTITY");
  const canScanSign =
    isOperator &&
    (session.primaryPersona === "CARRIER_OPERATOR" ||
      session.primaryPersona === "RECEIVER_OPERATOR" ||
      session.organizationType === "CARRIER" ||
      session.organizationType === "RECEIVER" ||
      session.organizationType === "MULTI_ENTITY");

  const canViewTimeline = true;
  const canVerify = true;
  const canViewAdmin = isSupervisor || isAuditor;
  const canViewOpsMetrics = isSupervisor || isAuditor;
  const canRequestAdminActions = isSupervisor;
  const canApproveAdminActions = isSupervisor;
  const canExecuteAdminActions = isSupervisor;

  const isScanFirstOperator =
    session.primaryPersona === "CARRIER_OPERATOR" || session.primaryPersona === "RECEIVER_OPERATOR";
  const visibleTabs: AppTabKey[] = isScanFirstOperator ? [] : ["home"];
  if (canCreateShipment) visibleTabs.push("create");
  if (canScanSign) visibleTabs.push("scan");
  if (canViewTimeline) visibleTabs.push("timeline");
  if (canVerify) visibleTabs.push("verify");
  if (canViewAdmin) visibleTabs.push("admin");

  let defaultTab: AppTabKey = "home";
  if (!session.onboardingComplete) defaultTab = "home";
  else if (session.primaryPersona === "CARRIER_OPERATOR" || session.primaryPersona === "RECEIVER_OPERATOR")
    defaultTab = "scan";
  else if (session.primaryPersona === "PRODUCER_OPERATOR") defaultTab = "create";
  else if (canViewAdmin) defaultTab = "admin";

  return {
    visibleTabs,
    defaultTab,
    canCreateShipment,
    canScanSign,
    canViewTimeline,
    canVerify,
    canViewAdmin,
    canRequestAdminActions,
    canApproveAdminActions,
    canExecuteAdminActions,
    canViewOpsMetrics,
  };
}

export interface WorkspaceHomeCard {
  title: string;
  description: string;
  actions: Array<{ label: string; tab: AppTabKey }>;
  checks: string[];
}

export function deriveWorkspaceHomeCards(
  session: WorkspaceSessionContext,
  capabilities: WorkspaceCapabilities,
): WorkspaceHomeCard[] {
  const cards: WorkspaceHomeCard[] = [];

  if (session.primaryPersona === "PRODUCER_OPERATOR") {
    cards.push({
      title: "Prepare & Create Shipment",
      description:
        "Crea il contenitore spedizione, genera QR e avvia il provisioning on-chain in modo sicuro (saga).",
      actions: [
        { label: "Create Shipment", tab: "create" },
        { label: "Verify QR / Audit", tab: "verify" },
      ],
      checks: [
        "Controlla producer/carrier/receiver DID",
        "Conferma origin/destination SGLN",
        "Non condividere dati sensibili nel QR",
      ],
    });
  }

  if (session.primaryPersona === "CARRIER_OPERATOR") {
    cards.push({
      title: "Field Handover OUT",
      description:
        "Scansiona QR, verifica stato/custodia, allega prove se richiesto e firma OUT. La custodia resta pending finché il ricevente non conferma.",
      actions: [
        { label: "Scan & Sign", tab: "scan" },
        { label: "Timeline", tab: "timeline" },
      ],
      checks: [
        "Actor DID deve corrispondere al custode corrente",
        "Verifica che la shipment non sia bloccata",
        "Carica prova sigillo se richiesta",
      ],
    });
  }

  if (session.primaryPersona === "RECEIVER_OPERATOR") {
    cards.push({
      title: "Confirm Handover IN",
      description:
        "Conferma la presa in carico solo quando il QR e la shipment corrispondono. La conferma IN chiude la disputa potenziale sul passaggio di custodia.",
      actions: [
        { label: "Scan & Sign", tab: "scan" },
        { label: "Verify", tab: "verify" },
      ],
      checks: [
        "Actor DID deve essere il receiver atteso",
        "Controlla integrità proof / stato",
        "Documenta eccezioni prima della conferma",
      ],
    });
  }

  if (capabilities.canViewAdmin) {
    cards.push({
      title: "Control Tower / Governance",
      description:
        "Monitora outbox, reconciliation e richieste di compensazione. Nessun rollback: solo azioni compensative con audit trail.",
      actions: [
        { label: "Admin Console", tab: "admin" },
        { label: "Timeline", tab: "timeline" },
      ],
      checks: [
        "Se mismatch: blocca operazioni e apri richiesta",
        "Dual control per approvazioni supervisor",
        "Verifica tenant prima di compensazioni",
      ],
    });
  }

  if (cards.length === 0) {
    cards.push({
      title: "Read-only Traceability",
      description: "Usa Timeline e Verify per consultazione e audit della spedizione.",
      actions: [
        { label: "Timeline", tab: "timeline" },
        { label: "Verify", tab: "verify" },
      ],
      checks: ["Controlla tenant corretto", "Usa shipment code/QR condiviso", "Escala a supervisor per modifiche"],
    });
  }

  return cards;
}
