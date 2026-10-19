# Product boundary

Hiring lets one recruiting organization operate distinct outward-facing brands with a controlled internal ATS. Each application belongs to exactly one brand and one requisition. A candidate can have multiple applications, including across brands, without exposing one brand's identity or data to another.

## Actors

- **Organization owner:** manages organization, membership, brand access, retention and integrations.
- **Recruiter:** manages authorized requisitions, applications, interviews and communications.
- **Hiring manager:** reviews assigned requisitions and decisions with limited candidate access.
- **Interviewer:** sees an assigned packet and submits their own scorecard; no broad search or export.
- **Candidate:** submits, views, corrects, withdraws and requests deletion through a scoped, time-limited flow.
- **Integration:** acts only within an explicit organization/brand installation and permission scope.

Platform `app.roles` gates app-level administration. Hiring must also enforce organization, brand, requisition and assignment grants server-side for every record and tool. A platform role alone never grants cross-brand access.

## Scope

**MVP:** organization and brand setup; membership/grants; requisition drafting and publishing; accessible brand-specific application form; candidate/application records; duplicate suggestions with human-controlled merge; stage pipeline; recruiter review; interview scheduling metadata and scorecards; human decision and offer tracking (no signature); consent, retention and audit; MAIL-mediated transactional messages; constrained MCP tools; export/deletion requests. Each form identifies the organization and brand and displays the approved privacy notice.

**Next:** separately consented talent pools, configurable templates, suppressed-small-cell analytics, calendar integration, structured offer approval, import and webhooks.

**Conditional:** job-board syndication, AI assistance, background checks and agency workflows require their own security, fairness, legal and commercial review.

Hiring is not payroll, HRIS, contract signing, immigration advice or an automated hiring decision maker. No ranking, rejection or offer may be made solely by AI. Candidate data is not a shared cross-brand talent pool by default. Unpaid trials, internships and volunteer roles follow the governance gate, not ordinary paid-job publishing.

Launch requires two distinct brands to run end-to-end without cross-brand access, resilient messaging, working subject rights, accessibility/security evidence and approved public legal identity and copy. Until then marketing and legal pages remain placeholders.
