import { useEffect, useRef, useState } from "react";
import { parseShipmentQr, parseShipmentQrDetails } from "../epcis/qr";

interface ScannerProps {
  onDetected: (shipmentCode: string) => void;
}

export function Scanner({ onDetected }: ScannerProps) {
  const [raw, setRaw] = useState("");
  const [error, setError] = useState("");
  const [cameraError, setCameraError] = useState("");
  const [cameraBusy, setCameraBusy] = useState(false);
  const [cameraOn, setCameraOn] = useState(false);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const controlsRef = useRef<{ stop?: () => void } | null>(null);
  const lastDetectedRef = useRef<string>("");

  const submit = () => {
    const code = parseShipmentQr(raw);
    if (!code) {
      const details = parseShipmentQrDetails(raw);
      if (details && details.checksum && details.checksumValid === false) {
        setError("QR checksum mismatch. Possibile errore di lettura/incolla: ripeti la scansione.");
      } else {
        setError("Invalid QR payload. Expected ant://shipment/ANT-XXXX (anche v=1&chk=...).");
      }
      return;
    }
    setError("");
    onDetected(code);
  };

  const stopCamera = () => {
    controlsRef.current?.stop?.();
    controlsRef.current = null;
    setCameraOn(false);
  };

  const startCamera = async () => {
    if (!videoRef.current) return;
    setCameraBusy(true);
    setCameraError("");
    try {
      const zxing = (await import("@zxing/browser")) as any;
      const ReaderCtor = zxing.BrowserMultiFormatReader;
      if (!ReaderCtor) throw new Error("BrowserMultiFormatReader not available");
      const reader = new ReaderCtor();

      const controls = await (reader.decodeFromVideoDevice
        ? reader.decodeFromVideoDevice(undefined, videoRef.current, (result: any, err: any) => {
            if (result) {
              const text = typeof result.getText === "function" ? result.getText() : String(result);
              setRaw(text);
              const code = parseShipmentQr(text);
              if (code) {
                if (lastDetectedRef.current !== code) {
                  lastDetectedRef.current = code;
                  onDetected(code);
                }
                stopCamera();
              }
            } else if (err && err.name && err.name !== "NotFoundException") {
              setCameraError(String(err.message ?? err.name));
            }
          })
        : reader.decodeOnceFromVideoDevice(undefined, videoRef.current));

      // decodeOnce returns result, decodeFromVideoDevice returns controls
      if (controls && typeof controls.stop === "function") {
        controlsRef.current = controls;
        setCameraOn(true);
      } else if (controls) {
        const text =
          typeof controls.getText === "function" ? controls.getText() : String(controls);
        setRaw(text);
        const code = parseShipmentQr(text);
        if (code) onDetected(code);
      }
    } catch (e) {
      setCameraError(e instanceof Error ? e.message : "Unable to start camera");
    } finally {
      setCameraBusy(false);
    }
  };

  useEffect(() => {
    return () => {
      stopCamera();
    };
  }, []);

  return (
    <div className="scanner-box">
      <div>
        <strong>Scan QR</strong>
        <p className="muted" style={{ margin: "4px 0 0" }}>
          Camera scan via `@zxing/browser` with manual fallback for environments without camera
          permissions.
        </p>
      </div>
      <video ref={videoRef} className="camera-preview" muted playsInline />
      {(cameraError || error) && <p className="error">{cameraError || error}</p>}
      <div className="actions">
        {!cameraOn ? (
          <button
            type="button"
            className="btn"
            onClick={() => void startCamera()}
            disabled={cameraBusy}
          >
            {cameraBusy ? "Starting camera..." : "Start camera scan"}
          </button>
        ) : (
          <button type="button" className="btn" onClick={stopCamera}>
            Stop camera
          </button>
        )}
      </div>
      <div className="field">
        <label htmlFor="scanner-input">QR payload or shipment code</label>
        <input
          id="scanner-input"
          placeholder="ant://shipment/ANT-8F2A"
          value={raw}
          onChange={(e) => setRaw(e.target.value)}
        />
      </div>
      <div className="actions">
        <button type="button" className="btn primary" onClick={submit}>
          Load shipment
        </button>
        {raw && (
          <button
            type="button"
            className="btn"
            onClick={() => {
              setRaw("");
              setError("");
            }}
          >
            Clear
          </button>
        )}
      </div>
    </div>
  );
}
