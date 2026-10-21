# Hiring agent operations runbook

This runbook records the live ProAgentStore (PAGS) configuration for the Hiring communications agent. It is an operations record, not a substitute for the [Hiring MCP contract](hiring-mcp-contract.md), which remains the application security and mutation contract.

## Purpose and boundaries

- **Hiring** is the applicant-record system at `https://hiring.proappstore.online`.
- **PAGS** hosts the communications agent. Its role is to read the Hiring records it is granted, prepare candidate correspondence, and make the permitted Hiring updates.
- The agent reaches Hiring through the PAS MCP endpoint: `https://mcp.proappstore.online/mcp/apps/hiring`.
- Candidate email is selected per Hiring organization. For the current **FreeAppStore** organization, it must use **`admin@freeappstore.online`**. Do not connect or select a personal mailbox, a developer mailbox, or `serge.pro.job@gmail.com` for the FreeAppStore workflow.
- PAGS Gmail access is separate from the Hiring MCP connection. A connected Hiring MCP endpoint does not give the agent Gmail access, and Gmail access does not give it access to Hiring records.

## Canonical agent

| Item | Value |
| --- | --- |
| PAGS instance | `PAS Hiring Comms 2` |
| Instance ID | `4c295181-8886-46a2-9272-f4abb159a595` |
| Template | `pas-hiring-comms` (`e33510a5-de6b-4df8-be3b-feaca597b411`) |
| Hiring MCP endpoint | `https://mcp.proappstore.online/mcp/apps/hiring` |
| FreeAppStore candidate mailbox | `admin@freeappstore.online` |

There should be one active communications instance for Hiring: the instance above. Do not create a second agent to work around a missing connection or permission; repair the connection on this instance instead. All applicants added so far belong to the FreeAppStore organization.

## Current verified state — 2026-10-21

### Hiring MCP

The Hiring MCP OAuth connection is active. The agent has a deliberately limited allowlist of 13 remote tools:

| Access | Granted tools |
| --- | --- |
| Read | `list_my_workspaces`, `list_applications`, `list_requisitions`, `list_application_notes`, `list_application_audit`, `list_stage_events`, `list_assignment_events`, `list_communication_drafts`, `list_workspace_members` |
| Write | `add_application_note`, `change_application_stage`, `create_communication_draft`, `reassign_application` |

The connector test reported **13 of 24** Hiring tools callable. The other 11 remain ungranted by design, including workspace/member administration, requisition creation, and LinkedIn application creation. The agent template includes `mcp_list_tools` and `mcp_call_tool` in addition to its Gmail capabilities.

## Communication and agent-activity audit trail

The repository now defines an append-only application timeline for agent activity and Gmail correspondence. It is pending deployment before it can be granted to PAGS:

- `record_candidate_email` stores the complete subject and body, direction, Gmail message/thread IDs, sender/recipient, occurrence time, authenticated actor and PAGS instance ID for each received or sent candidate email. It does not send email.
- `record_agent_activity` stores a candidate-profile crawl, candidate-search crawl or Gmail-thread scan with source URL, summary, occurrence time, authenticated actor and PAGS instance ID. It does not crawl or send.
- `list_application_communications` and `list_application_agent_activity` make those immutable records visible in the application detail alongside existing drafts and the generic audit trail.

After deployment, grant those four tools to `PAS Hiring Comms 2` and instruct it to record a crawl immediately after it occurs and record every candidate Gmail message immediately after it is read or sent. It must supply the matching organization, brand and application; an email record is accepted only when the candidate's recorded email matches the sender of an inbound email or recipient of an outbound email. Do not grant a send action in Hiring: Gmail remains the actual sending boundary.

### Gmail

Gmail is **not ready for candidate communication yet**:

- `admin@freeappstore.online` has not been connected to PAGS for the FreeAppStore organization.
- Agent email access is disabled, so the agent cannot currently read or send email.
- A stale pin to `serge.pro.job@gmail.com` was identified. That mailbox is wrong for Hiring and must be cleared or replaced with `admin@freeappstore.online` before enabling email access.

No candidate email should be read, drafted externally, replied to, or sent until the required mailbox is connected and selected.

## Required configuration

All PAGS account and agent changes are performed through the PAGS console or its deployed MCP connection. Never place OAuth tokens, cookies, passwords, or mailbox credentials in this repository.

### 1. Connect the correct Gmail account

1. In PAGS, open **Preferences → Connections → Gmail**.
2. Choose **Add or reconnect** and complete Google authorization as `admin@freeappstore.online`.
3. Confirm that PAGS lists that exact address as send-capable.

The owner must complete the Google sign-in and consent screen. Do not use an account merely because it is already listed in PAGS.

### 2. Bind and enable it for the Hiring agent

1. Open **Instances → PAS Hiring Comms 2 → Permissions**.
2. In the Gmail account selector, choose `admin@freeappstore.online` for FreeAppStore. This replaces the incorrect `serge.pro.job@gmail.com` selection; if the correct account is not available, leave email disabled rather than selecting another mailbox.
3. Enable **Allow this agent to reach my Gmail**.
4. Set the Gmail send approval policy deliberately. Use **Ask each time** unless the owner has expressly approved autonomous candidate sends. If autonomous sends are authorized, record that decision and its scope in the relevant operating issue.

Enabling email is a separate permission from granting the Gmail tools on the template. Both are required.

### 3. Keep the Hiring MCP grants narrow

In **Permissions → MCP Connections**, verify the endpoint is connected and that the 13-tool allowlist above is still the complete set. In particular, do not add general administrative tools, broad export/search, or LinkedIn import/write tools merely to resolve a routine candidate workflow. For another organization, confirm the selected organization and its approved mailbox before the agent accesses applicant records or Gmail.

## Verification after configuration

Run these checks in order. They are designed to verify connectivity without changing a production candidate record.

1. In PAGS, run the Hiring MCP connection test. It must show the endpoint as connected and the intended 13 tools callable.
2. Make a read-only Hiring call such as `list_my_workspaces`, then a tightly scoped `list_applications` call. Confirm results are from the expected Hiring workspace.
3. For FreeAppStore, check the instance Gmail account label is exactly `admin@freeappstore.online` and email access is enabled.
4. Use a harmless Gmail search with no expected results to confirm the mailbox identity. Do not use a candidate address as a probe.
5. Only with a known test record and explicit instruction, create an internal `create_communication_draft`. Do not use a live candidate record as a test mutation.

Before relying on the agent for a live send, review the generated message and confirm the recipient, application, and requested action. A send should not itself advance a candidate, reject a candidate, issue an offer, or alter a requisition.

## Normal operating flow

1. Read the specific Hiring application and its notes/history.
2. Create or review the internal communication draft in Hiring.
3. Prepare the corresponding Gmail message using the mailbox approved for that organization (`admin@freeappstore.online` for FreeAppStore) and the chosen approval policy.
4. Record the relevant internal note. Change stage or assignment only when the request explicitly calls for it and the application version is current.

The existing [MAIL contract](mail-contract.md) describes the app's separate, provider-neutral messaging architecture. It does not configure PAGS Gmail and must not be treated as evidence that the app's native mail delivery is live.

## Recovery and safety

- If PAGS shows **Authentication required** for Hiring, reconnect the Hiring MCP endpoint from the instance Permissions page and complete its PAS authorization. Re-test before granting additional tools.
- If the wrong Gmail address is selected, replace it with `admin@freeappstore.online` or disable agent email. Do not send from the wrong mailbox.
- To suspend all outbound email immediately, turn off **Allow this agent to reach my Gmail** in the instance Permissions page. To suspend Hiring access, remove the MCP tool grants or disconnect the endpoint.
- Never log email bodies, candidate addresses, OAuth URLs containing credentials, access tokens, or cookies in this repository or in an agent note.

