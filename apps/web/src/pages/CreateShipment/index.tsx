import { useState } from "react";
import type { CreateShipmentResponse } from "@ant/shared";
import { useShipmentStore } from "../../store/shipmentStore";
import { CreateShipmentForm } from "./CreateShipmentForm";
import { CreateShipmentSuccess } from "./CreateShipmentSuccess";

export function CreateShipmentPage() {
  const [result, setResult] = useState<{
    response: CreateShipmentResponse;
    shipmentDisplayName: string;
    shipmentTitle: string;
  } | null>(null);
  const syncShipmentCodeEverywhere = useShipmentStore((s) => s.syncShipmentCodeEverywhere);
  const setLastCreatedShipmentCode = useShipmentStore((s) => s.setLastCreatedShipmentCode);
  const resetCreateShipmentWizardStepIndex = useShipmentStore(
    (s) => s.resetCreateShipmentWizardStepIndex,
  );

  return (
    <div className="panel-grid">
      {result ? (
        <CreateShipmentSuccess
          result={result.response}
          shipmentDisplayName={result.shipmentDisplayName}
          shipmentTitle={result.shipmentTitle}
          onCreateAnother={() => {
            resetCreateShipmentWizardStepIndex();
            setResult(null);
          }}
        />
      ) : (
        <CreateShipmentForm
          onCreated={(res, meta) => {
            setResult({
              response: res,
              shipmentDisplayName: meta.shipmentDisplayName,
              shipmentTitle: meta.shipmentTitle,
            });
            syncShipmentCodeEverywhere(res.shipmentCode);
            setLastCreatedShipmentCode(res.shipmentCode);
          }}
        />
      )}
    </div>
  );
}
