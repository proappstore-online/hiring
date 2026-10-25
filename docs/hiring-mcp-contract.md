# Hiring MCP contract

The public `get_hiring_runtime_gate` action remains a bounded non-sensitive read. Authenticated internal actions now implement workspace bootstrap, membership grants, draft requisitions, LinkedIn application creation, stage and assignment history, notes, unsent drafts and audit reads. All private actions require PAS auth and SQL membership checks for the exact organization and brand. See [internal workspace](internal-workspace.md) for the deployed subset. The table below describes the overall contract; the versioned mutation surface shipped in #34 is specified separately below.

## Common envelope

Candidate mail archives support two existing transports without rewriting history:
`record_candidate_email` retains its Gmail-only contract; `record_worker_candidate_email`
records Cloudflare bridge mail as `channel=email-worker`, `provider=cloudflare`. The worker
action checks exact application/organization/brand membership, candidate address and the
configured mailbox side (inbound To or outbound From), and deduplicates operation IDs and
provider identifiers within the mailbox/bridge namespace. It stores message, thread,
acceptance receipt and event IDs separately. `get_worker_candidate_email` reads one exact
operation for verification; `list_application_communications` combines both providers.
Neither records nor reads mail directly from a provider or sends it. A zero-change write
requires readback and exact comparison; it is not evidence of a successful new archive.

Platform-authenticated caller, explicit organization/brand selection, validated arguments and request ID. Mutations require idempotency key and expected record version. Server derives grants; tool input cannot assert `user_id` or roles. Return only permitted fields, record version and structured errors (`UNAUTHENTICATED`, `FORBIDDEN`, `NOT_FOUND`, `CONFLICT`, `VALIDATION`, `RATE_LIMITED`). Mask unauthorized existence as `NOT_FOUND`. Bound and paginate results; minimize PII.

## Current scoped read surface (#33)

The registered read tools below replace the template's sample-item reads. They
are the deployed surface, not a prospective API: there are no generic
`list_brands`, `get_brand`, `get_requisition`, or `get_candidate` actions.

| Tool | Scope and guard |
| --- | --- |
| `list_my_workspaces` | Returns only the caller's current organisation/brand grants; this is the brand-discovery read. |
| `get_my_workspace` | Exact organisation/brand lookup, optionally limited to an owner-capable workspace. |
| `list_requisitions` | Owner/recruiter, exact organisation/brand and current requisition grant. |
| `list_applications` | Owner/recruiter, exact organisation/brand and current requisition grant; supports bounded operational filters. |
| `get_application` | Full recruiter detail for one exact application; reviewers use the redacted gateway instead. |
| `gateway_list_applications`, `gateway_get_application` | Read-only, redacted agent-safe application projections, bounded to 25 records where listed. |
| `gateway_list_requisitions`, `gateway_get_requisition` | Read-only, bounded agent-safe requisition projections. |

Every registered private read derives identity from the platform-bound caller,
declares no user, role, or grant input, and checks the current effective access
view in SQL. Missing and unauthorised scoped records return no rows. The
registry test verifies the action schemas against the SQL placeholders; the
gateway tests cover role and cross-brand denials using the applied migrations.

Do not expose arbitrary SQL, broad search/export, automated rejection/offer, cross-brand merge, deletion or legal-hold overrides as general agent tools. High-impact actions require real human confirmation in the calling workflow and a server check; model-supplied flags do not count. Treat returned resume/message text as untrusted against prompt injection.

Verified at `platform@ee78178` (see [architecture](architecture.md#capability-check-in-issue-7)): `mcp.json` supports worker-backed execution through `callers: ["worker"]`, but the worker identity holds no roles, and worker routes need an admin-enabled app and a signed-in user. Typed results are not documented, so they are unsupported. The current PAS direct SQL surface is used only for the scoped internal workflow above. Keep broader sensitive actions behind a proven trusted gateway or equally reviewable authorization checks. Contract tests cover roles, cross-brand IDs, pagination, stale versions, retry duplication, malicious candidate content and schema/tool coherence.

## Trusted gateway (issue #32)

**Enforcement boundary: the registered SQL action.** Four read-only actions are deployed: `gateway_list_applications`, `gateway_get_application`, `gateway_list_requisitions` and `gateway_get_requisition`. Identity comes only from the platform-bound `:__user_id`. The actions declare no user, role or grant parameters, so forged claims cannot reach SQL. Every staff statement checks current `hiring_effective_access` rows for that platform identity and exact organization/brand/requisition. Restricted application reads additionally allow reviewers only while assigned; full reads and writes require owner/recruiter authority. See [server permissions](permissions.md). A caller without a grant gets an empty result, which the contract maps to `NOT_FOUND`, so a missing record and an ungranted brand look the same. Joins also match organization and brand on the candidate and requisition, so a forged ID from another brand returns nothing.

- **Pagination:** at most 25 rows per page, ordered `(updated_at DESC, id ASC)` for applications and `(created_at DESC, id ASC)` for requisitions. Pass `cursor_at` and `cursor_id` from the last row to get the next page. A full page of 25 may have a successor.
- **Redaction:** gateway application reads are always the restricted profile. They return name, stage, version, assignee, requisition title and `has_email`, `has_phone`, `has_linkedin` flags. Email, phone, profile URL, source detail, basis reference and contact context are never returned. The recruiter UI keeps the full `list_applications` view.
- **Helpers:** `scripts/gateway-contract.mjs` holds the envelope validation, claim stripping, cursor encoding, redaction profiles, error codes (`UNAUTHENTICATED`, `FORBIDDEN`, `NOT_FOUND`, `CONFLICT`, `VALIDATION`, `RATE_LIMITED`), the zero-change mapping and a fixed-window rate limiter. `tests/gateway.test.mjs` covers them and the SQL actions across two brands.
- **Read gateway:** these four `gateway_*` actions remain read-only. The separate `hiring_v1_*` mutation contract below reuses the permission-checked workflow actions; it exposes no deletion or hold override.

### Known gaps (recorded on #32)

- **#12 implemented:** active organization/brand/requisition grants and membership revocation are enforced in SQL. Reviewer reads follow current assignment. See [server permissions](permissions.md) for the role matrix and administration actions.
- **#13:** a `query` tool cannot write. Denied and read accesses are therefore not audited, and the gateway has no `request_id` column to correlate against. The outbox is draft-only with no dispatcher. Failure-path auditing stays open and needs a batch-style action or a trusted worker.
- **Rate limits:** SQL tools cannot throttle per user. Only the platform's limit on anonymous calls was verified (120 per 60 seconds per app and client IP); the authenticated limit was not. `createRateLimiter` is for a future worker and is not enforced today.
- **Structured errors:** the platform returns rows or change counts, not error codes. The codes above are applied by the caller through the helpers. Typed results remain unsupported.
- **Worker route:** a trusted worker needs `pas worker enable hiring` by a platform admin. Enablement is unverified, and the worker runs as `system:worker` with no roles, so it would have to check the signed-in user itself. No worker is deployed.
- **#53 review:** ADR-001 accepts this SQL enforcement boundary for the current restricted reads. Worker enablement, server throttling, structured errors and read/denial audit remain gaps, not capabilities conferred by this decision.

## Approved onboarding and retention boundary (#53)

Owner: Serge. [Owner decisions](https://github.com/proappstore-online/hiring/issues/52#issuecomment-6309937556) approve many organizations, public organization sign-up and independent worker accounts/profiles. Authenticated worker actions must derive identity from the platform and enforce ownership of the worker/application link; recruiter membership checks do not authorize worker access. Anonymous writes and token-only D1 access are unsupported by the [#7 evidence](https://github.com/proappstore-online/hiring/issues/7). These actions and onboarding are not implemented by this review.

Retain records indefinitely without an automatic purge; explicit rights/deletion flows remain scoped and audited. No legal-review gate applies to unpaid, internship or volunteer roles. See [ADR review and backlog dependencies](architecture.md#affected-backlog-dependencies).

## Issue #3 action additions

Public `list_public_jobs` / `get_public_job` expose approved published snapshots only. Owner publication/closure require platform passkey step-up. Authenticated worker-profile, submission, receipt and attachment actions derive identity from `:__user_id`; they do not grant staff permissions. Submission requires the runtime gate open; no registered action opens it. Attachments stay pending and no user-callable scan verdict or byte-download capability exists. Exact contracts and remaining #3 release gates: [candidate intake](candidate-intake.md).

## Organisation playbooks

The org-only `get_org_recruiting_playbook` action uses `organization_id` without a
brand argument. Its schema version, grants, secret redaction and fail-closed agent
behavior are defined in [the agent playbook contract](agent-playbook-contract.md).
Its raw rows are not the generic gateway envelope described above.

## Application detail and stage contract v1 (#20)

`get_application(organization_id, brand_id, application_id)` is an authenticated,
read-only full recruiter detail lookup, independent of list limits. Current
owner/recruiter authority must cover the application's requisition; missing and
unauthorized records both return no rows. Reviewers use the restricted gateway
model. No browser interaction is required.

`change_application_stage` retains its existing parameters and zero-change denial
semantics. The static transition map, additive stage representation and atomic
history/audit guarantees are documented in [the domain model](domain-model.md#application-stage-contract-v1-20).

## Interview tools v1 (#22)

All tools require authentication. Shared scope `S` is
`tenant_id, brand_id, application_id, interview_id`; tenant means organization.
UUID record/assignment IDs are caller-generated; actor and time are server-bound.
Schedule fields `T` are `scheduled_at?` (UTC epoch milliseconds),
`duration_minutes?`, `location?`, `format` (phone/video/onsite/panel).
Optional schedule fields default to NULL; updates replace the complete schedule.

| Tool | Parameters | Result / authority |
| --- | --- | --- |
| `create_interview` | S, T, reviewer_id, assignment_id, operation_id | Owner/recruiter; creates interview, assignment, assigned history and audit |
| `update_interview_schedule` | S, T, expected_version, operation_id | Owner/recruiter; versioned schedule replacement and audit |
| `assign_interviewer` | S, reviewer_id, assignment_id, reason, expected_version, operation_id | Owner/recruiter; revokes previous active assignment, appends history/audit, installs new assignment |
| `revoke_interviewer` | S, reason, expected_version, operation_id | Owner/recruiter; revokes active assignment, appends history/audit |
| `read_interview_packet` | S | One `packet_json` row; reviewer needs active interview assignment plus current scoped grant; owner/recruiter receives full projection |
| `list_application_interviews` | tenant_id, brand_id, application_id | Up to 100 interview summaries, same read authority; ordered newest first |

Mutation operation IDs are globally checked against audit and interview history.
Successful exact retries append nothing; zero changes also represents denied or
stale requests and must not be interpreted as a new success. Reassignment audit
uses the operation ID and a derived `-revoked` ID for its two events. Version
checks serialize concurrent changes. Self-assignment by reviewers is forbidden.
Read denials return empty rows rather than revealing whether a record exists.
See [packet projection and access](permissions.md#interview-assignment-and-packets-22).
Full packets provide attachment metadata only, and preserve separate Gmail/worker
communication arrays; history collections are scoped to the exact application.

The scheduling UI calls these persisted actions and does not send invitations.
The older Working Interview Invitation component remains a separate playbook
workflow; interview metadata does not confer send, publication or final-decision
authority. Tests execute the deployed SQL against SQLite with PAS-style binding;
they do not claim a live D1 or provider probe.

### Structured scorecards (#23)

- `save_own_scorecard`: exact tenant/brand/application/interview/assignment IDs,
  `expected_version` (0 for new), `status` (`draft` or `submitted`),
  `criteria_json`, `operation_id`. Appends one immutable version and redacted
  audit event atomically; only the current assigned principal can write.
- `read_own_scorecard`: same IDs, optional exclusive `before_version`. Returns
  at most 50 own revisions descending by version. Current ownership/grants are
  rechecked for every page. Staff have no override. Submitted scorecards are final
  per assignment. Score capture supplies no hiring decision or send authority.

The interview list includes its active `assignment_id` for explicit scorecard
ownership. Full validation and lifecycle: [domain model](domain-model.md#structured-scorecards-23).

## Decisions and offers (#24)

Root `mcp.json` is the action registry; there is no `contracts/mcp.json`.
All new actions require authentication and exact tenant/brand/requisition access.
Every mutation requires a fresh `operation_id`. Actor/time/role are server-derived;
optional actor claims are equality checks, never authorization. System identities
are denied. The recruiter UI asks the already-authorised user for an explicit
confirmation before consequential decisions, offers, dispatch authorisation and
acceptance. No caller-supplied confirmation flag is authorization: current scoped
role checks, optimistic versions and immutable audit records remain server-side.

| Action | Parameters beyond tenant_id/brand_id |
| --- | --- |
| `record_decision` | requisition_id, application_id, disposition, rationale?, expected_version, actor_id?, actor_role?, operation_id |
| `list_application_decisions` | application_id; up to 100 records |
| `save_offer_draft` | requisition_id, application_id, terms_json, expected_version, operation_id |
| `submit_offer_for_approval` | offer_id, expected_version, actor_id?, actor_role?, note?, operation_id |
| `approve_offer` | offer_id, expected_version, actor_id?, actor_role?, note?, operation_id |
| `revoke_offer` | offer_id, expected_version, actor_id?, actor_role?, note?, operation_id |
| `get_offer` | offer_id? and/or application_id?; at least one is required |
| `list_offer_versions` | offer_id, before_version?; up to 50 descending revisions |
| `authorize_offer_dispatch` | offer_id, draft_id, expected_version, authorized_by?, operation_id |

Decision, submission, approval, revocation and dispatch authorization require an
authorised owner or recruiter and an explicit UI confirmation. Draft capture and
scoped history reads do not. The UI displays exact terms before confirmation.

Mutation batches contain writes only, as required by PAS registration. Each has
a separate scoped `get_*_result` readback action with the same original arguments:
`get_decision_result`, `get_offer_draft_result`, `get_offer_submission_result`,
`get_offer_approval_result`, `get_offer_revocation_result`, and
`get_offer_dispatch_result`. The browser write helper uses these to return the
committed record after success or an exact retry, without appending evidence again.
Conflicting replays return no record or fail constraints. All reads/replays recheck current access. Mutation counts of
zero alone never establish success. SQL batches commit business records and
redacted audit together. Audit failures roll back the entire operation. Reuse the
same operation key after an uncertain response and inspect its scoped readback record;
do not create a replacement offer/job to bypass an unknown provider outcome.

Local tests execute registered SQL with PAS-style parameter binding; they do not
perform live platform authentication ceremonies or provider sends. Existing
independent mail archive actions record evidence, rather than dispatch messages.

## Candidate acceptance (#98)

`record_acceptance(tenant_id, brand_id, application_id, operation_id,
expected_version, acceptance_evidence)` requires authentication by an authorised
owner or recruiter. Tenant means organization. Evidence must be 1–10000 characters
after trimming and must describe actual candidate acceptance. Owner/recruiter
requisition grants, offered prior state and approved offer terms (including unpaid, internship and volunteer terms) are rechecked.
The mutation commits acceptance, application state, stage history and audit in
one transaction. `get_acceptance_result` takes the exact same arguments and
returns the updated application ID, stage, version, evidence and operation ID for
an exact committed operation; it rechecks current grants and original actor.
Changed evidence or scope does not match a retry. Accepted is terminal. Existing
application reads and stage filters expose accepted; only authorized staff receive
acceptance evidence. Approval and interview booking never imply acceptance.

Stranded dispatch operators may call `reclaim_stale_communication` with exact scope,
draft, operation ID, expected attempt timestamp and optional staleness milliseconds.
This passkey-gated owner/recruiter action moves only a server-verified stale sending
attempt to unknown, with atomic audit/history and preserved claim. It neither sends
nor requeues. See [stranded sending recovery](audit-outbox.md#stranded-sending-recovery-4)
for bounds, replay behavior and subsequent human reconciliation.

## Privacy operations and audited read revision (#5)

[Privacy operations](privacy-operations.md) defines the new versioned owner rights
workflow, private 15-minute core export and `authorize_gateway_*` /
`audited_gateway_*` pairs. The browser routes restricted gateway reads through those
pairs. Authorization records server-derived denial/missing outcomes before retrieval;
caller-reported read uncertainty has separate durable evidence. Direct legacy reads,
platform-preexecution failures and broader mutation failures remain audit gaps.
The legacy core query remains compatible. The asynchronous subject export contract
uses a durable scoped JSON snapshot with explicit confidential and file-byte exclusions;
see [privacy operations](privacy-operations.md#private-asynchronous-subject-export-30). Full erasure/processor limitations
remain unchanged; issue #5 still has acceptance gaps.

Ordinary `change_application_stage` pipeline updates require current scoped staff
authority, version/reason checks and audit, without platform passkey step-up.
Dedicated final-decision, offer approval/dispatch and candidate-acceptance actions
retain their separate explicit-confirmation UI and server-side role/audit controls.

`withdraw_my_application` is authenticated candidate self-service. It requires
exact organization/brand/application, expected version and an operation ID, and
binds the caller to the immutable intake receipt rather than a claimed worker or
staff role. It records an active-to-withdrawn transition, immutable stage history
and audit in one batch. `get_my_application` and `list_my_job_applications` expose
the current version for optimistic concurrency and durable retry readback. No
candidate token, staff membership or passkey ceremony is required for this own-
account action. It does not fulfill an erasure request or recall in-flight mail.

## Duplicate review (#21)

`suggest_candidate_duplicates` checks current owner/recruiter access to each candidate
inside one exact brand. `merge_candidates` is a human owner operation with mandatory PAS
step-up, not a general agent merge tool. `list_candidate_merges` is brand-owner-only and
returns canonical fields and immutable source-field references. See
[candidate duplicates](candidate-duplicates.md) for preserved ownership, pair-only merge
limits, audit atomicity and erasure behavior.

### Brand template approval (#27)

`approve_communication_template` is a passkey-protected brand-wide owner action
bound to `template_id` and `expected_version`. Its immutable approval record is
the attribution evidence. `list_approved_communication_templates` requires live
application sender access, including requisition restrictions. Queue and claim
recheck exact approved content and recipient; queue pins template ID/version.
Editing a template invalidates sending from the previous version. Unapproved
freeform drafts remain unsent. See [MAIL contract](mail-contract.md).

## Retention and restore actions (#28)

Owner actions `record_store_hold`, `request_store_deletion`, `get_store_deletion`,
`release_restored_store_hold` and private ledger export reads require exact current
brand-wide owner authority. Export artifacts are private and may contain opaque
object keys/reason references. Worker execution, verification, per-store completion,
imports and restore readiness actions are `callers: ["worker"]` only and check the
platform worker identity. They must never be exposed through a user-supplied action
proxy. [Retention contract](retention.md) defines claim interlocks, uncertain-outcome
reconciliation, signed checkpoint/gate requirements and remaining integration limits.

### Subject rights intake (#29)

Candidates use authenticated `submit_my_rights_request` and
`list_my_rights_requests` with exact receipt ownership. Owners use
`list_brand_rights_intake` then adopt the unchanged receipt via
`record_candidate_rights_event`, assigning deadline and owner. Verification is
human-reviewed and scoped; private evidence references never appear in candidate
status. `attest_candidate_rights_completion` records owner/passkey-reviewed
completion of correction, withdrawal or deletion after processing; it performs no
data mutation beyond lifecycle/audit evidence. See [privacy operations](privacy-operations.md).

### Secure asynchronous exports (#30)

`queue_candidate_export` creates an idempotent principal-bound job from a verified
`request_candidate_export` receipt. `get_candidate_export_status` returns only state
and expiry. `prepare_candidate_export` is passkey-gated owner-only assembly;
`list_candidate_export_queue` and `assemble_candidate_export` are worker-only
alternatives. Both assembly paths use the same explicit SQL projection and atomic
content-free readiness audit. No arbitrary payload or storage key is accepted.

Before every download call `authorize_candidate_export_download` with a fresh
`access_id`, then `download_candidate_export`. Read authorization, current grants,
latest identity review, erasure and absolute expiry are checked again on retrieval.
Artifacts are private JSON, never public links. Coverage, exclusions, retention and
operational scheduling are specified in the privacy operations contract.


## Versioned agent mutation contract v1 (#34)

The registered `hiring_v1_*` actions are the stable agent mutation surface.
They are generated by `node scripts/mutation-tools.mjs` from existing workflow SQL;
registry tests require regeneration whenever those source controls change. Existing
browser actions remain compatible. Every v1 action requires authentication,
`organization_id`, `brand_id`, a fresh `operation_id` (1–128 trimmed characters),
and a nonnegative integral `expected_version`. Identity and current grants come
from platform-bound `:__user_id` and `hiring_effective_access`; there are no actor,
role, or confirmation claims in the parameters. Service identities are denied,
even if mistakenly granted membership. Scope and operation checks run in SQL.

| Action | Version and additional inputs | Effect |
| --- | --- | --- |
| `hiring_v1_create_requisition` | Version 0; requisition_id, title | Create a new internal draft, with organization/brand-wide owner or recruiter grant. |
| `hiring_v1_update_requisition` | Current PD version (0 before first); requisition_id and the complete structured PD fields from `save_pd_draft` | Append immutable PD revision; published requisitions cannot be edited this way. No publication or approval authority. |
| `hiring_v1_advance_application` | Current application version; application_id, from_stage, to_stage, reason | Allowed nonfinal pipeline transition, with passkey confirmation. Final dispositions must use the decision action. |
| `hiring_v1_submit_scorecard` | Current own scorecard revision (0 before first); application_id, interview_id, assignment_id, status=`submitted`, criteria_json | Final structured scorecard for the caller's active assignment only. No draft or decision authority. |
| `hiring_v1_record_decision` | Current application version; requisition_id, application_id, disposition, rationale? | Attributed human decision under existing decision/approved-paid-offer rules, with passkey confirmation. |
| `hiring_v1_draft_message` | Current application version; application_id, draft_id, recipient_email, subject, body, template_id?, template_version? | Save an immutable unsent draft after recipient and current access checks. Pin template ID/version for subsequent v1 send. |
| `hiring_v1_send_approved_message` | Pinned template version; application_id, draft_id | Passkey-authorized durable outbox enqueue of exact approved text. Recipient and current template approval are rechecked. This is not provider delivery. |

For requisition updates, structured fields are `overview`, `rolePurpose`,
`responsibilities` and `requirements` (JSON arrays of strings),
`workingArrangement`, `compensation`, `benefits`, `applicationProcess`,
`privacyContact`. Read current state with the existing scoped requisition/PD,
application, own scorecard, draft and template reads before constructing a mutation.

The human workflow must show the exact stage/decision or message preview,
recipient and approved template version before invocation. High-impact actions
have registered `step_up: true`: PAS performs the real passkey ceremony outside
SQL; a model-supplied `human_confirmed` flag cannot satisfy it. Do not route around
a required confirmation. For messages, normal authorized dispatch and delivery
history continue through the existing outbox controls from #27. A successful
enqueue does not authorize a second job after an unknown provider outcome.

Batches commit business state and content-free audit evidence atomically.
Unauthorized scope, stale version or duplicate operation produces zero changes;
`mutationResult` maps this to `CONFLICT` without revealing record existence.
Zero changes must never be presented as a new success. Following an uncertain
response, inspect scoped audit/history using the original operation ID; never
invent another operation to force a retry. Scorecards, decisions and PD revisions
retain their existing immutable histories. A failing audit write rolls back the
business mutation. The same operation namespace is shared with legacy actions,
so switching tool versions cannot replay an already committed operation.

Tests execute the registered SQL with PAS-style binding, including every v1
mutation's stale/replay/authorization and audit rollback paths. They check real
platform gate registration, but do not simulate or claim a live passkey ceremony.
The authenticated rate-limit, typed error and failure-path audit limitations
listed above remain platform gaps. No arbitrary SQL, export, deletion, hold
override, automatic rejection or automatic offer tool is added by this contract.

## Operational monitoring (#35)

`get_operational_health` adds owner/auditor brand-wide retention failed, blocked
and unknown counts plus unresolved quota/outage counts. These fields are null for
restricted grants. `inspect_operational_jobs` is a content-free brand-wide
owner/auditor keyset inspection of unresolved mail and retention jobs (100/page).
It grants no dispatch or worker capability. Recovery uses existing passkey human
reconciliation and hold-aware retention claims; see
[monitoring, alert bindings and runbooks](operational-monitoring.md).

Talent-pool actions: `list_talent_pool` requires current full-brand owner/recruiter
access and supports `after_id` pages of 50. `get_my_talent_pool` and
`withdraw_my_talent_pool` require the signed-in candidate's ownership of the selected
application and explicit organization/brand scope. Withdrawal uses `operation_id`
for atomic audit and replay protection. See [talent pool](talent-pool.md).

## Governed import and outbound webhooks v1 (#49)

The [reviewed bounded contract](governed-import-webhooks.md) adds owner-only dry
run, commit, rollback, subscription/revocation and bounded operational reads.
Claim/read/finish delivery actions require platform `system:worker`. Trusted,
exact-installation/brand approval records are empty by default; neither ordinary
MCP callers nor register edits can approve these capabilities. No candidate
source format or candidate webhook payload is supported. See
[the input schema](../contracts/requisition-import.v1.schema.json).

### Worker correspondence replay integrity (#59)

Migration `0046_worker_email_conflicting_replay` adds a conflict guard for both
unlinked correspondence and linked outbox evidence. Reusing a worker archive ID,
operation ID, or scoped message/receipt/event identity with different content,
provider metadata, actor or agent aborts the transaction. Exact retries remain
no-ops and require exact authorized readback. Gmail actions and existing migrations
are unchanged; candidate contacts are never rewritten.

Regression evidence lives in `tests/internal-workspace.test.mjs` (cross-owner,
scope, candidate/mailbox matching, provider union, opaque identifiers, immutable
storage, unlinked conflict/readback and contact preservation) and
`tests/email-history.test.mjs` (linked evidence and replay integrity). Tests execute
the manifest SQL against all canonical migrations and use synthetic correspondence;
no real candidate mail is sent. Local SQL readback is not proof of live provider
delivery. Push-triggered `Deploy to R2` supplies migration/action deployment evidence.

### Candidate lifecycle (#102)

Acceptance remains independent from onboarding. `record_acceptance` records explicit
agreement only. `record_lifecycle_transition` advances `accepted → onboarding →
onboarded → active`; accepted, onboarding and onboarded may also move to rejected
or withdrawn. Active, hired, rejected and withdrawn have no outgoing transitions.
Historical hired records are not reclassified and historical internship progress
is retained independently; it does not imply canonical onboarding completion.

Every lifecycle operation requires organization, brand, requisition, application,
expected application version, prior/next stage, operation ID and transition evidence.
Supply empty strings for registration_evidence, requirements_evidence and
handoff_evidence except when completing onboarding: all three must then contain
references proving registration, requirements acknowledgement and team/Discord
handoff completion. Actor and time are recorded by the server. Only scoped owners
and recruiters may write/read detailed lifecycle evidence.

Writes are atomic with immutable stage and audit events. Retry with the same
operation ID and identical payload, then confirm with `get_lifecycle_result`.
A conflicting retry cannot confirm success. `list_lifecycle_events` reads the
scoped evidence history; canonical application reads and stage filters return the
latest lifecycle stage. Candidate workspace URLs support `view=lifecycle` using
the existing organization/brand query scope. Acceptance evidence remains visible
through subsequent stages. Migration `0050_candidate_lifecycle` adds nullable
state and new tables/triggers without rewriting historical records.
