# Bounded Hiring email orchestration (#58)

`scripts/bounded-email.mjs` supplies trusted server integration helpers, alongside
the existing MAIL adapter and durable outbox dispatcher. They expose no browser
endpoint, scheduled sender or credential store. Deploying this repository does
not provision a mailbox or bind an external agent to these helpers. The connector
operator must supply authenticated adapters and shared storage when wiring the
integration. Existing PAGS recipient isolation, consent, sender approval and
provider-side budgets remain required.

## Durable admission and duplicate sends

Migration `0045_bounded_email_reservations` adds immutable policy windows and
append-only reservations. `createEmailBudget({ db, budgetId, windowId, limits })`
accepts PAS-style `db.query(sql, params)` / `db.execute(sql, params)` dependencies.
All competing dispatchers must use the same database and stable `budgetId` for
the tenant/brand/instance/connection being limited. Only the trusted server selects
the window (for example, UTC day for sending or a run ID for model reads), IDs and
limits. Do not let an agent choose another window or budget to evade admission.
The fixed window is not a rolling daily allowance or an account-wide cost cap.

`limits` explicitly supplies integer `sends`, `summaries`, `body_reads` and
`body_chars` capacities, each from zero through 1,000,000. There is no implicit
outbound allowance. The first reservation pins a window's policy; a conflicting
policy is refused. For instance read runs use the operating maxima of ten
summaries, three body reads and 12,000 body characters. A separately configured
outbound budget can share a ledger or use its own server-controlled window.

Admission uses one conditional SQL INSERT that checks all remaining dimensions
and the operation identity together, before transport/fetch. Separate worker
connections cannot both consume the final slot. Reservations retain requested
capacity after failure, an empty page, a short body, timeout or process exit.
An uncertain send must be reconciled, never automatically retried.

`createBoundedMailAdapter({ authorize, transport, budget })` is passed as `send`
to the existing `dispatchCommunication`. It retains the existing adapter's exact
approval, suppression, scope, template and rendered-payload checks, and reserves
one send only after they pass. A full budget returns `not_accepted` / `quota`;
the outbox stores the existing actionable quota reason. A duplicate/conflicting
operation is refused as `forbidden`. Storage failures remain conservative unknown
outcomes, without contacting the provider.

Use the claimed outbox's stable idempotency key. An operation can reserve only
once within its budget identity, even across windows or helper recreation. A hash
binds the reservation to its payload and requested capacity; the ledger stores no
message bodies or addresses. An intentional new email needs its own approved
outbox identity: identical text alone does not establish a duplicate.

## Bounded reads and explicit checkpoint

`createBoundedWorkerReader({ budget, listMessages, readMessage })` reserves
summaries before listing and body-read/character capacity before reading. Each
list requests at most ten summaries; each body window at most 4,000 characters.
Provider callbacks must return normalized `{ messages, ... }` and
`{ body, complete, nextOffset, ... }` objects. Oversized responses and unsafe or
misaligned continuations are refused; this validation does not undo a provider
fetch. The underlying connector must also enforce its own response bounds.
Each summary requires `message_id` and a positive integer `occurred_at`; optional
`subject`, `from_email` and `to_email` are bounded strings. Listings project only
those fields and a bounded opaque `nextCursor`, rejecting a repeated cursor.
Message bodies, attachments and raw provider extras are not forwarded in listings;
body reads likewise project only bounded archival fields and continuation flags.
Empty pages and failed fetches still consume the reservation. Continuation calls
consume the same budget. No helper silently loops through the inbox.

`createWorkerEmailProcessor({ actions, readMessage, checkpoint, mailboxAddress,
connectionId, agentInstanceId })` takes actor-bound PAS actions and pinned worker
adapters. Pass the bounded reader's `read` as `readMessage`. Invoke the returned
function with `{ scope, messageId, operationId }`; preserve that operation ID on
retry. Use a distinct archive operation namespace from outbox creation/claim
operations, whose audit IDs may already exist. The processor:

1. Reads a normalized complete message for the pinned mailbox/connection and
   verifies its provider ID and directional address. Partial/truncated bodies
   stop before archival. Longer messages need a separately reviewed continuation
   workflow; this helper does not claim previews are full archives.
2. Calls the real `record_worker_candidate_email` action. Candidate/application
   and actor authorization remain enforced by its SQL. Failed archival stops.
3. Calls `get_worker_candidate_email` for that exact scoped operation and compares
   provider/channel, archive ID, direction, addresses, body/subject, timestamp,
   mailbox/connection, message/thread/event/receipt IDs and agent instance.
   Zero changes on archive replay requires the same exact readback as a new insert.
4. Calls `checkpoint({ message_id, archive_reference })` only on a complete match.
   Its normalized result must report `handled: true` and the matching
   `archive_reference`. Failure/uncertain response can retry the same reference
   without duplicating the Hiring archive or audit. The PAGS checkpoint adapter
   must enforce prior scoped read evidence and idempotent references itself.

These are internal normalized adapter contracts, not claims about native MCP
argument/result shapes. The checkpoint adapter must normalize the actual PAGS
response. Supply the nonsecret operation ID, never a URL or body, as reference.
The checkpoint confirms caller-reported archival, not independent delivery.

## Verification limits

`tests/bounded-email.test.mjs` uses actual migrations, archive/readback MCP SQL and
outbox actions with synthetic provider callbacks. It covers failed/mismatched
archives, ordering, retries, send deduplication, exhausted budgets and independent
worker/database connections racing for one send slot. These tests verify this
Hiring integration boundary, not PAGS's internal budget implementation.

The [operational runbook](hiring-agent-operations.md) remains authoritative for
live acceptance: exact account consent, approved FAS sender, bridge provisioning,
preserved forwarding, owner-approved labeled tests on both paths, independent
receipt, foreign-recipient negative controls, reply identity/thread, actual
archive/audit readback and explicit checkpoint. Those checks require real
services; mocked results cannot close their evidence gaps.
