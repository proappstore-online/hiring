# Hiring compliance and policy verification matrix (#54)

Version 1, 25 October 2026. Accountable owner for every requirement: **Serge
(serge-ivo)**; technical operators and reviewers supply evidence to that owner.
This is verification design, not certification or production approval. Issue #54
has no comments. Approved policy inputs are #9/#52 (privacy and indefinite
retention) and #10/#52 (no external legal-review gate); #37, #48 and #42 supply
security/accessibility, incident and workflow requirements respectively.

## Gate and evidence rules

`intake` blocks real public candidate intake **and** launch. `launch` blocks the
production go decision, even if an isolated synthetic intake exercise is allowed.
A failed, missing, skipped, stale or unsupported check fails its gate. The owner
must keep intake closed when any intake requirement fails; this document adds no
runtime gate or deployment interlock. The existing evidence validator checks
records, not the truth of an attestation.

[launch-evidence.json](launch-evidence.json) remains the release status register;
all its checks are currently blocked. The IDs below map one-to-one to that
register. Each criterion is conjunctive: every clause must pass. Tests listed in
the register are repository evidence only. Required manual/live artifacts must
include full release SHA, HTTPS environment, date/time, reviewer, scoped synthetic
actors, expected and actual outcomes, findings and protected artifact URL.
Never commit personal data or credentials. A new revision needs renewed review.
No policy approval, provider delivery or completed drill is inferred from tests.

## Release requirement coverage

Every row has owner Serge (serge-ivo). The last column identifies the existing
backlog handoff and the evidence needed to resolve it; issue closure alone fails
the criterion. Intake requirements also inherit the privacy, isolation and
incident prerequisites detailed below, even where the final full-system check
is classified as a launch gate.

| Register ID | Gate | Planning source | Pass criterion (otherwise fail) | Repository evidence | Manual artifact / dependency |
| --- | --- | --- | --- | --- | --- |
| `identity-policies` | intake | [privacy-governance.md](privacy-governance.md); [public-copy-review.md](public-copy-review.md) | Approved operator/contact, processor list and versioned notices are published; no placeholder or unsupported claims. | [marketing/src/site.ts](../marketing/src/site.ts); [tests/marketing.test.mjs](../tests/marketing.test.mjs); [docs/privacy-governance.md](../docs/privacy-governance.md); [docs/public-copy-review.json](../docs/public-copy-review.json); [docs/public-copy-review.md](../docs/public-copy-review.md) | #36: Owner supplies approved values/versions and arranges marketing publication under #36. |
| `intake-files` | intake | [candidate-intake.md](candidate-intake.md); [architecture.md](architecture.md) | Trusted scanner checks immutable bytes; only exact candidate/assigned brand staff retrieve clean private files. | [docs/candidate-intake.md](../docs/candidate-intake.md); [tests/candidate-intake.test.mjs](../tests/candidate-intake.test.mjs) | #18: Complete scanner/object binding and byte-serving integration in #18 once a supported platform route is available. |
| `intake-authorization` | intake | [candidate-intake.md](candidate-intake.md); [privacy-governance.md](privacy-governance.md) | Live candidate authentication, request throttling, ownership, notice evidence and idempotency pass. | [tests/candidate-intake.test.mjs](../tests/candidate-intake.test.mjs); [tests/candidate-account-browser.test.mjs](../tests/candidate-account-browser.test.mjs) | #16: Run approved synthetic candidate submissions and abuse/retry checks on the deployed environment. |
| `security` | launch | [security-review.md](security-review.md); [hiring-mcp-contract.md](hiring-mcp-contract.md) | Threat review covers tenant/assignment, public input, files, MAIL and MCP; critical findings fixed and retested. | [docs/security-review.md](../docs/security-review.md); [tests/permissions.test.mjs](../tests/permissions.test.mjs); [tests/multibrand.test.mjs](../tests/multibrand.test.mjs); [pnpm-lock.yaml](../pnpm-lock.yaml); [tests/security-review-browser.test.mjs](../tests/security-review-browser.test.mjs) | #37: Review docs/security-review.md, assess remaining findings and accept/retest against the release SHA under #37. |
| `accessibility` | launch | [product-boundary.md](product-boundary.md); [launch-readiness.md](launch-readiness.md) | Keyboard, screen reader and 375px journeys pass with no unresolved blocking findings. | [tests/admin-browser.test.mjs](../tests/admin-browser.test.mjs); [tests/candidate-account-browser.test.mjs](../tests/candidate-account-browser.test.mjs); [tests/routing-browser.test.mjs](../tests/routing-browser.test.mjs); [tests/security-review-browser.test.mjs](../tests/security-review-browser.test.mjs) | #37: Run and record screen-reader and keyboard journeys under #37. |
| `monitoring` | launch | [operational-monitoring.md](operational-monitoring.md) | Scoped redacted queue age/error/denial monitoring, alert delivery and safe recovery are exercised. | [web/src/OperationalDiagnostics.tsx](../web/src/OperationalDiagnostics.tsx); [mcp.json](../mcp.json); [tests/admin-actions.test.mjs](../tests/admin-actions.test.mjs); [tests/admin-browser.test.mjs](../tests/admin-browser.test.mjs); [docs/release-operations.md](../docs/release-operations.md) | #35: Configure an approved monitor using get_operational_health and exercise quota/outage/denial alerts in #35; do not treat on-screen counts as paging. |
| `incident-response` | launch | [incident-response.md](incident-response.md) | Owner and backup contacts confirmed; cross-brand exposure and lost-token tabletops recorded. | [docs/release-operations.md](../docs/release-operations.md); [docs/incident-response.md](../docs/incident-response.md); [docs/incident-tabletops.json](../docs/incident-tabletops.json); [tests/incident-response.test.mjs](../tests/incident-response.test.mjs) | #48: Owner supplies contacts and records the two exercises in #48. |
| `privacy` | launch | [privacy-governance.md](privacy-governance.md); [retention.md](retention.md); [privacy-operations.md](privacy-operations.md) | Full export/erasure and processor handling verified, with indefinite retention and explicit holds preserved. | [docs/erasure.md](../docs/erasure.md); [docs/privacy-operations.md](../docs/privacy-operations.md); [tests/erasure.test.mjs](../tests/erasure.test.mjs); [tests/privacy-operations.test.mjs](../tests/privacy-operations.test.mjs) | #45: Complete full-store cleanup/export and processor integration in #28-#31/#45; keep partial status until verified. |
| `ci-deploy` | launch | [architecture.md](architecture.md); [release-operations.md](release-operations.md) | CI, Platform Compliance and Deploy to R2 pass for the exact candidate revision. | [.github/workflows/ci.yml](../.github/workflows/ci.yml); [.github/workflows/compliance.yml](../.github/workflows/compliance.yml); [.github/workflows/deploy.yml](../.github/workflows/deploy.yml) | #42: Record the passing run URLs for the final tested and deployed candidate. |
| `recovery` | launch | [retention.md](retention.md); [release-operations.md](release-operations.md) | Isolated D1/object restore, tombstone replay and authorization verification pass before reopening; RPO/RTO recorded. | [docs/release-operations.md](../docs/release-operations.md); [docs/erasure.md](../docs/erasure.md); [tests/erasure.test.mjs](../tests/erasure.test.mjs) | #38: Arrange supported isolated D1/R2 restore with platform owner, implement required replay in #28, then execute #38 drill. |
| `scenario-1` | launch | [delivery-roadmap.md](delivery-roadmap.md); [launch-readiness.md](launch-readiness.md) | Brand A cannot discover or mutate Brand B through UI, URL, export or MCP. | [tests/multibrand.test.mjs](../tests/multibrand.test.mjs); [tests/permissions.test.mjs](../tests/permissions.test.mjs); [tests/gateway.test.mjs](../tests/gateway.test.mjs); [tests/privacy-operations.test.mjs](../tests/privacy-operations.test.mjs) | #38: Exercise UI/direct URL/export/MCP denial using approved live two-brand accounts. |
| `scenario-2` | launch | [delivery-roadmap.md](delivery-roadmap.md); [launch-readiness.md](launch-readiness.md) | Same-email applications remain separate across brands; any authorized merge is audited. | [tests/candidate-intake.test.mjs](../tests/candidate-intake.test.mjs); [tests/multibrand.test.mjs](../tests/multibrand.test.mjs) | #38: Run same-email candidate flow across both live brands and record independent records. |
| `scenario-3` | launch | [delivery-roadmap.md](delivery-roadmap.md); [launch-readiness.md](launch-readiness.md) | Candidate applies, receives branded receipt, withdraws and requests export/deletion without staff membership. | [tests/candidate-account-browser.test.mjs](../tests/candidate-account-browser.test.mjs); [tests/privacy-operations.test.mjs](../tests/privacy-operations.test.mjs); [docs/mail-contract.md](../docs/mail-contract.md) | #38: Complete relevant #30/#31/#45/#47 integrations and run the approved candidate lifecycle in #38. |
| `scenario-4` | launch | [delivery-roadmap.md](delivery-roadmap.md); [launch-readiness.md](launch-readiness.md) | Unpaid/internship/volunteer disclosures are accurate with ordinary human publication/offer authorization; no legal-review gate. | [tests/vacancies.test.mjs](../tests/vacancies.test.mjs); [tests/hiring-decisions.test.mjs](../tests/hiring-decisions.test.mjs); [tests/acceptance-browser.test.mjs](../tests/acceptance-browser.test.mjs) | #38: Run accurate arrangement publication and human decision/offer checks on approved live fixtures. |
| `scenario-5` | launch | [delivery-roadmap.md](delivery-roadmap.md); [launch-readiness.md](launch-readiness.md) | MAIL timeout/quota preserve business state; unknown attempts reconcile manually without duplicate send; unsupported callbacks not claimed. | [scripts/outbox.mjs](../scripts/outbox.mjs); [tests/outbox.test.mjs](../tests/outbox.test.mjs); [docs/audit-outbox.md](../docs/audit-outbox.md) | #38: Exercise approved test mailbox quota/timeouts and reconcile actual provider outcomes under #47/#38. |
| `scenario-6` | launch | [delivery-roadmap.md](delivery-roadmap.md); [launch-readiness.md](launch-readiness.md) | Schema expansion precedes tools/client and failed migration prevents release. | [.github/workflows/deploy.yml](../.github/workflows/deploy.yml); [tests/deploy-json.test.mjs](../tests/deploy-json.test.mjs); [tests/migrations.test.mjs](../tests/migrations.test.mjs) | #38: Execute failed migration drill in isolated environment and retain run evidence. |
| `scenario-7` | launch | [delivery-roadmap.md](delivery-roadmap.md); [launch-readiness.md](launch-readiness.md) | Private attachments and any candidate access token deny other candidates and unassigned staff. | [tests/candidate-intake.test.mjs](../tests/candidate-intake.test.mjs); [docs/candidate-intake.md](../docs/candidate-intake.md) | #38: Complete #18 integration and prove live byte denial for other candidates/unassigned staff. |
| `backup-restore` | launch | [release-operations.md](release-operations.md) | Restore to isolation preserves deletion tombstones, owner holds and revocations; RPO and RTO are within defined bounds; owner signs restore drill record. | [scripts/backup-restore.mjs](../scripts/backup-restore.mjs); [tests/backup-restore.test.mjs](../tests/backup-restore.test.mjs) | #38: Execute restore drill on isolated environment using production snapshot; verify tombstone and hold preservation; record evidence in #38. |
| `launch-decision` | launch | [delivery-roadmap.md](delivery-roadmap.md) | Serge accepts the exact revision, evidence and rollback plan with dated go decision. | [docs/launch-readiness.md](../docs/launch-readiness.md); [docs/release-operations.md](../docs/release-operations.md) | #38: Serge reviews all live evidence and records go/no-go and rollback decision in #38. |

## Policy detail and intake prerequisites

These clauses refine the rows above; they do not replace the approved policy.
Owner for each is Serge; retain the named artifact with the release record.

| Policy requirement and source | Gate / register IDs | Exact pass evidence and remaining handoff |
| --- | --- | --- |
| Processing basis, minimization and AI restrictions — [privacy governance](privacy-governance.md) | intake / `identity-policies`, `intake-authorization`, `security` | #36 approved notice identifies contract performance, legitimate interest and separate optional consent; form review shows only relevant fields, no special-category requests or external-model processing. No ranking, rejection or offer solely by AI. #37 reviews actual data destinations. Fail on an unsupported public claim or unapproved processing. |
| Consent and candidate access — [privacy governance](privacy-governance.md) | intake / `intake-authorization` | #16 live submission retains notice version, purpose, timestamp, source and affirmative action; talent-pool and communications consent are separate and unchecked. Prove ownership and short-lived, purpose-bound candidate links, or record owner-approved authenticated replacement under #38. |
| Indefinite retention and explicit rights — [retention](retention.md), [privacy operations](privacy-operations.md) | intake prerequisite / `identity-policies`; full execution launch / `privacy`, `recovery` | #36 approved copy states indefinite account/content/attachment/message retention, explicit deletion, applicable payment-law exceptions and indefinite non-identifying aggregates. No scheduled purge after rejection/withdrawal. #28–#31/#45 prove identity verification, jurisdiction-specific owner/deadline tracking, confidential export exclusions, correction/erasure across all stores and processors, holds and restore tombstones. Partial results fail completion. |
| Accurate arrangements and human authority — [privacy governance](privacy-governance.md), [product boundary](product-boundary.md) | intake / `identity-policies`; launch / `scenario-4` | #36/#38 compare published version with jurisdiction, duties, duration, supervision, benefit, expenses and compensation for each arrangement; preserve changed disclosure versions. Require ordinary authorized human publication/decisions/offers. No lawyer sign-off or legal-review gate; labels alone never establish lawful nonpayment. |
| Tenant and worker independence — [product boundary](product-boundary.md), [permissions](permissions.md) | intake prerequisite / `intake-authorization`; launch / `scenario-1`, `scenario-2`, `security` | #37/#38 two independent organizations/brands and self-registered worker accounts demonstrate server-bound identity, grants, requisition/assignment restrictions and immediate revocation. Mixed/forged IDs fail across search, detail, UI, URL, MCP, export and files; same-email records remain independent with audited authorized merges only. Public organization registration must not grant other tenants' data. |
| MAIL safety and honest state — [MAIL contract](mail-contract.md) | launch / `scenario-3`, `scenario-5`, `monitoring` | #25–#27/#47 retain approved sender/template/processor terms, verified recipient/consent or transactional purpose, suppression and escaped content evidence; application acceptance stays separate from queued/sent/delivered state. Actual provider attempts prove timeout/quota recovery and no duplicate unknown-send retry. Unsupported IDs/callbacks/bounces cannot be reported as delivery. #58 FAS bridge has separate prerequisites; unused routes remain disabled. |
| Security, accessibility and incident readiness — [security review](security-review.md), [incident runbook](incident-response.md) | intake prerequisites / `security`, `incident-response`; final sign-off launch / `accessibility`, `incident-response` | Before real intake #37 threat review and #48 command/containment/notification decision process must exist. Final launch needs critical finding retests, actual keyboard/screen-reader/375px candidate and staff sessions, named backup and verified contacts, two operator-executed tabletops and jurisdiction/authority decision records. Synthetic desk walkthroughs alone fail live readiness. |

## Existing CI/compliance coverage and gaps

No workflow code is changed by #54. Workflow success applies only to its SHA;
all gate classifications above are release requirements, not claims of CI enforcement.

| Existing workflow/check | Requirements supported | Limits and gap handoff |
| --- | --- | --- |
| [CI](../.github/workflows/ci.yml): `pnpm typecheck`, Chromium install, `node --test tests/*.test.mjs` | All repository tests referenced above, including matrix integrity; scoped SQL/browser regressions, rights, MAIL, accessibility and migration contracts | Fixtures do not establish live grants, byte scanning, processor handling, actual screen-reader usability or delivery. #18/#28–#31/#37/#38/#45/#47 supply those artifacts. |
| [Platform Compliance](../.github/workflows/compliance.yml): Build, MIT License, No .env.production in repo, No tracking | `security`, `ci-deploy`, processing minimization | Build/static checks do not establish legal identity, consent approval, complete secret scanning or security acceptance. #36/#37 review these manually. |
| Platform Compliance: Brand fonts, CSS variables, HTML meta tags, PWA meta tags, Dark mode, pnpm workspace, Bundle size | `accessibility`, `ci-deploy` and brand presentation | Presence checks and one bundle threshold do not prove WCAG conformance or all-assets performance. #37 supplies keyboard/screen-reader/mobile evidence. |
| [Deploy to R2](../.github/workflows/deploy.yml): build, nonempty output, additive migration before MCP registration and frontend upload | `ci-deploy`, `scenario-6` | #42 records exact-SHA CI/compliance/deploy run URLs; #38 isolated failed-migration drill. Separate workflows are not a full release-evidence interlock. Report-only QA, auth skips and HTTP 200 do not pass scenarios. |
| [Release evidence validator](../scripts/launch-readiness.mjs) (operator invoked) | All register IDs, owner/reviewer, revision/environment and artifact completeness | Not wired into deployment or intake; cannot authenticate artifacts or reviewers. #38 retains evidence review and go/no-go authority. Future enforcement is separate implementation work, not part of #54. |

## Backlog and review ownership

Existing dependencies remain with their existing issues: #18 scanner/private bytes;
#28–#31/#45 complete rights/processors and restore replay; #35 paging transport;
#36 owner identity, processor arrangements and published notices; #37 manual
security/accessibility acceptance; #42 exact-revision workflow evidence; #47 live
MAIL exercise; #48 backup/contacts/operator exercises; #38 live scenarios,
isolated restore and signed go/no-go. Capability prerequisites and #58 are tracked
in [governance gates](capability-governance-gates.md). These are actionable gaps,
not new policy decisions or grounds to reopen the waived legal-review gate.
No new product implementation is authorized by this planning issue.

At a policy, capability or release-scope change, Serge reviews this matrix,
updates source documents and affected backlog, then revises the status register
and release evidence. Run `node --test tests/compliance-matrix.test.mjs` and
`node scripts/launch-readiness.mjs --check-register` for document integrity;
neither command approves intake or launch.
