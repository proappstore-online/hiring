# Privacy operations and audited MCP access (#5)

Migration `0030_privacy_operations` adds append-only rights events, content-free
access authorization evidence and caller-reported retrieval uncertainty. Earlier
migrations, archive protection and erasure fences remain intact. Retention remains
indefinite; no purge schedule or automatic hold expiry is introduced.

## Rights request tracking

`record_candidate_rights_event` requires authenticated brand-wide owner authority
and platform passkey step-up. Select an exact application and a stable request ID.
Record request type, responsible current brand-wide owner, explicit deadline and
opaque identity/decision case references. References must not contain identity
documents or free-text personal data. Deadline selection is an operator decision;
no jurisdictional deadline is guessed.

Versions are append-only. The flow is received → identity_verification → processing
→ fulfilled; each nonterminal state may instead become denied_with_reason. Only
access/export can be marked fulfilled through this action, after human review and
a decision/delivery evidence reference. This is a human attestation, not automatic
proof of complete delivery. Deletion, correction, withdrawal and objection cannot
be marked fulfilled by this endpoint. Processing requires an identity case reference.
An old version, changed scope/type, reused operation, forged actor or unauthorized
owner changes nothing. Missing and unauthorized history return the same empty rows.
`list_candidate_rights_events` pages by `(created_at DESC,id DESC)`, 50 at a time.
History and content-free business audit commit together. Audit failure rolls both
back. The UI retains operation IDs after uncertainty and reads history before
reporting a change as committed.

The Compliance screen provides receipt, verification, processing, denial and reviewed
access/export fulfillment controls. Ownership starts with the current owner; the
registered action can assign another current brand-wide owner. Changing role or
workspace clears the UI state. Candidate intake is described below. Evidence upload, rectification execution
and legally complete erasure remain separate execution work.

## Private asynchronous subject export (#30)

After identity review reaches processing, use the Compliance screen's “Prepare or
download private export” control. It calls passkey-gated `request_candidate_export`
and `queue_candidate_export` with exact organization, brand, application, rights
request and a stable request ID. Queueing returns no subject content. Repeating a
request never extends its server-derived 15-minute authorization.

Assembly is a separate resumable transaction. `prepare_candidate_export` allows
only the requesting current brand-wide owner with passkey step-up. A trusted
worker may instead poll `list_candidate_export_queue` and run
`assemble_candidate_export` through `worker/exports.mjs`. No worker deployment or
scheduler is required for the interactive path; no automatic worker scheduling is
claimed. The first UI action prepares the job; the next checks readiness and
downloads. Lost responses reconcile through `get_candidate_export_status`.

SQL assembles a durable private JSON snapshot from explicit fields: candidate
contact/profile data, same-brand application summaries, consent/notice metadata,
submitted statements and attachment metadata. It excludes confidential sourcing,
notes, reviews, decisions, internal correspondence, independent worker account
data, private storage keys and file bytes. The artifact includes its coverage and
exclusions; it is not an attestation that every possible subject-access disclosure
has been reviewed or delivered. File bytes continue through separately authorized
private file retrieval, not this JSON artifact. Review exclusions and any additional
required disclosures before recording fulfillment.

Each download calls passkey-gated `authorize_candidate_export_download` with a
fresh access ID, recording authorized/not_found evidence before
`download_candidate_export`. Its principal-bound read receipt lasts at most one
minute and never extends the artifact's 15-minute expiry. Every status, assembly
and retrieval rechecks current owner grants, latest verified processing status,
exact scope, expiry and erasure. Missing and denied return identical empty rows.
There is no public URL or bearer token. Audit failure rolls back authorization or
readiness. Failed/uncertain reads record `record_privacy_read_failure` where
available; evidence records attempts, not proof that a human saved a file.

Snapshots remain private under indefinite retention; expiry revokes access rather
than scheduling a purge. Explicit erasure deletes the snapshot in the same
transaction as its tombstone and prevents reassembly. Downloaded copies remain
outside server control. The legacy core-query actions remain compatible but the
Compliance UI uses the asynchronous snapshot and per-download audit path.

## Audited restricted MCP reads

Use `authorize_gateway_*` followed by the matching `audited_gateway_*` read for
applications and requisitions. The existing gateway parameter contract is preserved
with an added `request_id`. Authorization runs the real scoped read predicate and
records authorized/not_found. Missing and denied have the same outcome. The
receipt is principal/scope/action/target-bound and expires after 60 seconds. Lists
retain a 25-row page limit. All original role, assignment, redaction and keyset
constraints are rechecked during retrieval. A receipt is an access-attempt record,
not a new grant. It may authorize repeated readback within its short lifetime;
this is not a separate audit event for each SQL polling call.

The browser's shared `read` helper routes existing `gateway_*` calls through this
sequence. MCP callers should use the same sequence or `auditedGatewayRead` from
`scripts/privacy.mjs`. Legacy `gateway_*` actions remain available for compatibility
and do not acquire audit by being called directly. Other older SQL read/mutation
surfaces also have their existing audit limitations. Therefore comprehensive denial
and failure auditing across *all* registered actions is not claimed.

`hiring_privacy_access` retains requested opaque scope/target IDs, actor, action,
outcome and timestamps. It stores no query strings, payloads, contact data or error
text. It deliberately has no foreign key to the requested scope: nonexistent and
cross-brand scope attempts must also be recorded. For valid scope the same
transaction additionally appends the existing business audit. Invalid scopes remain
in the access ledger. Brand-wide owners/auditors can page their scope through
`list_privacy_access_events`; it does not return target IDs or payloads.

Retrieval exceptions in the coordinator append `hiring_privacy_read_failures`
through `record_privacy_read_failure`. Only the original receipt owner can append;
retries do not duplicate evidence. The event means **caller-reported unconfirmed
retrieval**, not proof that the server did not return data. A read failure cannot
roll back the previously committed authorization. If audit storage itself is down,
logging can also fail; the code never reports that such a failure was logged.
Platform authentication/validation failures before SQL are not covered by this
application ledger.

## Remaining acceptance gaps

Issue #5 is not fully resolved by this change. Complete deletion still lacks cleanup
of protected content, file bytes, indexes, backups and verified processor propagation
([erasure contract](erasure.md)). Complete rights execution and comprehensive legacy-action failure/denial auditing also
remain. Changing a checkbox cannot supply these missing capabilities. The current
owner-approved retention policy intentionally requires no scheduler.

Tests execute deployed SQL across two sibling brands, including denial masking,
forged claims, stale versions, receipt/operation replays, expiry, live revocation,
export exclusions, erasure invalidation and audit rollback. Browser coverage drives
rights receipt/identity review/core download and erasure at 375px using synthetic
transport and passkey stubs. No provider or live WebAuthn ceremony is claimed.

## Candidate request intake and scoped identity review (#29)

Authenticated candidates can submit access, correction, withdrawal and erasure
(`deletion`) requests from their application detail page. `submit_my_rights_request`
checks the authenticated principal against the exact organization, brand and
application intake receipt; email similarity and staff membership grant no access.
Missing, foreign and unowned applications cause no write. Retrying the same request
ID creates no duplicate. Confirm uncertain writes with `list_my_rights_requests`.
Candidate status excludes identity/decision references and other applications.
Both list endpoints page newest first using exclusive `before_at`/`before_id` (50).

Owners load `list_brand_rights_intake` in Compliance and select a receipt. Record
its unchanged request ID, type and application through the existing rights action,
assign a current brand-wide owner and determine the deadline from the original
receipt time and applicable jurisdiction. Unassigned receipts explicitly show that
owner/deadline review is pending; the app does not invent a statutory deadline.
Receipt time, review events, owner, deadline, decision and completion are durable.
The additive `0038_subject_rights_intake` migration makes receipts immutable and
commits content-free audit evidence atomically. A receipt ID cannot be adopted
into another scope or request type.

Identity review is proportionate and human-operated:

1. Start with the exact application and brand. An authenticated intake receipt
   proves account association, not automatically sufficient identity for disclosure.
2. Assess the request's sensitivity and existing trusted account/channel evidence.
   Use the organization's approved private process for additional evidence only
   when needed. Do not ask about or disclose applications at sibling brands.
3. For sourced candidates or inaccessible accounts, accept the request through the
   organization contact in its notice and use owner-assisted receipt tracking.
   Do not use email searches to confirm whether another brand has an application.
   Use the same neutral acknowledgement for unknown and mismatched identities.
4. Record only an opaque private case reference after review. Passkey verification
   authenticates the owner performing the review; it does not verify the subject.
   Processing and export remain blocked until the review is recorded.
5. Denials require an opaque decision reference. Communicate the reason privately
   through the verified channel without disclosing other-brand records.

`attest_candidate_rights_completion` adds owner/passkey-gated human completion
attestation for correction, withdrawal and deletion after verified processing.
It requires decision/execution evidence and preserves the version/audit guards.
Review all applicable stores and processor outcomes first; core erasure, a held
request or a pending processor step is not complete deletion. This action records
reviewed completion and does not execute correction, withdrawal or erasure.
Access/export retain human completion attestation after the asynchronous export and exclusion review.
The candidate sees completion status, not private evidence or identity documents.
Indefinite retention and legal holds remain unchanged. Additional subject-access disclosure review
and erasure execution continue under privacy operations and erasure contracts (#31).
