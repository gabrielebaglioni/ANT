import { ApiError } from "../api/client";

export function getErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 401) {
      return "Sessione non valida o scaduta. Verifica tenant/ruolo o autenticazione (OIDC/IOTA Identity).";
    }
    if (error.status === 400) {
      return `Dati non validi. Controlla i campi richiesti e il formato degli ID. (${error.message})`;
    }
    if (error.status === 403) {
      return `Operazione non autorizzata per l'operatore selezionato. (${error.message})`;
    }
    if (error.status === 404) {
      return `Shipment non trovata. Verifica il codice o il QR. (${error.message})`;
    }
    if (error.status === 409) {
      if (/blocked for operations/i.test(error.message)) {
        return "Spedizione bloccata per sicurezza/reconciliation. È richiesto intervento supervisor/admin prima di continuare.";
      }
      if (/provisioning is still in progress/i.test(error.message)) {
        return "La spedizione è stata creata ma l'oggetto on-chain non è ancora pronto. Attendi il completamento del provisioning.";
      }
      if (/provisioning failed/i.test(error.message)) {
        return "Provisioning on-chain fallito. Non eseguire operazioni: serve revisione supervisor/admin.";
      }
      return `Operazione non consentita nello stato attuale della spedizione. (${error.message})`;
    }
    if (error.status === 503) {
      return `Servizio temporaneamente non disponibile (IOTA/infra). L'evento non è stato finalizzato. Riprova.`;
    }
    return `${error.message} (HTTP ${error.status})`;
  }
  if (error instanceof Error) {
    return error.message;
  }
  return "Unknown error";
}
