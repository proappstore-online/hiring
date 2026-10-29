# MCP audit, external activity, and next actions

Migrations 0056–0058 add `mcp_audit_log`, `external_actions`, and `next_actions`.
Audit and external-action rows reject UPDATE and DELETE. There is no TTL or purge
job for these tables. Next actions are mutable so owners can change their due
date, blocker, and status.

All eight tools require a signed-in platform user and exact organization/brand
scope. Staff audit reads allow owners, recruiters, and auditors. Writes require
brand-wide owner or recruiter access. `log_external_action` also requires
`performed_by` to equal the platform-bound user ID; it records evidence but
does not send a message. The `params_json` argument stores full external action
parameters and may contain private data, so it is omitted from the redacted MCP
audit input. Do not put credentials in external action parameters.

| Tool | Purpose |
| --- | --- |
| `query_audit_log` | Filter audit rows by candidate, entity, tool, caller, and time. |
| `log_external_action` | Record email, LinkedIn, or Discord action with provider IDs. |
| `get_activity_timeline` | Combine audit and external actions in time order. |
| `create_next_action` | Create an open candidate or organization action. |
| `update_next_action` | Change action, due date, owner, or blocker state. |
| `complete_next_action` | Mark an action done. |
| `list_next_actions` | Filter by candidate, organization, status, or owner. |
| `session_start` | Return JSON arrays of open, overdue, and recent activity. |

The new write tools append an audit row in the same SQL batch after a successful
write. The source definitions are in `scripts/audit-tools.mjs`; regenerate them
with `node scripts/audit-tools.mjs`.

## Dispatch limitation

The platform runs registered `mcp.json` SQL tools. This repository has no MCP
dispatch middleware hook, and `worker/exports.mjs` only consumes export jobs.
`scripts/mcp-audit-middleware.mjs` provides a tested dispatch adapter for a
future hook; it is not invoked by the current platform runtime.
Consequently these migrations and tools **do not yet log every existing MCP tool
call**. In particular, older write tools and reads are not in `mcp_audit_log`,
failed SQL calls cannot be recorded by an in-transaction audit insert, and the
platform does not expose caller agent/session IDs or final result status to SQL
actions. A repo-local JavaScript wrapper would not run on calls made directly to
the platform. Dispatch-level logging requires platform support and a separate
deployment before `session_start` can be relied on as a complete history.
