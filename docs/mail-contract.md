# MAIL integration contract

`MAIL` is the planned messaging boundary, not an assumed installed product or verified API. Discovery must confirm service owner, endpoints, auth, quotas, webhooks, processing terms and deletion capability. Implement behind a provider-neutral adapter until verified.

The Outbound and Inbound sections describe the target adapter contract. The verified-interface table and ADR-004 review below define the supported subset and take precedence for implementation; provider IDs, callbacks and retry idempotency must not be assumed.

## Outbound

`SendMessage` carries `operation_id`, `organization_id`, `brand_id`, `application_id`, purpose, template ID/version, recipient, reply identity, locale, approved variables, requesting actor, consent/basis reference and correlation ID. Store minimal metadata and body hash in Hiring. Render approved brand templates, escape variables, and prevent recipient enumeration or cross-brand identity leakage. MAIL returns provider message ID, acceptance time and status. `operation_id` is idempotent across retries. No offer/rejection email without an authorized committed decision; transactional consent never authorizes marketing.

## Inbound

Events carry message/operation/event IDs, event type (`accepted`, `sent`, `delivered`, `bounced`, `complained`, `failed`, `replied`), occurrence time and signature. Verify signature and timestamp, deduplicate event ID and map to the original tenant/brand before recording history. Replies need verified sender and safe correlation; ambiguous replies go to manual triage. Quarantine/scan inbound attachments. Replies never directly change disposition.

## Reliability and privacy

Outbox owns retry/backoff; MAIL outages leave business state committed with visible pending/failed delivery. Terminal failures allow operator retry or alternate contact. Reconcile timeouts by idempotency key; respect provider quota. Send only rendering fields. The owner confirms processor terms, suppression and deletion propagation; no external legal-review gate applies. Hiring message bodies are retained indefinitely unless explicitly deleted. Never log body, recipient address, candidate token or secret. Test invalid signatures, duplicates, out-of-order callbacks, bounce, ambiguous reply, quota and timeout.

Adapter-selection issue must document actual API/SDK, credential storage, verification, guarantees, idempotency, rates and deletion. Missing guarantees need compensating controls or a launch hold. Platform `app.email` offers transactional send with a documented 100/day limit but is not automatically the full MAIL contract.

## Verified platform interface (#8)

Verified against `proappstore-online/platform@4ad0753` (`packages/sdk/src/email.ts`, `packages/backend/src/routes/email.ts`, `packages/backend/src/lib/email.ts`, `routes/notifications.ts`, migrations `0012`, `0057`) and a live probe on 2026-10-20.

| Property | Verified behaviour |
|---|---|
| Provider | Resend HTTPS API (`POST https://api.resend.com/emails`), called by the PAS backend worker. No SDK, no other provider. |
| App interface | `app.email.send(to, subject, body, { replyTo })` → `POST https://api.proappstore.online/v1/email/send` with the caller's session. Returns `{ ok: true }` only. |
| Credentials | Platform-owned Worker secrets `RESEND_API_KEY` and `EMAIL_FROM` on the PAS backend; the app never holds a key. Default sender `ProAppStore <noreply@proappstore.online>`, platform-wide. Per-brand from-identity is not possible; only `replyTo` is app-controlled. |
| Live status | **Not configured at the 2026-10-20 probe.** An unauthenticated probe returned `503` (the secret check runs before auth), indicating production then had no `RESEND_API_KEY`. No Resend entry was recorded in the inspected secrets inventory. |
| Who may send | Signed-in app owner, platform admin, or a user holding the `editor` app role (`app_roles`). Hiring memberships do not grant this, and MCP actions (SQL-only) cannot send. |
| Limits | 100 sends/day per app (rolling 24 h, reserved atomically before send and released if Resend fails); subject ≤ 200 chars, body ≤ 50 KB, one recipient. Notify-user email shares the 100/day budget. Errors: 400/401/403/404/429/503. |
| Body handling | The same string goes to Resend as both `html` and `text`, unescaped and unmoderated. Hiring must render and escape it. |
| Message ID / status | Not returned. No delivery status, no Resend message ID. |
| Idempotency | None. No `Idempotency-Key` is forwarded to Resend; a retry after a timeout can double-send. |
| Callbacks / inbound | None. No Resend webhook receiver, no bounce/complaint/delivered events, no inbound reply handling. |
| Suppression / unsubscribe | Only for notify-user email to platform members (`notification_email_optout`, RFC 8058 one-click). This does not apply to `app.email.send`, including mail to an approved self-registered worker. |
| Retention / deletion | Platform stores only `email_usage(app_id, user_id, sent_at)`: no recipient, subject or body. There is no API to delete a sent message at Resend; Resend-side retention follows the platform's Resend account. |

**Owner:** The ProAppStore platform (`proappstore-online/platform`, backend worker) owns the provider, the account, the secrets and the sending domain. Serge (`serge-ivo`) is the platform owner and the only person who can configure it. Hiring owns the adapter, the outbox, templates and the compensating controls below.

### Gap analysis and compensating controls

| Contract requirement | Gap | Control / decision |
|---|---|---|
| Configured provider | `503` in prod | **Launch hold on sending.** The outbox stays draft-only (current `create_communication_draft`, "no send capability") until Serge provisions the secrets. |
| `operation_id` idempotency | No provider idempotency | The outbox row is the idempotency record. Mark it `sending` before the call and `sent` after `{ok:true}`. A row in `sending` with an unknown result is **never auto-retried**: it becomes `unknown` and needs operator confirmation. Accept at-most-once with manual reconcile. |
| Provider message ID, status | Not returned | Record `accepted` only (the platform accepted it). Never show "delivered". |
| Delivery/bounce/complaint/reply callbacks | None | No inbound section is implementable. Replies go to `replyTo` (a brand-owned mailbox) and are triaged manually outside Hiring. Bounces are surfaced only by the recruiter, who marks the contact undeliverable. |
| Brand from-identity | Single platform sender | Use `replyTo` = verified brand address; the subject/body carry the brand name. Record this as a known limitation in brand terms. |
| Escaping / content safety | Raw `html` | The Hiring adapter renders approved templates and HTML-escapes every variable. Free-text bodies are escaped and converted to paragraphs. |
| Sender authorization | Requires platform `editor` | A sending recruiter needs both a Hiring membership and the platform `editor` app role. Keep the Hiring permission check as the primary gate, because the platform role is coarser. |
| Suppression | None for candidates | Keep a Hiring-side suppression list (candidate opted out, or undeliverable) checked before send. Do not rely on the platform. |
| Quota | 100/day shared | Show remaining-quota errors (`429`) as visible `failed` with retry next day. No bulk send. |
| Deletion propagation | No provider delete | Privacy notice states that sent mail is held by the processor (Resend) under the platform's terms. Hiring deletes its own outbox rows and body copies on erasure. The owner confirms processor terms without an external legal-review gate (see `privacy-governance.md`). |

### Needs Serge

1. Create/confirm the Resend account and a verified sending domain for `proappstore.online`. Store `RESEND_API_KEY` (and `EMAIL_FROM` if it is not the default) via `ops put` and set them on the PAS backend worker.
2. Decide whether the platform will add Resend `Idempotency-Key` forwarding, return the Resend message ID, and add a signed Resend webhook. These are platform changes. Hiring launches without them under the controls above.
3. Confirm the Resend DPA/retention terms for candidate mail.

## ADR-004 review (#53, 2026-10-21)

**Revised; owner: Serge.** The [#8 discovery](https://github.com/proappstore-online/hiring/issues/8#issuecomment-6286791370) is evidence for the PAS/Resend interface above, not a claim that the full outbound/inbound target contract is supported. Unknown send outcomes require manual reconciliation; automatic retry cannot safely guarantee deduplication. Sending remains unavailable until provider setup and adapter controls are verified.

The newer [FAS mail epic #58](https://github.com/proappstore-online/hiring/issues/58) selects a dedicated Cloudflare/PAGS bridge for the approved FAS identity. Its tools exist, but the recorded live check found no configured bridge and no successful mail roundtrip. Secure connection management (PAGS #1277), recipient isolation and bounded incremental reads (#1278), sender approval and a controlled roundtrip remain prerequisites. See [operations runbook](hiring-agent-operations.md). Do not substitute PAS email or unrelated Gmail credentials for that route. Existing communication-event recording proves storage/audit, not delivery.

The approved multi-tenant model requires every message to map to its organization, brand and application; worker self-registration grants no cross-tenant mailbox access. #25/#26/#27/#47 retain their broader adapter, callback, template and receipt work. Indefinite Hiring retention and explicit deletion follow [#9](https://github.com/proappstore-online/hiring/issues/9); provider retention/deletion limitations need owner confirmation, not lawyer sign-off.

## Issue #13 implementation

[Audit and transactional outbox](audit-outbox.md) defines the implemented lifecycle
and safe single-attempt adapter helper. This supersedes the earlier draft-only
outbox description. Sending/provider enablement remains separate. No automatic
retry, including failed jobs, is enabled; unknown or interrupted attempts require
reconciliation. `sent` in storage means provider acceptance only.

## Erasure status (#31)

The [scoped erasure workflow](erasure.md) records MAIL propagation as blocked with
`no_verified_deletion_route`. It does not call a provider API or infer that a
processor has no copies. The earlier requirement to delete local outbox/body copies
remains pending where immutable triggers protect those records. This implementation
never records those copies as deleted or treats a missing provider API as successful
propagation. Provider scope, retention and deletion evidence remain owner work.

## Human recovery (#4)

The [human recovery action](audit-outbox.md#human-mail-recovery-4-migration-0029)
adds scoped, passkey-gated reconciliation and a single evidence-backed unsent
replacement for definite non-acceptance. Provider acceptance and original attempts
remain preserved. This is local recovery functionality, not provider provisioning
or evidence that the remaining #25/#26/#58 live integration gates have passed.

## MAIL adapter and dispatcher (#25)

`scripts/mail.mjs` exports `createMailAdapter({ authorize, transport })`, consumed as
`send` by `dispatchCommunication` in `scripts/outbox.mjs`. These are trusted
server-side integration dependencies, never browser-supplied callbacks. Bind
`actions` to the current authenticated actor. Bind `transport` exclusively to the
approved connector; this change installs no scheduled sender and provisions no
provider credentials. Do not substitute PAS email for the FAS route.

Before each external attempt, `authorize` must read current template approval,
suppression, sender verification and provider enablement for the exact scoped
claimed draft. It returns `approved: true`, `suppressed: false`, organization,
brand, application and draft IDs, stable `operation_id`, template ID and positive
integer version, exact rendered `recipient_email`, `subject`, `body`, and verified
`reply_to`. Missing approval or changed payload fails closed. This interface is a
trusted approval resolver, not an assertion accepted from an agent or browser.
Existing editable templates alone are not approval evidence.

The transport receives only scoped operation/template references, one recipient,
reply identity, subject and escaped HTML. Subject is at most 200 characters; escaped
HTML is bounded to 50,000 UTF-8 bytes. It must return `{ outcome: 'accepted' }`
only on definitive acceptance, or `{ outcome: 'not_accepted', reason }` only on
proven non-acceptance (`quota`, `unavailable`, `forbidden`, or generic rejection).
Thrown errors, malformed responses and timeouts are unknown. No automatic retries
are installed: use existing evidence-backed reconciliation and replacement drafts.
A stable operation ID is forwarded but provider idempotency is never assumed.

Migration 0034 adds a bounded `delivery_reason`, committed atomically with
completion and audit, exposed by scoped draft reads. Reasons contain no recipient,
payload or raw provider error. Quota means check the connector's quota/reset and
then reconcile before creating a replacement; unavailable means check approved
connector setup; forbidden means review connector access. Approval failures require
current approval/suppression/sender review. Unknown means investigate provider
acceptance before any resend. ATS business state stays committed on mail failure.

Local tests verify the adapter and SQL dispatcher; they do not establish live
connector configuration, approved sender readiness or a successful roundtrip.
Those existing #58 deployment gates remain in force.
