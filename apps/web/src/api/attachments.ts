import { apiFetch } from "./client";

export interface UploadedAttachment {
  sha256: string;
  objectStoreKey: string;
  type: string;
  mime: string | null;
  sizeBytes: number;
  downloadUrl: string | null;
}

export async function uploadAttachment(file: File, type = "PHOTO_SEAL") {
  const formData = new FormData();
  formData.append("file", file);
  formData.append("type", type);
  return apiFetch<UploadedAttachment>("/attachments/upload", {
    method: "POST",
    body: formData,
  });
}
