# Capability and governance gates — issue #1

Reviewed 21 October 2026. Accountable owner: **Serge (serge-ivo)**, the product/platform owner identified in [#52](https://github.com/proappstore-online/hiring/issues/52#issuecomment-6309937556) and [MAIL discovery #8](https://github.com/proappstore-online/hiring/issues/8#issuecomment-6286791370). Implementation belongs to the linked Hiring backlog; this register does not claim individual implementers have been assigned.

## Recorded decisions

| Gate | Disposition and evidence | Contract |
| --- | --- | --- |
| Platform | Discovery complete, #7 closed. Source-verified authenticated SQL/batches; no supported anonymous writes; live worker enablement unverified. [Evidence](https://github.com/proappstore-online/hiring/issues/7#issuecomment-6285007874). | [Architecture](architecture.md), [MCP](hiring-mcp-contract.md) |
| MAIL | Discovery complete, #8 closed. PAS email lacks idempotency, IDs and callbacks; provisioning was unavailable at the recorded probe. FAS bridge is a separate, unconfigured route in #58. [Evidence](https://github.com/proappstore-online/hiring/issues/58#issuecomment-6312058208). | [MAIL contract](mail-contract.md) |
| Privacy | #9 complete: documented processing bases, indefinite retention, explicit deletion and owner-maintained public notices. [Evidence](https://github.com/proappstore-online/hiring/issues/9#issuecomment-6312506210). | [Privacy and governance](privacy-governance.md) |
| Unpaid arrangements | #10 closed as won't-do: no legal-review gate, including unpaid, internship and volunteer roles. Accurate disclosures still required. [Owner decision](https://github.com/proappstore-online/hiring/issues/10#issuecomment-6309937939). | [Product boundary](product-boundary.md), [governance](privacy-governance.md) |
| Product and ADRs | #52 and #53 complete: multi-tenant, public organization sign-up, independent worker registration; ADRs accepted/revised against those decisions. [Review evidence](https://github.com/proappstore-online/hiring/issues/53#issuecomment-6312826405). | [Domain model](domain-model.md), [ADRs](architecture.md) |

## Downstream blocker register

**Serge is accountable for every row**, including platform/provider coordination and accepting release evidence. These are open delivery gates, not unresolved policy approvals. Evidence is dated discovery and repository contracts, not a new live capability probe.

| Blocker / affected work | Evidence | Required unblock evidence |
| --- | --- | --- |
| Authenticated intake and worker ownership: #14, #16, #17, #19 | #7 and ADR-002; public signup approval in #52 does not enable anonymous writes. | Supported authenticated self-registration/application flow, ownership checks, abuse controls, notice/idempotency tests. Anonymous writes remain unsupported. |
| Tenant grants, audit and high-impact actions: #12, #13, #24, #32–#34 | ADR-001 and [MCP contract](hiring-mcp-contract.md); current gateway is restricted SQL reads. | Server-side assignment/grant denial tests, atomic audit/outbox, human confirmation for decisions/offers; verified throttling and denial audit where required. #33 waits for #20; #34 waits for #24/#27. |
| Private files and search: #18, #46 | ADR-005 records scanning and access-checked downloads as unproven. | Private upload/scan/download evidence and cross-brand denial for files and search. |
| PAS messaging: #25–#27, #47 | #8 and [MAIL gap analysis](mail-contract.md#gap-analysis-and-compensating-controls). | Owner-confirmed provisioning/processor terms, suppression, escaped templates, authorized sender, quota handling and manual unknown-send reconciliation. No unsupported callbacks or delivery claims. |
| FAS messaging: #58 | [Live setup evidence](https://github.com/proappstore-online/hiring/issues/58#issuecomment-6312058208); PAGS platform #1277/#1278 prerequisites. | Dedicated bridge, approved sender, recipient isolation, bounded reads and owner-address roundtrip with IDs/dedupe; verified application contact before outreach. Do not substitute unrelated Gmail/PAS credentials. |
| Rights and processor handling: #28–#31, #45 | #9 and [governance](privacy-governance.md). | Reconcile #28 to indefinite retention without automatic purge; identity-verified export/correction/erasure and processor propagation tests. No legal-review approval needed. |
| Public notices and release operations: #35–#38, #48, #54 | [Roadmap](delivery-roadmap.md) release scenarios and [#9 publication limitation](https://github.com/proappstore-online/hiring/issues/9#issuecomment-6312506210). | Owner/contact and processor confirmation, published marketing notices (app deploy does not publish marketing), incident owner/runbook, monitoring, security/accessibility, two-brand E2E and restore evidence. |

## Closure boundary

Issue #1 resolves discovery, policy decisions and ownership tracking. It does not complete the downstream implementation issues or approve public intake, mail sending or launch. The runtime gate remains `closed / public_intake_route_unverified`. Current communications remain drafts; unknown send outcomes must never be automatically retried. Revisit the relevant contract and this register when platform capabilities or owner decisions change; record evidence in the affected issue before opening a release gate.

Issue #3 now implements public job discovery, passkey-gated publication and gated candidate submission/consent. Its attachment reservations remain quarantined. The existing intake gate stays closed until trusted scanning and brand/assignment-scoped byte serving are verified; SQL tests alone do not resolve that gate. See [intake contract](candidate-intake.md).
