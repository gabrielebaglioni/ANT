import { useEffect, useState } from "react";
import QRCode from "qrcode";
import { parseShipmentQr, parseShipmentQrDetails } from "../epcis/qr";

interface QRCodeViewProps {
  value: string;
  title?: string;
  subtitle?: string;
  downloadFileName?: string;
  payloadHint?: string;
}

export function QRCodeView({
  value,
  title,
  subtitle,
  downloadFileName,
  payloadHint,
}: QRCodeViewProps) {
  const [dataUrl, setDataUrl] = useState<string>("");
  const [error, setError] = useState<string>("");
  const shipmentCode = parseShipmentQr(value) ?? value;
  const qrDetails = parseShipmentQrDetails(value);

  useEffect(() => {
    let cancelled = false;
    QRCode.toDataURL(value, {
      margin: 3,
      width: 360,
      errorCorrectionLevel: "Q",
      color: {
        dark: "#111111",
        light: "#FFFFFF",
      },
    })
      .then((url: string) => {
        if (!cancelled) {
          setDataUrl(url);
          setError("");
        }
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : "QR generation failed");
      });
    return () => {
      cancelled = true;
    };
  }, [value]);

  const handleDownload = async () => {
    if (!dataUrl) return;
    const safeCode = shipmentCode.replace(/[^A-Za-z0-9_-]/g, "_");
    const safeFileName = (downloadFileName ?? `ant-shipment-qr-${safeCode}`)
      .replace(/[^A-Za-z0-9._-]/g, "_")
      .replace(/_+/g, "_");

    try {
      const img = await loadImage(dataUrl);
      const canvas = document.createElement("canvas");
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("Canvas not available");

      const cardWidth = 760;
      const padding = 36;
      const qrSize = 420;
      const topMetaHeight = 120;
      const footerHeight = 70;
      canvas.width = cardWidth;
      canvas.height = topMetaHeight + qrSize + footerHeight + padding * 2;

      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      // Header title/subtitle
      ctx.fillStyle = "#111111";
      ctx.font = "bold 34px -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
      ctx.fillText(title || shipmentCode, padding, 54);

      ctx.fillStyle = "#475569";
      ctx.font = "20px -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
      ctx.fillText(subtitle || "ANT shipment QR", padding, 88);

      // QR area
      const qrX = Math.round((canvas.width - qrSize) / 2);
      const qrY = topMetaHeight + padding;
      ctx.fillStyle = "#f8fafc";
      roundRect(ctx, qrX - 14, qrY - 14, qrSize + 28, qrSize + 28, 18);
      ctx.fill();
      ctx.drawImage(img, qrX, qrY, qrSize, qrSize);

      // Footer meta
      const footerY = qrY + qrSize + 38;
      ctx.fillStyle = "#111111";
      ctx.font = "bold 22px -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
      ctx.fillText("ANT Traceability QR", padding, footerY);
      ctx.fillStyle = "#64748b";
      ctx.font = "16px -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
      ctx.fillText(`Code: ${shipmentCode}`, padding, footerY + 28);

      const exportUrl = canvas.toDataURL("image/png");
      const a = document.createElement("a");
      a.href = exportUrl;
      a.download = `${safeFileName}.png`;
      a.click();
    } catch {
      const a = document.createElement("a");
      a.href = dataUrl;
      a.download = `${safeFileName}.png`;
      a.click();
    }
  };

  return (
    <div className="card">
      <h3>{title ? `QR Code • ${title}` : "QR Code"}</h3>
      {subtitle && <p className="field-hint" style={{ marginTop: -4 }}>{subtitle}</p>}
      <p>
        Shipment code: <span className="code-pill">{shipmentCode}</span>
      </p>
      <p className="muted">
        Payload encoded: {value}
        <br />
        {payloadHint ??
          "Contiene solo riferimento spedizione (no dati sensibili), versione schema QR e checksum anti-errore di scansione/incolla."}
      </p>
      {qrDetails && (
        <p className="field-hint">
          QR version: <strong>{qrDetails.version ?? "legacy"}</strong> • checksum:{" "}
          <strong>{qrDetails.checksum ?? "—"}</strong>
          {qrDetails.checksumValid === false ? " (checksum mismatch)" : ""}
        </p>
      )}
      {error && <p className="error">{error}</p>}
      {dataUrl ? (
        <>
          <img
            src={dataUrl}
            alt={`QR code for shipment ${shipmentCode}`}
            width={260}
            height={260}
            style={{ imageRendering: "pixelated", background: "#fff", borderRadius: 12 }}
          />
          <div className="actions" style={{ marginTop: 10 }}>
            <button type="button" className="btn" onClick={handleDownload}>
              Download PNG (titolo + QR)
            </button>
          </div>
        </>
      ) : (
        <p className="muted">Generating QR...</p>
      )}
    </div>
  );
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
) {
  const r = Math.min(radius, width / 2, height / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + width, y, x + width, y + height, r);
  ctx.arcTo(x + width, y + height, x, y + height, r);
  ctx.arcTo(x, y + height, x, y, r);
  ctx.arcTo(x, y, x + width, y, r);
  ctx.closePath();
}
