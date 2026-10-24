# Launch verification and evidence (#6)

Status on 24 October 2026: **HOLD**. Accountable release owner: Serge
(`serge-ivo`, as recorded in the capability/governance register). No owner
approval, live E2E pass or restore drill is asserted by this document.
External legal review remains waived by #52; owner approval of public identity,
contact, processor arrangements and notice versions is still required.

## Evidence matrix (#54)

[launch-evidence.json](launch-evidence.json) is the checklist: each entry names
the accountable owner, source issue, intake/launch gate and exact pass criterion.
All entries are pending until supported by reviewed artifacts. Intake checks
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
| Monitoring and incident response | Scoped diagnostics and outbox tests | #35/#48 alert delivery, incident backup, escalation contacts and two tabletop records |
| Deployment safety | CI typecheck/full test suite; Platform Compliance build/no tracking/secrets/metadata/bundle checks; deploy migration-before-tools-before-client | #42 exact candidate SHA and passing run URLs for all three workflows; failed migration release evidence |
| Live scenarios and recovery | Local tests cover portions of roadmap scenarios | #38 all seven live scenarios, isolated D1/R2 drill, RPO/RTO, tombstone replay and owner launch/rollback decision |

Platform Compliance does not check identity approval, screen-reader usability,
scanner readiness, processor deletion or restore. Post-deploy QA is advisory;
auth-gated skipped tests and HTTP 200 do not constitute an E2E pass. No workflow
changes are made by this matrix. The release evidence CLI is an operator check,
not a deployment interlock or an intake gate mutation.

## Recording and validating a release

Copy `docs/launch-evidence.json` to a restricted release record outside the
repository. Set `revision` to the full tested/deployed commit SHA and `environment`
to its HTTPS origin. For every check record `status: pass`, reviewer identity,
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
artifact references in #38; only then can #6 be closed. This avoids committing a
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
still identifies the operator as “The hiring team” with no contact email or
jurisdiction. Do not invent those values. Marketing publication is separate from
the app deploy. Existing GitHub runs for `a72c80d9113246e9954affe9fecf5d4158875d3e`
passed [CI](https://github.com/proappstore-online/hiring/actions/runs/40065942674),
[Platform Compliance](https://github.com/proappstore-online/hiring/actions/runs/40065942690)
and [Deploy](https://github.com/proappstore-online/hiring/actions/runs/40065942666).
These are historical evidence, not approval of a subsequent revision.

Remaining dependencies: #18 scanner/scoped bytes; #28–#31/#45 complete rights
and restore handling; #35 monitoring/alert delivery; #36 approved/public copy;
#37 manual security/accessibility review; #47 provider evidence; #48 backup,
contacts and exercises; #38 live scenarios/restore/owner decision. The #54 matrix
is now documented, but other checks remain pending. See
[operations and recovery](release-operations.md). Existing runtime intake stays
closed; no new tool opens it.
