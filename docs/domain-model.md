# Canonical domain model

Use opaque stable IDs, UTC timestamps, actor attribution and `organization_id` on all records. Brand-owned records also carry `brand_id`; application-owned records carry `application_id`. Foreign keys and queries enforce same-organization ownership. Never trust client-provided tenant IDs without a server-side grant check. Use new additive migrations; do not repurpose the starter `items` table.

| Aggregate | Core fields and invariants |
| --- | --- |
| Organization | Name, verified contact, policy version, retention settings, status; administrative tenant. |
| Brand | Organization, public name, scoped slug, identity, notice version, reply identity, status; publishing requires approval. |
| Membership/grant | Platform user, organization, role and optional brand/requisition scope, status. |
| Requisition | Brand, title, location, employment/compensation type, description version, owner, status, publication window. |
| Candidate | Organization, normalized contact identifiers, profile and verification metadata; internal identity, not a public login. |
| Application | Candidate, brand, requisition, source, submitted snapshot, pipeline version/stage, status, consent, idempotency key. Requisition brand equals application brand. |
| Attachment | Application, private storage key, type, size, checksum, scan state, retention class. Never public R2. |
| Stage event | Prior/new stage, actor, reason, time and pipeline version; append-only history. |
| Interview/scorecard | Application, assignment, scheduled time, criteria, reviewer and submitted version. |
| Decision/offer | Application, human actor, reason, offer terms/version and approval state. |
| Message | Application, direction, MAIL IDs, template/version, recipient, delivery state; body retention separate. |
| Consent/rights request | Purpose, notice version, evidence/time; request type, proof, deadline, outcome. |
| Audit event | Actor, action, object, tenant, timestamp, request ID and redacted change summary. |
| Unpaid review | Requisition, jurisdiction, arrangement, rationale, reviewer, evidence, expiry and state. |

## Transitions

- Requisition: `draft → pending_review → published → paused/closed → archived`; review can return to draft. Unpaid classifications cannot publish before approval.
- Application: `submitted → in_review → interviewing → decision_pending → offered → hired` or `rejected`; `withdrawn` and `deleted` are terminal operational states. Reopening is an audited action; deleted cannot reopen.
- Offer: `draft → pending_approval → approved → sent → accepted/declined/expired`. No email implies approval before approval.
- Rights request: `received → identity_verification → processing → fulfilled/denied_with_reason`; partial failures remain visible.

Each mutation has operation ID, expected version, permitted prior state, actor authorization and audit event in one transaction where possible. External sends use an outbox and idempotency key; a MAIL outage does not undo committed state. Email/phone match suggests a duplicate but never automatically merges or discloses across brands. A merge records provenance and needs a human. Deletion covers PII, attachments, message bodies, indexes, exports and processor copies, preserving only legally required minimal evidence under the retention policy.
