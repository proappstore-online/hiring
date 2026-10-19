# Architecture and ADRs

The current repo has a React client (`web/`), Astro marketing site (`marketing/`), D1 schema (`migrations.json`), registered SQL tools (`mcp.json`) and main-branch deploy. Deploy applies migrations, deploys an optional worker, registers tools, then uploads the frontend. D1 requires an authenticated platform user. Public candidate intake therefore needs a supported, abuse-protected server route; it cannot be an anonymous browser `app.db` call. Verify app-worker availability before building intake. If unavailable, that milestone is blocked until a supported route exists.

## ADR-001 — Tenant authorization

D1 is canonical. Every business record is organization-scoped and brand data is additionally brand-scoped. Platform auth identifies the user, and `app.roles` gates app-level administration; Hiring-owned membership/grant records express organization, brand, requisition and assignment scope. A trusted server path enforces both for every sensitive read and mutation. Browser filters are display aids, never policy. Direct `mcp.json` SQL is unsuitable for multi-step grants unless its runtime demonstrably enforces them.

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
