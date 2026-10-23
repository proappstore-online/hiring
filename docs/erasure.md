# Scoped core erasure (#31)

Migration `0027_scoped_erasure_requests` and the authenticated action
`request_candidate_erasure` implement irreversible core redaction, not complete
erasure. The current result is always `partial`. Issue #31 must remain open until
all remaining stores and processor copies can be verified and only legally
required minimal evidence survives. No completion action or automatic purge exists.

A current brand-wide owner selects an exact application ID and attests that identity
and scope have been verified under the approved privacy process and legal holds
reviewed. These attestations are not an automated identity-verification service.
The server derives candidate identity and current owner access; caller role/actor
claims provide no authority. The scope includes this candidate and all their
applications in the exact organization/brand, not other brands or their independent
worker account. A new operation ID is needed for a different target; retain the same
one after a timeout and read status before retrying.

In one transaction the action inserts immutable `erasure_requests`, redacts name,
email, phone and LinkedIn fields, redacts application sourcing/basis/contact text,
clears submitted snapshots, increments application versions, records fixed blocked
MAIL propagation in `processor_erasure_log`, and appends `erasure.requested` to the
existing audit. Original audit rows, application/candidate IDs and scope survive;
no audit UPDATE/DELETE or schema replacement occurs. Failure of any write rolls
back everything. Existing migrations and trigger definitions remain unchanged.
New fences reject subsequent writes to the candidate/application and related
content/dispatch stores. This prevents old clients and agents restoring PII or
claiming a queued message after a tombstone. Already sending/unknown messages
block the request until reconciled; core erasure cannot recall a provider attempt.

`record_candidate_erasure_hold` appends an owner-attributed active/released event
with reason reference and review date. `get_candidate_erasure_hold` reads the
latest event. Dates never automatically release a hold. An active hold blocks the
request transaction before any redaction; only an explicit owner release permits
it. Hold events cannot be rewritten/deleted or added after core redaction. Owners
must also review holds outside this application before attesting. This is not the
full rights/deadline/identity workflow from #29 or the full hold/restore work in #28.

`get_candidate_erasure_status` returns request identity, fixed partial status,
processor limitation and current record counts for candidate/application core,
notes, drafts, Gmail/worker archives, agent activity, consent, intake receipts,
application sources, attachments, stage/assignment history, interviews and their
assignment history, scorecards, decisions, offers, offer versions/approval events,
external dispatch authorizations and worker-profile linkage. Counts reveal no
payload. Zero core counts verify only the specified fields, never all PII. Other
records are reported conservatively for review, even if their content is harmless.

The owner UI wires the shared `scripts/erasure.mjs` coordinator through the existing
registered-action HTTP endpoint (`app.actions.call`), rather than inventing a
server route inside the Vite client. The coordinator performs durable readback even
after a lost mutation response and returns structured partial results. Reloading the
page and checking the exact application retrieves the same request. The interface
shows remaining store counts and operator cleanup guidance, never a success claim
for a processor or store that was not verified.

## Unresolved cleanup and processor handling

Under the current additive-only and audit-preservation constraints this release
redacts only candidate/application core fields. Immutable receipts, sources,
archives, queued payloads, stage history, scorecards and offer evidence cannot be
redacted through existing triggers. Other local content remains pending as well.
File bytes/metadata, search indexes, exports, independent worker accounts and backups
require separately evidenced cleanup. Restore must replay tombstones before access
or writes reopen; no backup restore integration is claimed here. SDK storage
availability is not proof of scoped object deletion. Neither hidden reads nor
redaction markers mean stored copies have been erased.

MAIL is a documented processor boundary, not proof that Resend, Gmail and Cloudflare
all hold this subject's data. No verified processor deletion route exists in the
current MAIL contract. Consequently propagation is durably recorded as **blocked**
(`no_verified_deletion_route`), not sent, completed or not applicable. No external
API is called and no job dispatcher is fabricated. In particular the log never
asserts "outbox rows and body copies deleted": those copies may still exist and
are counted in status. The owner must establish actual processor scope, permitted
retention and deletion evidence before closure. Merely recording a limitation does
not satisfy processor erasure or #31's completion criterion.

## Validation

`tests/erasure.test.mjs` executes the actual migration and registered SQL in SQLite:
core redaction, immutable tombstone/processor evidence, exact owner permission,
identity/hold attestations, explicit holds/releases, atomic rollback, live blocker
counts, rehydration/send fences, in-flight sends and lost-response reconciliation.
`tests/erasure-browser.test.mjs` drives the real compliance screen, coordinator and
API wrapper against a synthetic action transport at 375px, covering confirmation,
failure/retry, scope/role reset and truthful partial progress. No real candidate or
provider is touched. Run `pnpm test` and `pnpm build`.
