import { useMemo, useState } from "react";
import { uploadAttachment, type UploadedAttachment } from "../api/attachments";
import { getErrorMessage } from "../utils/errors";

interface AttachmentUploaderProps {
  value: string[];
  onChange: (sha256List: string[]) => void;
}

export function AttachmentUploader({ value, onChange }: AttachmentUploaderProps) {
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [type, setType] = useState("PHOTO_SEAL");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [uploaded, setUploaded] = useState<UploadedAttachment[]>([]);

  const uploadedHashes = useMemo(() => new Set(uploaded.map((u) => u.sha256)), [uploaded]);

  const onUpload = async () => {
    if (!selectedFile) return;
    setBusy(true);
    setError("");
    try {
      const res = await uploadAttachment(selectedFile, type);
      setUploaded((prev) => {
        if (prev.some((p) => p.sha256 === res.sha256)) return prev;
        return [res, ...prev];
      });
      if (!value.includes(res.sha256)) onChange([...value, res.sha256]);
      setSelectedFile(null);
    } catch (e) {
      setError(getErrorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const removeHash = (hash: string) => {
    onChange(value.filter((h) => h !== hash));
  };

  return (
    <div className="card">
      <h3>Attachments (Seal photo / docs)</h3>
      <p className="muted">
        Upload files first, then handover endpoints include only SHA-256 references.
      </p>
      <div className="form-grid two">
        <div className="field">
          <label>Attachment type</label>
          <select value={type} onChange={(e) => setType(e.target.value)}>
            <option value="PHOTO_SEAL">PHOTO_SEAL</option>
            <option value="PDF_DOC">PDF_DOC</option>
            <option value="SENSOR_FILE">SENSOR_FILE</option>
          </select>
        </div>
        <div className="field">
          <label>File</label>
          <input
            type="file"
            onChange={(e) => setSelectedFile(e.target.files?.[0] ?? null)}
            accept="image/*,.pdf,.csv,.txt,.json"
          />
        </div>
      </div>
      <div className="actions">
        <button
          type="button"
          className="btn"
          disabled={!selectedFile || busy}
          onClick={() => void onUpload()}
        >
          {busy ? "Uploading..." : "Upload attachment"}
        </button>
      </div>
      {error && <p className="error">{error}</p>}

      <div className="upload-list">
        {value.length === 0 && <p className="muted">No attachment references selected.</p>}
        {value.map((hash) => {
          const item = uploaded.find((u) => u.sha256 === hash);
          return (
            <div key={hash} className="upload-item">
              <div>
                <strong>{item?.type ?? "ATTACHMENT"}</strong>
                <div className="muted">{hash}</div>
                {item?.downloadUrl && (
                  <a href={item.downloadUrl} target="_blank" rel="noreferrer">
                    Preview
                  </a>
                )}
              </div>
              <button type="button" className="btn" onClick={() => removeHash(hash)}>
                Remove
              </button>
            </div>
          );
        })}
      </div>

      {uploaded.length > 0 && (
        <details>
          <summary>Uploaded cache ({uploaded.length})</summary>
          <ul>
            {uploaded.map((u) => (
              <li key={u.sha256}>
                {u.type} • {u.sizeBytes} bytes • {uploadedHashes.has(u.sha256) ? "ready" : "—"}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
