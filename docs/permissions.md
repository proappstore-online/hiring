# Server permissions (#12)

Platform authentication supplies `:__user_id`; caller arguments and app-level role claims never supply Hiring authority. Platform administrators do not automatically gain candidate access. Hiring's D1 records map that identity to organization, brand and requisition permissions. Every staff action checks the current `hiring_effective_access` view in SQL. Organization suspension removes staff access. Public job snapshots and candidate-owned actions retain their separate authorization contracts.

Migration `0012_scoped_permissions` adds a membership revocation ledger and the effective-access view without changing existing records. Active legacy owner/recruiter memberships remain brand-wide. Active `hiring_grants` apply to an organization (both scope columns null), brand (requisition null), or exact requisition. Organization grants expand only to brands in that organization. Revoked grants and memberships confer no authority. Multiple active grants are additive; revoking one does not cancel another independent grant.

| Role | Server permission |
| --- | --- |
| Owner | Brand-wide staff operations, grant administration, passkey-protected publication. Creating sibling brands and organization-wide delegation also require organization creator identity. Owner delegation/revocation is unavailable through these tools. |
| Recruiter | Full application reads and operational writes within granted requisitions. Creating requisitions and listing staff/publications require brand-wide authority. |
| Reviewer | Restricted `gateway_get_application` / `gateway_list_applications` reads within scope, and only for applications currently assigned to that identity. No full candidate/contact/history reads or mutations. |
| Auditor | `list_application_audit` within granted requisitions. No candidate detail reads or business mutations. |

An application assignee must have active owner, recruiter or reviewer authority for that exact requisition. Assignment alone grants no access. Reassignment immediately removes the previous reviewer's access; revocation also removes access even if their user ID remains on an application. Reviewers cannot reassign themselves. Application mutations still require optimistic versions where supported, and audit/operation checks remain atomic.

## Administration actions

All actions require platform authentication. A brand-wide owner calls `grant_workspace_access` with `organization_id`, `brand_id`, optional `requisition_id`, `member_user_id`, `role`, `grant_id` and `operation_id`. Roles are limited to recruiter/reviewer/auditor. The requisition must belong to the selected brand. Omit the requisition to grant brand-wide authority. Grants cannot target the caller or overwrite existing grant IDs.

`grant_organization_access` takes the same fields except requisition; it additionally checks the organization's creator. Its selected owned brand supplies audit attribution; the new grant covers all brands in that organization. `list_workspace_grants` returns active grant/membership IDs and scopes to a brand-wide owner.

`revoke_workspace_grant` and `revoke_workspace_membership` take organization, brand, `grant_id` and a new `operation_id`. The membership action records a durable revocation rather than deleting legacy data. Only the organization creator can revoke an organization-wide grant. Self-revocation and owner revocation are unavailable. Revoked legacy memberships can be replaced with a new explicit grant if access is needed again; `add_workspace_member` does not reactivate them.

Successful administration appends an audit event with platform actor and object ID. A replay, forged scope, unauthorized role, or rejected administration attempt writes nothing. Audit failure rolls back the entire batch. Reads return empty results for missing or unauthorized objects; mutations return zero changes, following the existing gateway contract. Read/denial auditing and authenticated rate limiting remain separate open work.

`tests/permissions.test.mjs` exercises scoped reads and writes, forged IDs/roles, assignment changes, revocation, overlapping grants, role restrictions, organization suspension, administration ownership, replay and audit rollback. Existing multi-brand and intake tests also exercise these deployed SQL statements.
