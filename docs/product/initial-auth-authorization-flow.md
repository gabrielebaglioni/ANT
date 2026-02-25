# ANT Initial Auth & Authorization Flow (Multi-Entity / IOTA-First)

## Goal

ANT deve essere usato da enti diversi (producer, carrier, receiver, auditor) senza fiducia implicita reciproca.
La UX iniziale deve quindi rendere chiari, prima di ogni operazione:

- `chi` sta operando (identità)
- `per conto di quale ente` (tenant / organization)
- `con quale ruolo` (authorization)
- `su quale shipment` (context)

## Current Development Mode (implemented)

In development ANT usa una **Workspace Session** visibile in UI che alimenta le chiamate API con header `x-ant-*`:

- `x-ant-tenant-id`
- `x-ant-role`
- `x-ant-actor-id`
- `x-ant-sub`

Questo permette di testare già:

- tenant scoping
- RBAC
- errori di autorizzazione
- leggibilità dei blocchi operativi

senza valori reali OIDC/IOTA.

## Future Testnet / Production Mode (target)

### Authentication (who are you?)

1. Utente apre ANT
2. Login via OIDC (IAM aziendale)
3. Sessione applicativa riceve token JWT
4. Backend valida JWT via JWKS (`issuer`, `audience`, `exp`)
5. Backend estrae `tenant` + `roles`

### IOTA Identity / Wallet binding (which on-chain identity?)

Dopo il login OIDC:

1. Utente collega wallet/IOTA Identity
2. ANT verifica challenge firmata
3. ANT associa `OIDC subject -> DID/address` (tenant-scoped)
4. Le operazioni che implicano custodia usano quel DID come attore EPCIS / Move

Nota:
- OIDC = identità enterprise e governance
- IOTA DID/address = identità operativa/on-chain verificabile
- Le due identità vanno collegate ma non confuse

## Authorization model (minimum enterprise)

Ruoli applicativi:

- `operator`: create shipment, handover OUT/IN, upload evidenze
- `supervisor`: approva compensazioni/dispute, sblocchi controllati
- `auditor`: read-only verify/timeline/ops evidence
- `service`: worker/integrazioni macchina-macchina

Regole:

- Tutte le query e write sono `tenant-scoped`
- Le azioni admin sensibili richiedono `supervisor` + dual control
- Le operazioni di custodia verificano sia ruolo sia coerenza DID/custodia attesa

## UI entry flow (recommended)

Quando l'app si apre:

1. **Workspace Session panel**
   - tenant
   - ruolo/i
   - actor DID
   - modalità auth (dev now, OIDC/IOTA later)
2. **Shipment context shared**
   - codice shipment condiviso tra tab (`Scan`, `Timeline`, `Verify`)
3. **Action tabs**
   - `Create Shipment`
   - `Scan & Sign`
   - `Timeline`
   - `Verify`

Questo riduce errori da:

- ruolo sbagliato
- tenant sbagliato
- DID non allineato
- incolla codice su tab diversi

## QR payload design (privacy-safe)

Il QR **non** deve contenere payload sensibili.

Payload raccomandato (implementato):

- `ant://shipment/<shipmentCode>?v=1&chk=<checksum>`

Dove:

- `shipmentCode` = riferimento pubblico minimo
- `v` = versione schema QR (evoluzione compatibile)
- `chk` = checksum anti-errore (scansione/incolla), non sostituisce notarization

Integrità reale e timestamp:

- proof notarizzate su IOTA
- hash EPCIS deterministico

## Problem readability (operator vs admin)

Ogni problema deve avere due livelli:

1. **Linguaggio operativo (operator-friendly)**
   - cosa significa
   - cosa fare adesso
2. **Dettaglio tecnico (admin/support/audit)**
   - codice stato
   - timestamp
   - reconciliation / block reason

Esempi:

- `MISSING_RECEIVER_CONFIRMATION`
  - Operatore: "Manca la conferma del ricevente"
  - Admin: "Verifica DID ricevente atteso / tenant / ruoli"

- `SLA_BREACH`
  - Operatore: "Nessun evento da troppo tempo"
  - Admin: "Controlla integrazione partner / outbox / auth failures"

- `CONDITION_VIOLATION`
  - Operatore: "Manca evidenza richiesta (es. sigillo)"
  - Admin: "Valuta sospensione/disputa e raccolta evidenze"

## Security invariants (must never break)

- Nessun payload sensibile nel QR
- Nessuna write operativa se shipment `blocked`
- Nessuna create/handover senza `Idempotency-Key`
- Nessun accesso cross-tenant
- Nessuna compensazione admin senza audit trail (e, in prod, approvazione)
- Nessuna chiave privata IOTA in `.env` di produzione

