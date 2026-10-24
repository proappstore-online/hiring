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

Issue #19 adds principal/application/purpose-bound 15-minute candidate tokens.
The UI generates 256-bit random tokens in memory; SQL fixes expiry, checks current
receipt ownership and limits issuance to 20 per candidate per rolling 15 minutes.
Withdrawal consumes the token atomically with stage and audit writes; status tokens
cannot withdraw. Tests cover cross-application and principal misuse, expiry at the
boundary, stale versions, replay and audit rollback. Platform sign-in remains
required; tokens do not enable anonymous D1 access. Legacy ownership-checked
candidate actions remain available for compatibility. Database token values must
be treated as credentials and excluded from logs and exports.

## Issue #37 follow-up review — 24 October 2026

Reviewed baseline `5b5f2fc39572589a294210bcc5ee90f2e7659ca7` and the
attachment change in this follow-up. Reviewer: automated Codex engineering review.
This does not supply the missing live or assistive-technology evidence.

### Finding SR-37-01: stale attachment metadata across scope changes — fixed

`Attachments` retained rows when its application, brand or signed-in user changed.
A delayed list read or refresh after a delete could also populate the new view
with the old application's filenames and deletion controls. Server authorization
still checked the original scope, but private metadata must not survive the UI
boundary. Severity: high confidentiality risk in a reused panel; no server
permission bypass established. The component now remounts its state on organization,
brand, application, user or upload-permission changes. Old asynchronous operations
retain their original scope and cannot update the new panel.

Retest: `tests/security-review-browser.test.mjs` uses the real React component in
Chromium at 375 × 812, starts a deletion in A, switches to B while its list is
pending, then completes A's mutation and returns A's refresh after B's list. It
asserts A disappears immediately and cannot reappear, B remains usable, and a
principal change clears B's list. API/storage are synthetic: this proves UI state
isolation, not live storage authorization.

### Finding SR-37-02: ambiguous attachment delete controls — fixed

Repeated buttons all had the accessible name "Delete attachment". Each now
includes its filename, and the attachment section is a named region. The same
browser test captures an accessibility-tree snapshot and invokes the named
control with Enter, asserting the exact brand on the mutation. This is keyboard
and accessibility-tree evidence; it is **not an actual screen-reader session**.

### Review coverage and residual risk

| Surface | Reviewed control / executable evidence | Residual verification |
| --- | --- | --- |
| Public intake | `candidate-intake.test.mjs`: mixed scope, stale snapshots, ownership, throttle, consent, token purpose/expiry/replay and atomic rollback | Live authenticated abuse requests and approved brand notices |
| Tenant boundaries | `permissions.test.mjs`, `multibrand.test.mjs`, `gateway.test.mjs`: forged sibling IDs, outsiders, revoked grants, assignment, read/write/audit isolation | Two live brand accounts through UI, direct URL and registered MCP |
| Files | `candidate-intake.test.mjs`: quarantined metadata, candidate ownership, no client scan approval; SR-37-01 retest above | Trusted immutable-byte scanner and exact-brand byte serving remain unresolved under #18; reviewer download stays unavailable |
| MAIL | `mail.test.mjs`, `mail-callbacks.test.mjs`, `outbox.test.mjs`: approved bounded rendering, changed recipient/template denial, signed callback forgery/replay/mapping, uncertain send reconciliation | Real provider timeout/quota and callback transport exercises under #47 |
| MCP | `mutation-tools.test.mjs`, `gateway.test.mjs`, `hiring-decisions.test.mjs`: caller identity excluded, version/replay checks, stage/decision separation, human step-up metadata | Live platform principal binding and actual passkey ceremony |
| Privacy / recovery | `candidate-export.test.mjs`, `erasure.test.mjs`, `retention.test.mjs`: scoped expiry/revocation, audited download, tombstone fences, legal holds and closed restore | Configured processor adapters and isolated restore exercise; no claim that all external copies were erased |
| Accessible journeys | Routing, candidate-account, interview, scorecard, admin and acceptance browser suites: named controls, keyboard/dialog/error/mobile flows; SR-37-02 above | Actual screen-reader testing of all journeys below |

The earlier export row's "full subject export coverage" gap is superseded by
#30's asynchronous snapshot/expiry/download-audit implementation and tests.
Processor coverage and live authorization evidence still require verification.
The earlier retention/restore gaps now have worker contracts and regression tests
under #28; configured external stores and a live isolated recovery drill remain
requirements. Do not infer missing implementation solely from the older table.

### Outstanding acceptance evidence

At the initial review, issue #37 was kept open for the operational evidence below.
The subsequent closing disposition separates this implementation review from
production verification, as explicitly directed by the Pilot. Retain the
security/accessibility launch holds in `docs/launch-evidence.json`; closure does
not assert that an actual screen-reader or live security session occurred.

For each remaining run, record the exact release SHA and environment, date,
reviewer, browser/OS and assistive-technology versions, viewport, account roles,
steps, expected and actual output/announcements, finding severity, restricted
artifact location and retest result. Use synthetic candidates; do not put tokens,
private filenames, identity documents or message bodies in public evidence.

Required screen-reader/keyboard runs:

1. Candidate sign-in, vacancy search/detail, application labels/consent/errors and receipt.
2. Candidate status, withdrawal confirmation/error/retry and privacy request receipt.
3. Recruiter list/detail, workspace switch, assignment, scorecard and decision/offer confirmation.
4. Communication approval/failure/reconciliation and subject export/error/download flows.

Required live abuse run: brand-A staff and a candidate attempt brand-B discovery,
direct application URLs, attachment retrieval, export and MCP reads/mutations;
repeat after assignment/grant revocation. Expect no private content and no writes
or provider sends. Verify with server records, not just a hidden UI control.

Dependency status checked through GitHub during this review: #17, #31 and #34
are closed; #18, #45, #46 and #47 remain open. Their current scopes matter:
#45 is correction/provenance/processor rectification, #46 is grant-scoped search
(including no cross-brand snippets, counts or existence), and #47 is branded
application receipts with accurate pending/failed delivery state. Those unfinished
surfaces need review and negative tests when implemented. Closing a dependency
issue is not itself evidence of its live behavior. Earlier references in this
document to #45 as generic erasure work or #47 as general provider integration
reflect older planning; use the current scopes above.

Local validation of this follow-up: `pnpm test` exited 0 with 343 tests passed,
0 failed, 0 skipped (includes TypeScript and all browser/SQL tests). `pnpm build`
exited 0; platform compliance passed all hard checks with existing warnings about
CLAUDE.md length and the copied deploy workflow. `pnpm audit --json` exited 0:
675 dependencies, zero vulnerabilities at every severity. The launch-register
validation and `git diff --check` also passed. These results describe the local
follow-up tree, not a deployed revision or manual accessibility approval.


## Closing disposition — 24 October 2026

Issue #37 and its complete comment collection were reread before closure (open,
zero comments). Under the Pilot's explicit follow-up direction, this direct-to-main
change closes the repository implementation/review deliverable and treats the
remaining operational evidence as outside this change's scope. This is a scope
disposition, not a claim that the issue's original evidence criterion has been
fully demonstrated in production.

Implemented controls include server-bound identity and tenant/assignment checks,
revocation and mixed-ID denial, quarantined private attachment metadata,
application/principal-scoped attachment UI state, named keyboard-operable deletion
controls, approved MAIL rendering and replay/reconciliation protections, versioned
MCP mutations with audit and human gates, and scoped expiring audited exports.
The review's attachment confidentiality and accessibility findings were fixed and
regression-tested in `bdede3b`; the coverage table above maps the other controls
to executable evidence. No additional code defect requiring a fix was identified
in this closing review.

Actual screen-reader sessions, live two-brand UI/URL/MCP authorization exercises,
provider/passkey verification and production security acceptance remain operational
follow-ups under the security/accessibility/scenario launch holds in
`docs/launch-evidence.json` and release acceptance in #38. Scanning/private byte
serving (#18), corrections (#45), scoped search (#46) and branded receipts (#47)
remain separate implementation issues requiring review when delivered. Closing
#37 neither completes those issues nor passes or removes any launch hold. No PR
or branch is used.

Closing validation: `pnpm test` was rerun after this documentation change and
exited 0: 343 passed, 0 failed, 0 skipped, including TypeScript compilation.
Launch-register validation and `git diff --check` also passed.
