# Audit and transactional outbox (#13)

Registered mutation batches execute in one D1 transaction. Existing business writes
and their audit event commit together; draft creation includes its durable outbox
row. Queue, claim and completion each update that row and append attributed audit
metadata atomically. Audit failure aborts the whole batch. Audit records reject
UPDATE and DELETE (migration 0010); privileged schema operators remain outside
this tamper boundary.

Migration 0013 adds exclusive claim identity, queued-payload immutability, durable
job deletion protection and database-enforced delivery transitions. Historical
migrations and draft status constraints remain unchanged. `status` is the legacy
`draft` field; `delivery_state` is authoritative for delivery.

Authenticated actions take organization, brand, application and draft IDs. Every
statement checks current effective owner/recruiter access, including requisition
scope. Caller-supplied IDs never grant access.

| Action | Transition / result |
| --- | --- |
| `queue_communication` | draft → pending; freezes payload and sets stable provider idempotency key to the draft's creation operation ID |
| `claim_communication` | pending → sending; records operation ID as exclusive claim ID, actor, attempt count and time |
| `get_claimed_communication` | private payload only for current claimant with current access and exact claim ID |
| `complete_communication` | sending → sent, failed or unknown; exact claim and current claimant required |

Mutation operation IDs are globally deduplicated by audit records. Each successful
transition appends actor, timestamp, operation/request ID, object reference and a
fixed summary. Summaries contain no subject, address, body or provider error. The
staff timeline displays delivery state; `sent` is labelled **accepted**, never
“delivered.” Claims are credentials: do not include them in diagnostics.

`scripts/outbox.mjs` provides a provider-neutral single-attempt dispatcher. Inject
an authenticated action transport and a provider adapter. Invoke the provider only
after a successful exclusive claim; forward the stored stable idempotency key.
Only definitive `accepted` or `not_accepted` adapter results map to sent or failed.
Exceptions, timeouts and unexpected results map to unknown. Diagnostics emit only
a fixed event name and enumerated outcome, never raw errors or payloads.

Claims have no automatic expiry or reclaim. A crash after claim, lost completion
response or uncertain provider outcome cannot result in another send on retry.
Even known failures are terminal in this foundational implementation. Reconciliation
and any evidence-backed retry require a later audited workflow; do not recreate a
job to bypass an unknown outcome. This intentionally trades automatic recovery for
protection against duplicate external effects where provider idempotency is absent.
A revoked claimant may be unable to complete, leaving sending for reconciliation.

No provider is configured or called by deploy, browser UI or SQL actions. The helper
is ready for adapter integration; no scheduled sender is installed. Existing sender,
quota, suppression and approval gates in the MAIL contract still apply. Queueing a
draft does not authorize an offer/rejection or a new final disposition. Future
business transitions that require an external job must create that job in the same
registered batch, never via a second browser request.

Regression evidence: in-memory SQLite executes the deployed SQL with PAS-style
binding and transactions; tests cover scope forgery, replay, exclusive claims,
immutable payloads, audit rollback, redaction, timeouts and lost responses. These
are local contract tests, not a live D1/provider delivery probe.

## Logical email identity and history (#60 / #61)

Additive migration `0018_email_identity_history` gives new outbox drafts a
server-generated UUID (`logical_email_id`). Existing outbox and archive identities
remain NULL until an old unsent draft is genuinely queued; that queue assigns an
identity and records only its real queued event, never an invented draft event. It adds nullable identity columns, immutable explicit archive links,
and append-only `email_status_events`. It does not edit any historical migration,
rewrite archives, delete duplicate-looking records, or backfill fictional events.
Gmail archives now reject updates/deletes just as worker archives do.

Draft creation captures `draft` at server time and authenticated actor. Successful
queue/claim/completion audit inserts capture `queued`, `sending`, and
`accepted`/`failed`/`unknown` in the same transaction, including attempt number.
`pending` maps to queued; outbox `sent` maps to provider accepted, **not delivered**.
Rejected, replayed and no-op mutations append no events. Migration `0019_preserve_email_acceptance` rejects failed/unknown completion once linked provider acceptance is recorded, with `completion contradicts recorded provider acceptance`. A sent completion still finalizes the outbox and records its audit, but adds no duplicate accepted status event; current status remains accepted. Cancellation has an event
schema value but no new cancellation operation is introduced; existing transition
and no-double-send guards remain authoritative. Events have a monotonic sequence
for stable ordering when timestamps tie. Current status follows recorded sequence;
chronological history uses actual event time, then sequence.

`get_claimed_communication` and `list_communication_drafts` now return the identity.
The draft list also returns `current_status`, `latest_activity_at`, and
`linked_archive_id`. Old delivery fields remain available. Both
`record_candidate_email` and `record_worker_candidate_email` accept optional
`logical_email_id`. Omit it for independent inbound/outbound archives, as before.
For a new linked outbound archive, use the identity returned with the claimed
payload, with the real provider message/thread/receipt/event IDs. Archive during
sending or after sent/unknown completion, using the same authenticated claimant
with current scoped access. Then complete using the original claim. Linking does
not change the exclusive claim, release an unknown job, or authorize another send.

Links require exact organization, brand and application, outbound direction,
matching immutable subject/body, recipient and claimant identity. A logical email can link to only one
provider archive across Gmail and Cloudflare. Conflicting links/payload replays
abort; exact retries append nothing. Existing operation-ID replays can return zero
changes before insertion, per the existing contract: zero changes is not evidence
of a successful new archive. Use authorized provider-specific archive readback to
verify the identity and actual IDs. Worker IDs are scoped to mailbox/connection;
thread IDs never establish email identity. No actor parameter is accepted.

`list_email_status_history` requires organization_id, brand_id, application_id,
and logical_email_id. It uses the same owner/recruiter requisition access as the
communication reads. Returns 50 events in chronological order. Supply the last
returned `timestamp` as `cursor_at` and `id` as `cursor_id`; continue until an empty
page (or a page shorter than 50). Do not treat the first page as complete history.
The UI loads on expansion and offers further pages, with loading/error/retry states.
No provider secrets, payloads or claim credentials are copied into event metadata.

### Legacy reconciliation boundary

The existing send/record/complete actions never persisted an explicit archive
foreign key or provider account on the outbox. The historical nullable
`provider_message_id` alone lacks a provider/mailbox/connection discriminator and
cannot prove a Gmail-versus-worker association. Consequently this migration's safe
reconciliation result is **no proven pairs**, no writes, NULL legacy identities,
and unavailable history. It intentionally does not infer links from subject,
body, addresses, time, threads, or a bare cross-provider message-ID collision.

For an old pair to be reconciled in a future audited operation, retain an explicit
stored outbox ID + provider + account/mailbox/connection + message/receipt reference
from trusted send evidence, validate both scopes and immutable payloads, check
one-to-one uniqueness, and append an attributed reconciliation link. Do not update
an immutable archive or pretend reconciliation time was historical send time.
This release exposes no manual content-matching/backfill bypass. Existing real
invitation evidence is preserved, so unproven legacy duplicates stay visible.

The Communications UI merges only shared non-null identities. Immutable outbox
subject/body appear once; provider details enrich the same card. Separate identical
sends stay separate. Standalone inbound and legacy archives remain visible and
legacy cards say “Legacy / Unverified link.” Dates say Created, Provider event or
Latest activity; a creation time is never described as send time. Existing bounded
application list contracts still return up to 100 outbox rows and 100 archives;
per-email history is independently paginated without truncating older events.

Validation uses synthetic SQLite fixtures and React server rendering, not a live
provider send, candidate mutation, or browser authentication ceremony.

### Communications UI verification

The Communications list distinguishes initial detail loading and fetch failure from
an empty result, with an in-section retry. Email card identity includes workspace,
application and logical email identity: status/activity updates preserve expansion,
while scope changes reset history. History controls have 44px minimum touch targets.
Provider receipt/event references remain available inside the expanded history.

Run `pnpm exec playwright install --with-deps chromium` once before `pnpm test`.
The browser regression suite uses synthetic fixtures, real React and Tailwind,
and a local Vite server with only the API read boundary mocked. It exercises
keyboard expansion/collapse, loading/error/retry, pagination, pending requests
across applications, stable card identity, and the 375px layout. CI installs
Chromium before running the same full suite.

## Offer authorization (#24)

An offer authorization is immutable evidence for one exact paid terms revision and
one exact draft payload/recipient. Once an application has an offer, its queue and
claim transitions require that authorization and a currently approved offer; revoked
or terminal applications cannot dispatch it. Generic drafts cannot bypass an
existing offer. Queue now requires human passkey step-up. Existing general
correspondence for applications without an offer retains its separate queue flow;
this is not an automated content classifier for arbitrary message bodies.

Approval/authorization do not mean queued, accepted or delivered. Revocation blocks
an unclaimed job. Once claimed, revocation is rejected rather than representing an
irreversible provider attempt as recalled. Original sending/unknown states and
exclusive claims remain durable; no new retry/reclaim capability is added.

## Scoped core erasure (#31)

[Erasure contract](erasure.md) adds owner-only core redaction and an append-only
`erasure.requested` tombstone. This creates no exception to audit/archive/job
immutability. Existing audit rows and protected payloads are not modified or
removed. A tombstoned candidate cannot receive new content writes or dispatch
claims. Sending/unknown jobs require reconciliation before the request is allowed.
MAIL propagation remains blocked without a verified deletion route; retained stores
are exposed in live status. This is partial erasure, not evidence of completion.
