# MAIL integration contract

`MAIL` is the planned messaging boundary, not an assumed installed product or verified API. Discovery must confirm service owner, endpoints, auth, quotas, webhooks, processing terms and deletion capability. Implement behind a provider-neutral adapter until verified.

## Outbound

`SendMessage` carries `operation_id`, `organization_id`, `brand_id`, `application_id`, purpose, template ID/version, recipient, reply identity, locale, approved variables, requesting actor, consent/basis reference and correlation ID. Store minimal metadata and body hash in Hiring. Render approved brand templates, escape variables, and prevent recipient enumeration or cross-brand identity leakage. MAIL returns provider message ID, acceptance time and status. `operation_id` is idempotent across retries. No offer/rejection email without an authorized committed decision; transactional consent never authorizes marketing.

## Inbound

Events carry message/operation/event IDs, event type (`accepted`, `sent`, `delivered`, `bounced`, `complained`, `failed`, `replied`), occurrence time and signature. Verify signature and timestamp, deduplicate event ID and map to the original tenant/brand before recording history. Replies need verified sender and safe correlation; ambiguous replies go to manual triage. Quarantine/scan inbound attachments. Replies never directly change disposition.

## Reliability and privacy

Outbox owns retry/backoff; MAIL outages leave business state committed with visible pending/failed delivery. Terminal failures allow operator retry or alternate contact. Reconcile timeouts by idempotency key; respect provider quota. Send only rendering fields. Agree body retention, suppression, deletion propagation and processor terms with legal review. Never log body, recipient address, candidate token or secret. Test invalid signatures, duplicates, out-of-order callbacks, bounce, ambiguous reply, quota and timeout.

Adapter-selection issue must document actual API/SDK, credential storage, verification, guarantees, idempotency, rates and deletion. Missing guarantees need compensating controls or a launch hold. Platform `app.email` offers transactional send with a documented 100/day limit but is not automatically the full MAIL contract.
