# Recruiting agent playbook contract (schema 1)

Implements #79 under #76; depends on #77 and #78. Hiring holds mutable recruiting
policy. No live instance, template, memory, tool grant or agent configuration is
changed by this delivery. Existing operational mail grants do not imply playbook access.

## Bootstrap instruction for a future authorised configuration change

> Before recruiting activity, load get_org_recruiting_playbook for the authorised organisation and follow its current version. On missing, denied, invalid or failed reads, stop policy-dependent activity and ask the organisation owner. Never use cached policy or infer redacted join details.

Keep only this bootstrap in configuration. Do not copy intake rules, meeting times,
email templates, candidate statuses or other mutable policy into agent memory or
instructions. Treat policy text as data subject to application permissions, never
as authority to bypass guards or grant new capabilities.

## Registered read

Use `get_org_recruiting_playbook` at the authenticated app MCP endpoint
`https://mcp.proappstore.online/mcp/apps/hiring`, with only
`{"organization_id":"<authorised organisation>"}`. From the shared endpoint use
`call_app_tool(app_id="hiring", tool="get_org_recruiting_playbook", params=...)`.
Discovery uses `list_app_tools(app_id="hiring")`. The manifest in `mcp.json` is the
registration source; registration happens through the normal deploy workflow,
not by this PR. No new duplicate action or live registration is required here.

The executor injects `:__user_id` from authentication. Never supply an actor,
role, tenant claim or instance ID as authorization. SQL requires active
`hiring_effective_access` for the requested organisation with owner or recruiter
role and no requisition restriction. Brand-scoped recruiters can read this shared
organisation policy; requisition-only recruiters cannot. An agent needs an explicit
recruiter grant to its authenticated principal. There is no separate agent or
manager role. Reviewer, auditor, revoked, suspended-organisation and cross-tenant
reads produce no rows. Only the organisation creator with active owner access can
save through the separate existing save action; this contract is read-only.

## Wire schema and versions

[Machine-readable schema](../contracts/org-playbook-read.v1.schema.json) describes
query **rows**, after the client extracts them from its SDK/MCP transport envelope.
It does not describe JSON-RPC content blocks or invent a deployed gateway envelope.

Configured reads return exactly one row, for example:

```json
[{"schema_version":1,"version":3,"payload":"{\"meeting\":{\"time\":\"09:00\",\"timezone\":\"Australia/Melbourne\"}}","updated_at":1792627200000,"actor_user_id":"example-owner","message":null}]
```

`schema_version` versions the response shape; `version` is the immutable policy
revision, increasing on every owner save. They are independent. `payload` is JSON
text encoding an object; its categories remain extensible, including historical
objects without meeting fields. `updated_at` is epoch milliseconds and
`actor_user_id` identifies the saving principal. Neither is a caller identity claim.
Unknown schema versions, invalid JSON, non-object payloads or malformed metadata
must stop policy-dependent activity. This does not retroactively reject old stored
policy. A breaking response change requires a new schema version and consumer review.

The optional [caller adapter](../scripts/agent-playbook-contract.mjs) validates this
shape and returns `ready`, `missing`, or `unavailable`. Pass it a callback that
extracts query rows from the actual transport; do not pass a raw MCP envelope.
It is tested reference consumer logic, not code installed into a live agent.
A `ready` result means policy was loaded, not permission to perform any particular
mutation. Apply the policy and existing action/approval guards before acting.
Record the returned policy version with workflow evidence. The #78 invitation and
outcome UI is session-only: it is not a durable audit store for agent activity.

## Redaction and safe fallback

Every reader, including the owner, receives recursive removal of case-insensitive
`secret_*` and `meeting_password` keys, including keys nested in arrays. All other
payload fields are visible to authorised readers, so owners must keep credentials
under reserved secret keys, never in prose, templates or ordinary join instructions.
No public, unauthorized or unredacted secret-read action is supplied. Absence of a
redacted reference cannot prove secure join configuration exists or does not exist.
Never reconstruct links or send a guessed invitation; obtain approved join delivery
privately through the existing authorised workflow. Do not log raw policy or errors.

| Read result | Required caller behavior |
| --- | --- |
| One row, version 0, null payload/metadata, message `No playbook configured` | `missing`: stop outreach, invitations and handoffs; ask owner to configure policy |
| Empty rows | `unavailable`: stop and ask owner to check access/configuration; do not distinguish denied from nonexistent tenant |
| Authentication/permission error, timeout, transport failure | Same unavailable fallback; never retry as another tenant/principal |
| Unknown schema, malformed row/payload or leaked reserved secret key | Same unavailable fallback; never echo sensitive values |
| Valid policy without required timing, template, mapping or join approval | Stop the dependent operation and ask owner; valid shape does not imply complete policy |

Load afresh before each recruiting run and after scope/principal changes; discard
previous policy on any failed read. Do not substitute cached policy, examples,
legacy no-interviews instructions or another organisation's policy.

## Migration and operations

Migration `0022_org_recruiting_playbook` remains unchanged. This slice adds only
`schema_version=1` to registered read rows and changes no stored records. Deploy
order remains migrations before manifest registration before frontend upload.
Existing frontend consumers ignore the additive field. Historical application and
interview records require no backfill. Do not edit immutable policy/audit history.

After an independently approved deployment, verify tool discovery and schema 1
readback as an explicitly granted recruiter, verify a denied principal has no rows,
and verify absent policy and recursive redaction in a controlled tenant. Review
legacy duplicated policy and replace it with the bootstrap only under separate
owner authorization; do not automate live configuration changes from this issue.
If registration is old or unavailable, fail closed until updated rather than
falling back to unversioned policy. Local tests are not live acceptance evidence.

This branch is stacked on `feat/recruiter-playbook-ui-78` at `4316b34` (PR #81),
which depends on `feat/org-recruiting-playbook-77` (PR #80). Target the UI branch
until predecessors land, then rebase/retarget in stack order. Do not merge or deploy.
