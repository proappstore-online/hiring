# Recruiter dashboard and pipeline

The dashboard and application pipeline use the authorized workspace selected in the UI.
Owners and recruiters see records permitted by their organization, brand and requisition grants.
Reviewers see only the redacted, assignment-scoped gateway summaries. Auditors have an
application-reference lookup for authorized audit history, without candidate records or mutations.

Dashboard counts and requisition counts cover the most recent 100 authorized applications,
not organization-wide totals. Reviewer counts cover the first 25 assigned gateway records.
The UI states these bounds. No candidate names appear in summary cards.

Stage, requisition, assignee, attention and grouping filters use URL query parameters.
Candidate-name search stays in memory and is never written to the URL or browser storage.
Application links retain organization and brand scope. Filters apply only to loaded records.
Assignees are displayed using staff IDs because the member API supplies no display names.

Full application detail keeps the existing versioned mutations and history. Workspace tools
retain candidate creation and administration. Publication controls remain owner-only.
No interview scheduling, scorecard, or offer approval capability is implied by stage counts.
