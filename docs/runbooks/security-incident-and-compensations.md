# ANT Security Incident + Compensation Runbook

## Scope

Use this runbook for:

- reconciliation mismatches (`PROOF_MISMATCH`, `CHAIN_STATE_MISMATCH`)
- outbox failures affecting notarization/Move updates
- suspected operator misuse / disputed custody
- admin compensations (`OPEN_DISPUTE`, `SUSPEND`, `CORRECTIVE_HANDOVER`)

## Roles (minimum)

- `operator`: operational shipment actions only
- `supervisor`: can request, approve, execute compensations (dual control enforced)
- `auditor`: read-only access to verify/timeline/audit/ops metrics

## Detection and Triage

1. Check `/ops/metrics` for outbox lag, retries, open critical reconciliation alerts.
2. Inspect `GET /shipments/:code/state` for:
   - `operationsBlocked=true`
   - `blockReason`
   - `reconciliationStatus`
3. Inspect `GET /verify/:code` and `GET /shipments/:code/timeline`.
4. Confirm if issue is:
   - off-chain data/proof mismatch
   - on-chain Move state mismatch
   - operational delay only (no integrity issue)

## Immediate Containment

1. If integrity is unclear, request `SUSPEND` or `OPEN_DISPUTE`.
2. Do not allow further handover events while `operationsBlocked=true`.
3. Preserve evidence:
   - event payload hashes
   - proof records (notarization object id, tx digest)
   - Move object snapshot
   - audit log entries

## Admin Compensation Workflow (Dual Control)

1. Supervisor A creates request:
   - `POST /admin/shipments/:code/{action}/request`
2. Supervisor B approves:
   - `POST /admin/action-requests/:id/approve`
3. Supervisor B (or authorized supervisor) executes:
   - `POST /admin/action-requests/:id/execute`

Rules:

- requester and approver must be different supervisors
- every step writes `audit_log`
- direct execution endpoints should be disabled in production (`ADMIN_COMPENSATION_REQUIRE_APPROVAL=true`)

## Corrective Actions (Compensation, not rollback)

- Wrong notarization/proof:
  - create corrective EPCIS event referencing previous event (`previous_event_id` / custom extension ref)
  - keep original immutable record for auditability
- Wrong Move custody state:
  - `OPEN_DISPUTE` if investigation needed
  - `CORRECTIVE_HANDOVER` only after evidence review and supervisor approval

## Recovery Validation

1. Re-run reconciliation (automatic worker or manual trigger if available).
2. Confirm:
   - `reconciliationStatus=OK`
   - `operationsBlocked=false` (if issue resolved)
   - verify page shows expected proof status
3. Review audit trail completeness:
   - request -> approve -> execute -> reconcile

## Escalation Criteria

Escalate to platform/security leadership if any of these occur:

- repeated mismatches for same tenant or carrier
- outbox retries persist > 30 minutes
- unexpected admin compensation volume
- suspected key compromise / signer compromise
- WORM audit mirror unavailable in deploy

## Production Controls Checklist

- `AUTH_MODE=oidc_jwt`
- `ADMIN_COMPENSATION_REQUIRE_APPROVAL=true`
- `IOTA_MODE=relay`
- `IOTA_KEY_SOURCE=relay_kms` or `relay_hsm`
- `AUDIT_WORM_REQUIRED_IN_DEPLOY=true`
- monitoring webhook configured (`ALERT_WEBHOOK_URL`)

