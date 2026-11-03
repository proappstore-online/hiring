# MCP audit, external activity, and next actions

Migrations 0056–0058 add `mcp_audit_log`, `external_actions`, and `next_actions`.
Audit and external-action rows reject UPDATE and DELETE. There is no TTL or purge
job for these tables. Next actions are mutable so owners can change their due
date, blocker, and status.

Next actions are **internal hiring-team reminders and work records** for Serge
and the hiring bot. They help the team resume work each day and preserve what
was done. `candidate_id` links a reminder to a record; it never makes that
candidate or intern the task owner or exposes a task to them. New and reassigned
owners are restricted to `Serge` or `bot` (the hiring bot). Completed actions
remain available as internal history.

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
| `create_next_action` | Create a hiring-team reminder linked to a candidate or organization; owner is `Serge` or `bot`. |
| `update_next_action` | Change reminder, due date, team owner, or blocker state. |
| `complete_next_action` | Mark team work done and retain its record. |
| `list_next_actions` | Filter internal reminders and completed records by linked candidate, organization, status, or team owner. |
| `session_start` | Return open and overdue team reminders plus recent audit and external activity for the daily review. |

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
