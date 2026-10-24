# Server permissions (#12)

Platform authentication supplies `:__user_id`; caller arguments and app-level role claims never supply Hiring authority. Platform administrators do not automatically gain candidate access. Hiring's D1 records map that identity to organization, brand and requisition permissions. Every staff action checks the current `hiring_effective_access` view in SQL. Organization suspension removes staff access. Public job snapshots and candidate-owned actions retain their separate authorization contracts.

Migration `0012_scoped_permissions` adds a membership revocation ledger and the effective-access view without changing existing records. Active legacy owner/recruiter memberships remain brand-wide. Active `hiring_grants` apply to an organization (both scope columns null), brand (requisition null), or exact requisition. Organization grants expand only to brands in that organization. Revoked grants and memberships confer no authority. Multiple active grants are additive; revoking one does not cancel another independent grant.

| Role | Server permission |
| --- | --- |
| Owner | Brand-wide staff operations, grant administration, passkey-protected publication. Creating sibling brands and organization-wide delegation also require organization creator identity. Owner delegation/revocation is unavailable through these tools. |
| Recruiter | Full application reads and operational writes within granted requisitions. Creating requisitions and listing staff/publications require brand-wide authority. |
| Reviewer | Restricted `gateway_get_application` / `gateway_list_applications` reads for currently assigned applications. Interview packets require the current interview assignment. Reads and edits only own current assigned scorecard. No full candidate/contact reads, other reviewer content, application mutations or hiring decisions. |
| Auditor | `list_application_audit` within granted requisitions. No candidate detail reads or business mutations. |

An application assignee must have active owner, recruiter or reviewer authority for that exact requisition. Assignment alone grants no access. Reassignment immediately removes the previous reviewer's access; revocation also removes access even if their user ID remains on an application. Reviewers cannot reassign themselves. Application mutations still require optimistic versions where supported, and audit/operation checks remain atomic.

## Administration actions

All actions require platform authentication. A brand-wide owner calls `grant_workspace_access` with `organization_id`, `brand_id`, optional `requisition_id`, `member_user_id`, `role`, `grant_id` and `operation_id`. Roles are limited to recruiter/reviewer/auditor. The requisition must belong to the selected brand. Omit the requisition to grant brand-wide authority. Grants cannot target the caller or overwrite existing grant IDs.

`grant_organization_access` takes the same fields except requisition; it additionally checks the organization's creator. Its selected owned brand supplies audit attribution; the new grant covers all brands in that organization. `list_workspace_grants` returns active grant/membership IDs and scopes to a brand-wide owner.

`revoke_workspace_grant` and `revoke_workspace_membership` take organization, brand, `grant_id` and a new `operation_id`. The membership action records a durable revocation rather than deleting legacy data. Only the organization creator can revoke an organization-wide grant. Self-revocation and owner revocation are unavailable. Revoked legacy memberships can be replaced with a new explicit grant if access is needed again; `add_workspace_member` does not reactivate them.

Successful administration appends an audit event with platform actor and object ID. A replay, forged scope, unauthorized role, or rejected administration attempt writes nothing. Audit failure rolls back the entire batch. Reads return empty results for missing or unauthorized objects; mutations return zero changes, following the existing gateway contract. Read/denial auditing and authenticated rate limiting remain separate open work.

`tests/permissions.test.mjs` exercises scoped reads and writes, forged IDs/roles, assignment changes, revocation, overlapping grants, role restrictions, organization suspension, administration ownership, replay and audit rollback. Existing multi-brand and intake tests also exercise these deployed SQL statements.

## Organization and brand administration (#14)

`update_organization_identity` takes organization/brand IDs, `name`, `verified_contact` and a fresh `operation_id`. It requires the active organization creator and brand-wide owner authority on the selected audit brand. Organization-wide identity and member visibility are reserved to the creator, so ownership of one brand cannot expose or administer sibling brands. Identity fields are optional individually; at least one must be supplied. Omitted fields remain unchanged; contact may be cleared with an empty string. The legacy field name does not imply independent verification of owner-supplied contact details.

`update_brand_settings` takes the exact organization/brand, `name`, `slug`, `notice_version`, `reply_identity` and a fresh operation ID. It requires brand-wide owner authority. Name is nonblank; other fields may be cleared. Slugs contain lowercase ASCII letters, digits and hyphens and must be unique within the organization when nonempty. Fields are trimmed and bounded to 300 characters (notice version: 128). Both updates atomically append attributed, text-free audit events. Replayed operations, forged scopes and unauthorized callers change nothing; audit failure rolls back the update.

`get_admin_settings` returns current settings only to a brand owner. `list_organization_members` returns up to 500 active raw grants and unrevoked legacy memberships across the organization to its creator-owner. Entries include ID, user, role, scope type/ID, brand/requisition IDs, granted timestamp and source. `list_brand_admin_members` provides brand owners the equivalent list limited to explicit grants and memberships in their brand. Organization grants are managed by the creator. These bounded lists do not claim to enumerate beyond 500 rows.

The owner UI uses the existing canonical actions: `grant_workspace_access` for brand/requisition grants, `grant_organization_access` for organization grants, `revoke_workspace_grant` for explicit grants and `revoke_workspace_membership` for legacy memberships. There are no separate `create_scoped_grant` or `revoke_grant` endpoints. Roles available for delegation are recruiter, reviewer and auditor; owner/self revocation remains unavailable. Authority is recomputed on every server call, so changes take effect immediately. Overlapping grants must all be revoked to remove access. Open clients refresh administration after changes; a previously loaded screen is not authorization for a subsequent action.

Migration `0014_brand_org_admin` adds an immutable publication identity table and captures names for existing publications at upgrade time. Future publication inserts capture names in the same transaction through a trigger. Organization/brand edits affect live workspace records and future publications, **not existing public publication names, contact or notice snapshots**. Historical pre-upgrade names cannot be reconstructed; legacy publications preserve their names as observed during upgrade. Brand notice version and reply identity are configuration metadata; publication still requires explicit review of its notice and contact.

Regression coverage: `tests/brand_admin.test.mjs`, alongside the existing permissions and multi-brand suites.

## Interview assignment and packets (#22)

Interview assignment is separate from the application's operational assignee.
`tenant_id` on interview tools maps to the existing `organization_id`. Every tool
checks platform `:__user_id` against current organization/brand/requisition access.
Owner/recruiter authority permits scheduling, assignment, revocation and full
packet reads. Target interviewers must have current owner/recruiter/reviewer
access to that same requisition; assignment alone grants no authority.

Reviewers may call `list_application_interviews` and `read_interview_packet` only
for scheduled interviews with their own active, non-revoked assignment and a
current scoped reviewer grant. Reassignment, explicit revocation, grant revocation
and organization suspension remove access on the next server call. Existing
application assignment does not grant interview access. Previously downloaded
information cannot be recalled; the UI reloads packets on focus and manual refresh.

Packets are returned as `packet_json`. Reviewer objects contain exactly
`candidate_name`, `requisition_title`, `stage`, `scheduled_at`, `duration_minutes`,
`location`, `format`, `status`; no contact, source, notes, messages, drafts or
attachments. Owner/recruiter objects additionally contain contact/source context,
notes, Gmail/worker communication history, drafts and attachment metadata. Private
storage credentials/paths and attachment bytes are never included. No packet read
bypasses attachment quarantine. Unauthorized and missing reads both return no rows;
denied/stale/replayed mutations return zero changes, matching existing actions.

## Scorecards (#23)

`read_own_scorecard` and `save_own_scorecard` require the authenticated identity
on the exact active interview assignment plus current requisition authority.
This is the scorecard's sole ownership contract; application assignment, role
alone, and owner/recruiter access to interview packets do not authorize reading
another reviewer's scorecard. Reassignment, assignment revocation, grant
revocation and tenant suspension deny subsequent scorecard requests. Returning
reviewers receive a new assignment and cannot reopen the old assignment's review.
See [structured scorecards](domain-model.md#structured-scorecards-23) for revision,
submission, validation and pagination contracts.

## Human decisions and offers (#24)

Current scoped owner/recruiter authority is required for all decision/offer reads
and writes. Interview or scorecard assignment does not confer this authority.
Caller-supplied actor IDs/roles are checked against the platform identity/current
grant; no system/automation/API-key role can produce human evidence. Human actions
also require platform passkey step-up, following publication's existing boundary.
Every history/retry read recomputes grants, including organization suspension.

## Grant-scoped search (#46)

`search_candidates` and `search_applications` accept the selected organization and
brand, optional requisition, `q` (required, at most 200 characters), `limit`
(default 20, range 1–50), and an optional opaque `cursor`. Application search also
accepts `stage`. SQL treats these IDs as selectors, never as authority: every
matching application must independently pass current `hiring_effective_access`
organization/brand/requisition checks for platform `:__user_id`. Owner/recruiter
access includes only granted requisitions. The interviewer role is named
`reviewer` in this schema; it requires a current scoped reviewer grant AND an
active assignment on a scheduled interview for the matching application.
Application assignee alone is insufficient for this search surface. Auditors and
unassigned reviewers receive no records. Revocation and organization suspension
take effect on the next query, including continuation pages and direct fetches.

Search uses `hiring_candidates.name` only, exposed as `full_name` in candidate
results. `%`, `_` and backslash are literal characters, not caller-controlled LIKE
operators. Email is neither searchable nor returned: candidate `email` is always
null, following the existing restricted-contact policy. Application results
contain only ID, candidate ID, requisition ID, canonical stage and creation time.
No counts, snippets, source text or contact values are returned. Candidates with
multiple authorized applications are deduplicated. Candidates without an
authorized application are excluded. Same-email applicants in different brands
remain independent records.

`get_search_candidate` and `get_search_application` take `id`, the same explicit
scope and optional requisition (plus optional application stage), and return the
same minimal projection after fresh authorization. Missing, forged, erased and
unauthorized IDs all produce empty rows. Existing full `get_application` remains
owner/recruiter-only; interview packet reads retain their separate assignment
checks. Search visibility never authorizes full contact/history retrieval.

Pages order by creation time descending, ID ascending. `next_cursor` on the last
row is the continuation token; null marks the end. Tokens encode tool, principal,
organization, brand, optional requisition/stage and anchor ID, without query text
or contact information. They are opaque scope-bound tokens, **not signatures or
bearer credentials**. SQL resolves anchors only among currently authorized
matches. Forged, cross-principal, cross-brand or filter-mismatched anchors return
no rows. Changing search text starts a new page in the UI. Removed/revoked anchors
invalidate continuation; restart the search. Pages are live reads, not snapshots.
Every page rechecks authority even if a caller constructs a token itself.

Migration `0041_grant_scoped_search` adds one bounded counter row per principal.
All four search actions atomically increment the same authenticated-user budget
and read within a D1 batch. Each batch contains one upsert with `RETURNING`;
its response row contains `status`, `retry_after` and `rows_json`. The client
decodes `rows_json` into the documented record projection. No result payload or
query text is persisted in the budget table. This fits the platform requirement
that registered batch members be write statements. At most 30 requests per server-clock minute are
admitted across tools, brands and cursors; request 31 onward returns empty data
and a status row with `status=429` and `retry_after`. The next minute resets the
counter. Denied/invalid searches also consume budget. Counter storage contains
only identity, window and count; it never contains query text. The `x-rate-limit`
manifest extension documents this policy; SQL enforces it independently.

**Transport boundary:** the current PAS action endpoint wraps successful SQL
batches in HTTP 200 and does not implement authenticated per-tool HTTP status
mapping. `scripts/search.mjs` maps the server status row to `SearchError.status=429`
and the UI displays a retry message. A literal HTTP 429 on the raw action endpoint
requires a platform change; no enabled custom worker route is assumed. This is a
remaining transport limitation, not a claimed platform capability.

Search reads canonical D1 rows, never index payloads, with live grants and
scoped erasure/deletion/restore tombstone suppression. There is no new FTS or
external index. A future index may supply IDs only; canonical joins and these
checks must remain authoritative, preventing stale references from revealing
removed data. Query text travels only in authenticated POST bodies. The app does
not log requests, results or upstream error text, and stores no search text in
URLs, analytics, local storage or cursors. The checked platform operation logger
explicitly excludes request bodies and SQL parameters; production logging changes
must preserve that boundary.

The Applications screen adds an explicit-submit workspace search for both record
types, with next-page loading and fresh direct fetch before opening a result.
Its existing recent-pipeline filters remain available. Query edits, record-type,
workspace and account changes clear results; stale asynchronous responses are
discarded. `tests/search-scoping.test.mjs` executes the deployed SQL across two
brands and covers role/scope denial, current assignments, revocation, forged
cursors, rate enforcement, stale references, tombstones and input bounds.
