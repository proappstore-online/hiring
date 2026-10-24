# Requisitions and authenticated candidate intake — issue #3

## Issue #16 — candidate-facing protected intake

The owner clarified that “without recruiter app authentication” means a signed-in
candidate without recruiter membership. The candidate UI uses Google sign-in; the installed platform SDK also supports
email/password registration and email magic links. Anonymous writes are
not required by this contract. No staff credential, D1/R2 secret, or OAuth secret
is supplied to the candidate browser; the SDK uses the candidate's own session.

`submit_job_application` checks an optional `website` honeypot (absent/empty only)
on the server, validates fields, and limits accepted submissions to ten per day
and one per ten seconds per authenticated candidate across brands. This is a
basic bot trap, not CAPTCHA or an IP request limiter; platform request throttling
remains separate. Candidate identity and evidence timestamps are server-bound.
Exactly one intake receipt per candidate and organization/brand/requisition is
accepted even with new IDs or retry keys. `get_my_requisition_receipt` reconciles
such retries within the caller's exact scope. Changed payloads report a conflict.
The atomic batch records the published notice, actor, time and optional consent.

External vacancy links use `/jobs/:jobId?organization_id=…&brand_id=…`.
The same link loads the current published snapshot and survives sign-in. Paused,
closed, stale and mixed-scope jobs refuse submission. No recruiter access is
needed or granted by this path.

The independent issue #3 attachment/scanner release gate remains closed. These
controls do not open production intake or claim scanner readiness. SQL tests
exercise the endpoint's registered server batch; platform authentication and
request throttling are provided by PAS, not simulated as HTTP tests here.

Implementation revision, 21 October 2026. Issue #3 remains a release gate until the file capabilities below are verified. This document takes precedence over earlier statements that no job discovery or intake actions exist; it does not claim that intake is open.

## Published jobs

Owners publish an immutable job and notice snapshot with `publish_job_requisition`. The platform requires recent app-origin passkey step-up (`step_up: true`); personal app tokens and model-supplied confirmation flags cannot satisfy it. The UI provides passkey registration/verification and requires review of public content. `close_job_requisition` checks version and records closure atomically with audit. Ordinary recruiter membership cannot publish. A publication is separate from the legacy requisition, whose draft-only CHECK remains unchanged. Owners can stage a versioned draft for review before publication (see the #15 lifecycle below); editing an existing publication is not supported. Create a new requisition for revised public content.

`list_public_jobs` is a public summary query, keyset-paginated by requisition ID at 25 rows. `get_public_job` checks exact organization, brand and requisition. Both exclude closed publications and suspended organizations. Public responses contain approved job, organization/brand and notice fields, never candidates or attachments. `/jobs` is the candidate entry point and survives authentication without requiring recruiter membership.

## Worker ownership and evidence

`save_my_worker_profile` creates/updates only the platform-bound caller's independent profile. It grants no organization membership. `submit_job_application` requires that profile, an open runtime gate, a current published job/version/notice, mandatory processing-notice acknowledgement and an owner available for assignment. SQL derives the assignee and caller identity. The exact organization/brand/requisition is checked before any write.

One atomic batch writes the brand-scoped candidate, application, immutable worker receipt, mandatory notice evidence, separately selected optional consent, initial stage and audit. Mandatory application processing is recorded under contract, not optional marketing consent. Evidence includes the notice text/version, affirmative submission action, actor and server time. Optional talent-pool and communications checkboxes start unchecked; publication notices must accurately describe those purposes. No special-category fields are requested.

Legacy `source='linkedin'` remains required by an applied CHECK. The immutable intake receipt is the canonical direct-source marker. Registered application reads return `direct` when a same-scope receipt exists, otherwise the legacy source. The legacy column alone must not classify direct applications. Requisition `status='draft'` is similarly a legacy field; publication state comes from `hiring_job_publications`.

Receipts bind idempotency keys to the authenticated worker and full submitted payload. Retrying the same request writes no second records. The UI reads the caller's receipt and compares the payload before reporting success; changed payloads are conflicts. Reads expose only that worker's applications, never internal notes or other candidates. The same worker/email across brands does not cause a merge. SQL limits successful submissions to ten per rolling 24 hours and at least ten seconds apart across all brands. Platform request limits remain separate; these controls bound accepted submissions, not raw request load.

## Attachment lifecycle and remaining blocker

`create_application_attachment` reserves an immutable private path `intake/<attachment-id>` under the uploader's platform storage namespace. Only the worker owning the exact application can reserve or delete it. Three active attachments per application, PDF/plain text metadata only, 1–5 MB and lowercase SHA-256 checksum are enforced by SQL. Filename/type/size/checksum supplied by the browser are **unverified claims**, not a trusted content check. Actual bytes upload through private `app.storage.upload`, never public or app-wide review storage.

All reservations start `pending`. Metadata reads require the uploader or the currently assigned staff member with exact brand membership; unassigned staff are denied. `get_application_attachment` refuses all states except `clean` and returns no object key or URL. No user action can mark a file clean. The schema's scan states reserve the future integration; they are not evidence of a running scanner.

Deletion first tombstones and audits the attachment, denying future application reads, then the uploader deletes their private object. Failed object deletion is reported and can be retried in the current UI. The deterministic path also permits operator-assisted cleanup. Reload recovery and processor erasure remain broader rights work; a tombstone alone does not prove object deletion.

**Required before completing #3:** a trusted byte-inspection/malware scanner, immutable object/checksum binding, and byte-serving authorization for exact assigned brand staff. The platform's current normal private storage is user-scoped; its review storage uses app-wide review roles, which are insufficient for Hiring brand isolation. No scanner or brand-aware reviewer file route has been verified. Do not substitute a client-supplied scan result or public capability URL. Reviewer download UI remains unavailable.

The runtime gate stays `closed / public_intake_route_unverified`; no new action can open it. Before opening it, record production evidence for the supported file path, owner/notice configuration, authenticated submission, two-brand denial and attachment lifecycle. Updating the gate is a separate reviewed release operation. Existing applicant data stays compatible. Retention remains indefinite with explicit deletion and no legal-review gate.

## Verification

`tests/candidate-intake.test.mjs` executes the registered SQL in SQLite: publication authorization, snapshots, closure, public scope/pagination, candidate ownership, consent, closed gate, stale/mixed IDs, retries, rate limits, rollback and quarantined attachment authorization/deletion. Fixture-only clean-state changes exercise future authorization; they do not simulate a deployed scanner. Migration tests cover populated upgrades and legacy constraints. UI source checks cover separation, escaped content, unchecked consent and private uploads. Passkey enforcement is provided by the platform, not by SQLite; an actual owner passkey ceremony and scanner/reviewer byte access require production verification before closure.

Current platform evidence checked from `proappstore-online/platform` on 21 October 2026: `docs/app-actions-security.md` (public queries, SQL batch, passkey step-up), `docs/app-workers.md` (admin enablement, worker identity), `packages/backend/src/routes/passkeys.ts` (registration/assertion payloads), installed SDK storage contract (user-private and app-role review storage). These checks establish documented boundaries, not a successful authenticated production intake.

### Migration recovery evidence

The first 0011 production attempt failed after at least its initial ADD COLUMN had committed; the migration remained untracked. A diagnostic retry exposed the duplicate `intake_source` column. The still-unapplied 0011 was revised to use only idempotent CREATE statements; direct provenance now derives from receipts and does not depend on that unused partial expansion column. Applied migrations 0001–0010 were not changed, no tracking row was inserted by hand, and no production objects were dropped. Regression coverage exercises fresh install and this partial-DDL retry state.

## Requisition lifecycle (#15)

Migration `0015_requisition_lifecycle` adds versioned job/notice review drafts, immutable compensation classification (`paid`, `unpaid`, `internship`, `volunteer`), and publication availability controls. Existing publications retain `unspecified` classification; existing publish clients may omit classification for compatibility. New workspace forms require an explicit classification.

Owners use **Load saved review** to restore saved content and its current version, **Save draft** to edit or return a review to draft, and **Submit for review** before **Approve and publish**. `save_requisition_review` requires version zero for first creation and the current review version thereafter. Publication of a staged requisition requires `pending_review` and exact matching content, classification, and notice; altered or draft content cannot publish. Legacy direct publication remains an owner approval with passkey step-up. Published content cannot be edited; revised content requires a new requisition. The brand and organization identity snapshots from #14 remain immutable and independent across brands.

`pause_job_requisition` and `resume_job_requisition` require brand ownership, passkey step-up, current publication version, and a fresh operation ID. Pause hides the job from both public queries and blocks candidate submission in the same server predicates; resume increments the version so pre-pause forms remain stale. Closure works from published or paused and is terminal. Each transition and its attributed audit commit atomically. Legacy draft-only requisition/publication CHECK constraints are preserved; the canonical availability state combines publication status with the separate pause control. The intake release gate remains closed.

**Acceptance revision:** #15's original unpaid legal-review criterion is superseded by Serge's explicit approval in [#52](https://github.com/proappstore-online/hiring/issues/52#issuecomment-6309937556) and #10's won't-do resolution. Unpaid, internship, and volunteer roles require classification and the same owner content/notice approval as paid roles, with no legal-review record or expiry gate. This implements that recorded owner decision rather than reinstating the rejected dependency.

Verification adds regression coverage for staged payload binding, forged brand IDs, non-owner denial, stale review versions, unpaid publication under the approved policy, immutable classification, pause discovery/submission denial, resume, terminal closure, and rollback on audit failure. Platform passkey enforcement and production deployment remain platform checks, not simulated by SQLite.

## Candidate account routes (#65)

Signed-in candidates can open `/my-applications` and
`/my-applications/:applicationId` independently of recruiter membership.
The list shows at most the latest 100 owned applications; the new authenticated
`get_my_application` action resolves a single owned ID without that list limit.
It returns only scope, job/brand/organization identity, stage and submission time.
Missing and unauthorized IDs both return no rows. Closing a public job does not
remove the candidate's receipt/status access. Older servers can fall back to the
owned list; that compatibility lookup retains the 100-record limit.

Job and vacancy discovery both provide keyword and brand filtering over loaded
pages, with an explicit loaded-results disclaimer. Detail/application links bind
organization and brand. Candidate sign-in accepts only local supported return
routes and preserves application/account destinations.

The application form displays submission progress and links the verified receipt
to its status route. Uncertain responses retain the same mounted-form identifiers
and require receipt payload reconciliation. Reloading does not persist PII or
form state; server requisition deduplication remains authoritative.

Candidate withdrawal is available through `withdraw_my_application` (#6/#19).
It derives ownership from the authenticated worker's exact intake receipt, checks
the current version and active stage, then commits `withdrawn`, the next version,
attributed immutable stage history and `application.withdrawn` audit atomically.
Other candidates, staff acting as staff, mixed brand IDs, stale versions, terminal
states and duplicate operation IDs cannot change the record. The detail/list
reads include `version`; no staff notes or contact data are added.

The candidate detail screen requires explicit confirmation. It retains its
operation ID across a failed attempt and reads the current owned application after
both successful and uncertain writes; it reports withdrawal only from durable
`withdrawn` state. Refreshing reads the same state. Withdrawal stops active-stage
changes, does not erase data, and cannot recall already-started messages.
Migration `0031_withdrawn_dispatch_guard` prevents new queue/claim transitions for
withdrawn applications, including jobs queued before withdrawal. Pending jobs
remain held for operator review; no cancellation or delivery claim is fabricated.

Private attachment metadata and quarantine remain visible;
neither the status page nor discovery introduces download capability or opens
intake/scanning gates. Browser tests use mocked auth/actions; they do not verify
a live OAuth ceremony, scanner, or file-serving integration.

## Accessible brand-specific application form (#17)

The scoped `/apply/:requisitionId` form shows the published organization, brand,
role and notice before submission. Native labels, required name/email/notice
validation, length limits, autocomplete and a keyboard-accessible submit button
support mobile and keyboard use. Optional consents start unchecked. Invalid
controls are marked for assistive technology; server errors are described by the
form fields and receive focus. Submission progress is announced, controls are
locked during submission, and a verified confirmation receives focus before the
candidate can tab to their application status link.

Stable in-memory submission identifiers survive uncertain responses. Changed
retry payloads are blocked; exact payload receipt reconciliation is required for
success. No form values enter navigation URLs or persistent browser storage.
Public brand B vacancies remain discoverable to candidates who applied to brand
A; candidate records and receipt access remain caller-owned and scope-bound.

Browser tests use two brands and mocked platform responses for stale-version
errors, scope denial, validation, keyboard order, retries and confirmation. SQL
tests separately verify the registered action rejects unpublished, paused,
closed, stale-notice and stale-publication submissions without partial records.
These tests do not verify a live authentication ceremony or scanner.

Current lifecycle clarification: the owner/recruiter publishing simplification
removed passkey step-up from publication and intake-gate actions. The gate still
starts closed, is authenticated and audited, and is opened only by the existing
scoped staff action. Earlier statements above that no action can open it or that
publication always requires passkey step-up describe the older implementation.
This form change does not open intake or add attachment-serving capabilities.

## Scoped candidate access (#19)

Migration `0032_candidate_access_tokens` adds access tokens bound to the signed-in
candidate, exact application and one purpose (`status` or `withdraw`). The detail
screen generates 32 cryptographically random bytes with Web Crypto, registers the
hex token using `issue_candidate_access_token`, and keeps it only in memory.
Tokens never appear in routes, persistent browser storage, audit summaries or mail.
The SQL action derives ownership from the intake receipt; staff membership grants
no candidate access. Issuance is capped at 20 per candidate per rolling 15 minutes.
The server fixes expiry at 15 minutes using `:__now`; callers cannot set the clock
or expiry. Unknown applications and unauthorized ownership cannot issue tokens.

`get_candidate_application_status` accepts only a live status-purpose token for
the same candidate and application, and returns the existing candidate-safe fields.
`withdraw_candidate_application` accepts only a live withdrawal-purpose token and
consumes it in the same transaction as the versioned withdrawal, stage event and
attributed audit. Audit failure rolls back consumption and withdrawal together.
Failed/stale requests leave the token unconsumed; successful replay cannot mutate
again. The UI reconciles uncertain writes through a fresh status token and keeps
its operation ID across retries. A withdrawal token never authorizes status, and
status never authorizes withdrawal. Withdrawn applications remain terminal.

These tokens supplement platform authentication; they are not anonymous bearer
links. Candidates use their own platform account without any staff role, consistent
with ADR-002. Existing `get_my_application` and `withdraw_my_application` remain
ownership-checked compatibility actions for authenticated clients; the detail UI
uses the scoped actions. Tokens are private database credentials and must not be
included in operational logs or exports. No anonymous endpoint, email token delivery
or privileged worker is introduced.

Talent-pool participation now has a fixed 180-day expiry and candidate self-service
withdrawal. See [talent pool](talent-pool.md) for scope, consent and retention rules.
