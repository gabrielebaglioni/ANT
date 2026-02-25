import type { CreateShipmentResponse } from "@ant/shared";
import { QRCodeView } from "../../components/QRCodeView";

interface Props {
  result: CreateShipmentResponse;
  shipmentDisplayName: string;
  shipmentTitle: string;
  onCreateAnother?: () => void;
}

export function CreateShipmentSuccess({
  result,
  shipmentDisplayName,
  shipmentTitle,
  onCreateAnother,
}: Props) {
  return (
    <div className="panel-grid">
      <div className="card create-success-hero">
        <div className="create-success-header">
          <div>
            <p className="field-hint" style={{ marginTop: 0 }}>Shipment creata con successo</p>
            <h2 style={{ marginTop: 4 }}>{result.shipmentCode}</h2>
            <p className="muted" style={{ marginTop: -4 }}>
              {shipmentTitle} • {shipmentDisplayName}
            </p>
          </div>
          {onCreateAnother && (
            <button type="button" className="btn" onClick={onCreateAnother}>
              Crea un&apos;altra shipment
            </button>
          )}
        </div>
        <p>
          Codice spedizione: <span className="code-pill">{result.shipmentCode}</span>
        </p>
        <p className="muted">
          Stato provisioning chain: <strong>{result.provisioning.status}</strong>
          <br />
          {result.provisioning.message}
        </p>
        <p className="muted">ID oggetto on-chain (Move): {result.moveObjectId ?? "pending..."}</p>
        {result.provisioning.status === "ACTIVE" ? (
          <p className="success">
            Shipment pronta anche on-chain. Ora puoi usare `Scan & Sign`, `Timeline` e `Verify`.
          </p>
        ) : (
          <p className="muted">
            QR pronto subito. Se la chain è lenta, usa `Timeline/Verify` o aggiorna stato prima di
            operazioni critiche.
          </p>
        )}
        <p className="field-hint">
          Il QR contiene solo riferimento shipment (`shipmentCode`) + versione schema + checksum
          anti-errore. Integrità e timestamp restano garantiti dalle proof notarizzate su IOTA.
        </p>
      </div>
      <QRCodeView
        value={result.qrPayload}
        title={result.shipmentCode}
        subtitle={shipmentDisplayName}
        downloadFileName={`ANT_${result.shipmentCode}_${shipmentTitle}`}
      />
    </div>
  );
}
