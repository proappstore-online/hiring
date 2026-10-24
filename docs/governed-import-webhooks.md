# Governed import and outbound webhooks (#49)

Contract: `requisition-import-v1`. Repository security/schema assessment: 2026-10-25.
Accountable activation owner: Serge. This contract implements a bounded internal
JSON source and two import lifecycle events. Candidate imports, CSV/vendor mappings,
application/consent migration and candidate event families are excluded; they require
separate reviewed schemas and implementation issues. No production processor,
endpoint, installation or activation is approved by this repository change.

## Schema, mapping and authorization review

Input is `rows_json`, a JSON array of 1–100 objects, at most 50,000 characters.
Each object has exactly two string properties: `source_id` (1–128 characters) and
`title` (1–200 trimmed characters). Unknown fields, duplicate keys, repeated source
IDs, malformed JSON and incomplete records reject the entire commit. Organization,
brand and installation come from explicit action selection, never source rows.
The server requires a current full-brand owner grant and an exact-scope, unexpired,
unrevoked capability approval. Requisition-limited, recruiter and candidate grants
do not authorize import or subscriptions. Another capability's approval is invalid.

`source_reference` pins a non-personal source dataset revision; `basis_reference`
pins the reviewed public-job-data processing purpose. Both must match the trusted import approval and are required opaque
references, 1–200 characters, never raw source URLs or personal information.
Source titles must contain job data only, with no candidate information. There is
no consent mapping: no candidate, worker link or consent record is created and no
application, talent-pool or communications consent is inferred.

The registered actions are `dry_run_requisition_import`,
`commit_requisition_import`, `get_requisition_import` and
`rollback_requisition_import`. Dry run writes nothing and returns only row indexes
and fixed error codes, including `forbidden` for unauthorized scope. It never
queries another tenant's source data. Commit validates again in the same D1 batch
as all inserted drafts, provenance, audit and subscription fanout. Zero changes is
conflict/denial, not success; inspect the scoped batch after an uncertain response.

IDs are deterministic (`import-<batch_id>-<row index>`). Batch IDs are 1–100
characters, globally unique opaque operation IDs. Replaying a batch cannot create
another draft or event. Reusing a source revision in the same installation/brand
is denied, even with a new batch ID; updates require an explicitly new dataset
revision. Duplicate titles are allowed: titles are not identity keys. Existing
records are never merged or overwritten. Internal ID collisions abort the entire
transaction without exposing the collided record. No partial import is accepted.

Rollback is all-or-none and limited to the original importing owner with current
approval. It deletes only untouched, unpublished drafts without applications;
edited, published, missing or referenced drafts prevent rollback. Foreign keys
also abort rollback if another workflow references a draft. Provenance, original
row mapping and redacted audit remain; rollback emits a separate stable event.

## Trusted approval and processor review

`hiring_integration_approvals` is empty on deployment. There is deliberately no
browser/MCP approval-writing action. Trusted operations must provision evidence
only after the owner records the exact revision/environment, organization, brand,
installation, capability, contract, reviewers, expiry and processing purpose.
For outbound approval, also record the exact public HTTPS endpoint, processor
identity/jurisdiction, terms, subprocessors, secondary-use prohibition, retention,
erasure/correction obligations, incident contact, quotas and spend cap. Store
only an opaque `secret_ref` in D1; the signing secret stays in the installation's
server secret store. Editing the JSON governance register grants no SQL authority.
Review renewal is required when source, fields, endpoint or processor changes.
External legal sign-off is not required by owner policy.

Internal-only import has no new external supplier or spend. Fairness review:
imports create drafts for human review, never candidate rankings, dispositions or
automatic publication. Public job titles and counts still require owner review
for accuracy and inappropriate personal information. Production processor and
commercial review remain pending until an actual receiver is selected.

## Subscription and delivery contract

`subscribe_import_webhooks` selects a trusted outbound approval by ID and exact
scope; it does not accept a caller URL, secret or payload. Subscriptions bind an
installation, brand and owning user. `revoke_import_webhooks` stops future claims
and reads immediately. Current grants and approval scope/expiry/revocation are
checked on each claim, retry and immediately before egress.
`list_import_webhook_deliveries` exposes bounded state to current brand owners.
Subscription, revocation, claims and completion append redacted audit events;
source data, secrets, endpoints and provider errors never enter delivery audit.

Only `import.committed` and `import.rolled_back` are emitted. Wire JSON contains
`version`, stable opaque event `id`, `type`, and `row_count`; it contains no title,
source reference, candidate identifier, email, contact information or free text.
Fanout commits with the business transition, unique per subscription/batch/type.
The system-worker-only actions claim/read/finish delivery using an exclusive
claim ID. Completion with a stale claim cannot alter another attempt.

`worker/import-webhooks.mjs` is a server adapter, following the existing worker
helper pattern. It is not a deployed scheduler or a browser sender. Bind its RPC
to platform `system:worker`, secrets to the installation secret store, and transport
to approved public HTTPS egress with DNS/IP SSRF checks, no redirects, bounded
response size and a 10-second timeout. An ordinary unrestricted fetch adapter is
not approved. Worker enablement, secret provisioning, safe egress and a scheduled
queue consumer require live deployment evidence before activation.

Signatures are HMAC-SHA256 over `<timestamp>.<exact body>` using a secret of at
least 32 characters. Headers are `x-hiring-id`, `x-hiring-timestamp` (epoch ms),
and `x-hiring-signature` (hex digest). The supplied verifier rejects altered bodies
and timestamps outside five minutes. Receivers must persist unique event IDs and
return 2xx for an already processed event: delivery is at least once. They must
apply dedupe and their business effect atomically. Timestamp verification alone
does not prevent replay within the acceptance window.

Any 2xx acknowledges acceptance, not downstream processing. Non-2xx and timeouts
retry the same event with fresh signatures after 2, 4, 8, 16 minutes, with at most
five claims. The bounded worker queue tick discovers at most 25 due deliveries for its configured installation/brand. A lost claim is reclaimable after five minutes; old completion is
fenced by claim ID. Failed fifth completion is dead-lettered. A worker crash on
the fifth claim leaves a non-reclaimable sending row for operator reconciliation;
operators must not manufacture a new event ID. Exhausted events require explicit
review, not an unbounded reset. Receiver dedupe is mandatory for ambiguous sends.
Revocation may race an already in-flight request; revoke the receiver secret and
coordinate processor cancellation for that case.

## Retention, correction and erasure review

This v1 rejects candidate fields and exports no candidate data, so it creates no
new candidate processor copies or candidate erasure propagation obligation.
Existing application/consent/erasure workflows remain authoritative. Import mapping,
job drafts and redacted operational/audit evidence follow indefinite retention
with explicit deletion; no age-based purge is introduced. Rollback does not erase
audit evidence. Secrets must be revoked on installation removal. A processor must
honor explicit deletion of operational copies and confirm completion; failed
confirmation stays unresolved. If personal information is accidentally placed in
a title/reference, stop imports, revoke subscriptions, contain the data, use the
incident procedure and explicitly correct/delete retained copies including import
mapping/backups; do not claim candidate erasure automatically covered them.

Candidate source formats or candidate event families need independent assessment
of notice/basis, consent evidence, duplicate resolution, retention, identity-verified
rights propagation, erasure write fences and receiver deletion acknowledgement
before implementation. This contract grants no candidate-transfer authority.

The machine-readable [input schema](../contracts/requisition-import.v1.schema.json)
is complemented by SQL checks for duplicate keys/IDs, document size, provenance
and current authorization. `tests/governed-import.test.mjs` executes registered
SQL against the complete migration chain and dispatches through the server adapter.
It covers forged tenant/installation, isolated dry run, duplicate source/delivery,
partial import failure, rollback, missing/expired/revoked approvals, revoked grants,
claim fencing, signing, replay-window rejection, minimization and bounded retries.
