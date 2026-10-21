# Hiring agent operations runbook

Verified through a fresh PAGS MCP connection on **2026-10-21**.
Tracking: [FAS email epic #58](https://github.com/proappstore-online/hiring/issues/58).
The [Hiring MCP contract](hiring-mcp-contract.md) remains the application authorization contract.

## Objective

The PAGS Hiring agent handles candidate mail addressed to `admin@freeappstore.online`,
replies from that approved identity, and records correspondence in the matching Hiring
application. Filter unrelated mail before it reaches the model and skip processed messages
on later runs. Operational access uses PAGS and PAS MCP. The owner permits Himalaya only
as an independent test check; it is not the agent's integration.

## Canonical instance and account

| Item | Verified value |
| --- | --- |
| PAGS account | Google `serge.the.dev@gmail.com` |
| Account ID | `google:110736373305646082562` |
| Instance | `PAS Hiring Comms 2` |
| Instance ID | `4c295181-8886-46a2-9272-f4abb159a595` |
| Template | `pas-hiring-comms` (`e33510a5-de6b-4df8-be3b-feaca597b411`) |
| PAS Hiring MCP | `https://mcp.proappstore.online/mcp/apps/hiring` |
| FreeAppStore organization | `4750d98c-fa61-49f3-bc99-5bdc1824d94a` |
| FreeAppStore brand | `1e98240d-0745-4c73-8553-7f8b3684de6e` |
| Mail identity | `admin@freeappstore.online` |

Reuse this instance. Check `whoami` and `my_instances` on the actual MCP session:
a running client can retain an old identity after a separate CLI login. During this check,
the old client reported a GitHub account with no instances; a fresh MCP connection found
the Google account and the existing Hiring instance.

## Routing and sending

The `serge-ivo/email-infra` registry declares Cloudflare Email Routing for
`admin@freeappstore.online`, forwarding to `serge.the.dev@gmail.com`. Its recorded
routing verification is dated 2026-10-17. This is a routed alias, **not a Google mailbox**
to authorize with Gmail OAuth. The earlier instruction to sign into Google as that alias
was incorrect.

Compare two supported paths; a bridge is not inherently required to receive forwarded mail.

| Path | Receive | Send as FAS | Isolation and cost controls |
| --- | --- | --- | --- |
| Gmail forwarding | Authorize the receiving mailbox `serge.the.dev@gmail.com`, then pin this instance | Requires an already verified Gmail send-as alias for `admin@freeappstore.online`; forwarding alone is insufficient | PAGS #1279 adds an account-bound recipient/sender policy, provider-side search, direct-ID checks, metadata pages and bounded body windows |
| Cloudflare bridge | A dedicated PAGS `email-worker/v1` bridge receives routed mail | Requires domain sending onboarding, bridge identity and owner approval | PAGS #1278 must enforce recipient isolation, paging and bounded reads; #1277 supplies secret-safe MCP connection management |

Do not present code or unit tests as a live connection or delivery result. Gmail must not
be enabled until the correct account is connected, the sender is verified and its scoped
policy is read back. The old unrelated pin must never be used as a fallback.

[PAGS #1269](https://github.com/ProAgentStore/platform/issues/1269) and
[#1270](https://github.com/ProAgentStore/platform/issues/1270) delivered connector foundations.
A receive route does not authorize sending: the domain needs sending onboarding, the
bridge must report the sender, and the owner must approve it and select the reply identity.
The registry does not currently list `admin@freeappstore.online` as an outbound sender;
do not infer send capability.

Preserve desired Gmail forwarding when provisioning the bridge. Historical forwarded mail
requires a separately explicit backfill with provider-side original-recipient filtering.
Never silently fall back to another Gmail account.

## Verified live state

- PAS Hiring MCP is connected. Workspace and application reads succeeded for FreeAppStore.
- Seventeen remote tools are granted: the original thirteen below plus
  `record_candidate_email`, `record_agent_activity`, `list_application_communications`
  and `list_application_agent_activity`. The four additions are deployed and discoverable.
- Template capabilities now include `email_worker_list_messages`,
  `email_worker_read_message`, `email_worker_send`, `email_worker_reply`,
  `email_worker_identities` and `email_worker_list_events`; all are invocable.
- Live identity and inbox checks (`limit: 1`) both returned
  **No worker-backed email connection is configured.** No email roundtrip has passed.
- Gmail write consent is `off`. The instance's `gmail_search`, `gmail_read_message`,
  `gmail_reply` and `gmail_send` tools are disabled. The stale
  `serge.pro.job@gmail.com` account pin is unrelated to Hiring.
- Eight imported applications returned by the check have no candidate email addresses.
  Do not infer contact addresses from LinkedIn applicant alerts.
- Special Instructions and memory key `fas_hiring_mail_setup` record the setup,
  account identifiers, scope, limits and current blockers.

The original thirteen PAS grants are:

| Access | Tools |
| --- | --- |
| Read | `list_my_workspaces`, `list_applications`, `list_requisitions`, `list_application_notes`, `list_application_audit`, `list_stage_events`, `list_assignment_events`, `list_communication_drafts`, `list_workspace_members` |
| Write | `add_application_note`, `change_application_stage`, `create_communication_draft`, `reassign_application` |

## Remaining work

1. [PAGS #1277](https://github.com/ProAgentStore/platform/issues/1277): secret-safe MCP
   inspection, secure connection enrollment, testing, pinning and sender/reply-identity
   configuration. Fresh discovery exposed no worker-email management commands. Do not
   bypass the missing MCP surface with private APIs or a generic HTTP/shell proxy.
2. [PAGS #1278](https://github.com/ProAgentStore/platform/issues/1278): enforced recipient
   isolation and bounded incremental reads. The bridge inspected after #1270 shares
   storage across routes, ignores list cursors, considers only the first 200 keys and
   returns `nextCursor: null`; reads can return up to 200,000 raw MIME characters.
   Prompt instructions do not fix those implementation gaps.
3. [PAGS #1279](https://github.com/ProAgentStore/platform/issues/1279): finish deploying
   and verifying Gmail exact-account OAuth handoff, recipient/sender enforcement and
   bounded reads. Use `start_gmail_connection` for `serge.the.dev@gmail.com`; the owner
   independently signs into the same PAGS account and approves Google. Inspect identities,
   pin that mailbox and set/read back recipient and sender `admin@freeappstore.online`.
   Enable only the required tools and instance email permission, keeping write consent
   off until the labeled send test is ready. Alias verification may require owner setup
   in Gmail; never substitute another From address to make a test pass.
4. Provision and securely connect the bridge for the comparison, approve the sender/reply
   identity, pin this instance and verify routing/health. Credentials belong in approved
   secret storage, never instructions, memory, tickets or this repository. Preserve the
   existing forwarding route and test one outbound path at a time.

Until prerequisites pass, leave sending unavailable. Do not expand administrative Hiring
grants merely to repair an email connection.

## Read budget and application audit

Instance rules require metadata first, at most ten summaries and three relevant body reads
per run, at most 4,000 body characters each. Continuation pages count toward the same run
budget, not as permission for an unbounded loop. Persist provider IDs/checkpoints only after
successful Hiring recording. Scope, pagination and output limits must be enforced and
tested by the connector; stop with an actionable blocker if unavailable.

After an actual candidate email read/send, immediately `record_candidate_email` in the
matching organization, brand and application with the actual subject/body, direction,
addresses, provider message/thread IDs, occurrence time and instance ID. Verify provider
compatibility; never fabricate Gmail IDs for Cloudflare mail. A preview is not a full
archived message. Unmatched correspondence goes to human triage.

After a real profile/search crawl or thread scan, `record_agent_activity` with the supported
activity type, HTTPS source URL and factual summary/time. Read history when relevant.
Never change stage, assignment, reject or offer without explicit human direction.
Sending follows connector consent and approval; setup-test authorization is not blanket
candidate-outreach authorization.

## Verification receipt and next test

Operational note `194e66e9-05b3-46ef-9859-fd274a48de81` was written through this agent's PAS
MCP connection and read back on application `8729c34d-cab9-4f5d-bafc-6c96e749dc05`.
It explicitly labels itself an integration check, says no email was read/sent and makes
no candidate decision. This verifies app recording, not mail delivery.

For each path, after connection, send a labeled test to an owner-controlled address; independently
verify receipt, agent read, reply From/thread identity and retries/deduplication. Record
actual correspondence on a verified test contact/application and read it back. The owner
authorized setup test mail on 2026-10-21. Do not use candidates as test recipients or claim
delivery from an accepted-send receipt alone.

Also send an unrelated-mail negative control to the same receiving Gmail mailbox without
the FAS recipient. Verify it is excluded by search and refused by direct message-ID read,
attachment and reply. Repeating a scan must skip processed provider IDs. Gmail sends are
not currently provider-idempotent: after a timeout inspect Sent/thread evidence before any
retry; never automatically resend an uncertain send. Keep the epic open until both paths'
actual receipts and limitations are recorded and the owner chooses the operating path.

