# Launch verification and evidence (#6)

Production status on 24 October 2026: **HOLD**. Accountable release owner: Serge
(`serge-ivo`, as recorded in the capability/governance register). No owner
approval, live E2E pass or restore drill is asserted by this document.
External legal review remains waived by #52; owner approval of public identity,
contact, processor arrangements and notice versions is still required.

## Issue #6 repository completion and production approval

The Pilot's clarified instruction on 24 October permits closing #6 when the
repository launch work is complete and external actions are explicitly handed
off. Issue closure is therefore a repository delivery decision, **not a production
go decision**. Do not check off live sign-off/scenario evidence or open intake
because GitHub closes the epic. #38 continues to own the production launch gate.

Issue #6 has no comments and exactly two original acceptance checkboxes:

| Original criterion | Repository work delivered | Genuine unresolved acceptance / handoff |
| --- | --- | --- |
| Legal, security, accessibility and recovery evidence is signed off | Evidence register/validator, policy mapping, threat review, dependency patches, keyboard/mobile regression checks, incident and restore/rollback procedures | Owner identity/contact/copy approval, security and screen-reader acceptance, backup/contacts/tabletops, supported restore environment and an executed drill (#36/#37/#38/#48). External legal review remains waived; no approval is fabricated. |
| Live two-brand end-to-end scenarios pass | All seven executable verification protocols mapped to existing SQL/browser tests; scoped operational counts, authorization/recovery regressions and failure states | Actual deployed two-brand sessions, passkey/provider/scanner evidence and protected result artifacts (#18/#38/#47). Local fixtures are not live evidence. |

The actual code gaps found in this follow-up were missing candidate withdrawal
and queue-health aggregates, an unactionable all-pending evidence template,
insufficient artifact-to-revision binding, vulnerable dependencies and a deferred
vacancy-search input bug exposed by the router upgrade. These are addressed here. Final human
review and infrastructure execution cannot be implemented as a passing fixture.

Pre-existing product gaps remain genuine implementation work: trusted scanner and
brand-scoped byte serving (#18), complete-store/processor export and erasure
(#28–#31/#45), complete restore replay (#28/#38), and configured alert delivery
(#35). They are not relabeled as owner sign-off and are not claimed complete by
this epic's closure. Their existing issues retain ownership; they continue to
block affected production scenarios. Supported scanner/storage/processor/restore
interfaces must be established before their integrations can be safely completed.
This launch-readiness delivery does not invent those platform capabilities.

## Evidence matrix (#54)

[launch-evidence.json](launch-evidence.json) is the checklist: each entry names
the accountable owner, source issue, intake/launch gate and exact pass criterion.
Every unresolved entry classifies its blocker as `owner_action`, `infrastructure`
or `implementation_dependency`, records why it is blocked and the next action,
and links actual repository evidence. No blocked entry counts as a release pass. Intake checks
also block launch. Passing local tests cannot replace live or manual evidence.
Conditional integrations (AI, background checks, agencies, job boards) remain
disabled and require their own reviews; they are not approved by this checklist.

| Requirement | Existing automated evidence | Additional acceptance evidence |
| --- | --- | --- |
| Identity, notices, indefinite retention, accurate role disclosures | `marketing`, `candidate-intake`, `vacancies`, `hiring-decisions` tests | #36 owner identity/contact, exact approved copy/version, processors and published URLs; no external legal review required |
| Intake authorization, notice, idempotency and abuse controls | `candidate-intake`, `candidate-account-browser`, `runtime-gate` tests | #16 real candidate session, live throttling, notice snapshot and retry readback |
| Private files | `candidate-intake` quarantine and denial checks | #18 trusted scanner/byte binding and scoped download evidence; synthetic clean rows do not qualify |
| Brand/tenant/requisition/assignment isolation | `multibrand`, `permissions`, `gateway`, `interview-assignment`, `scorecards` tests | #37/#38 live forged-ID, direct URL, UI, export and MCP denial tests, including revocation |
| Human decisions and MAIL recovery | `hiring-decisions`, `outbox`, `email-history`, `email-browser` tests | #35/#47 actual provider scope, quota/timeout, stale sending and reconciliation, verified no duplicate; no unsupported callback claim |
| Subject rights, export, erasure and holds | `privacy-operations`, `erasure`, browser tests | #28–#31/#45 all stores/processors accounted for, confidential exclusions, access audit/expiry, tombstones reapplied on restore; partial core erasure is insufficient |
| Security and accessibility | Authorization tests and browser tests in CI | #37 threat review, critical finding retests, keyboard and screen-reader results for all public/staff journeys at 375px |
| Monitoring and incident response | Scoped diagnostics, queue counts/ages, restricted 24-hour denial/unconfirmed-read counts, outbox and admin browser tests | #35/#48 alert delivery, incident backup, escalation contacts and two tabletop records |
| Deployment safety | CI typecheck/full test suite; Platform Compliance build/no tracking/secrets/metadata/bundle checks; deploy migration-before-tools-before-client | #42 exact candidate SHA and passing run URLs for all three workflows; failed migration release evidence |
| Live scenarios and recovery | Local tests cover portions of roadmap scenarios | #38 all seven live scenarios, isolated D1/R2 drill, RPO/RTO, tombstone replay and owner launch/rollback decision |

Platform Compliance does not check identity approval, screen-reader usability,
scanner readiness, processor deletion or restore. Post-deploy QA is advisory;
auth-gated skipped tests and HTTP 200 do not constitute an E2E pass. No workflow
changes are made by this matrix. The release evidence CLI is an operator check,
not a deployment interlock or an intake gate mutation.

Run `node scripts/launch-readiness.mjs --check-register` to validate repository
handoff completeness (owners, criteria, repository references and actionable
blockers). This command can pass while production remains held. Its output never
approves launch. Full-release evidence checking remains a separate, strict path.

## Recording and validating a release

Copy `docs/launch-evidence.json` to a restricted release record outside the
repository. Set `revision` to the full tested/deployed commit SHA and `environment`
to its HTTPS origin. For every check record the same `revision` and `environment`,
`status: pass`, reviewer identity,
review timestamp with timezone and an HTTPS artifact reference. Artifacts must
identify the same SHA/environment, actors, expected/actual results and findings.
Use protected evidence storage; never commit tokens, candidate data or screenshots
containing personal information. Keep failed and blocked results; never mark a
scenario passed because it was skipped or a provider lacks the capability.

Run `node scripts/launch-readiness.mjs /path/to/release.json FULL_COMMIT_SHA`.
It exits nonzero for incomplete, duplicate, malformed or mismatched attestations.
It checks record completeness only; reviewers must verify artifact authenticity,
environment/revision binding, approval authority and unresolved findings. A new
code revision requires a new evidence review. Store the dated final decision and
artifact references in #38; only then can production launch be approved. Closing
#6 follows the repository completion rule above. This avoids committing a
self-referential release SHA into the very commit it identifies.

## Live scenario protocol (#38)

Use owner-approved synthetic accounts: two brands with separate recruiters,
an assigned and unassigned reviewer, two candidates and an owner. Record exact
organization, brand and requisition scope in restricted evidence. Repeat negative
tests with mixed IDs and revoked grants; a hidden navigation link is insufficient.

1. Run roadmap scenario 1 across list/search, direct detail URLs, export and MCP.
   Capture denied results and permitted same-brand controls.
2. Apply the same email to both brands. Verify independent application IDs,
   notices and recruiter visibility; no implicit merge or cross-brand discovery.
3. As a candidate without staff membership, submit with notice acknowledgement,
   receive a correctly branded receipt, withdraw, request export and erasure.
   Record full processor/store results; current partial erasure blocks completion.
4. Publish paid/unpaid/internship/volunteer fixtures with accurate terms, then
   verify human publication, decision and offer authority. No lawyer gate applies.
5. With approved test mailbox/provider, exercise quota refusal, definitive failure,
   timeout, lost completion and stale `sending`; use the recovery procedure below.
   Count actual provider attempts. Unknown must never cause automatic resend.
6. In an isolated release environment, prove migration failure prevents dependent
   action/client deployment. Do not inject a failing migration into production.
7. Attempt private file access as another candidate and unassigned staff; prove
   clean-byte binding and denial before scan. Test expiry, purpose and scope for
   any deployed candidate token, or document the approved authenticated-session
   replacement with owner acceptance; do not pretend an absent token was tested.

## Current observations and holds

Read-only probes on 24 October 2026: app root returned HTTP 200; marketing root
`https://about-hiring.proappstore.online/` returned HTTP 404. `marketing/src/site.ts`
now explicitly marks the public copy as draft, with operator identity and contact
unconfirmed. The exact draft and existing brand assets are hashed in
`docs/public-copy-review.json`; no owner sign-off is recorded. Do not invent those values. Marketing publication is separate from
the app deploy. Existing GitHub runs for `a72c80d9113246e9954affe9fecf5d4158875d3e`
passed [CI](https://github.com/proappstore-online/hiring/actions/runs/40065942674),
[Platform Compliance](https://github.com/proappstore-online/hiring/actions/runs/40065942690)
and [Deploy](https://github.com/proappstore-online/hiring/actions/runs/40065942666).
These are historical evidence, not approval of a subsequent revision.

Remaining dependencies: #18 scanner/scoped bytes; #28–#31/#45 complete rights
and restore handling; #35 alert configuration/delivery; #36 approved/public copy;
#37 manual security/accessibility review; #47 provider evidence; #48 backup,
contacts and exercises; #38 live scenarios/restore/owner decision. The #54 matrix
is now documented, but other checks remain pending. See
[operations and recovery](release-operations.md). Existing runtime intake stays
closed; no new tool opens it.


## Procedural backup/restore and owner signature checks (#38)

`scripts/backup-restore.mjs` documents database/object export and isolated restore.
`verifyRestoreIntegrity` compares explicit `expected` and `restored` arrays of
scoped immutable record IDs under `tombstones`, `holds`, and `revocations`.
Use the independent latest ledger as expected input, including post-backup
changes. Supply measured `rpoMs`/`rtoMs` and owner-defined
`maxRPOMs`/`maxRTOMs`; missing, invalid or exceeded bounds fail closed.
This checks supplied observations only, not infrastructure, erased bytes or
artifact authenticity. No default recovery objectives are invented.

The `backup-restore` check lives in the existing `checks` array and remains blocked
until the actual isolated drill and owner review. The live scenarios also remain
blocked. These procedural additions do not constitute deployed E2E evidence.

Run `node scripts/launch-gate.mjs [evidence.json]` for the separate owner-signature
check. Exactly one `launch-decision` must have status `approved`, a reviewer and
a valid non-future timestamp with timezone. The full readiness validator now also
uses `approved` for this decision; all other successful checks use `pass`.
The signature check does not authenticate the reviewer or replace full readiness
validation, and is not wired to authorize deployment or open intake.
