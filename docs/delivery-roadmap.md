# Delivery roadmap

GitHub issues are the execution queue, with explicit dependencies. Work lands directly on main in small additive changes. This is sequence, not dates.

| Phase | Outcome and gate |
| --- | --- |
| 0. Capability and policy | Verify worker/public endpoint, D1, MCP and MAIL; owner/contact, legal basis, indefinite retention and owner-approved arrangement disclosures. Block intake if unresolved. |
| 1. Secure core | Additive schema, tenant/grant enforcement, audit/outbox, organization/brand/requisition management. Prove cross-brand denial and migration order. |
| 2. Intake | Brand forms, protected endpoint, attachments, consent, candidate token, application pipeline and reviewer access. Two-brand E2E. |
| 3. Decisions and messaging | Interviews, scorecards, human decisions/offers, MAIL send/reconcile and retry. No duplicate send. |
| 4. Rights and agent access | Retention, requests, export/deletion, least-privilege MCP, monitoring and recovery. |
| 5. Launch | Approved marketing/legal, accessibility/security review, live E2E, restore drill, incident owner and rollback plan. |

Every development issue includes appropriate authorization/data handling, useful failure states, targeted tests and doc updates for contract changes. On main, check CI, deploy and live behavior before closure. No planning assumption becomes a public promise without owner approval.

The [capability and governance gate register](capability-governance-gates.md) identifies Serge as accountable owner and links evidence and unblock conditions for downstream work. Completing discovery epic #1 does not open intake or authorize sending.

## Release scenarios

1. Brand A recruiter cannot discover or mutate Brand B through UI, URL, export or MCP.
2. Same-email applicants across brands remain separate absent an authorized audited merge.
3. Candidate applies, receives branded receipt, withdraws and requests export/deletion without a recruiter account.
4. Unpaid, internship and volunteer roles use accurate disclosures and ordinary human publication/offer authorization, with no legal-review gate.
5. MAIL timeout and quota exhaustion preserve business state; unknown sends require manual reconciliation. Test callbacks/bounces only on a provider that supports them.
6. Schema expansion precedes dependent tools/client; failed migration blocks release.
7. Private attachment and candidate token cannot be fetched by another candidate or unassigned staff.

The [#53 ADR review](architecture.md#affected-backlog-dependencies) records resolved #52/#9 policy inputs and remaining implementation/capability dependencies, including the separate FAS mail route #58.

Issue #3 progress: publication and authenticated intake actions/UI have been added with regression tests; intake remains closed pending trusted file scanning and assigned-reviewer byte serving. See [intake contract](candidate-intake.md). This progress does not complete Phase 2 or authorize closing the epic.
