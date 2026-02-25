import { ANT_DEMO_MULTI_ENTITY_TENANT_ID, type CreateShipmentRequest } from "@ant/shared";
import { create } from "zustand";
import { persist } from "zustand/middleware";

export const defaultCreateShipmentDraft: CreateShipmentRequest = {
  trackingUnitType: "LOGISTIC_UNIT",
  trackingId: "urn:epc:id:sscc:1234567.0000000001",
  origin: {
    readPointId: "urn:epc:id:sgln:9521141.54321.0",
    bizLocationId: "urn:epc:id:sgln:9521141.54377.0",
    label: "Origin Dock",
  },
  destination: {
    readPointId: "urn:epc:id:sgln:9521141.11111.0",
    bizLocationId: "urn:epc:id:sgln:9521141.11111.0",
    label: "Receiver Dock",
  },
  slaHours: 24,
  maxDelayHours: 6,
  conditions: {
    sealRequired: false,
    routeOpenDynamic: true,
    routePlan: [
      {
        stepType: "CARRIER",
        actorDid: "did:iota:carrier-demo",
        label: "Trasporto iniziale",
      },
      {
        stepType: "FINAL_RECEIVER",
        actorDid: "did:iota:receiver-demo",
        label: "Hub / ricevente finale",
      },
    ],
  },
  participants: {
    producerDid: "did:iota:producer-demo",
    carrierDid: "did:iota:carrier-demo",
    receiverDid: "did:iota:receiver-demo",
  },
};

export interface ScanOperatorContext {
  actorDid: string;
  readPointId: string;
  bizLocationId: string;
}

export type WorkspaceAuthMode = "dev_headers" | "iota_identity_preview";
export type OrganizationType = "PRODUCER" | "CARRIER" | "RECEIVER" | "MULTI_ENTITY" | "AUDITOR";
export type WorkspacePersona =
  | "PRODUCER_OPERATOR"
  | "CARRIER_OPERATOR"
  | "RECEIVER_OPERATOR"
  | "SUPERVISOR"
  | "AUDITOR";

export interface WorkspaceSessionContext {
  authMode: WorkspaceAuthMode;
  tenantId: string;
  organizationName: string;
  organizationType: OrganizationType;
  identityLabel: string;
  subject: string;
  actorId: string;
  actorDid: string;
  rolesCsv: string;
  primaryPersona: WorkspacePersona;
  onboardingComplete: boolean;
}

export type WorkspaceSessionPreset =
  | "producer_operator"
  | "carrier_operator"
  | "receiver_operator"
  | "supervisor"
  | "auditor";

interface ShipmentUiState {
  activeShipmentCode: string;
  setActiveShipmentCode: (code: string) => void;
  clearActiveShipmentCode: () => void;
  sharedShipmentCodeInput: string;
  setSharedShipmentCodeInput: (code: string) => void;
  syncShipmentCodeEverywhere: (code: string) => void;
  lastCreatedShipmentCode: string | null;
  setLastCreatedShipmentCode: (code: string | null) => void;
  createShipmentDraft: CreateShipmentRequest;
  setCreateShipmentDraft: (draft: CreateShipmentRequest) => void;
  patchCreateShipmentDraft: <K extends keyof CreateShipmentRequest>(
    key: K,
    value: CreateShipmentRequest[K],
  ) => void;
  resetCreateShipmentDraft: () => void;
  createShipmentWizardStepIndex: number;
  setCreateShipmentWizardStepIndex: (stepIndex: number) => void;
  resetCreateShipmentWizardStepIndex: () => void;
  scanOperatorContext: ScanOperatorContext;
  setScanOperatorContext: (patch: Partial<ScanOperatorContext>) => void;
  workspaceSession: WorkspaceSessionContext;
  setWorkspaceSession: (patch: Partial<WorkspaceSessionContext>) => void;
  applyWorkspaceSessionPreset: (preset: WorkspaceSessionPreset) => void;
  completeWorkspaceOnboarding: () => void;
  resetWorkspaceOnboarding: () => void;
  lastAccessProfileId: string | null;
  setLastAccessProfileId: (id: string | null) => void;
  syncScanContextFromWorkspaceSession: () => void;
}

export const useShipmentStore = create<ShipmentUiState>()(
  persist(
    (set) => ({
      activeShipmentCode: "",
      setActiveShipmentCode: (code) => set({ activeShipmentCode: code }),
      clearActiveShipmentCode: () => set({ activeShipmentCode: "", sharedShipmentCodeInput: "" }),
      sharedShipmentCodeInput: "",
      setSharedShipmentCodeInput: (code) => set({ sharedShipmentCodeInput: code }),
      syncShipmentCodeEverywhere: (code) =>
        set({
          activeShipmentCode: code,
          sharedShipmentCodeInput: code,
        }),
      lastCreatedShipmentCode: null,
      setLastCreatedShipmentCode: (code) => set({ lastCreatedShipmentCode: code }),
      createShipmentDraft: defaultCreateShipmentDraft,
      setCreateShipmentDraft: (draft) => set({ createShipmentDraft: draft }),
      patchCreateShipmentDraft: (key, value) =>
        set((state) => ({
          createShipmentDraft: {
            ...state.createShipmentDraft,
            [key]: value,
          },
        })),
      resetCreateShipmentDraft: () => set({ createShipmentDraft: defaultCreateShipmentDraft }),
      createShipmentWizardStepIndex: 0,
      setCreateShipmentWizardStepIndex: (stepIndex) =>
        set({
          createShipmentWizardStepIndex: Number.isFinite(stepIndex)
            ? Math.max(0, Math.trunc(stepIndex))
            : 0,
        }),
      resetCreateShipmentWizardStepIndex: () => set({ createShipmentWizardStepIndex: 0 }),
      scanOperatorContext: {
        actorDid: "did:iota:carrier-demo",
        readPointId: "urn:epc:id:sgln:9521141.54321.0",
        bizLocationId: "urn:epc:id:sgln:9521141.54377.0",
      },
      setScanOperatorContext: (patch) =>
        set((state) => ({
          scanOperatorContext: { ...state.scanOperatorContext, ...patch },
        })),
      workspaceSession: {
        authMode: "dev_headers",
        tenantId: ANT_DEMO_MULTI_ENTITY_TENANT_ID,
        organizationName: "Demo Logistics Network",
        organizationType: "CARRIER",
        identityLabel: "Mario Rossi",
        subject: "dev-carrier-operator",
        actorId: "did:iota:carrier-demo",
        actorDid: "did:iota:carrier-demo",
        rolesCsv: "operator",
        primaryPersona: "CARRIER_OPERATOR",
        onboardingComplete: false,
      },
      setWorkspaceSession: (patch) =>
        set((state) => ({
          workspaceSession: { ...state.workspaceSession, ...patch },
        })),
      applyWorkspaceSessionPreset: (preset) =>
        set((state) => {
          const common = {
            authMode: "dev_headers" as const,
            tenantId: ANT_DEMO_MULTI_ENTITY_TENANT_ID,
          };
          if (preset === "producer_operator") {
            return {
              workspaceSession: {
                ...state.workspaceSession,
                ...common,
                organizationName: "Demo Producer Co.",
                organizationType: "PRODUCER" as const,
                identityLabel: "Production Planner",
                subject: "dev-producer-operator",
                actorId: "did:iota:producer-demo",
                actorDid: "did:iota:producer-demo",
                rolesCsv: "operator",
                primaryPersona: "PRODUCER_OPERATOR" as const,
              },
            };
          }
          if (preset === "carrier_operator") {
            return {
              workspaceSession: {
                ...state.workspaceSession,
                ...common,
                organizationName: "Demo Carrier SpA",
                organizationType: "CARRIER" as const,
                identityLabel: "Carrier Operator",
                subject: "dev-carrier-operator",
                actorId: "did:iota:carrier-demo",
                actorDid: "did:iota:carrier-demo",
                rolesCsv: "operator",
                primaryPersona: "CARRIER_OPERATOR" as const,
              },
              scanOperatorContext: {
                ...state.scanOperatorContext,
                actorDid: "did:iota:carrier-demo",
                readPointId: defaultCreateShipmentDraft.origin.readPointId,
                bizLocationId: defaultCreateShipmentDraft.origin.bizLocationId,
              },
            };
          }
          if (preset === "receiver_operator") {
            return {
              workspaceSession: {
                ...state.workspaceSession,
                ...common,
                organizationName: "Demo Receiver Hub",
                organizationType: "RECEIVER" as const,
                identityLabel: "Receiving Operator",
                subject: "dev-receiver-operator",
                actorId: "did:iota:receiver-demo",
                actorDid: "did:iota:receiver-demo",
                rolesCsv: "operator",
                primaryPersona: "RECEIVER_OPERATOR" as const,
              },
              scanOperatorContext: {
                ...state.scanOperatorContext,
                actorDid: "did:iota:receiver-demo",
                readPointId: defaultCreateShipmentDraft.destination.readPointId,
                bizLocationId: defaultCreateShipmentDraft.destination.bizLocationId,
              },
            };
          }
          if (preset === "supervisor") {
            return {
              workspaceSession: {
                ...state.workspaceSession,
                ...common,
                organizationName: "Demo Control Tower",
                organizationType: "MULTI_ENTITY" as const,
                identityLabel: "Operations Supervisor",
                subject: "dev-supervisor",
                actorId: "did:iota:supervisor-demo",
                actorDid: "did:iota:supervisor-demo",
                rolesCsv: "supervisor,auditor",
                primaryPersona: "SUPERVISOR" as const,
              },
            };
          }
          return {
            workspaceSession: {
              ...state.workspaceSession,
              ...common,
              organizationName: "Demo Audit Office",
              organizationType: "AUDITOR" as const,
              identityLabel: "Compliance Auditor",
              subject: "dev-auditor",
              actorId: "did:iota:auditor-demo",
              actorDid: "did:iota:auditor-demo",
              rolesCsv: "auditor",
              primaryPersona: "AUDITOR" as const,
            },
          };
        }),
      completeWorkspaceOnboarding: () =>
        set((state) => ({
          workspaceSession: {
            ...state.workspaceSession,
            onboardingComplete: true,
          },
        })),
      resetWorkspaceOnboarding: () =>
        set((state) => ({
          workspaceSession: {
            ...state.workspaceSession,
            onboardingComplete: false,
          },
        })),
      lastAccessProfileId: null,
      setLastAccessProfileId: (id) => set({ lastAccessProfileId: id }),
      syncScanContextFromWorkspaceSession: () =>
        set((state) => ({
          scanOperatorContext: {
            ...state.scanOperatorContext,
            actorDid: state.workspaceSession.actorDid || state.workspaceSession.actorId,
          },
        })),
    }),
    {
      name: "ant-ui-state-v3",
      partialize: (state) => ({
        activeShipmentCode: state.activeShipmentCode,
        sharedShipmentCodeInput: state.sharedShipmentCodeInput,
        lastCreatedShipmentCode: state.lastCreatedShipmentCode,
        createShipmentDraft: state.createShipmentDraft,
        createShipmentWizardStepIndex: state.createShipmentWizardStepIndex,
        scanOperatorContext: state.scanOperatorContext,
        workspaceSession: state.workspaceSession,
        lastAccessProfileId: state.lastAccessProfileId,
      }),
    },
  ),
);
