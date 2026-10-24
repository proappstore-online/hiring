# Calendar and job-board integration assessment (#41)

Version 1 · assessed 2026-10-25 · accountable owner: Serge.
Decision: defer implementation. This assessment authorizes no external candidate
transfer, provider installation, OAuth grant, purchase or production enablement.
The machine-readable [decision register](integration-decisions.json) records all
three paths as blocked. No approved provider contract is recorded in this repository.

## Current capability and dependency

Hiring stores scoped interview scheduling metadata and assignments; those mutations
create no outbox or external send. See [domain model](domain-model.md#interviews-22-migration-0024).
Recording `job_board` as an application source is inbound provenance, not permission
to export. No calendar connector or job-board syndication action is shipped here.
Existing MAIL approval does not authorize calendar invitations or board transfers.

#38 is closed in GitHub, but the [release roadmap](delivery-roadmap.md) still requires
actual live evidence and an owner launch decision. Closure alone supplies neither
provider approval nor the separate job-board transfer gate. Future integration work
must attach its own implementation issue and release evidence before activation.

## Capability assessment

| Path | Capability and limits | Decision |
| --- | --- | --- |
| Google Calendar | API provides free/busy and event operations with distinct OAuth scopes. Prefer availability-only discovery; event writing needs separately justified scope. PAS sign-in is not Calendar authorization. | Feasible candidate for a later pilot; no installed credential or end-to-end proof recorded. |
| Microsoft 365 / Graph | Delegated Calendars.ReadWrite permits calendar edits; application permissions have a different access model. Tenant-wide access is outside the proposed pilot. | Alternative for customer demand; no tenant consent or end-to-end proof recorded. |
| Job listing syndication (Indeed example) | Job Sync creates, updates and expires listings. Partner agreement and integration review are prerequisites; listing APIs do not imply permission to transfer candidate records. | Conditional, listing-only pilot after commercial approval; keep applications on the brand's Hiring URL. |
| Candidate/application or disposition transfer | Identity, CVs and application status leave Hiring; board-side retention, downstream reuse and rights propagation need separate assessment. | Blocked by separate transfer approval; no bulk export, webhook or MAIL workaround. |

Provider facts were checked against primary documentation on the assessment date:
[Google scopes](https://developers.google.com/workspace/calendar/api/auth),
[Graph permissions](https://learn.microsoft.com/graph/permissions-reference),
[Indeed Job Sync](https://docs.indeed.com/job-sync-api), and
[Indeed integration prerequisites](https://docs.indeed.com/job-sync-api/integrate-with-job-sync-api).
These establish potential capabilities, not verified PAS support, pricing or an
approved commercial relationship. Recheck scopes and terms at implementation.

## Data sharing and consent

Calendar availability requests should contain staff calendar identifiers and bounded
time ranges only; do not persist unrelated event titles or attendee lists. A later
invitation may share the candidate's chosen name, email, interview time/timezone,
duration and a minimal location/link with the selected provider and intended
attendees. Use a neutral event title; exclude CVs, scorecards, notes, protected
characteristics, application tokens and private attachment URLs. Preview exactly
who receives an invitation; calendar guest visibility can expose attendees.

Before any calendar candidate transfer, record the approved processing contract,
purpose, applicable lawful basis and notice version, candidate's informed scheduling
choice, recipients and data fields. Offer manual coordination when declined;
application consent and talent-pool opt-in do not cover provider disclosure.
Provider OAuth consent is staff authorization, not candidate consent. Do not assert
that consent is the only possible legal basis; the owner must record the basis
appropriate to the approved purpose in the existing privacy governance process.

A listing-only board payload is allowlisted published requisition content: brand,
title, description, location, arrangement/pay disclosures and canonical apply URL.
Exclude internal contacts, draft fields and every candidate record. Unpublish or
close must expire the remote listing. Candidate transfer requires its own explicit
notice/basis and any required separate opt-in; listing approval never covers it.

## Security and failure assessment

Any future connector must enforce authenticated organization/brand installation,
owner approval and current recruiter grants server-side on every operation. Verify
candidate/application scope and assignment; deny cross-brand and revoked access.
Keep provider tokens in a trusted server secret store, never browser storage,
MCP parameters or logs. Require OAuth state/PKCE, exact redirect allowlists,
least-privilege scopes, rotation and disconnect/revocation. Do not assume the generic
proxy proves per-organization delegated OAuth isolation; demonstrate that capability
before choosing it. Reject tenant-wide calendar access for the initial pilot.

Use durable operation IDs, provider IDs and version checks for create/reschedule/
cancel; reconcile timeouts before retry to prevent duplicate invitations or listings.
Authenticate callbacks and reject replay/stale versions. Validate timezone and DST,
recipient changes, quotas, outages and concurrent edits. Audit actor, scope,
approval revision and outcome without event bodies, tokens or candidate content.
Disconnect stops queued work and revokes credentials; it does not erase provider
copies. Track provider deletion/correction separately and report partial completion,
including provider retention, backups, legal holds and subprocessors, through
[privacy operations](privacy-operations.md) and [retention](retention.md).

## Commercial and privacy due diligence

Serge must record the actual supplier entity, product/region, processor/controller
roles, approved contract version and signature evidence, permitted purposes, data
fields, residency and cross-border safeguards, subprocessors, retention/deletion,
subject-rights support, incident notice times and support/escalation contact.
Review secondary use, advertising, AI training, resale and onward disclosure;
reject incompatible reuse. No lawyer sign-off is introduced by this assessment.

Pricing, API quotas, partner eligibility, sponsored-listing spend, rate limits,
SLA, support, termination, data portability and exit costs remain unverified.
Obtain written commercial terms and an owner-approved spend cap; default to no
paid postings and no automatic renewal/charge. Neither provider documentation nor
an integration assessment is an approved contract.

## Approval gates and implementation handoff

All gates fail closed. Missing, expired, revoked or mismatched evidence denies work.
Approvals must be bound to provider, organization, brand, purpose, allowlisted fields,
contract revision, approver identity/date and expiry. A global boolean or client-side
checkbox cannot authorize transfer. Changes to scope, provider or terms require review.

1. Calendar pilot: owner approves the processing contract and minimized data flow;
   staff authorizes the specific calendar; candidate scheduling choice/notice is
   recorded; scoped OAuth, security checks and live reconciliation tests pass.
2. Listing-only syndication: owner approves partner/commercial terms, exact public
   listing fields, no-spend default, and publish/update/expire tests. This gate has
   no authority over candidate data.
3. Separate job-board candidate-transfer gate: owner explicitly approves a candidate
   transfer contract, recipients, fields, lawful basis/notice and required consent,
   downstream rights and security evidence. No external candidate transfer without
   approved contract. Calendar or listing approval cannot satisfy this gate.

The follow-up implementer must build a server-enforced approval lookup and default
deny before adding any connector. Test missing/revoked/expired/wrong-brand contracts,
listing approval used for candidate export, minimized payloads, secret redaction,
revoked grants, duplicate sends, timeout reconciliation, cancellation/expiry,
provider deletion failures and disconnect with queued operations. Demonstrate the
two-brand scenarios on a sandbox with synthetic people, then obtain a revision-bound
owner activation decision. This issue completes evaluation only; production gates
remain blocked and no connector is enabled by these documentation tests.
