# Vacancies, position descriptions and external role-track mapping (#68)

## Delivered contract

`/vacancies` is the public index; `/vacancies/:vacancyId` is the canonical detail.
Generated links retain exact `organization_id` and `brand_id`. Bare IDs resolve
through approved public summaries; supplied incorrect scope never falls back to
another tenant. `/jobs`, `/jobs/:jobId`, and `/apply/:jobId` remain supported.
Application links use the existing `/apply` route: that route rechecks publication,
version, runtime intake status, candidate authentication, notice and consent.
Owner passkey verification is required by the existing publication action; candidates
do not perform the owner's publication ceremony. No intake gate is opened here.

Migration `0020_position_descriptions` adds append-only `hiring_pd_versions` and
immutable `hiring_pd_publications`. Existing rows/publications remain untouched and
continue to render their original description. PD JSON contains only the nine named
text/list fields, never arbitrary imported keys or HTML. Optional sections are omitted
when empty. Responsibilities/requirements are JSON arrays of at most 100 strings,
each at most 2,000 characters; other sections are strings up to 20,000 characters.

- `savePDDraft`: owner/recruiter with exact workspace/requisition access; requires
  all nine fields (empty strings/arrays allowed), `expected_version` (zero initially)
  and a unique `operation_id`. No writes after publication. Saves a new version and
  audit atomically. Edits reset existing pending review to draft and increment its
  review version. This prevents publication of a changed PD under an old review.
- `getPDDraft`, `previewPD`: same scoped access, latest payload/version/update time;
  preview is plain data, rendered as escaped React text. Empty rows mask missing or
  unauthorized records. Preview in the editor saves before requesting the preview.
- `listVacancies`: public, 25 rows ordered by requisition ID, `after_id` cursor;
  optional organization/brand filters. Search/arrangement filters apply to loaded
  pages; the UI clearly states this and offers load more. Only published, unpaused
  vacancies in active organizations are returned.
- `getVacancyDetail`: public exact organization/brand/requisition lookup with the
  same visibility boundary; empty rows map to the UI's 404. Both public actions
  explicitly select approved publication fields plus the captured PD/version.
- `listVacancyManagement`: granted owner/recruiter view of 100 recent requisitions,
  lifecycle and latest recorded activity time. Review/publication controls remain
  owner-only. Create a new requisition for revisions after publication.

Publishing captures the latest PD version inside the same database transaction
as the existing passkey-protected publication. Later availability/version changes
cannot mutate it. Previously published vacancies are not backfilled from private
drafts. Public reads never join candidates, attachments, notes, or private PD drafts.

## Non-executing Interns / external role-track import plan

This is a design proposal only. It contains no importer, scheduled job, data copy,
remote writes, or authorization to run an import. The previously referenced local
Interns checkout is unavailable in this workspace; source field names below are
conceptual, not a claim about its current schema. Obtain and inspect the actual
source contract before implementing a future importer.

| Source concept | Hiring destination | Review / transformation |
| --- | --- | --- |
| System + stable role-track ID + source revision | Future private import provenance record | Unique source/revision/destination key; never expose source credentials or private IDs publicly |
| Destination organization and brand | Existing exact Hiring scope | Explicit owner-approved mapping; no inference from names or email domains |
| Track / role title | Draft requisition title | Human-confirmed role; one requisition per independently published vacancy |
| Track summary | PD `overview` | Copy only approved role text; no participant profiles or private commentary |
| Track purpose | PD `rolePurpose` | Rewrite learning goals as accurate role purpose |
| Tasks / outcomes | PD `responsibilities` | Ordered string array, one meaningful item per entry |
| Eligibility / prerequisites | PD `requirements` | Validate role relevance; remove inappropriate personal/sensitive criteria |
| Delivery mode, hours, location, duration, supervision | PD `workingArrangement` and legacy publication location/arrangement | Explicit employment/internship/volunteer classification and accurate disclosures |
| Pay / stipend / expenses | PD `compensation` and legacy compensation | Owner verifies currency, period, conditions and classification; never invent pay |
| Support / development | PD `benefits` | Confirm promises and eligibility |
| Application instructions | PD `applicationProcess` | Use Hiring's existing intake flow; do not import external submission credentials |
| Approved role contact | PD `privacyContact` | App-owned contact; separately approve publication privacy notice/version |

Proposed future sequence:

1. Inventory source role tracks read-only and agree the exact source schema,
   ownership, tenant mapping and field-level publication rights with the owner.
2. Produce an offline dry-run report: source revisions, target matches, omitted
   fields, validation failures and proposed new draft PD versions. No writes.
3. Owner approves exact target scopes and conflict resolution. Reject ambiguous
   identity matches; never merge solely by role title. Keep prior versions.
4. A separately authorized importer would create draft requisitions and append PD
   versions only, using the registered scoped actions and expected-version checks.
   Store provenance privately and audit each accepted operation. Checkpoint stable
   keys for retries; concurrent changes require human reconciliation.
5. A recruiter reviews preview and disclosures. A brand owner submits exact public
   content for review and publishes through the existing passkey action. Import
   must never publish, reopen intake or carry over consent/publication approval.
6. Verify resulting tenant scope, public field allowlist, version provenance and
   duplicate prevention. Rejected drafts remain unpublished; correct mistakes by
   appending versions, never rewriting immutable history.

Excluded: candidate identities, resumes, applications, interview notes, messages,
source access tokens, participation records, inferred consent, or external private
metadata. Importing those requires a separate purpose, permission and design.
