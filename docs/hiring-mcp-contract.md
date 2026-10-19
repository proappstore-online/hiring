# Hiring MCP contract

The first implementation retires the template `items` actions and registers only `get_hiring_runtime_gate`, a bounded public read of non-sensitive intake availability. It grants no access to applicant data. Registered actions deploy before frontend upload and must match `migrations.json`. All future tenant-scoped Hiring tools run through a trusted authorization path. Natural-language requests and candidate content are untrusted input; tool descriptions alone cannot enforce access.

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

Verify whether `mcp.json` supports worker-backed authorization and typed results. If it only supports direct SQL with `:__user_id`, hold sensitive tools until a gateway exists. Replace sample actions only after schema and gateway. Contract tests cover roles, cross-brand IDs, pagination, stale versions, retry duplication, malicious candidate content and schema/tool coherence.
