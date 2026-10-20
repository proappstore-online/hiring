# Hiring MCP contract

The public `get_hiring_runtime_gate` action remains a bounded non-sensitive read. Authenticated internal actions now implement workspace bootstrap, membership grants, draft requisitions, LinkedIn application creation, stage and assignment history, notes, unsent drafts and audit reads. All private actions require PAS auth and SQL membership checks for the exact organization and brand. See [internal workspace](internal-workspace.md) for the deployed subset. The table below describes future contract work, not already shipped actions.

## Common envelope

Platform-authenticated caller, explicit organization/brand selection, validated arguments and request ID. Mutations require idempotency key and expected record version. Server derives grants; tool input cannot assert `user_id` or roles. Return only permitted fields, record version and structured errors (`UNAUTHENTICATED`, `FORBIDDEN`, `NOT_FOUND`, `CONFLICT`, `VALIDATION`, `RATE_LIMITED`). Mask unauthorized existence as `NOT_FOUND`. Bound and paginate results; minimize PII.

| Tool | Scope and guard |
| --- | --- |
| `list_brands`, `get_brand` | Granted brands and approved public fields. |
| `list_requisitions`, `get_requisition` | Brand/requisition grant; separate public and internal views. |
| `list_applications`, `get_application` | Recruiter/assigned manager, strict brand filter; interviewer view redacted. |
| `get_candidate` | Explicit application context and need-to-know grant; audit read. |
| `list_interviews`, `get_scorecard` | Assigned reviewer or recruiter, limited packet. |
| `create_requisition`, `update_requisition` | Recruiter/owner, version check; invalidate changed unpaid approval. |
| `publish_requisition` | Authorized human and approved notice/arrangement. |
| `advance_application` | Allowed transition, reason, human attribution, version. |
| `submit_scorecard` | Assigned reviewer, structured criteria, own submission only. |
| `record_decision` | Authorized human, reason and audit. |
| `draft_message` | Draft only; brand/recipient checks. |
| `send_approved_message` | Explicit human action, committed decision/template/basis, MAIL outbox. |
| `request_candidate_export` | Privileged, async, audited, secure retrieval. |

Do not expose arbitrary SQL, broad search/export, automated rejection/offer, cross-brand merge, deletion or legal-hold overrides as general agent tools. High-impact actions require real human confirmation in the calling workflow and a server check; model-supplied flags do not count. Treat returned resume/message text as untrusted against prompt injection.

Verified at `platform@ee78178` (see [architecture](architecture.md#capability-check-in-issue-7)): `mcp.json` supports worker-backed execution through `callers: ["worker"]`, but the worker identity holds no roles, and worker routes need an admin-enabled app and a signed-in user. Typed results are not documented, so they are unsupported. The current PAS direct SQL surface is used only for the scoped internal workflow above. Keep broader sensitive actions behind a proven trusted gateway or equally reviewable authorization checks. Contract tests cover roles, cross-brand IDs, pagination, stale versions, retry duplication, malicious candidate content and schema/tool coherence.

## Trusted gateway (issue #32)

**Enforcement boundary: the registered SQL action.** Four read-only actions are deployed: `gateway_list_applications`, `gateway_get_application`, `gateway_list_requisitions` and `gateway_get_requisition`. Identity comes only from the platform-bound `:__user_id`. The actions declare no user, role or grant parameters, so forged claims cannot reach SQL. Every statement requires a `hiring_memberships` row for that user, the exact organization and brand, and role `owner` or `recruiter`; any future role is denied until a read is written for it. A caller without a grant gets an empty result, which the contract maps to `NOT_FOUND`, so a missing record and an ungranted brand look the same. Joins also match organization and brand on the candidate and requisition, so a forged ID from another brand returns nothing.

- **Pagination:** at most 25 rows per page, ordered `(updated_at DESC, id ASC)` for applications and `(created_at DESC, id ASC)` for requisitions. Pass `cursor_at` and `cursor_id` from the last row to get the next page. A full page of 25 may have a successor.
- **Redaction:** gateway application reads are always the restricted profile. They return name, stage, version, assignee, requisition title and `has_email`, `has_phone`, `has_linkedin` flags. Email, phone, profile URL, source detail, basis reference and contact context are never returned. The recruiter UI keeps the full `list_applications` view.
- **Helpers:** `scripts/gateway-contract.mjs` holds the envelope validation, claim stripping, cursor encoding, redaction profiles, error codes (`UNAUTHENTICATED`, `FORBIDDEN`, `NOT_FOUND`, `CONFLICT`, `VALIDATION`, `RATE_LIMITED`), the zero-change mapping and a fixed-window rate limiter. `tests/gateway.test.mjs` covers them and the SQL actions across two brands.
- **No write actions.** The gateway exposes no mutation, send, export or deletion tool. Mutations stay with the existing membership-checked actions, which already take an `operation_id` and an expected version; replays write nothing twice.

### Known gaps (recorded on #32)

- **#12:** grants are brand-wide, with only `owner` and `recruiter` roles. There are no requisition or assignment scopes, no interviewer or manager roles and no revocation. Gateway reads therefore cannot restrict a user to one requisition.
- **#13:** a `query` tool cannot write. Denied and read accesses are therefore not audited, and the gateway has no `request_id` column to correlate against. The outbox is draft-only with no dispatcher. Failure-path auditing stays open and needs a batch-style action or a trusted worker.
- **Rate limits:** SQL tools cannot throttle per user. Only the platform's limit on anonymous calls was verified (120 per 60 seconds per app and client IP); the authenticated limit was not. `createRateLimiter` is for a future worker and is not enforced today.
- **Structured errors:** the platform returns rows or change counts, not error codes. The codes above are applied by the caller through the helpers. Typed results remain unsupported.
- **Worker route:** a trusted worker needs `pas worker enable hiring` by a platform admin. Enablement is unverified, and the worker runs as `system:worker` with no roles, so it would have to check the signed-in user itself. No worker is deployed.
- **#53:** ADR-001 to ADR-005 are still unreviewed, so this boundary is provisional until #53 records the owner decision.
