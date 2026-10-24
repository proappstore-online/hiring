# Architecture and ADRs

The current repo has a React client (`web/`), Astro marketing site (`marketing/`), D1 schema (`migrations.json`), registered SQL tools (`mcp.json`) and main-branch deploy. Deploy applies migrations, deploys an optional worker, registers tools, then uploads the frontend. D1 requires an authenticated platform user. Public candidate intake therefore needs a supported, abuse-protected server route; it cannot be an anonymous browser `app.db` call. Verify app-worker availability before building intake. If unavailable, that milestone is blocked until a supported route exists.

## Capability check in issue #7

Verified against the platform source at `platform@ee78178` (`docs/app-workers.md`, `docs/app-actions-security.md`, `docs/mcp-app-tools.md`, `docs/authorization-model.md`), not only the public agent guide. Evidence is source-level; the live enablement state of the `hiring` app was not checked.

- **App workers are a prototype.** They run only for apps a platform admin enabled with `pas worker enable <appId>` (at most 5, first-party). Deploys for any other app are refused with `403 app workers are not enabled for this app`. The source says no production app was enabled at that commit.
- **Worker routes need a signed-in user.** `/.pas/worker/*` requires a signed-in user with CSRF checks and runs registered actions as that user. The worker has no URL of its own and no D1, KV, R2 or queue binding. Hooks have public URLs, but each delivery's signature is verified before app code runs; they are for provider callbacks, not candidate submissions.
- **Anonymous writes are not supported.** `requires_auth: false` is allowed only for constrained public `query` tools with no `:__user_id`, no roles and `LIMIT` of at most 500. Anonymous action calls are limited to 120 per 60 seconds per app and client IP. Candidate writes must therefore be `requires_auth: true`, which means a signed-in platform user.
- **Batch limits.** MCP `batch` tools run up to 25 statements in one D1 transaction with a shared params pool. The worker SDK's `pas.actions.batch` documents 500 statements and 1 MB per transaction. Hiring uses only MCP batch tools; its largest batch is 5 statements (`create_workspace`).
- **Tool cap.** The source sets 500 tools per app (`MAX_TOOLS_PER_APP`, raised from 120 by #116). The public agent guide still says 120. Hiring currently registers 26 tools (including four gateway reads); the earlier #7 snapshot had 18.
- **Worker-backed authorization** exists through `callers: ["worker"]`, but a worker or hook runs as `system:worker` or `system:hook`, which holds no roles. A trusted gateway would have to check the signed-in user in worker code, and that needs admin enablement first.
- **Typed results** are not documented in the platform sources checked. Treat them as unsupported until verified.
- **`mcp.json` rules checked locally.** Every statement of an authenticated tool references `:__user_id` or a membership `EXISTS`, every `:param` is declared, and no statement contains a semicolon.

Result: no supported, abuse-protected anonymous write route exists, and enabling the worker would not change that, since its browser route also needs sign-in. Anonymous intake (#16) stays unsupported; the approved signed-in worker flow still needs implementation and abuse controls. Direct SQL actions remain unsuitable for high-impact multi-step grants without a proven trusted gateway (#32).

Migration `0002_hiring_runtime_gate` starts candidate intake closed. That public gate remains closed. Migration `0003_internal_workspace` and authenticated, membership-scoped SQL actions support internal staff sourcing only; template `items` tools are retired. There is no public application form. Opening the gate requires the later intake implementation and security evidence. Policy decisions in #52 and #9 are resolved; they are not outstanding legal-review or retention blockers.

## Decision review — issue #53, 21 October 2026

Decision owner: **Serge (serge-ivo)**. This review applies [the approved owner decisions](https://github.com/proappstore-online/hiring/issues/52#issuecomment-6309937556) and [privacy policy completion (#9)](https://github.com/proappstore-online/hiring/issues/9). Evidence: [platform discovery #7](https://github.com/proappstore-online/hiring/issues/7#issuecomment-6285007874), [MAIL discovery #8](https://github.com/proappstore-online/hiring/issues/8#issuecomment-6286791370), and the [current Cloudflare/PAGS mail work #58](https://github.com/proappstore-online/hiring/issues/58). These are dated discovery results, not a fresh production capability probe. Accepted/Revised records design disposition; neither status claims unimplemented features are live.

## ADR-001 — Tenant authorization

**Status: Revised. Owner: Serge. Reviewed: 2026-10-21.** Evidence: [discovery #7](https://github.com/proappstore-online/hiring/issues/7), [owner approval #52](https://github.com/proappstore-online/hiring/issues/52#issuecomment-6309937556).

D1 is canonical. Every business record is organization-scoped and brand data is additionally brand-scoped. Platform auth identifies the user, and `app.roles` gates app-level administration; Hiring-owned membership/grant records express organization, brand, requisition and assignment scope. For the first internal workflow, registered PAS SQL actions enforce exact organization/brand membership in every statement and atomic batches record audit events with writes. Browser filters are display aids, never policy. Wider grant administration and high-impact workflows still need a stronger trusted authorization path.

**Reviewed gateway boundary (issues #32 and #53).** The MCP gateway is enforced at the SQL layer: read-only registered actions that derive identity from `:__user_id`, require a brand membership with role `owner` or `recruiter`, return restricted fields and cap pages at 25. The worker route is admin-gated (`pas worker enable hiring`), not verified as enabled, and no worker is deployed, so per-user rate limits, denial audit and structured error codes are not enforced server-side. See [hiring MCP contract](hiring-mcp-contract.md#trusted-gateway-issue-32).

## ADR-002 — Candidate boundary

**Status: Revised. Owner: Serge. Reviewed: 2026-10-21.** Evidence: [discovery #7](https://github.com/proappstore-online/hiring/issues/7), [owner approval #52](https://github.com/proappstore-online/hiring/issues/52#issuecomment-6309937556).

Public organization sign-up and independently self-registered worker accounts are approved. Public discovery/sign-up does not imply anonymous D1 writes. The supported write boundary is a platform-authenticated registered action deriving identity from `:__user_id`, with server-enforced worker ownership and organization/brand/application checks. Existing recruiter-only actions cannot be reused as worker authorization. Workers need their own account/profile and application link through additive schema work.

The proposed anonymous server endpoint is revised: #7 found no supported anonymous write route. An admin-enabled worker browser route also requires sign-in and does not solve that gap. A future intake flow must provide abuse/rate controls, notice evidence, idempotency and private-file scanning before launch; none is claimed deployed. Short-lived candidate tokens alone do not authorize platform D1 access. Submission and any outbox event must commit together. Never expose credentials to the browser. No legal-review gate is required; indefinite retention and explicit deletion follow #9.

## ADR-003 — Schema and deploy

**Status: Accepted. Owner: Serge. Reviewed: 2026-10-21.** Evidence: [discovery #7](https://github.com/proappstore-online/hiring/issues/7), [owner approval #52](https://github.com/proappstore-online/hiring/issues/52#issuecomment-6309937556).

`migrations.json` is authoritative, additive and immutable once applied. Deploy schema expansion before dependent tools/UI. Migration failure stops deploy. New MCP actions refer only to existing columns; preserve compatibility for active clients. Retire template `items` actions deliberately; the additive policy may leave their unused table. No branch or PR workflow.

## ADR-004 — Side effects

**Status: Revised. Owner: Serge. Reviewed: 2026-10-21.** Evidence: [discovery #8](https://github.com/proappstore-online/hiring/issues/8), [owner approval #52](https://github.com/proappstore-online/hiring/issues/52#issuecomment-6309937556).

Use a transactional outbox for business changes and external work, with stable operation IDs and visible delivery state. Current Hiring outbox rows are drafts, not a running dispatcher. The #8 PAS email interface lacks provider idempotency, message IDs and callbacks. A timeout with an unknown send outcome must go to manual reconciliation, never automatic retry; retry/backoff applies only when non-acceptance is known. Show accepted, never delivered, without delivery evidence. Authenticate and deduplicate callbacks only where a provider actually supports them.

The current FAS route is the dedicated Cloudflare/PAGS bridge in #58, not an assumed configured Resend or Gmail connection. Its connection, sender approval, recipient isolation and bounded reads remain prerequisites. See [MAIL contract](mail-contract.md) for both paths and their distinct gaps. Serge owns provisioning/provider decisions; Hiring owns adapter/outbox controls. Retain message bodies indefinitely unless explicitly deleted; processor terms and deletion limits need owner confirmation, with no external legal-review gate.

## ADR-005 — Files, search and audit

**Status: Revised. Owner: Serge. Reviewed: 2026-10-21.** Evidence: [discovery #7](https://github.com/proappstore-online/hiring/issues/7), [owner approval #52](https://github.com/proappstore-online/hiring/issues/52#issuecomment-6309937556).

Private files/search remain design requirements, not verified end-to-end services. Platform storage availability alone does not prove scanning or access-checked downloads. Attachments use private R2 keys and short-lived, access-checked downloads. Enforce MIME/size limits and malware scan before reviewer access. Search obeys current brand grants, regardless of index contents. No PII in analytics, logs, URLs or public metadata. Audit is append-only and redacted. AI can draft only when enabled and logged; final disposition is human-attributed. Current SQL mutation batches append audit events, but migration 0010 rejects audit updates and deletes through database triggers. Read/denial auditing and tamper resistance against privileged operators who can remove triggers are not proven. Retain files, indexes and audit records indefinitely with no scheduled purge; explicit erasure removes PII and processor copies subject to required minimal evidence.

## Operational gates

Use request IDs across UI, worker, D1, MAIL and MCP. Monitor queue age, failures, denials and migration outcome without raw candidate data. Test backup and restore, including replay of deletion tombstones. Keep secrets in platform secret storage. Threat-model public intake, cross-brand access, attachments, candidate tokens, spoofed mail and MCP prompt injection. First implementation issue verifies current worker, D1 transaction and MCP capabilities against the actual platform.

## Affected backlog dependencies

- **#11, #12, #14:** additive multi-tenant schema and server grants; public organization onboarding and independent worker identity are still required. Current brand-wide owner/recruiter grants do not satisfy assignment-scoped roles.
- **#16, #17, #19:** implement authenticated self-registered worker intake and ownership checks; anonymous writes remain unsupported. #52 and #9 are resolved policy inputs, not blockers. #18 still needs private upload/download and scan evidence.
- **#13, #25, #26, #27, #47:** dispatcher, suppression, safe retries and mail status require implementation/provider evidence. Callback work #26 cannot assume PAS email has callbacks. #58 tracks the separate FAS bridge and PAGS #1277/#1278 prerequisites.
- **#28–#31, #45:** revise #28's scheduler scope to indefinite retention with no automatic purge; explicit rights/deletion and processor propagation remain required. No legal-review approval gate.
- **#32–#34:** SQL reads are the accepted current enforcement boundary; broader mutations, audit, per-user throttling and assignment scope remain future work. Closing #53 does not complete those controls.
- **#46, #35, #37, #38, #54:** grant-filtered search, monitoring, security/restore evidence and policy verification remain release work; ADR acceptance does not waive these checks.

## Issue #3 implementation revision

Public job discovery and passkey-protected owner publication now have registered actions and UI. Candidate-owned submission is implemented behind the still-closed runtime gate. Private attachment reservations are quarantined; no scanner or brand-scoped reviewer byte-serving route is claimed available. Public discovery does not open intake. See [candidate intake contract](candidate-intake.md) for additive schema compatibility, SQL abuse limits and required release evidence.

## Issue #12 authorization revision

The registered SQL boundary now resolves active organization, brand and requisition grants through `hiring_effective_access`, including revocation and assignment checks for reviewers. This supersedes the earlier brand-wide-only authorization and #12 gap descriptions above. Atomic owner administration is implemented as registered batches; no worker enablement is required. [Server permissions](permissions.md) documents the role matrix, actions, and remaining read/denial audit and throttling gaps.

## Issue #13 audit/outbox revision

The [audit and outbox contract](audit-outbox.md) supersedes draft-only outbox
limitations above: scoped queue, exclusive claim and completion actions now exist,
with atomic attributed audit and a provider-neutral dispatch helper. No scheduled
sender/provider integration is deployed; uncertain outcomes remain non-retryable.

## Issue #31 constrained implementation

[Scoped core erasure](erasure.md) now supports brand-wide owner authorization,
identity/hold review attestations, append-only holds, atomic candidate/application
core redaction, write fences, durable tombstones and blocked MAIL evidence. Existing
schema/audit/archive protections remain in force. Status is always partial and
lists retained stores; files, indexes, exports, backups, protected payloads and
processor deletion still require evidence. This does not complete #31, #28 or #29.

## Privacy operations revision (#5)

Migration 0030 introduces append-only subject-rights events and access authorization
receipts. Separate authorization and retrieval transactions preserve attempted-access
evidence across read failures, without worker enablement. Restricted browser reads
use receipt-bound actions; raw legacy actions retain their existing audit gaps.
Core exports are private, principal-bound and expire after 15 minutes, with current
grant/identity/erasure checks on retrieval. Full export and erasure remain incomplete;
see [privacy operations](privacy-operations.md) for exact boundaries.

## Retention execution revision (#28)

Migration 0037 and `worker/retention.mjs` implement explicit per-store deletion
progress, cross-store claim/hold interlocks and signed closed-gate restore replay
scaffolding. There is no age-based purge. Worker-only registered actions provide
the trusted execution boundary; actual scoped R2/index/gate bindings still require
host integration. Immutable local archives and unavailable services remain visible
blockers. See [retention contract](retention.md); no live worker or recovery drill
is asserted.

## Grant-scoped search revision (#46)

Search now runs as authenticated atomic SQL batches over canonical D1 candidate
and application rows. Live grants, scheduled interview assignments and scoped
deletion tombstones govern every page and exact minimal result read; no search
index is introduced. Migration 0041 provides a shared per-user SQL budget of
30 requests per server minute. The manifest annotation is descriptive; enforcement
is independent of platform annotation support. The action transport currently
returns HTTP 200 for SQL batches: over-budget data is suppressed server-side,
and the response status row maps to a client error with status 429. Raw HTTP 429
still requires platform routing support. See [search permissions](permissions.md#grant-scoped-search-46)
for projection, pagination, logging and remaining transport limits.
