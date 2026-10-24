# Operational monitoring and replay (#35)

Authenticated operators use `get_operational_health` and
`inspect_operational_jobs` through the registered app actions. Inspection is
restricted to current brand-wide owners/auditors. Keyset pagination uses
`kind + ':' + job_id` as `after_key`; pages contain at most 100 jobs.
No contact information, payloads, provider errors, storage paths or evidence text
are projected. Opaque job IDs stay in restricted inspection, outside alerts.

Health includes queue/sending age, unresolved delivery failures, quota/outage
counts, retention failed/blocked/unknown steps and recorded privacy denial counts.
Privacy denials include masked missing records, not every platform authorization
failure. Restricted grants retain their existing scoped health view; brand-wide
metrics are null. Retention counts include restore steps. Holds are actionable
blocks, never permission to erase.

## Alert binding

`scripts/operational-alerts.mjs` provides `monitorOperations`: a trusted host
supplies authenticated actions, configured scope and a private notification sink.
Poll every minute; deduplicate by configured scope and code for 15 minutes,
escalating persistent incidents after 15 minutes. The host must monitor polling
and notification failures separately. Alerts trigger at 15 minutes of pending or
sending age, any unresolved delivery/retention/quota/outage/callback failure,
or 10 recorded privacy denials in 24 hours. Thresholds are operational defaults,
not delivery guarantees. No candidate content or opaque IDs enter notifications.

The trusted MAIL callback host supplies `observe` to
`createMailCallbackHandler`. It receives only fixed event/outcome labels.
Count rejected/unavailable callbacks over the current polling interval and pass
that count as `callbackFailures`; do not forward bodies, signatures or exceptions.
Rejected callbacks remain rejected and duplicate receipts remain ignored.
A callback database failure returns a generic error so the connector can redeliver.

Live scheduler, private destination, escalation contact and delivery drill remain
deployment bindings: this repository does not invent a paging service or claim a
live alert has been delivered. Verify one synthetic alert and transport failure
before enabling dispatch. Polling never performs automatic expiry or replay.

## Runbooks

| Alert | Investigation and recovery |
| --- | --- |
| Quota | Pause dispatch using approved operator controls; check provider allowance, restore quota, reconcile each failed attempt before queueing an approved replacement. |
| Outage / queue age | Check platform/provider status and worker health. Preserve queued identities. Resume after a synthetic dispatch succeeds and owner approves. |
| Callback failure | Check connector secret rotation, timestamp/clock, approved message mapping and database availability privately. Redeliver the same signed event through the trusted connector; receipt uniqueness prevents duplication. Never weaken verification. |
| Access denial | Review recent grant changes and scoped privacy audit privately. Revoke suspect access and verify cross-brand denial before restoring grants. |
| Retention failure | Inspect exact store status; repair adapter availability. Continue the same explicit request through the retention worker. Current holds are rechecked on every claim; unknown/running steps require adapter absence verification, never blind reclaim. |
| Unknown/stale mail | Verify worker cessation and provider outcome. Use passkey-protected stale reclaim, then evidence-backed reconciliation. Age alone never proves non-delivery. |

## Safe replay

Mail replay uses existing `reconcile_communication` with exact application,
draft, current grant, passkey and definitive accepted/not-accepted evidence.
Accepted attempts never resend. A not-accepted attempt creates at most one unsent
replacement, which must pass current template, suppression and human gates before
queue/dispatch. Offer attempts cannot create replacements. Repeated operations
are no-ops; audit failure rolls back recovery. Never bulk reset sending/unknown
jobs to pending.

Retention replay uses `worker/retention.mjs` and the existing worker-only
claim/completion actions. Reuse request identity; complete stores are skipped,
holds block every destructive path and each outcome has durable evidence.
Restore replay retains its closed access gate. See [retention](retention.md).
No generic replay action grants the operator a worker identity.
