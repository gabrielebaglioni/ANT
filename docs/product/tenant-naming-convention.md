# Tenant Naming Convention (ANT)

## Purpose
In ANT, `tenant_id` identifies the **shared workspace/network** (multi-entity operating space), not a single company.

- Tenant: network / consortium / shared traceability workspace
- Organization: single participant (producer, carrier, receiver, auditor, control tower)

## Recommended pattern

`tenant-<platform>-<network>[-<region>][-<vertical>]`

Rules:
- lowercase only
- use `-` as separator
- no spaces
- prefix must be `tenant-`

## Current development/demo tenant

`tenant-ant-multientity-network`

This is the canonical dev workspace used by:
- mock access profiles
- seeded dashboard dataset (`ANT-DEMO-*`)
- development auth fallback (`AUTH_DEV_DEFAULT_TENANT`)

## Examples (real projects)

- `tenant-ant-italy-fresh-chain`
- `tenant-ant-emea-cold-logistics`
- `tenant-ant-retail-hub`
- `tenant-ant-pharma-track-eu`

## Anti-patterns (avoid)

- `default`
- `demo`
- `greenfarm-only` (looks like a single organization, not a workspace)
- `Tenant ANT Network` (spaces / uppercase)

## Environment guidance

- Keep **environment** (`development`, `testnet`, `deploy`) outside the tenant ID.
- Use separate DB/env configs per environment.
- Reuse the same tenant naming convention across environments for the same business workspace.

