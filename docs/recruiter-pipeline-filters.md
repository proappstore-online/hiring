# Recruiter pipeline filters (#74)

The signed-in application list uses `ApplicationFilters.tsx`, `useFilterParams.ts`
and the registered SQL actions in `mcp.json`. The recruiter Overview also shows
current stage counts from `get_current_pipeline`, using the same effective grants
and reviewer-assignment boundary. Stage links open this existing filter component;
counts aggregate the complete authorized scope rather than the capped list.
Historical funnel analytics remain a separate milestone view.

Position/requisition, stage, source, assigned recruiter and submitted-date bounds
are applied in SQL before the existing 100 owner/recruiter or 25 reviewer row limit.
The count describes loaded matches, not an unbounded total. Native select/date
controls support keyboard use; the panel collapses on mobile. Arbitrary existing
source values can be entered; suggested sources are not a new intake allowlist.

Route parameters are `requisition`, `stage`, `source`, `assignee`, `date_from` and
`date_to`, alongside organization/brand scope. Invalid stages/dates are ignored.
Dates are UTC days, with inclusive start and inclusive selected end day (exclusive
next-day bound in SQL). Inverted valid ranges yield no matches. SQL uses epoch
milliseconds; the list converts returned creation timestamps to optional ISO strings.
Existing source remains required on `Application`; requisition and creation fields
are optional for compatibility with existing clients/fixtures.

Candidate-name/source-detail search stays in component memory and never enters the
URL or an action parameter. It persists across filter changes, resets when leaving
the list or changing workspace, and is lost on reload. Shared links restore only
non-text filters. Search applies to the bounded loaded rows; reviewers receive no
source-detail field and can search candidate names only. The source detail is the
existing owner/recruiter-authorized provenance field, not contact context, notes,
email bodies or profile URLs. It is not rendered in list results.

LinkedIn campaign is unavailable: profile URLs identify people and are not campaign
IDs. Onboarding status now filters the latest recorded internship progress from #73.
Invitation date bounds filter the first recorded `invited` event, using UTC days.
Applications without the corresponding evidence do not match; offered/hired
are never used as substitutes. These filters use `onboarding`, `invited_from` and
`invited_to` URL parameters and are applied before row limits. Historical interview stages remain filterable.

Both list actions preserve effective grants and organization/brand scope. Reviewer
queries additionally enforce assignment. The full list now uses tenant-aware joins
like the gateway. Auditors receive no application list. Stale responses are discarded
when filter/scope changes or the component unmounts. Errors suppress old results and
provide Retry; an empty result offers Clear filters.

No index or migration was added. `EXPLAIN QUERY PLAN` against all current migrations
uses `idx_hiring_applications_brand` for both actions. No production row-count evidence
was available to justify an index. Reproduce the plan with:

```sh
PRINT_FILTER_PLAN=1 node --test tests/pipeline-filters.test.mjs
```
