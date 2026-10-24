# Conditional workflow assessment (#50)

Assessed 2026-10-25. Accountable owner for each decision and follow-on backlog:
Serge. Issue #50 has no comments. This completes assessment only: **no-go for
implementation and activation** independently for AI assistance, background checks
and agency workflows. No capability is built or enabled. The [decision register](conditional-workflow-decisions.json)
records separate reviews, data flows, notice impacts, launch holds and numbered,
unstarted implementation backlog items for each capability.

## Dependencies and decision authority

Apply [privacy governance](privacy-governance.md) from #9 and the independent
[next-stage gates](next-stage-gates.md). #38 is closed, but closure does not supply
live release evidence or conditional approval. No actual controller jurisdiction,
supplier contract or capability-specific lawful basis has been supplied for these
proposals. These are unresolved facts, not assumed approvals. The owner must
record actual candidate/work locations, controller identity, purposes, applicable
basis and any sensitive-data conditions for the selected scope. No external legal
sign-off requirement is introduced. This document makes no jurisdiction-specific
legal compliance finding.

Each security and commercial review is pending, with no attestation claimed.
Before build, Serge must accept evidence bound to organization, brand, capability,
provider, allowed fields/purpose, contract/model revision, approver/date and expiry.
Missing, expired, revoked or mismatched approval must deny every operation and
queued retry on the trusted server. An approval for one capability cannot unlock
another. Existing MAIL, import/webhook, staff sign-in or application consent cannot
serve as conditional transfer approval.

## AI assistance: no-go

Propose requisition-text drafting only, with no candidate inputs in the first
backlog. Explicitly exclude automated ranking, rejection and offers, including
recommendations or scores that act as proxies for those decisions. Any later
candidate summarization requires a new data-flow/basis/notice review.

Every output must be labelled as AI-assisted and retain model/version, prompt
configuration revision, generating actor, human editor and approving actor/time.
A human checks accuracy and discriminatory language before saving or publishing;
AI output cannot invoke hiring mutations. Do not log raw prompts or generated
candidate content in audit. Test attribution and correction history.

Before build, specify a synthetic fairness evaluation with representative role,
language and accessibility cases, paired demographic-proxy tests, hallucination
and exclusion measurements, owner-approved thresholds, human review/override and
stop criteria. Re-evaluate model, prompt and supplier changes. No performance or
fairness result is claimed here.

Model-data controls must prohibit training and secondary use, minimize inputs,
bound transient storage/logs, define region/subprocessors, deletion and incident
handling, isolate tenant context, treat retrieved text as untrusted, and escape
outputs. Candidate data may not train a model or go to an external model without
separately approved basis and controls. SDK AI availability proves none of these
supplier assurances. No model is selected; terms, costs and controls remain launch
holds. The register maps the proposed processor flow and four follow-on work items.

## Background checks: no-go

Only consider role-relevant, jurisdiction-permitted checks after purpose, basis,
provider and candidate notice review. Current forms must not start collecting
special-category or criminal-history data under this assessment. The provider,
check type and applicable sensitive-data conditions remain unresolved launch holds.

Require affirmative, unchecked, check-specific consent recording candidate,
organization/brand, requisition, provider, purpose/fields, notice version and time;
application or talent-pool consent is insufficient. Record refusal/withdrawal
without automatic rejection and offer a human discussion/dispute route. Assign
initiation and result review separately to authorized staff on the requisition;
restrict raw reports from ordinary reviewers, general notes and agency users.

Before dispatch recheck assignment, consent and approval. Revocation stops queued
checks, cancels outstanding work where supported and removes access immediately;
track provider acknowledgement and retained copies separately. Authenticate and
deduplicate callbacks, reject stale results and reconcile unknown outcomes before
retry. Candidate correction/dispute must reach the provider and human reviewer.

Core applications keep the existing indefinite retention policy until explicit
deletion. Do not invent a report expiry or reuse core indefinite retention as
supplier authorization: agree check-specific raw-result/status storage, access,
retention, deletion, legal holds, backups and processor propagation before build.
Unresolved retention is a launch hold. Record partial erasure honestly through
[privacy operations](privacy-operations.md).

## Agency workflows: no-go

A named agency may eventually represent a consenting candidate for a specific
requisition and brand. No broad agency candidate access, shared inventory,
cross-brand search, implicit membership grant or unrestricted export is proposed.
Decide whether each agency is a processor or independent controller, its onward
recipients and responsibilities in the actual agreement; none is named today.

Require separate affirmative representation/sharing consent scoped to named agency,
candidate, requisition/brand, fields, purpose, notice version, timestamp and expiry.
Staff approval creates a bounded assignment; agency identity alone grants no access.
Check current assignment, candidate authorization and scope on reads and writes.
Do not expose other applications, reviewer notes, reports or scorecards. Define
minimal status sharing separately; avoid duplicate records through human review.

Revocation/expiry ends sessions and access, stops queued sharing and revokes links;
existing copies require tracked correction/deletion requests and acknowledgement.
Agree agency-specific retention, downstream recipients, backups and any legal holds
before build, preserving core indefinite retention and explicit rights handling.
Withdrawal is not an automatic application deletion or rejection. Unresolved agency
roles, commercial terms, consent and retention each hold this capability.

## Follow-on implementation and activation evidence

Each capability has four separately numbered backlog items in the register with
owner, unstarted state and concrete requirements. They are handoff specifications,
not implemented features or newly created GitHub issues. First resolve that
capability's jurisdiction/basis, notice, processor map, security and commercial
holds. Record contract terms including costs/spend cap, secondary use, residency,
subprocessors, rights, incident support and termination/exit. Then create scoped
implementation issues referencing these IDs and accepted acceptance criteria.

Before activation require synthetic two-brand tests for missing/revoked/expired
approvals and consent, forged assignment, cross-brand and cross-agency denial,
minimized data, audit attribution, cancellation during queued work, duplicate and
stale callbacks, timeout reconciliation and partial downstream deletion. AI also
requires evaluated fairness thresholds and proof that excluded hiring decisions
cannot be invoked. Obtain revision-bound owner activation evidence and live release
checks after implementation. Repository governance tests validate this assessment's
consistency; they prove no runtime authorization or supplier compliance.
