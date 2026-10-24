# Next-stage and conditional capability gates (#44)

Reviewed 2026-10-25. Accountable owner: Serge. The [gate register](next-stage-gates.json)
assigns independent approval, security, fairness, commercial and processing-basis/notice
reviews to every capability in #39, #40, #41, #49 and #50. All activation approvals
remain pending: repository implementation and a closed issue are not production approval.
This epic establishes governance; it authorizes no candidate-data transfer or AI decisions.

## Delivery and approval matrix

| Child / capability | Repository state | Separate approval and security gate |
| --- | --- | --- |
| #39 talent pool | Implemented; [contract](talent-pool.md), SQL and browser tests | Optional brand-only affirmative consent, current unrestricted brand grants, participation expiry/withdrawal and erasure. No automatic outreach or cross-brand sharing. |
| #40 funnel analytics | Implemented; [contract](funnel-analytics.md), SQL and browser tests | Fixed aggregates, current brand grants, small-pattern suppression including complements; review repeated-observation risk. No candidate-level filters, drilldown or export. |
| #41 calendar | Assessed, blocked; [assessment](integration-assessment.md) | Provider/processing contract, minimum scheduling fields, scoped OAuth, scheduling choice, revocation and reconciliation evidence. |
| #41 job listing | Assessed, blocked | Public listing allowlist, partner terms/spend cap, update/expire tests; approval grants no candidate transfer. |
| #41 candidate transfer | Separately blocked | Explicit transfer contract, recipients/fields, basis/notice and required consent, processor rights propagation and two-brand security evidence. |
| #49 import | Bounded v1 implemented; [contract](governed-import-webhooks.md) | Source format/schema and organization/brand mapping, provenance, consent basis, duplicates, validation, rollback and tenant-isolated dry run. Test forged tenant and partial failure before activation. |
| #49 outbound webhooks | Bounded v1 implemented; [contract](governed-import-webhooks.md) | Installation and permitted-brand subscriptions, minimal payloads, signatures, replay prevention, bounded retries, dedupe and audit. Test duplicate delivery, revocation and rights propagation. |
| #50 AI assistance | Assessed, blocked; [assessment](conditional-workflow-assessment.md) | Human attribution, fairness evaluation and model-data controls; no automated ranking, rejection or offers. No candidate training or external model transfer without separately approved basis and controls. |
| #50 background checks | Assessed, blocked; [assessment](conditional-workflow-assessment.md) | Jurisdiction/basis, processor/data-flow map, scoped consent and assignment, notice impact, retention/erasure and revocation. Unresolved risks hold this capability. |
| #50 agency workflows | Assessed, blocked; [assessment](conditional-workflow-assessment.md) | Jurisdiction/basis, agency roles and processor/data-flow map, scoped consent and assignment, notice impact, retention/erasure and revocation. No broad agency access. |

The pending reviews for #39/#40 record missing activation attestations; they do not
claim those implemented local features were removed or that a runtime switch was added.
The existing consent, grant and suppression predicates continue to enforce their
documented boundaries. Their approval cannot authorize another capability.

## Evidence required before activation

Each row requires its own dated owner decision and reviewer evidence for security,
fairness, commercial terms, and applicable jurisdiction, processing basis and notice.
Record the implementation issue, exact revision/environment, organization/brand,
purpose, provider/processor, allowed fields/recipients, contract revision, reviewer,
review date and expiry. Do not copy a sibling's approval. Changes to provider,
scope, terms, or data flow require renewed review. Missing, expired, revoked or
mismatched evidence keeps that capability blocked.

The [owner policy](privacy-governance.md) waives external legal sign-off; this
register does not reintroduce a lawyer approval or unpaid-role legal gate. Processing
basis, jurisdiction, candidate notice and processor obligations still need an
explicit recorded disposition for the proposed capability. Indefinite application
retention and explicit deletion remain in force; talent-pool participation expiry
is not an application deletion schedule.

Security evidence must exercise current grants, cross-tenant/brand denial, least
privilege, revocation, payload minimization, audit and failure/retry behavior.
Fairness evidence must address exclusion/disparate impact, human accountability
and candidate alternatives. Commercial evidence must identify actual supplier
terms, quotas, spend cap, secondary use, subprocessors and exit costs, or explicitly
justify no external supplier/spend for an internal-only capability. Privacy evidence
must include correction/erasure propagation, retention and incident handling.

#38 is closed, but the [launch evidence](launch-evidence.json) still records holds.
Actual revision-bound live evidence and the owner launch decision remain required.
Neither #38 nor #44 closure satisfies a capability's approval or opens intake.

## Implementation handoff and closure boundary

#49 retains import/webhook design and implementation ownership. Split large source
formats or event families into further issues after schema, mapping, authorization
and processor review. #50 must produce separate go/no-go assessments and follow-on
implementation backlogs; it must not build or enable those three capabilities.
The bounded #49 repository implementation is complete; #50 completes assessment
only with separate no-go decisions and follow-on backlogs in the [assessment](conditional-workflow-assessment.md). All production activation reviews remain independent.

The #49 SQL actions and server dispatch adapter implement a bounded v1 behind
empty trusted approval records. No production import runner, webhook dispatcher,
conditional connector, AI call, background check or agency access path is enabled
by the governance register. Before activating such a path,
implement a trusted server-side approval lookup bound to the above scope and
recheck it before every operation and queued retry. Demonstrate denial for missing,
expired, revoked and wrong-brand evidence, sibling approvals, forged tenant,
duplicate delivery and partial failure. Generic SDK availability, MAIL permissions,
OAuth sign-in, application consent and talent-pool consent cannot substitute for it.

The JSON register and `tests/next-stage-gates.test.mjs` are repository governance
checks, not a deployed authorization service or proof of live review. Existing
CI runs these checks through the full test suite. Future activation requires an
explicit reviewed contract revision, implementation tests and owner evidence;
editing a status field alone grants no runtime permission. #44 closes the gate
inventory and handoffs while #49/#50 and every pending production approval remain
independently tracked.
