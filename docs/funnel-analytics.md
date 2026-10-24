# Privacy-safe funnel analytics

The Overview screen and authenticated `get_funnel_analytics` action report fixed,
lifetime application conversion counts for one organization and brand. Every SQL
query requires a current full-brand owner, recruiter, or auditor grant through
`hiring_effective_access`, and an active organization. Requisition-limited grants,
reviewers, candidates, and callers from other brands receive no rows. Authorization
is enforced before aggregation; the browser does not receive candidate records.

## Metric contract

The only parameters are `organization_id` and `brand_id`. There are no candidate,
source, assignee, requisition, or date filters, drilldowns, or exports. Rows contain
only `milestone`, `count`, and `suppressed`:

- `received`: all currently retained applications, including imported applications.
- `reviewed`: reached review or a later positive stage.
- `interviewed`: reached interviewing or decision pending; interviews may be skipped.
- `offered`: reached offered, accepted, or hired.
- `hired`: reached hired.

Current effective stage (`accepted_stage`, then `stage_extension`, then `stage`)
and scoped stage events establish milestone evidence. Each application contributes
at most once per milestone. A subsequent rejection or withdrawal preserves earlier
milestones recorded in stage history. Legacy records without history cannot prove
earlier stages beyond the implications above. These are application counts, not
unique candidate counts, vacancy views, or a time-bounded acquisition cohort.
No new tracking, identifiers, or personal-data copies are created.

## Small-cell suppression

The server groups applications internally by their complete boolean milestone
pattern. If any nonempty pattern contains fewer than **five distinct candidate records**, **all**
counts, including received, become SQL NULL with `suppressed=1`. Otherwise exact
counts and `suppressed=0` are returned. An empty brand returns zero counts.
This conservative rule protects small intersections and complements as well as
individual counts; withholding only one number would allow subtraction from totals.
The UI displays a suppression explanation rather than treating NULL as zero.

This is small-cell suppression, not differential privacy. Repeated observations
as retained data changes and outside knowledge can still reveal changes; staff
must not combine snapshots with candidate-level records to identify people.
No arbitrary filters are offered because overlapping queries would weaken protection.
Erasure and retention follow the canonical application tables: deleted applications
are no longer counted. There is no separate analytics retention store.

## Verification

`tests/funnel-analytics.test.mjs` executes the registered SQL against the real
migrations, covering current grants and cross-brand isolation, unauthorized access,
empty data, four/five boundaries, complementary suppression, small intersections,
historical milestones without repeated counting, and repeated applications from one candidate.

`tests/funnel-analytics-browser.test.mjs` verifies suppression messaging, exact counts,
access denial, and retry after failures without stale displayed numbers.
