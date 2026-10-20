# Architecture and ADRs

The current repo has a React client (`web/`), Astro marketing site (`marketing/`), D1 schema (`migrations.json`), registered SQL tools (`mcp.json`) and main-branch deploy. Deploy applies migrations, deploys an optional worker, registers tools, then uploads the frontend. D1 requires an authenticated platform user. Public candidate intake therefore needs a supported, abuse-protected server route; it cannot be an anonymous browser `app.db` call. Verify app-worker availability before building intake. If unavailable, that milestone is blocked until a supported route exists.

## Capability check in issue #7

Verified against the platform source at `platform@ee78178` (`docs/app-workers.md`, `docs/app-actions-security.md`, `docs/mcp-app-tools.md`, `docs/authorization-model.md`), not only the public agent guide. Evidence is source-level; the live enablement state of the `hiring` app was not checked.

- **App workers are a prototype.** They run only for apps a platform admin enabled with `pas worker enable <appId>` (at most 5, first-party). Deploys for any other app are refused with `403 app workers are not enabled for this app`. The source says no production app was enabled at that commit.
- **Worker routes need a signed-in user.** `/.pas/worker/*` requires a signed-in user with CSRF checks and runs registered actions as that user. The worker has no URL of its own and no D1, KV, R2 or queue binding. Hooks have public URLs, but each delivery's signature is verified before app code runs; they are for provider callbacks, not candidate submissions.
- **Anonymous writes are not supported.** `requires_auth: false` is allowed only for constrained public `query` tools with no `:__user_id`, no roles and `LIMIT` of at most 500. Anonymous action calls are limited to 120 per 60 seconds per app and client IP. Candidate writes must therefore be `requires_auth: true`, which means a signed-in platform user.
- **Batch limits.** MCP `batch` tools run up to 25 statements in one D1 transaction with a shared params pool. The worker SDK's `pas.actions.batch` documents 500 statements and 1 MB per transaction. Hiring uses only MCP batch tools; its largest batch is 5 statements (`create_workspace`).
- **Tool cap.** The source sets 500 tools per app (`MAX_TOOLS_PER_APP`, raised from 120 by #116). The public agent guide still says 120. Hiring registers 22 (18 plus four gateway reads).
- **Worker-backed authorization** exists through `callers: ["worker"]`, but a worker or hook runs as `system:worker` or `system:hook`, which holds no roles. A trusted gateway would have to check the signed-in user in worker code, and that needs admin enablement first.
- **Typed results** are not documented in the platform sources checked. Treat them as unsupported until verified.
- **`mcp.json` rules checked locally.** Every statement of an authenticated tool references `:__user_id` or a membership `EXISTS`, every `:param` is declared, and no statement contains a semicolon.

Result: no supported, abuse-protected anonymous write route exists, and enabling the worker would not change that, since its browser route also needs sign-in. Public intake (#16) stays blocked. Direct SQL actions remain unsuitable for high-impact multi-step grants without a proven trusted gateway (#32).

Migration `0002_hiring_runtime_gate` starts candidate intake closed. That public gate remains closed. Migration `0003_internal_workspace` and authenticated, membership-scoped SQL actions support internal staff sourcing only; template `items` tools are retired. There is no public application form. Opening the gate or deploying a public intake route remains blocked on platform capability verification, privacy approval and the later intake implementation issues.

## ADR-001 — Tenant authorization

D1 is canonical. Every business record is organization-scoped and brand data is additionally brand-scoped. Platform auth identifies the user, and `app.roles` gates app-level administration; Hiring-owned membership/grant records express organization, brand, requisition and assignment scope. For the first internal workflow, registered PAS SQL actions enforce exact organization/brand membership in every statement and atomic batches record audit events with writes. Browser filters are display aids, never policy. Wider grant administration and high-impact workflows still need a stronger trusted authorization path.

**Gateway boundary (issue #32, provisional pending #53).** The MCP gateway is enforced at the SQL layer: read-only registered actions that derive identity from `:__user_id`, require a brand membership with role `owner` or `recruiter`, return restricted fields and cap pages at 25. The worker route is admin-gated (`pas worker enable hiring`), not verified as enabled, and no worker is deployed, so per-user rate limits, denial audit and structured error codes are not enforced server-side. See [hiring MCP contract](hiring-mcp-contract.md#trusted-gateway-issue-32).

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
