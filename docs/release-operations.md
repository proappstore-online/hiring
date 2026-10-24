# Release operations, incidents and recovery (#35, #38, #48)

Version 1, 24 October 2026. Accountable owner/incident commander: Serge
(`serge-ivo`). Backup, paging destination, provider escalation contacts and
applicable jurisdiction/notification decision authority require owner confirmation.
Until confirmed and exercised this is a draft procedure, not incident readiness.
Keep contact details and subject-level evidence in restricted operator storage.

## Operational triage and safe recovery

Check `/admin/operations` under the exact organization/brand grant. Its latest
100 activity records omit candidate content and have unknown outcomes. The
`get_operational_health` snapshot adds permitted pending/sending counts and ages,
unreconciled failed/unknown counts and restricted recorded privacy counters.
Brand-wide owners/auditors also see retention failure/blocked/unknown and
unresolved quota/outage counts. Use `inspect_operational_jobs` for paged,
content-free failure inspection. [Monitoring and replay](operational-monitoring.md)
defines executable alert evaluation, trusted callback observation, deployment
bindings and runbooks. Live transport/recipient configuration and an exercised
alert delivery remain launch evidence requirements.

| Observation | Operator action | Evidence before continuing |
| --- | --- | --- |
| Quota/provider outage | Pause dispatch through the approved operator route, investigate provider quota/status; preserve ATS decisions | Actual provider result, affected operation IDs, owner approval to resume |
| `sending` past timeout | Verify active worker is no longer processing, inspect provider evidence, invoke scoped owner/recruiter passkey `reclaim_stale_communication` with exact scope and configured timeout | Durable transition to `unknown`; age is never proof of non-delivery |
| `unknown` | Inspect actual provider attempt; invoke `reconcile_communication` only with definitive accepted/not-accepted evidence | Audited reconciliation readback; never automatically resend |
| Definitive failure | Correct cause and use existing authorized retry path only after state readback | Same logical message/idempotency identity, no extra accepted provider attempt |
| Unsupported callbacks/replies | Keep outcome unknown and triage manually | Do not invent delivery/bounce state; quarantine ambiguous input |
| Erasure/export failure | Read exact request status and preserve operation identity after timeout | No completed claim while store/processor handling is partial or blocked |
| Access denial spike | Restrict affected access, assess grant changes and scope | Content-free IDs/counts in telemetry; full detail in restricted evidence |

Consult [audit/outbox](audit-outbox.md) for actual action parameters and permitted
states. A stale reclaim cannot cancel an in-flight provider request; verify worker
and provider before retry. Never replay all failed/unknown jobs or call a provider
directly to bypass the audited dispatch authority. If a pause/revocation operation
is unavailable, escalate to the platform owner and keep release held.

## Incident playbook

1. Record incident ID, UTC detection time, reporter, deployed SHA and commander.
   Page the owner and confirmed backup through the agreed private channel.
2. Contain the smallest verified scope: revoke affected grants/sessions or token
   using supported platform controls; pause affected intake/dispatch if available.
   Confirm denial with a fresh request. If revocation/containment cannot be proven,
   escalate to platform operations; do not assume hiding UI provides containment.
3. Preserve append-only audit, provider references and protected diagnostic copies.
   Record access/custody and timestamps. Never paste candidate content, credentials,
   full email bodies or tokens into GitHub/telemetry.
4. Establish tenant/brand/time range, data categories and affected subjects through
   authorized reads. Compare successful and denied requests; document uncertainty
   and processor involvement. Revoke exposed access before investigating copies.
5. The owner appoints the jurisdiction-qualified notification decision authority,
   confirms applicable deadlines and processor contacts, and records decision,
   basis, clock start, recipients and review time. No universal deadline or legal
   compliance conclusion is asserted here. Track notification receipts privately.
6. Fix the cause, retest affected and cross-brand controls, reconcile uncertain
   sends, preserve deletion tombstones and obtain owner authorization before
   resuming. Record resolution time, remaining risk, remediation owner and follow-up.

Before launch exercise both (a) Brand A seeing a Brand B record and (b) a lost
candidate token/session. Record simulated detection, escalation acknowledgement,
containment result, affected scope, notification decision and recovery/retest.
An unexecuted tabletop is pending evidence, never a pass.

## Isolated backup/restore drill and rollback

No supported backup/restore or tombstone replay integration is established by
this repository. Arrange the platform-supported procedure with its owner; do not
invent a D1/R2 API or restore over production. Keep #38 held until the following
drill succeeds and the operator has accepted measured recovery objectives.

1. Record known-good client/tool/schema SHA, deployed migration set, backup time,
   object inventory/checksums and encryption/access controls. Obtain a matching
   D1/object backup in an isolated destination with intake, dispatch and user
   access disabled. Owner defines acceptable RPO/RTO; record measured values.
2. Use synthetic two-brand records with a pre-backup application and attachment.
   After backup, perform explicit erasure/tombstone and grant revocation; preserve
   the latest protected tombstone/hold/revocation ledger independently of backup.
3. Restore into isolation using the verified platform procedure, apply compatible
   additive migrations and replay all later deletion tombstones before any access
   or writes reopen. Preserve active holds; never resurrect erased fields, file
   bytes, exports, processor jobs or revoked access. Current core-only redaction
   cannot prove complete-store replay; record this as a blocker.
4. Verify row/object counts and checksums for retained fixtures, denied reads and
   writes for erased/revoked fixtures, brand isolation, audit integrity and no
   provider dispatch from restored queues. Unknown/sending attempts remain held
   for provider reconciliation; restoring a database never makes them retryable.
5. Run all seven live scenarios against the restored isolated release. Record
   timings, losses, failures and retests. Securely remove drill data according to
   the approved procedure and retain minimal protected evidence.

For a bad release, owner chooses a previously verified compatible client/tool
revision, deploys through the normal main workflow and verifies the resulting SHA.
Additive migrations stay applied; do not drop schema or restore an old database
as a client rollback. Verify old tools against expanded schema, preserve audit and
tombstones and hold uncertain sends. If compatibility is unproven, keep access
contained and ship a forward fix. Final launch/rollback record names commander,
backup/contact, candidate and rollback SHAs, evidence references, RPO/RTO, trigger,
decision/time and required verification before reopening.

### Executable replay scaffold (#28)

`worker/retention.mjs` now provides signed private ledger export and closed-gate
restore replay with fresh store attempts. The [retention contract](retention.md)
defines required trusted bindings, independent latest checkpoint, gate/draining,
resume identities and active-hold handling. This supersedes the absence of replay
code above; the supported live backup/restore environment and completed drill
remain unverified. Missing services and protected content keep access closed.
