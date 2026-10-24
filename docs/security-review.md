# Repository threat review (#6 / #37)

Reviewed against the repository on 24 October 2026. This is an engineering
assessment and test map, not owner sign-off or a claim of production security.
Serge owns acceptance; unresolved production findings stay in #37/#38.

## Boundaries and controls

| Boundary / threat | Repository control and regression evidence | Remaining verification |
| --- | --- | --- |
| Forged organization/brand/requisition IDs and revoked grants | Registered SQL checks `hiring_effective_access` with platform-bound `:__user_id`; `permissions`, `multibrand`, `gateway` tests exercise mixed IDs and revocation | Live PAS identity binding, action auth and cross-brand UI/URL/MCP tests |
| Reviewer sees unassigned candidate material | Current assignment and reviewer-specific packet/scorecard reads; `interview-assignment`, `scorecards` tests | Deployed reassignment and revoked-session evidence |
| Candidate changes another worker/application | Principal-bound profile, receipts, intake and versioned self-service withdrawal with atomic audit; `candidate-intake`, `candidate-account-browser` tests | Actual candidate sign-in, abuse/throttling and configured notices |
| Browser input injects markup or redirects | React renders job/notice/message content as text; `safeBack`/`staffBack` allow local known routes; routing and intake browser tests | Live browser review of candidate/recruiter journeys and any new rich content |
| MCP/model performs final decision, publication or offer | Role checks, optimistic versions, audit and platform passkey step-up; decisions/acceptance tests | Real owner passkey ceremony; model confirmation text is never authority |
| Duplicate send after timeout, crash or restore | Exclusive claims; ambiguous outcome `unknown`; manual stale reclaim and evidence-backed reconciliation; `outbox` tests | Actual provider acceptance/refusal evidence and no-duplicate test; no bulk replay |
| Operational telemetry exposes candidate data | `get_operational_health` returns numeric counts/ages only under exact brand/requisition access; denial counters require brand-wide owner/auditor; `admin-actions` tests | Approved alert receiver/retention, alert delivery exercise; data in a permitted small brand still requires access controls |
| Export leaks other-brand or confidential review data | Identity-reviewed owner export with private expiring authorization; `privacy-operations` tests | Full subject export coverage, processor scope and deployed retrieval audit |
| Malicious file or public attachment URL | Private/quarantined metadata; no client can mark a scan clean; unauthorized reads denied | **Unresolved #18:** trusted immutable byte scan and assigned-brand private byte serving |
| Erased subject reappears after recovery | Core tombstone, content/send fences and explicit partial status; `erasure` tests | **Unresolved #28/#31/#45:** remaining stores, processor copies and complete restore replay |
| Expanded schema and deployed tool/client mismatch | Additive migrations before action registration before upload; migration/deploy tests | Isolated failed migration drill, compatible rollback and RPO/RTO |
| Compromised dependency/build environment | Pinned lockfile, frozen CI install, OIDC deploy and billing-aware runner router | Review dependency advisories and CI results for each final release revision |

## Dependency remediation

The initial `pnpm audit --json` reported 24 high, 14 moderate and 4 low findings
on the installed dependency graph. The launch follow-up updates Vite and React
Router and refreshes vulnerable transitive packages within their dependency
ranges. React Router moves to patched 7.18.2 because two reported
advisories have no patched v6 version. Run the full routing/browser suite after
this change, plus `pnpm build` and `pnpm build:marketing`.

The router upgrade exposed a controlled-search timing bug: using the deferred
URL value as the input value could lose typed characters. Vacancy search now
updates local text immediately and restores query text on incoming/history
navigation. The browser regression asserts both the typed value and query string.
Candidate fault-injection tests wait for list rendering before measuring reads
or enabling a detail failure, so they test the intended boundary under deferred
navigation as well as synchronous navigation.

The final local `pnpm audit --json` on 24 October 2026 exited zero with **0
vulnerabilities** across all severities (675 audited dependencies). Re-run for the
final release and retain that result with its evidence. Package audit
checks known dependency advisories only; it cannot sign off source security or
prove a deployed environment safe. Do not confuse a patched development server
with successful production isolation testing.

## Accessibility verification boundary

Browser tests cover modal names, focus return/trapping, Escape/Enter/Tab actions,
error/retry states, labeled forms, mobile overflow and permission navigation.
The new queue health section has an accessible region name, semantic definition
list, manual-reconciliation status and keyboard refresh. It does not expose a
resend shortcut. Run `tests/admin-browser.test.mjs` and the existing candidate,
routing, privacy, interview and scorecard browser suites.

Before production approval, #37 still requires an actual screen-reader review:
candidate sign-in/discovery/apply/status/withdrawal, recruiter list/detail,
decision/offer confirmation, communications and privacy request/error flows.
Record browser/assistive technology versions, viewport, keyboard sequence,
announcements, expected/actual results and blocking findings/retests. A passing
DOM assertion is not a screen-reader pass.
