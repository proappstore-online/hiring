# Requisitions and authenticated candidate intake — issue #3

Implementation revision, 21 October 2026. Issue #3 remains a release gate until the file capabilities below are verified. This document takes precedence over earlier statements that no job discovery or intake actions exist; it does not claim that intake is open.

## Published jobs

Owners publish an immutable job and notice snapshot with `publish_job_requisition`. The platform requires recent app-origin passkey step-up (`step_up: true`); personal app tokens and model-supplied confirmation flags cannot satisfy it. The UI provides passkey registration/verification and requires review of public content. `close_job_requisition` checks version and records closure atomically with audit. Ordinary recruiter membership cannot publish. A publication is separate from the legacy requisition, whose draft-only CHECK remains unchanged. This first workflow publishes directly after owner review; staged review and editing an existing publication are not implemented. Create a new requisition for revised public content.

`list_public_jobs` is a public summary query, keyset-paginated by requisition ID at 25 rows. `get_public_job` checks exact organization, brand and requisition. Both exclude closed publications and suspended organizations. Public responses contain approved job, organization/brand and notice fields, never candidates or attachments. `/?view=jobs` is the candidate entry point and survives authentication without requiring recruiter membership.

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
