# Structured vacancy terms

New vacancy creation atomically saves explicit terms with the role title. Terms
are never inferred from titles, legacy compensation labels, descriptions or
internship policy records. Existing integrations may still create legacy drafts;
these appear in the explicit review queue and the publishing UI requires review.

In Vacancies, expand **Terms filters, report and backfill review** to filter by
engagement basis, compensation type and programme kind, inspect grouped counts,
and select records needing review. This view reports the latest 100 authorized
vacancies only. Common terms can be applied to selected vacancies; titles and
role-specific descriptions are preserved. Each save is individually atomic and
audited. Bulk failure reports the completed count; refresh before retrying.

For an unpaid volunteer internship, explicitly choose volunteer / internship /
unpaid, enter 8 for both weekly hours, 10 programme weeks and approved as the
weeks basis. No amount or currency is stored for unpaid or other compensation.
Hourly, salary and stipend require a positive amount and three-letter uppercase
currency code. Volunteers cannot use hourly or salary compensation. Internship
and placement programmes require a positive whole-number duration and basis;
ongoing contributions may omit both. Hours must be positive, ordered and at most
168 per week.

Every terms review appends an immutable version with actor, operation and time,
and resets publication review to draft. Publication copies the reviewed terms
into an immutable snapshot. Existing published vacancies can be explicitly
backfilled once; they then have the same immutable terms guarantee. Revisions to
published terms require a new requisition. Public views show reviewed structured
terms and never use a legacy salary paragraph in place of reviewed unpaid terms.

The existing controlled internship publication policy remains: internships stay
unlisted and do not open public intake. Structured engagement and compensation
are independent of that sourcing policy. Legacy public rows without reviewed
terms say that explicit review is needed instead of guessing their terms.
