# Routing foundation (UI-1, #63)

React Router 6 BrowserRouter owns navigation. Public routes `/`, `/jobs`,
`/jobs/:jobId`, `/apply/:jobId` and `/sign-in` share an app-branded public
header. Public discovery does not wait for authentication hydration. Recruiter
routes `/dashboard`, `/applications` and `/applications/:applicationId` use
an authenticated ProShell with `branding="app"`. Dashboard and applications
currently reuse the existing workspace; richer pipeline views belong to UI-2.
Unknown routes show a public 404. Render errors are caught per destination;
loading, empty and recoverable fetch failures have distinct presentations.

Protected destinations redirect to `/sign-in?returnTo=…`; only local dashboard
and application destinations are accepted on return. OAuth continues through the
SDK's existing provider flow; this change does not implement token exchange.

Generated vacancy links include `organization_id` and `brand_id` query fields
beside the job ID in the pathname. Bare `/jobs/:jobId` and `/apply/:jobId`
resolve scope through paginated public summaries, then fetch the exact public
snapshot. A supplied incorrect scope is never replaced with another scope.
Generated recruiter links likewise include exact organization and brand IDs;
links without scope use the user's default workspace. No candidate name,
contact information or secret appears in generated URLs.

All authorization remains in the existing registered server actions. The full
recruiter workspace list returns at most 100 recent records. Direct links use
`get_application` for full owner/recruiter detail independent of that limit.
Assigned reviewers use `gateway_get_application`, which supplies a restricted
summary without contact or history fields. Missing and unauthorized records
share the same 404 UI.
Scope/destination changes remount loaded state; in-flight loads cannot populate
the next destination. Scoped APIs and intake/attachment gates are unchanged.

Vite uses `appType: 'spa'`; Workbox uses `/index.html` as navigation fallback,
keeping `/.pas/` excluded. The existing production host returned app HTML and
HTTP 200 for a fresh nested `/jobs/route-probe` request on 22 October 2026.
This verifies host fallback, not deployment of this branch. Tests exercise fresh
nested loads locally with the actual route tree and synthetic SDK/API fixtures.

Legacy `?view=jobs` routing has been removed. Replace saved links with `/jobs`
or scoped `/jobs/:jobId` links. Browser links, refresh, back/forward and keyboard
navigation use real URLs. Navigation includes a skip link, main landmark focus
and current-page navigation indicators.

This delivery uses a branch and PR under the owner's explicit instruction;
older direct-to-main documentation does not apply to this delivery. No merge,
deployment or opening of intake is authorized by UI-1.

## Vacancies foundation (#68)

Public `/vacancies` and `/vacancies/:vacancyId` add discovery and structured PDs;
canonical shared links retain organization/brand scope. Existing job/application
routes remain intact. Signed-in navigation includes Vacancies; owner/recruiter
workspaces include Vacancy Management with lifecycle states and PD editing.
See [PD contracts and non-executing mapping plan](vacancies-mapping-plan.md).

## Exact recruiter application detail (#20)

`/applications/:applicationId` now loads `get_application` directly, independent
of the 100-record queue. It returns full details only for current owner/recruiter
access to the exact organization, brand and requisition. Missing and unauthorized
IDs both return no rows. Assigned reviewers retain the restricted
`gateway_get_application` fallback, with no contact or history authority.
