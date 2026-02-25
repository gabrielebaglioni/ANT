# ANT

ANT is a lightweight traceability MVP for small and mid-sized supply chains.

Core design goals:
- Keep sensitive EPCIS 2.0 event payloads off-chain.
- Anchor tamper-evident proofs on IOTA (notarization).
- Enforce custody transitions on-chain with a minimal Move smart contract.
- Stay commodity-agnostic, with room for future IoT condition monitoring.

This repository now contains a scaffolded monorepo aligned to the architecture blueprint:
- `apps/web`: React + TypeScript frontend skeleton
- `apps/api`: Fastify + TypeScript backend skeleton
- `packages/shared`: EPCIS schemas, DTOs, hashing utilities
- `infra/migrations`: Postgres migration(s)
- `move/ant_core`: IOTA Move package for shipment custody state

## Quick start (scaffold)

1. Install dependencies with your package manager (`pnpm` recommended).
2. Run the API and web apps in separate terminals.
3. Configure `.env` profiles (runtime + IOTA network), start Postgres/MinIO, and run migrations.

## Environment Matrix (Configured)

API env templates (`/Users/gabrielebaglioni/ANT/apps/api`):
- `.env.development.example`
- `.env.deploy.example`
- `.env.iota.testnet.example`
- `.env.iota.mainnet.example`

Web env templates (`/Users/gabrielebaglioni/ANT/apps/web`):
- `.env.development.example`
- `.env.production.example`
- `.env.iota.testnet.example`
- `.env.iota.mainnet.example`

Use one runtime profile + one IOTA profile, then merge/copy into `.env`.

DB parity rule (dev/deploy):
- Same variable names (`DATABASE_URL`, `PGSSL`, etc.)
- Same SQL migrations (`infra/migrations/*.sql`)
- Only values/credentials/hosts differ, not schema shape

IOTA profiles:
- `IOTA_NETWORK=testnet` for pre-production/testing
- `IOTA_NETWORK=mainnet` for real/production
- `IOTA_MODE=relay` (recommended) or `sdk`
- Local fallback stubs only with `IOTA_ALLOW_STUBS=true`

## Current status

This is an MVP scaffold with:
- EPCIS subset validation (`ObjectEvent`, `AggregationEvent`)
- Deterministic JSON canonicalization + SHA-256 hashing
- Backend endpoint structure and convenience handover builders
- Frontend page/component structure for Create / Scan / Timeline / Verify
- SQL schema migration and Move contract/tests
