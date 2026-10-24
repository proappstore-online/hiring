# Hiring planning set

These documents are the implementation baseline. Changes to a decision require a documented revision and updates to affected issues.

| Document | Purpose |
| --- | --- |
| [Capability and governance gates](capability-governance-gates.md) | Issue #1 decisions, accountable owner, evidence and downstream unblock conditions. |
| [Routing foundation](routing.md) | Public/recruiter routes, scope, detail API limits and SPA fallback. |
| [Product boundary](product-boundary.md) | Actors, release scope, brand separation, exclusions. |
| [Domain model](domain-model.md) | Canonical records, invariants, state transitions. |
| [Internal workspace](internal-workspace.md) | Staff setup, scope, and current limits. |
| [Architecture and ADRs](architecture.md) | Platform mapping, authorization and deployment decisions. |
| [Privacy and governance](privacy-governance.md) | Consent, retention, rights and unpaid-arrangement controls. |
| [MAIL contract](mail-contract.md) | Provider-neutral messaging boundary and failure handling. |
| [Hiring MCP contract](hiring-mcp-contract.md) | Safe agent tools, identity, authorization and mutation rules. |
| [Hiring agent operations](hiring-agent-operations.md) | Live PAGS communications-agent configuration, Gmail mailbox requirement, checks and recovery. |
| [Delivery roadmap](delivery-roadmap.md) | Phases, dependency gates and release acceptance. |
| [Launch readiness](launch-readiness.md) | Traceable release matrix, evidence checklist, live scenarios and current holds. |
| [Repository security review](security-review.md) | Threat boundaries, dependency remediation, regression evidence and manual review limits. |
| [Release operations](release-operations.md) | Draft incident, messaging recovery and isolated restore/rollback procedures. |
| [Google sign-in](google-sign-in.md) | Live PAS-native auth path and operator configuration. |

This is a plan, not a claim that features exist or legal copy is approved. The runtime configuration remains a scaffold. Capability and policy discovery is recorded in the gate register; its remaining implementation and release gates must be verified before dependent launch work.

## Delivery environment prerequisite

The repository workflows use GitHub-hosted runners; the deploy workflow uses GitHub OIDC rather than stored repository credentials. Workflow execution therefore also depends on the organization/account having an active GitHub Actions billing arrangement and available spending limit. When GitHub prevents a job from starting at the account layer, no workflow-step or secret change can remedy it. The owner must resolve the billing block and re-run CI, Platform Compliance, and Deploy to R2. Issue #43 records the observed block and remediation.

Candidate intake implementation and its remaining release gate: [Requisitions and authenticated candidate intake](candidate-intake.md).

Server identity, scoped grants, assignment restrictions and revocation: [permissions contract](permissions.md).

Append-only audit, durable job transitions and retry safety: [audit and outbox contract](audit-outbox.md).

Owner identity editors, scoped member management, and immutable public identity snapshots: [organization and brand administration](permissions.md#organization-and-brand-administration-14).

- [Organisation recruiting playbook](org-recruiting-playbook.md): versioned policy,
  owner-only saves, tenant guards, audit, redaction and agent fallback (#77/#76).

- [Scoped core erasure](erasure.md): owner-only redaction, explicit holds, durable
  partial status and remaining store/processor blockers (#31, not yet complete).

- [Privacy operations](privacy-operations.md): candidate intake, scoped identity review, versioned subject rights requests,
  private asynchronous subject exports, audited restricted MCP access and remaining #5 gaps.

- [Duplicate review and merge](candidate-duplicates.md): scoped suggestions, owner/passkey
  confirmation, canonical field provenance and preserved application ownership (#21).

- [Explicit deletion, legal holds and restore replay](retention.md): worker-only
  per-store progress, scoped holds, signed private ledgers and closed-gate replay;
  indefinite retention, with no automatic expiry (#28).

- [Operational monitoring and replay](operational-monitoring.md): scoped failure
  inspection, content-free alerts, trusted callback observation and safe recovery.

- [Verified candidate corrections](privacy-operations.md#verified-corrections-and-processor-rectification-45): scoped current-field execution, immutable provenance, MAIL/processor retries and completion gating.

- [Incident response and breach decisions](incident-response.md): versioned command, containment, evidence, processor escalation and notification records; synthetic [tabletops](incident-tabletops.json) and remaining readiness holds (#48).
