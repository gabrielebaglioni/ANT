# ANT Testnet Cutover Checklist

## 1. Pre-check (development complete)

- UI flows validated with demo codes:
  - `ANT-DEMO-PEND1`
  - `ANT-DEMO-SLA1`
  - `ANT-DEMO-SEAL1`
  - `ANT-DEMO-OK1`
  - `ANT-DEMO-MISMATCH1`
- `POST /shipments` saga verified (`PROVISIONING -> ACTIVE`)
- reconciliation worker blocking logic verified
- admin compensation approval workflow verified in dev

## 2. Clean development demo data

- run `pnpm --filter @ant/api run seed:dev:clean`
- verify no `ANT-DEMO-*` shipments remain

## 3. Prepare testnet env (API)

Create `apps/api/.env.testnet` from `apps/api/.env.testnet.example` and set:

- OIDC:
  - `AUTH_MODE=oidc_jwt`
  - `AUTH_OIDC_ISSUER`
  - `AUTH_OIDC_AUDIENCE`
  - `AUTH_OIDC_JWKS_URL`
- IOTA:
  - `IOTA_NETWORK=testnet`
  - `IOTA_MODE=relay` (recommended)
  - `IOTA_KEY_SOURCE=relay_kms` or `relay_hsm`
  - `IOTA_TESTNET_TX_RELAY_URL`
  - `IOTA_TESTNET_NOTARIZATION_RELAY_URL`
  - `IOTA_TESTNET_PACKAGE_ID`
  - `IOTA_DID_ADDRESS_MAP_JSON`
- Ops:
  - `ALERT_WEBHOOK_URL`
  - `AUDIT_WORM_ARCHIVE_URL`

## 4. Prepare testnet env (Web)

Create `apps/web/.env.testnet` from `apps/web/.env.testnet.example` and set:

- `VITE_API_BASE_URL`
- `VITE_IOTA_NETWORK=testnet`
- OIDC client-side values (if/when frontend login is enabled)

## 5. DB migrations

Apply all migrations in order, including:

- `006_enterprise_security_controls.sql`

## 6. Testnet smoke tests

- Create shipment (observe `PROVISIONING`)
- Wait for `ACTIVE`
- Create OUT event
- Confirm proof + Move update reaches `FINALIZED`
- Verify timeline and verify page
- Force a mismatch in non-prod scenario and validate security hold

