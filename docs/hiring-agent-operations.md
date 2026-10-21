# Hiring agent operations runbook

Live-state observations below were verified through a fresh PAGS MCP connection on **2026-10-21**.
Implementation notes additionally reflect frozen PAGS source `fcee1d877cbf375691c3fb1f1ac07fb3222c77d1`;
its deployment and live behavior have **not** yet been verified. Source/test completion is not a live mail roundtrip.
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
| Gmail forwarding | Authorize the receiving mailbox `serge.the.dev@gmail.com`, then pin this instance | Requires an already verified Gmail send-as alias for `admin@freeappstore.online`; forwarding alone is insufficient | PAGS #1279 implements an account-bound recipient/sender policy, provider-side search, direct-ID checks, metadata pages and bounded body windows; live verification pending |
| Cloudflare bridge | A dedicated PAGS `email-worker/v1` bridge receives routed mail | Requires domain sending onboarding, bridge identity and owner approval | PAGS #1278 plus the frozen hardening implement exact mailbox scope, resumable paging, run budgets and explicit archive checkpoints; #1277 supplies secret-safe MCP management; deployment/live verification pending |

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
- Nineteen remote tools are granted: the original thirteen below plus
  `record_candidate_email`, `record_agent_activity`, `list_application_communications`
  and `list_application_agent_activity`, and now `record_worker_candidate_email` and
  `get_worker_candidate_email`. All six additions are deployed and discoverable;
  the worker archive actions shipped in PAS Hiring commit `157cc67`.
- Template capabilities now include `email_worker_list_messages`,
  `email_worker_read_message`, `email_worker_send`, `email_worker_reply`,
  `email_worker_identities` and `email_worker_list_events`; all are invocable.
  The newly implemented `email_worker_mark_handled` is **not** included in this verified
  live capability list; discover and grant it after the hardened PAGS deployment is verified.
- Live identity and inbox checks (`limit: 1`) both returned
  **No worker-backed email connection is configured.** No email roundtrip has passed.
- The new MCP management tool `get_instance_email_worker` is deployed. Its live readback
  confirms `state: absent`, `no_connection`, `readyToRead: false`, `readyToSend: false`
  and write consent `off`; deployed tools do not imply a configured bridge.
- Gmail write consent is `off`. The instance's `gmail_search`, `gmail_read_message`,
  `gmail_reply` and `gmail_send` tools are disabled. The stale
  `serge.pro.job@gmail.com` account pin is unrelated to Hiring.
- Eight imported applications returned by the check have no candidate email addresses.
  Do not infer contact addresses from LinkedIn applicant alerts.
- Special Instructions and memory key `fas_hiring_mail_setup` record the setup,
  account identifiers, scope, limits and current blockers. Their final hardening update
  remains pending deployment verification; this document is not evidence that the live instructions changed.

The original thirteen PAS grants are:

| Access | Tools |
| --- | --- |
| Read | `list_my_workspaces`, `list_applications`, `list_requisitions`, `list_application_notes`, `list_application_audit`, `list_stage_events`, `list_assignment_events`, `list_communication_drafts`, `list_workspace_members` |
| Write | `add_application_note`, `change_application_stage`, `create_communication_draft`, `reassign_application` |

## Remaining work

1. [PAGS #1277](https://github.com/ProAgentStore/platform/issues/1277) has deployed secret-safe
   MCP inspection, enrollment, connection testing, pinning and sender/reply-identity tools.
   [PAGS #1280](https://github.com/ProAgentStore/platform/issues/1280) hardens malformed bridge
   identities, credential echoes and fail-closed sender-policy loading in source; verify the
   final hardened deployment before enrollment. Credentials go through the returned owner secure-input page, never
   private APIs, a shell proxy, tool arguments or chat.
2. [PAGS #1278](https://github.com/ProAgentStore/platform/issues/1278) and the final hardening
   are implemented in the frozen source: exact recipient checks for list/direct read/reply,
   stable per-mailbox index cursors beyond 200 messages, bounded content and per-run counters.
   Cloudflare identity probes require a nonempty, valid `mailboxes` array; missing/empty legacy
   scope blocks access with a repair instruction, and malformed stored scope fails closed.
   Generic v1 worker behavior is unchanged. The earlier first-200/cursor/raw-read limitations
   describe the old bridge, not the current source. Verify the deployed bridge and connector
   together, including foreign-recipient controls, paging and archive-after-success checkpoints.
3. [PAGS #1279](https://github.com/ProAgentStore/platform/issues/1279): verify deployment
   and live Gmail exact-account OAuth handoff, recipient/sender enforcement and
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
per run, at most 4,000 body characters each. These are the tighter operating limits, not
the connector's maximums. The frozen CF connector defaults to ten summaries, caps each list
at 25 and each list's bridge scan at eight pages, and enforces per-run ceilings of 60 summaries,
six body reads and 60,000 delivered body characters. A body window defaults to 6,000 and caps
at 20,000 characters; the agent must explicitly request its lower 4,000-character limit.
The bridge bounds raw inbound ingestion at 262,144 bytes and retained body text at 50,000
characters. Truncation/continuation is explicit; unavailable source content must not be described
as fully archived. Follow returned `nextCursor`/`nextOffset` only within the operating budget;
continuations consume the same run budget, not permission for an unbounded loop. A scan reports
skipped handled mail, remaining mail and limit/budget stops. Stop with an actionable blocker
if the deployed scope or limits cannot be verified.

After an actual candidate email read/send, immediately record it in the
matching organization, brand and application with the actual subject/body, direction,
addresses, provider message/thread IDs, occurrence time and instance ID. Verify provider
compatibility; never fabricate Gmail IDs for Cloudflare mail. A preview is not a full
archived message. Unmatched correspondence goes to human triage.

Use `record_candidate_email` for Gmail. For the Cloudflare bridge, use
`record_worker_candidate_email`: `mailbox_address` must equal inbound `to_email` or
outbound `from_email`, while the other address must match the stored candidate. Preserve
the bridge's opaque `provider_message_id` and `provider_thread_id`; record an actual
Cloudflare acceptance receipt as `provider_receipt_id` and an actual inbound event ID as
`provider_event_id` when supplied. Use the stable non-secret bridge/connection identifier
as `provider_connection_id` when known; never include a credential or capability URL.
Reuse the original `operation_id` on a retry. Zero inserted rows does not prove a new
record: use `get_worker_candidate_email` with that exact operation/application and compare
its provider, mailbox, IDs and content. A different existing payload is a conflict; stop.
These are archival records reported by the caller, not a provider delivery verification.

For CF mail, the processing order is strictly **archive → exact readback → explicit checkpoint**:

1. Successfully read the in-scope provider message in this instance; archive the actual
   correspondence using `record_worker_candidate_email` with stable `operation_id`.
2. Call `get_worker_candidate_email` for that exact operation, organization, brand and
   application. Compare direction, subject/body, addresses, mailbox, provider/connection,
   message/thread IDs and supplied acceptance/event IDs against the intended archive.
   An empty result, incomplete content, mismatched existing record or failed readback is not success.
3. Only after that exact match, invoke PAGS `email_worker_mark_handled` with
   `message_id` and `archive_reference` equal to the verified nonsecret archive `operation_id`.
   The reference accepts 1–128 letters, digits, `.`, `_`, `:` or `-`, starting with a letter
   or digit; never use a credential, URL, body or subject. Inspect its `handled: true`
   result and matching reference before assuming the checkpoint advanced.

Reading or replying alone no longer marks mail handled. Failed PAS archive/readback leaves it
visible for the next scan. The checkpoint requires prior successful scoped read evidence for
this instance and pinned connection, is idempotent for the same reference and refuses a
different reference without overwriting the first. It records the caller's confirmed archive,
not independent PAS/provider verification. It mutates only PAGS state (`scope: read`,
`mutates: true`, `reach: platform`), requires its own capability but no outbound-send consent,
and never contacts/modifies the mailbox. Legacy automatic read/reply marks remain as history
but do not hide mail until explicitly upgraded with an archive reference. This behavior is
implemented, **not yet live-verified**; never emulate it with an early local checkpoint.

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

Before any outbound test, obtain the owner's confirmation of the exact owner-controlled
recipient and labeled subject (and intended test message). Broad setup-test authorization on
2026-10-21 is recorded, but that exact recipient/subject confirmation is still pending;
it is not an approval for an arbitrarily chosen send or candidate outreach.

For each path, after connection and that exact approval, send the labeled test; independently
verify receipt, agent read, reply From/thread identity and retries/deduplication. Record
actual correspondence on a verified test contact/application and read it back before advancing
the CF checkpoint. Do not use candidates as test recipients or claim
delivery from an accepted-send receipt alone.

Also send an unrelated-mail negative control to the same receiving Gmail mailbox without
the FAS recipient. Verify it is excluded by search and refused by direct message-ID read,
attachment and reply. Repeating a scan must skip processed provider IDs. Gmail sends are
not currently provider-idempotent: after a timeout inspect Sent/thread evidence before any
retry; never automatically resend an uncertain send. Keep the epic open until both paths'
actual receipts and limitations are recorded and the owner chooses the operating path.

