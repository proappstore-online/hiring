# Explicit deletion, legal holds and restore replay (#28)

The owner-approved policy remains **indefinite retention** (#52/#9). There is no
scheduler, cron handler, age-based eligibility or automatic purge. Migration
`0037_retention_holds_and_restore` follows the already shipped 0028–0036; it does
not modify an applied migration.

## Owner and worker actions

`record_store_hold` derives the candidate from an exact organization/brand/application
and requires current brand-wide owner access. It appends active/released state,
owner identity, opaque reason reference and review date, plus business audit in
one transaction. Review dates never release holds. Both legacy erasure holds and
new store holds are checked. These are separate hold streams: releasing one does
not release another active stream. Scope covers all applications of the candidate
in this brand, never another brand or the independent worker account.

`request_store_deletion` is an explicit owner continuation of an existing
identity-verified `erasure_requests` record. It creates D1/R2/index steps and an
immutable tombstone, and snapshots private opaque object identities before metadata
can disappear. Calling it again is idempotent. It cannot turn age, rejection or
withdrawal into deletion eligibility. `get_store_deletion` exposes owner-scoped
progress without contact data or storage paths.

The executor in `worker/retention.mjs` uses registered **worker-only** actions
(`callers: ["worker"]`, `system:worker`). Owner/agent callers cannot invoke claims,
completion, inventory reads, imports or D1 purge by claiming a worker role. Platform
RPC must bind this identity; do not expose an arbitrary action proxy. The module
exports `executeStoreDeletion`, `reconcileStoreDeletion`, private-ledger export and
restore-replay entrypoints. It is reusable trusted worker code, not a browser API.

Each step has pending/running/unknown/failed/blocked/complete state, attempt identity,
attempt count and a fixed reason code. A claim atomically rechecks current holds.
The same transaction appends content-free `hiring_retention_evidence` for each
claim/outcome. Completed steps are immutable and skipped on retry; failed/blocked
steps can be retried explicitly. Evidence includes scope/request/attempt IDs, store,
outcome and server timestamp, never payloads, keys, reasons or provider errors.
Write/evidence failure rolls back the state transition.

Running/unknown work is never reclaimed by elapsed time. A racing new hold is
rejected until deletion has settled, rather than recording an effective hold
while an external delete might already be in flight. Provider exceptions are
unknown. `reconcileStoreDeletion` requires an adapter's definitive absent or
settled-not-deleted result before allowing completion/retry and accepting new holds.
An ordinary object HEAD returning present is not proof that deletion has stopped.
An unknown attempt must not be blindly resent. Lost claim responses are reconciled
by exact durable attempt identity.

## Store boundaries and honest completion

- D1: hold triggers protect application/candidate deletion and application child
  deletion, plus attachment deleted-state transitions. The default adapter redacts
  restored candidate/application core and removes mutable notes, agent activity,
  candidate access tokens and draft messages. It removes attachment metadata only
  after R2 is verified. Immutable receipts, history, archives, decisions/offers,
  replies, merge reasons and other protected content are conservatively counted as
  blockers. Existing archive protections are preserved. D1 remains blocked until
  those retained records can be addressed under an approved compatible design.
- R2: `createR2DeletionAdapter` requires a trusted R2-compatible delete/head binding.
  Each destructive path verifies the current worker claim and hold state. Keys come
  from paginated scoped SQL inventory and the persistent signed object manifest,
  including when attachment metadata has already disappeared. It verifies absence
  after removal. Filenames and bytes never enter the manifest or evidence ledger.
- Indexes: `createIndexDeletionAdapter` requires a trusted service implementing
  server-side delete/count predicates for organization, brand and candidate. It
  derives scope from the live worker claim and verifies zero remaining matches.
  It does not invent an existing external index service or treat hidden SQL reads
  as proof of physical index deletion.

Missing adapters become durable `blocked/adapter_unavailable` steps. These helpers
do not create platform bindings or bypass storage access controls. The PAS worker
SDK inspected for this repository provides worker put/get storage, not deletion of
user-uploaded objects. No deployed worker, user-object deletion bridge, external
index service or live backup interface is asserted by this change. A trusted host
must wire the module to verified scoped services; the existing deployment skips
worker deployment without a worker package. Direct provider/admin operations outside
these paths remain a platform responsibility and must honor the same holds.

A complete result describes only these three verified steps and their configured
inventory. It never completes the original core erasure status or processor log.
MAIL remains independently blocked; independent accounts, downloaded exports,
unregistered/orphan objects and processor copies require their own inventory and
evidence. The existing erasure UI remains truthful about its partial result.

## Private ledger and isolated restore

`exportRetentionLedger` uses authenticated owner actions, cursor pages and
before/after append-only ledger watermarks. It exports core-only and cross-store
request tombstones, private opaque object manifests, and both hold histories,
including previously replayed histories. A concurrent ledger change rejects the
export. HMAC-SHA256 seals the exact artifact; keep the signing key (at least 32
bytes), artifact and latest SHA-256 checkpoint in private operator storage
independent of the backup. Artifacts contain opaque reason references and object
keys and are **not public content-free audit evidence**.

`replayRetentionLedger` verifies signature and exact tenant/brand scope, requires a
durable gate covering reads/writes/intake/dispatch, and requires that gate to attest
the artifact digest matches the independently protected latest checkpoint. A signed
but outdated artifact is insufficient. Never derive this checkpoint from the backup
being restored or a caller-supplied digest. Restore cannot start with running or
unknown deletion work in the destination.

A fresh restore ID identifies each physical restore. Imports are idempotent against
the signed manifest digest. All holds and tombstones import before the session can
seal and permit claims. Replayed tombstones create fresh store steps, irrespective
of earlier completion. Core/child write fences prevent rehydration. Newer imported
hold events supersede stale backup events by original ledger sequence. Active holds
remain effective; `release_restored_store_hold` lets a current owner explicitly
release a specific restored stream after review. New store hold sequence allocation
also advances beyond imported history.

Interrupted imports and replay resume with the same restore ID and signed artifact.
An active hold, missing adapter, incomplete import or unverified step prevents
readiness. `finish_retention_restore` verifies all three steps for every tombstone.
Even ready returns `access: closed`: the module never reopens access. The operator
must separately verify complete inventory, processor/queue reconciliation, grant
revocations and supported restore procedures before reopening. Restoring the same
physical destination again requires a **new** ID and a closed/drained gate; do not
reuse a prior ready session to skip replay. This is executable replay scaffolding,
not evidence that a production recovery drill has occurred.

## Validation

`tests/retention.test.mjs` executes the actual migrations/registered SQL, with
synthetic R2/index services: hold enforcement, tenant isolation, retries, unknown
outcomes, racing/concurrent workers, lost responses, rollback, pagination beyond
100 objects, signed manifests, tampering, checkpoint/gate refusal, import sealing,
active/released hold replay, redaction/write fences and private evidence exclusions.
The full suite is `pnpm test`. No production candidate or provider is touched.
