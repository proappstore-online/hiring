# Hiring URL contract v1 (#91)

React Router 6 BrowserRouter owns navigation. The public header is app branded;
authenticated recruiter pages use ProShell with `branding="app"`. Vite and the
production host provide the SPA fallback for direct nested loads.

| Journey | Canonical URL | Scope and authorization |
| --- | --- | --- |
| Public vacancy list | `/vacancies` | Published, open records only |
| Public vacancy detail | `/vacancies/:requisitionId` | Exact globally unique requisition ID |
| Apply to vacancy | `/vacancies/:requisitionId/apply` | Same exact published record; intake and candidate sign-in gates |
| Candidate applications | `/my-applications` | Signed-in candidate's own records |
| Candidate application record | `/my-applications/:applicationId` | Exact candidate-owned read |
| Recruiter vacancy list/detail | `/recruiter/vacancies[/:requisitionId]?organization_id=…&brand_id=…` | Exact validated workspace and server-side owner/recruiter grant |
| Recruiter application list/detail | `/recruiter/applications[/:applicationId]?organization_id=…&brand_id=…` | Exact validated workspace; owner/recruiter full read, assigned reviewer restricted read |
| Brand settings | `/recruiter/organizations/:organizationId/brands/:brandId/settings` | Both IDs must identify an owner workspace |
| Organisation settings | `/recruiter/organizations/:organizationId/settings` | Organisation ID must identify a workspace created by the signed-in owner |

Organisation settings expose organisation identity and grants; brand settings
expose brand identity, brand grants and requisition creation. Other recruiter
sections retain `/recruiter/{overview,communications,playbook,operations,compliance}`
with validated `organization_id` and `brand_id` query fields. Selected communications use `/recruiter/communications/:applicationId` and exact application authorization. Settings has
explicit scope in its path. Requisition and application IDs are globally unique
primary keys; public and candidate exact reads need no scope selector. Staff
scope is needed for authorization and is resolved by `get_my_workspace` for
explicit scoped URLs before any protected screen mounts. The workspace list
only populates the selector and supplies the default workspace. Every detail action uses an exact ID lookup;
no route scans a paginated list to infer scope. Missing, removed, cross-scope,
and unauthorized staff records all show the same 404 view.

List query parameters carry only non-sensitive transient state: public vacancy
`q`, `filter_brand`, `arrangement`; staff application `requisition`, `stage`,
`source`, `assignee`, `date_from`, `date_to`; and the staff workspace scope.
Candidate names and source-detail search stay in memory. Detail links may carry
a `back` pointer to a whitelisted list path with allowed filters; it is
validated again before rendering a back link. Copy/share actions omit `back` and
emit the stable canonical URL. No applicant contact data is placed in a URL.

`/jobs` redirects to `/vacancies`; `/jobs/:id` and `/apply/:id` validate any
supplied legacy organisation/brand pair against the exact published record,
then redirect to the canonical vacancy or apply URL. A partial or mismatched
pair resolves to 404, never to a different record. Legacy `/dashboard`,
`/admin/*`, `/playbook`, and `/applications[/:id]` redirect to their matching
recruiter screens, preserving exact IDs and validated workspace scope. The old
`/recruiter/settings` URL redirects to explicit brand settings after the owner
workspace is resolved. Public browsing does not wait for auth hydration;
protected pages redirect to `/sign-in?returnTo=…` and restore a local allowed
path after sign-in.

## Exact recruiter application detail (#20)

`/recruiter/applications/:applicationId` now loads `get_application` directly, independent
of the 100-record queue. It returns full details only for current owner/recruiter
access to the exact organization, brand and requisition. Missing and unauthorized
IDs both return no rows. Assigned reviewers retain the restricted
`gateway_get_application` fallback, with no contact or history authority.

### Assigned scorecards (#23)

The existing application detail Interviews section embeds “Your scorecard” only
for the signed-in user on the active interview assignment. It saves persistent
criterion/rating/evidence drafts and final submissions through registered actions,
and offers immutable version history with earlier-page loading. There is no new
route or staff review override. Assignment IDs come from the authorized interview
list; direct action calls still require exact current ownership and scoped grants.

## Purpose-specific recruiter screens (#94)

The protected layout owns the organization/brand selector and checks workspace
scope before rendering a screen. `/recruiter/overview` is available to all staff;
`/recruiter/vacancies` and `/recruiter/vacancies/:requisitionId`,
`/recruiter/communications`, `/recruiter/playbook`, and `/recruiter/operations`
require owner or recruiter access. `/recruiter/applications` and its exact-ID
detail allow owner, recruiter, and reviewer access. `/recruiter/compliance`
allows owner, recruiter, and auditor access; explicit organisation and brand settings routes are owner-only.
Denied screens and missing scoped resources both render the same 404 view.

Each screen is a distinct route. Vacancy detail uses `get_vacancy_management`
for an exact authorized requisition lookup even when it is older than the recent
100-row list. Application detail uses the existing exact full read for owners
and recruiters, and an assigned reviewer receives the restricted gateway summary.
Application detail links to the communications screen, where a selected
`application_id` is fetched exactly even if it has left the recent list.
Scope changes on detail routes return to the corresponding list. Navigation retains validated `organization_id` and `brand_id` in staff links.

Legacy `/dashboard`, `/admin`, `/applications`, `/applications/:applicationId`,
`/playbook`, and `/admin/{communications,operations,compliance,settings}`
redirect to their canonical `/recruiter/` equivalents while preserving query scope and application IDs. Legacy `application_id` on communications redirects to `/recruiter/communications/:applicationId`.
