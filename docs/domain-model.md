# Canonical domain model

Use opaque stable IDs, UTC timestamps, actor attribution and `organization_id` on all tenant-owned records. A self-registered worker account/profile is user-owned and exists independently of an organization; its application links are tenant-scoped. Brand-owned records also carry `brand_id`; application-owned records carry `application_id`. Foreign keys and queries enforce same-organization ownership. Never trust client-provided tenant IDs without a server-side grant check. Use new additive migrations; do not repurpose the starter `items` table.

| Aggregate | Core fields and invariants |
| --- | --- |
| Organization | Name, verified contact, policy version, indefinite retention policy, status; administrative tenant created through public organization sign-up. |
| Brand | Organization, public name, scoped slug, identity, notice version, reply identity, status; publishing requires approval. |
| Membership/grant | Platform user, organization, role and optional brand/requisition scope, status. |
| Requisition | Brand, title, location, employment/compensation type, description version, owner, status, publication window. |
| Worker account/profile | Self-registered platform user/login, user-owned profile and verification metadata; exists before any application or organization association. No shared recruiter access across tenants. |
| Candidate | Tenant/brand-scoped recruiting record with normalized contact identifiers and a link to the self-registered worker where associated; preserves internal provenance without exposing other brands or tenants. Existing internal records may precede that link. |
| Application | Candidate and associated worker identity, brand, requisition, source, submitted snapshot, pipeline version/stage, status, consent, idempotency key. Requisition brand equals application brand. |
| Attachment | Application, private storage key, type, size, checksum, scan state, retention class. Never public R2. |
| Stage event | Prior/new stage, actor, reason, time and pipeline version; append-only history. |
| Interview/scorecard | Application, assignment, scheduled time, criteria, reviewer and submitted version. |
| Decision/offer | Application, human actor, reason, offer terms/version and approval state. |
| Message | Application, direction, MAIL IDs, template/version, recipient, delivery state; message bodies retained indefinitely unless explicitly deleted. |
| Consent/rights request | Purpose, notice version, evidence/time; request type, proof, deadline, outcome. |
| Audit event | Actor, action, object, tenant, timestamp, request ID and redacted change summary. |
| Unpaid arrangement | Requisition and arrangement classification (unpaid, internship or volunteer); no required legal-review record, approval or expiry gate at this stage. |

## Approved design and shipped schema

[Owner approval in issue #52, 21 October 2026](https://github.com/proappstore-online/hiring/issues/52#issuecomment-6309937556) establishes multi-tenant architecture, public organization sign-up, worker self-registration with an independent login/profile linked to applications, indefinite data retention and no required legal review at this stage. Unpaid, internship and volunteer roles have no legal-review gate (#10 closed as won't-do). No scheduled expiry or automatic retention purge is required (#9); explicit deletion requests remain distinct from retention expiry.

The table above describes the canonical design. The shipped migrations currently provide:

- **0003:** organizations, brands, owner/recruiter memberships, draft-only requisitions, brand-scoped internal candidates, applications, stage events, notes, draft outbox messages and audit events. Candidate and requisition composite foreign keys keep applications in the same organization and brand. Applications currently require `source='linkedin'` and provenance/contact context; candidate records have no worker login link. These existing internal records do not implement the approved self-registered worker identity.
- **0004:** assignment history with actor, reason and application version.
- **0005:** operation provenance on notes, outbox messages and requisitions.
- **0006:** nullable `linkedin_profile_url` on candidates alongside the legacy required `linkedin_url`; a separate LinkedIn profile URL is optional.
- **0007:** Gmail communication events and agent activity records, scoped to organization, brand and application, with provider/operation identifiers.
- **0009:** Additive Cloudflare email-worker archives with an exact mailbox, optional bridge namespace, separate opaque message/thread/acceptance/event IDs and append-only storage; legacy Gmail rows remain in their original table. Combined application history reports the actual provider.

- **0008:** independent platform-user-keyed worker profiles with nullable candidate links; organization policy/contact metadata; organization/brand/requisition-scoped grants; requisition metadata and submitted application snapshots; scoped idempotency indexes; consent evidence and explicit rights requests; redacted audit metadata and outbox delivery bookkeeping. Retention defaults to indefinite, with no expiry or legal-review gate. Composite foreign keys constrain new grant/governance references. Insert/update triggers enforce organization/brand/application agreement on existing history, notes, outbox, communications, agent activity and audit tables; application scope is immutable. Existing historical rows are preserved, not retroactively repaired.

**0010:** brand operation provenance and audit update/delete rejection triggers; sibling-brand setup and mutation audit guards are enforced by registered actions. Existing records remain compatible.

Public organization sign-up and worker self-registration flows remain implementation work. Worker identity now links through the scoped candidate; nullable links preserve internally sourced candidates. The new grants table does not replace existing membership authorization until actions explicitly adopt it. Existing requisitions and outbox `status` remain draft-only; `delivery_state` is bookkeeping for future dispatch, not permission to send. No dispatcher or public intake is enabled by 0008. Introduce them through additive migrations while preserving existing internal candidate records and brand isolation; do not treat the existing candidate row as a worker login. The broader aggregates above and transitions below are the design target where the current schema is narrower. Migration tests cover fresh install, populated upgrade, tracked replay, historical migration immutability, scoped reference rejection and deployment ordering. The baseline fixture preserves migrations 0001–0007 for verification even in shallow CI checkouts.

## Transitions

- Requisition: `draft → pending_review → published → paused/closed → archived`; review can return to draft. Unpaid, internship and volunteer classifications do not require legal-review approval to publish.
- Application: `submitted → in_review → shortlisted → offered → hired`; rejection is allowed from `in_review`, `shortlisted` and `offered`. Hired and rejected are terminal. Historical `interviewing`, `decision_pending` and `withdrawn` remain readable with no outgoing transitions. Deletion and reopening are not implemented by the stage action.
- Offer: `draft → pending_approval → approved → sent → accepted/declined/expired`. No email implies approval before approval.
- Rights request: `received → identity_verification → processing → fulfilled/denied_with_reason`; partial failures remain visible.

Each mutation has operation ID, expected version, permitted prior state, actor authorization and audit event in one transaction where possible. External sends use an outbox and idempotency key; a MAIL outage does not undo committed state. Email/phone match suggests a duplicate but never automatically merges or discloses across brands. A merge records provenance and needs a human. Data is retained indefinitely without scheduled expiry, including message bodies; withdrawal or rejection does not trigger automatic deletion. Explicit deletion covers PII, attachments, message bodies, indexes, exports and processor copies, preserving only legally required minimal evidence under the retention policy.

**0011:** separate immutable job/notice publications and closure state; canonical direct-source receipt links; worker-owned idempotent receipts; private attachment reservations, quarantine states and immutable identities. Legacy draft requisition and LinkedIn source CHECK constraints remain untouched. See [intake contract](candidate-intake.md) for canonical read semantics and unverified scanner/reviewer serving gates.

**0012:** durable legacy membership revocations and an effective-access view combining active organization/brand/requisition grants with existing memberships. [Server permissions](permissions.md) defines role, assignment and administration behavior.

**0015:** versioned requisition review payloads and immutable compensation classification; publication pause/resume controls gate public reads and submissions without changing legacy CHECK constraints. Owner approval binds staged notice and job content exactly. See [requisition lifecycle](candidate-intake.md#requisition-lifecycle-15). The approved #52 policy continues to supersede the original #15 legal-review criterion.

## Application stage contract v1 (#20)

The current operational flow is:
`submitted → in_review → shortlisted → offered → hired`, with rejection from
`in_review`, `shortlisted` or `offered`. Hired and rejected are terminal.
Historical `interviewing`, `decision_pending` and `withdrawn` records remain
readable; this contract provides no outgoing transitions for them or reopening.
No stage change grants publication, review approval or email sending authority.

`web/src/application-stages.json` is the static source for UI choices and the
registered SQL predicate. Run `node scripts/application-stages.mjs --write`
after changing it; contract tests check generated SQL and every allowed/denied edge.
The SQL checks the stored canonical prior stage as well as the supplied prior
stage, expected version, current owner/recruiter requisition authority, reason
and unused operation ID. State, attributed stage history and audit commit in one
batch. Replays and denials change nothing, using the existing zero-change action
contract (not a new HTTP error mapping).

Migration `0023_application_stage_contract` is additive: the legacy stage CHECK
cannot accept `shortlisted`, so nullable `stage_extension='shortlisted'` is allowed
only alongside legacy `stage='in_review'`. Canonical stage is
`COALESCE(stage_extension,stage)` in every registered application read and stage
mutation. Other stages clear the extension. Existing rows and applied migrations
are unchanged. Consumers must use registered read models rather than interpreting
the legacy column alone. Stage-event UPDATE and DELETE now abort, preserving
append-only evidence alongside the existing immutable audit.
