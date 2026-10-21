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
