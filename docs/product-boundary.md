# Product boundary

Hiring is a multi-tenant service where many recruiting organizations register through public organization sign-up and each operates distinct outward-facing brands with a controlled internal ATS. Each application belongs to exactly one brand and one requisition. A candidate can have multiple applications, including across brands, without exposing one brand's identity or data to another.

## Approved owner decisions

[Serge approved these decisions in issue #52 on 21 October 2026](https://github.com/proappstore-online/hiring/issues/52#issuecomment-6309937556):

- **Multi-tenant architecture:** organizations are isolated tenants; brand and application access remains scoped within each organization.
- **Public organization sign-up:** any organization can register itself.
- **Worker self-registration:** workers create their own account, login and profile independently of an organization adding them or an application being created. Applications link to that worker identity without granting organizations access to other tenants' or brands' records.
- **Indefinite data retention:** data is retained indefinitely, with no scheduled expiry or automatic retention purge. Explicit deletion and subject-rights requests remain supported.
- **No legal review required for now:** legal review is not an approval or launch prerequisite at this stage. Unpaid, internship and volunteer roles do not require a legal-review gate; issue #10 was closed as won't-do. This records a product decision, not a legal compliance finding.

These decisions resolve the organization/onboarding, worker identity, retention (#9) and legal-review assumptions for this scope. The approved design is not a claim that public sign-up or worker self-registration is already implemented; see the schema reconciliation in the domain model.

## Actors

- **Organization owner:** manages organization, membership, brand access and integrations under the approved indefinite-retention policy.
- **Recruiter:** manages authorized requisitions, applications, interviews and communications.
- **Hiring manager:** reviews assigned requisitions and decisions with limited candidate access.
- **Interviewer:** sees an assigned packet and submits their own scorecard; no broad search or export.
- **Worker/candidate:** self-registers with their own login and profile; submits, views, corrects, withdraws and requests deletion through authorized, scoped flows.
- **Integration:** acts only within an explicit organization/brand installation and permission scope.

Platform `app.roles` gates app-level administration. Hiring must also enforce organization, brand, requisition and assignment grants server-side for every record and tool. A platform role alone never grants cross-brand access.

## Scope

**MVP:** public organization sign-up, brand setup and worker account/profile self-registration; membership/grants; requisition drafting and publishing; accessible brand-specific application form; candidate/application records; duplicate suggestions with human-controlled merge; stage pipeline; recruiter review; interview scheduling metadata and scorecards; human decision and offer tracking (no signature); consent, retention and audit; MAIL-mediated transactional messages; constrained MCP tools; export/deletion requests. Each form identifies the organization and brand and displays the approved privacy notice.

**Next:** separately consented talent pools, configurable templates, suppressed-small-cell analytics, calendar integration, structured offer approval, import and webhooks.

**Conditional:** job-board syndication, AI assistance, background checks and agency workflows require their own security, fairness and commercial review; legal review is not currently required.

Hiring is not payroll, HRIS, contract signing, immigration advice or an automated hiring decision maker. No ranking, rejection or offer may be made solely by AI. Candidate data is not a shared cross-brand talent pool by default. Unpaid trials, internships and volunteer roles follow ordinary role publishing without a legal-review gate at this stage.

Launch requires two distinct brands to run end-to-end without cross-brand access, resilient messaging, working subject rights, accessibility/security evidence and approved public legal identity and copy; no separate legal review is required. Until then marketing and legal pages remain placeholders.
