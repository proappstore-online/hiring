# Hiring planning set

These documents are the implementation baseline. Changes to a decision require a documented revision and updates to affected issues.

| Document | Purpose |
| --- | --- |
| [Capability and governance gates](capability-governance-gates.md) | Issue #1 decisions, accountable owner, evidence and downstream unblock conditions. |
| [Product boundary](product-boundary.md) | Actors, release scope, brand separation, exclusions. |
| [Domain model](domain-model.md) | Canonical records, invariants, state transitions. |
| [Internal workspace](internal-workspace.md) | Staff setup, scope, and current limits. |
| [Architecture and ADRs](architecture.md) | Platform mapping, authorization and deployment decisions. |
| [Privacy and governance](privacy-governance.md) | Consent, retention, rights and unpaid-arrangement controls. |
| [MAIL contract](mail-contract.md) | Provider-neutral messaging boundary and failure handling. |
| [Hiring MCP contract](hiring-mcp-contract.md) | Safe agent tools, identity, authorization and mutation rules. |
| [Hiring agent operations](hiring-agent-operations.md) | Live PAGS communications-agent configuration, Gmail mailbox requirement, checks and recovery. |
| [Delivery roadmap](delivery-roadmap.md) | Phases, dependency gates and release acceptance. |
| [Google sign-in](google-sign-in.md) | Live PAS-native auth path and operator configuration. |

This is a plan, not a claim that features exist or legal copy is approved. The runtime configuration remains a scaffold. Capability and policy discovery is recorded in the gate register; its remaining implementation and release gates must be verified before dependent launch work.

## Delivery environment prerequisite

The repository workflows use GitHub-hosted runners; the deploy workflow uses GitHub OIDC rather than stored repository credentials. Workflow execution therefore also depends on the organization/account having an active GitHub Actions billing arrangement and available spending limit. When GitHub prevents a job from starting at the account layer, no workflow-step or secret change can remedy it. The owner must resolve the billing block and re-run CI, Platform Compliance, and Deploy to R2. Issue #43 records the observed block and remediation.
