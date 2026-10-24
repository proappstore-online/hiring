# Hiring administration and operations (UI-4, #66)

The `/admin` workspace adds direct `/admin/communications`, `/admin/operations`,
`/admin/compliance` and `/admin/settings` routes. `/dashboard` remains available.
URLs contain record/scope IDs, not candidate names or email addresses. Workspace
switching preserves the admin section and clears the application selection.

## Permissions

| Role | Dashboard/applications | Communications | Operations | Compliance | Settings |
| --- | --- | --- | --- | --- | --- |
| Owner | Yes | Yes | Yes | Yes | Yes |
| Recruiter | Yes | Yes | Yes | No | No |
| Reviewer | Yes | No | No | No | No |
| Auditor | Yes | No | Yes | Yes | No |

Navigation is a presentation gate; registered actions enforce scope independently.
Organization identity remains organization-creator-only. Brand creation uses the
existing creator capability. Requisition creation and template management require
brand-wide owner/recruiter authority; a requisition-only grant does not qualify.
Existing application authorization, intake gates and private attachment gates remain
in force.

## Templates and communications

Migration `0021_communication_templates` adds brand-scoped templates. The authenticated
`list_communication_templates` and `save_communication_template` actions require a
brand-wide owner/recruiter grant. Saves use expected versions and transactional audit
evidence. Templates store unsent text and confer no sending authority. They do not
specify a provider: the approved connector workflow supplies the provider.

Communication cards name the selected brand and actual recorded provider, or say
that no provider was recorded. Provider acceptance is never presented as confirmed
delivery. Unknown outcomes display a count for the loaded application records and
manual reconciliation guidance. Staff check provider evidence and status history,
record evidence through the approved connector workflow, then refresh the page.
There is no resend control and no new reconciliation mutation.

## Operational diagnostics

`get_operational_health` adds a current snapshot of permitted outbox counts and
ages. Owner/recruiter/auditor access follows exact brand and requisition grants;
ungranted callers get no row. Failed/unknown counts exclude reconciled attempts.
Pending age is since draft creation (not queue insertion); sending age uses
`last_attempt_at`. Missing timestamps return no recorded age, not zero.
Only brand-wide owners/auditors receive 24-hour recorded privacy denied/missing
and unconfirmed-read counts; everyone else receives null, not a fabricated zero.
These cover gateway/export receipts only, not all API failures. There is no
automatic retention purge or alert transport. Counts contain no IDs or candidate
content. The operations UI offers keyboard refresh and manual reconciliation
guidance, never an automatic resend. SQL and browser tests cover scope, restricted
counters, age, empty/error/retry states and keyboard refresh.

`list_operational_diagnostics` returns at most 100 scoped activity IDs, agent instance
IDs, action names and timestamps. Owners/recruiters/auditors can read only granted
requisitions. Candidate content, source URLs, summaries, contact fields and application
IDs are excluded from this response. The UI omits URLs entirely, including domains.
The loaded count is not a total or a funnel metric. Existing activity has no outcome
field, so the response truthfully reports `unknown`; no successes are inferred.

## Compliance capabilities

The non-dismissible policy notice is **Indefinite retention — no automatic purge**.
Owners can now request [scoped core erasure](erasure.md) after selecting an exact
application and confirming identity/scope and hold review. The server enforces
brand-wide ownership and recorded active holds. Two review steps precede irreversible
core redaction. Live status shows partial progress, retained stores and blocked MAIL
propagation. This does not complete erasure or the broader identity/rights workflow.
Export remains unavailable; no automatic purge or fabricated completion is supplied.

## Consequential actions and validation

Publication, pause/resume, closure and grant revocation require modal confirmation.
Dialogs use the browser modal top layer, focus containment/restoration, Escape
cancellation and keyboard activation. Success messages expire after four seconds;
conflict/access-change errors persist and direct staff to reload before retrying.
Server publication/passkey restrictions remain unchanged.

The repository test runner is `npm test` from the root (Node tests plus Playwright
browser fixtures); `web/package.json` has no separate test script. Browser scenarios
live in `web/src/admin.test.tsx` and are exercised by `tests/admin-browser.test.mjs`.
`tests/admin-actions.test.mjs` verifies SQL scoping, concurrency, replay and rollback;
`tests/routing-browser.test.mjs` covers direct admin routes and role denial.
Run `npm run typecheck` and `npm run build` from the root for TypeScript, compliance
hard checks and the production build.

This branch starts from `feat/candidate-account-65`; unmerged routing/vacancy/account
predecessors are required. The separate recruiter-dashboard branch is not included.
