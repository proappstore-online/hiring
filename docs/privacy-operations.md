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
workspace clears the UI state. Intake from candidates themselves, evidence upload,
rectification execution and legally complete erasure are still separate work.

## Private scoped core export

1. Record an access/export request and finish identity review into processing.
2. Call passkey-gated `request_candidate_export` with exact scope, application,
   rights request and a fresh `request_id`. It derives authorization on the server
   and commits authorized/not_found evidence before data retrieval.
3. Call `get_candidate_export` with the identical parameters. The handle is private,
   bound to the requesting principal, brand and application, and expires after
   900000 milliseconds (15 minutes) using server time. It grants no public URL.
   Repeating the authorization does not extend expiry. Use a new handle for a
   deliberately renewed authorization.

Every retrieval rechecks current owner access, verified processing status, scope,
expiry and erasure tombstones. Another principal cannot redeem the handle. An
erasure request immediately invalidates outstanding export access. No export
payload is persisted in the database or sent to MAIL. The UI downloads an ephemeral
JSON Blob and releases its object URL. Downloaded copies are outside server control.

The explicit projection includes candidate core contact/profile fields, the
candidate's application summaries in this brand, and consent/notice metadata.
It excludes confidential notes, sourcing context, review/scorecard/decision text,
mail archives, internal staff details, storage keys, file bytes and the independent
worker account. This is labeled `scoped_core_export`, **not a complete subject
access export**. Async assembly, secure file-byte export and review of other
subject data remain #30 work; the new action must not be used as evidence that
#30's whole export contract has been delivered.

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
([erasure contract](erasure.md)). Complete export/async retrieval, candidate-facing
rights intake/execution and comprehensive legacy-action failure/denial auditing also
remain. Changing a checkbox cannot supply these missing capabilities. The current
owner-approved retention policy intentionally requires no scheduler.

Tests execute deployed SQL across two sibling brands, including denial masking,
forged claims, stale versions, receipt/operation replays, expiry, live revocation,
export exclusions, erasure invalidation and audit rollback. Browser coverage drives
rights receipt/identity review/core download and erasure at 375px using synthetic
transport and passkey stubs. No provider or live WebAuthn ceremony is claimed.
