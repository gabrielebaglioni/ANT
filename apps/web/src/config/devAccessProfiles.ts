import { ANT_DEMO_MULTI_ENTITY_TENANT_ID } from "@ant/shared";
import type {
  OrganizationType,
  WorkspaceAuthMode,
  WorkspacePersona,
  WorkspaceSessionContext,
} from "../store/shipmentStore";

export interface DevAccessProfile {
  id: string;
  label: string;
  orgName: string;
  tenantId: string;
  organizationType: OrganizationType;
  persona: WorkspacePersona;
  identityLabel: string;
  subject: string;
  actorDid: string;
  rolesCsv: string;
  authMode: WorkspaceAuthMode;
  pin: string;
  notes: string[];
}

export const DEV_ACCESS_PROFILES: DevAccessProfile[] = [
  {
    id: "producer-marta",
    label: "Producer • Marta (operator)",
    orgName: "GreenFarm Producer Co.",
    tenantId: ANT_DEMO_MULTI_ENTITY_TENANT_ID,
    organizationType: "PRODUCER",
    persona: "PRODUCER_OPERATOR",
    identityLabel: "Marta Bianchi",
    subject: "dev-marta-producer",
    actorDid: "did:iota:producer-demo",
    rolesCsv: "operator",
    authMode: "dev_headers",
    pin: "111111",
    notes: [
      "Crea shipment e genera QR",
      "Prepara partecipanti e punti origine/destinazione",
      "Usa Verify per audit rapido",
    ],
  },
  {
    id: "carrier-luca",
    label: "Carrier • Luca (operator)",
    orgName: "TransitOne Carrier SpA",
    tenantId: ANT_DEMO_MULTI_ENTITY_TENANT_ID,
    organizationType: "CARRIER",
    persona: "CARRIER_OPERATOR",
    identityLabel: "Luca Verdi",
    subject: "dev-luca-carrier",
    actorDid: "did:iota:carrier-demo",
    rolesCsv: "operator",
    authMode: "dev_headers",
    pin: "222222",
    notes: [
      "Scansiona QR e firma handover OUT",
      "Vede stato custodia e blocchi di sicurezza",
      "Carica prove sigillo/documenti quando richiesti",
    ],
  },
  {
    id: "receiver-anna",
    label: "Warehouse • Anna (operator)",
    orgName: "Warehouse Hub North",
    tenantId: ANT_DEMO_MULTI_ENTITY_TENANT_ID,
    organizationType: "RECEIVER",
    persona: "RECEIVER_OPERATOR",
    identityLabel: "Anna Neri (Magazzino)",
    subject: "dev-anna-warehouse",
    actorDid: "did:iota:warehouse-demo",
    rolesCsv: "operator",
    authMode: "dev_headers",
    pin: "333333",
    notes: [
      "Prende in carico spedizioni in ingresso al magazzino",
      "Controlla condizioni e tempi massimi di stoccaggio",
      "Rilascia al corriere successivo tramite flow scan-first (dev)",
    ],
  },
  {
    id: "carrier-elena-2",
    label: "Carrier 2 • Elena (operator)",
    orgName: "TransitOne Carrier SpA",
    tenantId: ANT_DEMO_MULTI_ENTITY_TENANT_ID,
    organizationType: "CARRIER",
    persona: "CARRIER_OPERATOR",
    identityLabel: "Elena Blu",
    subject: "dev-elena-carrier-2",
    actorDid: "did:iota:carrier-2-demo",
    rolesCsv: "operator",
    authMode: "dev_headers",
    pin: "232323",
    notes: [
      "Secondo corriere per tratte successive",
      "Usa Scan con codice ANT per prendere in carico",
      "Verifica policy e deadline prima della consegna",
    ],
  },
  {
    id: "final-receiver-sofia",
    label: "Final Receiver • Sofia (operator)",
    orgName: "Store Finale / Punto Vendita",
    tenantId: ANT_DEMO_MULTI_ENTITY_TENANT_ID,
    organizationType: "RECEIVER",
    persona: "RECEIVER_OPERATOR",
    identityLabel: "Sofia Gialli",
    subject: "dev-sofia-final-receiver",
    actorDid: "did:iota:final-receiver-demo",
    rolesCsv: "operator",
    authMode: "dev_headers",
    pin: "666666",
    notes: [
      "Prende in carico il prodotto finale",
      "Può generare QR/label finale con storico passaggi e condizioni",
      "Può aprire issue se il prodotto arriva danneggiato",
    ],
  },
  {
    id: "supervisor-marco",
    label: "Supervisor • Marco (admin)",
    orgName: "ANT Control Tower",
    tenantId: ANT_DEMO_MULTI_ENTITY_TENANT_ID,
    organizationType: "MULTI_ENTITY",
    persona: "SUPERVISOR",
    identityLabel: "Marco Supervisore",
    subject: "dev-marco-supervisor",
    actorDid: "did:iota:supervisor-demo",
    rolesCsv: "supervisor,auditor",
    authMode: "dev_headers",
    pin: "444444",
    notes: [
      "Vede metriche ops/reconciliation",
      "Apre dispute o sospensioni tracciate",
      "Approva/esegue compensazioni con dual control flow",
    ],
  },
  {
    id: "auditor-giulia",
    label: "Auditor • Giulia (read-only)",
    orgName: "Compliance Audit Office",
    tenantId: ANT_DEMO_MULTI_ENTITY_TENANT_ID,
    organizationType: "AUDITOR",
    persona: "AUDITOR",
    identityLabel: "Giulia Audit",
    subject: "dev-giulia-auditor",
    actorDid: "did:iota:auditor-demo",
    rolesCsv: "auditor",
    authMode: "dev_headers",
    pin: "555555",
    notes: [
      "Consultazione verify/timeline",
      "Vede metriche controllo",
      "Nessuna write operativa",
    ],
  },
];

export function mapProfileToWorkspaceSession(
  current: WorkspaceSessionContext,
  profile: DevAccessProfile,
): WorkspaceSessionContext {
  return {
    ...current,
    authMode: profile.authMode,
    tenantId: profile.tenantId,
    organizationName: profile.orgName,
    organizationType: profile.organizationType,
    identityLabel: profile.identityLabel,
    subject: profile.subject,
    actorId: profile.actorDid,
    actorDid: profile.actorDid,
    rolesCsv: profile.rolesCsv,
    primaryPersona: profile.persona,
    onboardingComplete: true,
  };
}
