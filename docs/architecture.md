# Architecture and ADRs

The current repo has a React client (`web/`), Astro marketing site (`marketing/`), D1 schema (`migrations.json`), registered SQL tools (`mcp.json`) and main-branch deploy. Deploy applies migrations, deploys an optional worker, registers tools, then uploads the frontend. D1 requires an authenticated platform user. Public candidate intake therefore needs a supported, abuse-protected server route; it cannot be an anonymous browser `app.db` call. Verify app-worker availability before building intake. If unavailable, that milestone is blocked until a supported route exists.

## Capability check in issue #7

The platform [app-worker reference](https://github.com/proappstore-online/platform/blob/main/docs/app-workers.md) currently marks app workers as an opt-in prototype; deployment is refused with 403 when an app is not enabled. Its `/.pas/worker/*` browser route is for signed-in users only, so it does not provide anonymous candidate intake. The worker has no direct D1 or R2 binding; data calls go through registered actions. The SDK documents D1 `batch` as transactional, while the action executor supports a bounded atomic batch with per-statement caller scoping. Direct SQL actions therefore remain unsuitable for high-impact multi-step Hiring grants without a proven trusted authorization path. These are platform contract findings, not evidence that the `hiring` app has been enabled on the live platform.

Migration `0002_hiring_runtime_gate` starts candidate intake closed. That public gate remains closed. Migration `0003_internal_workspace` and authenticated, membership-scoped SQL actions support internal staff sourcing only; template `items` tools are retired. There is no public application form. Opening the gate or deploying a public intake route remains blocked on platform capability verification, privacy approval and the later intake implementation issues.

## ADR-001 — Tenant authorization

D1 is canonical. Every business record is organization-scoped and brand data is additionally brand-scoped. Platform auth identifies the user, and `app.roles` gates app-level administration; Hiring-owned membership/grant records express organization, brand, requisition and assignment scope. For the first internal workflow, registered PAS SQL actions enforce exact organization/brand membership in every statement and atomic batches record audit events with writes. Browser filters are display aids, never policy. Wider grant administration and high-impact workflows still need a stronger trusted authorization path.

## ADR-002 — Candidate boundary

Public intake uses a server endpoint with bot/rate controls, consent evidence, file scanning and idempotency. A short-lived, scoped candidate token supports status and rights requests. Never put D1/R2 credentials or platform app tokens in the candidate browser. Submission and outbox event commit together.

## ADR-003 — Schema and deploy

`migrations.json` is authoritative, additive and immutable once applied. Deploy schema expansion before dependent tools/UI. Migration failure stops deploy. New MCP actions refer only to existing columns; preserve compatibility for active clients. Retire template `items` actions deliberately; the additive policy may leave their unused table. No branch or PR workflow.

## ADR-004 — Side effects

MAIL and other external systems receive transactional outbox jobs with stable IDs, bounded payloads, retries/backoff, dead-letter visibility and operator replay. Authenticate and deduplicate callbacks. UI distinguishes committed business state from delivery state.

## ADR-005 — Files, search and audit

Attachments use private R2 keys and short-lived, access-checked downloads. Enforce MIME/size limits and malware scan before reviewer access. Search obeys current brand grants, regardless of index contents. No PII in analytics, logs, URLs or public metadata. Audit is append-only and redacted. AI can draft only when enabled and logged; final disposition is human-attributed.

## Operational gates

Use request IDs across UI, worker, D1, MAIL and MCP. Monitor queue age, failures, denials and migration outcome without raw candidate data. Test backup and restore, including replay of deletion tombstones. Keep secrets in platform secret storage. Threat-model public intake, cross-brand access, attachments, candidate tokens, spoofed mail and MCP prompt injection. First implementation issue verifies current worker, D1 transaction and MCP capabilities against the actual platform.
