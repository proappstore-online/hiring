# Separately consented talent pool

Talent-pool participation permits future contact by the selected brand for 180 days
from affirmative consent. It is separate from application processing and optional
communications consent. The intake checkbox starts unchecked and explains the
period and withdrawal route. Consent evidence records the notice version, actor,
server timestamp and affirmative action. No sourced candidate is pooled by default.

Migration `0043_talent_pool` creates fixed expiry terms for new talent-pool consent
records. Existing historical consent is not enrolled: its notice did not establish
this period. There is no automatic renewal or cross-brand transfer. Expiry removes
participation at read time, including the exact expiry boundary, without relying
on a scheduled cleanup job.

`list_talent_pool` requires current unrestricted owner/recruiter access to the exact
organization and brand. Requisition-only recruiters, reviewers and auditors cannot
browse a brand pool. Pages contain at most 50 candidates ordered by candidate ID;
pass the last ID as `after_id`. Access and expiry are checked again on every page.
The pool joins current canonical candidate details instead of copying personal data,
so corrections apply immediately. It does not authorize automated outreach or
expand existing application grants or communications dispatch permissions.

Candidates see active participation and expiry in My Applications detail and can
use `withdraw_my_talent_pool` to withdraw their talent-pool consent across their
own candidate records in that brand. The server checks account ownership; the
operation writes a scoped audit event atomically. Other purposes and the application
stage remain unchanged. A lost response is reconciled with `get_my_talent_pool`.

Expiry and withdrawal stop future pool access immediately. Original consent evidence
and application records remain under the existing explicit-deletion/hold policy;
expiry does not delete the application or promise automatic data erasure. Pool terms
contain only a consent identifier and expiry, without copied profiles, files or an
external index. Core verified erasure removes these terms immediately, and every
pool query excludes erasure requests and deletion/restore tombstones. Existing
hold review, erasure and retention procedures continue to cover the underlying
candidate and consent records. A restored consent cannot revive an erased pool
while its tombstone exists.

Validation: `tests/talent-pool.test.mjs` covers affirmative consent, historical
exclusion, current brand/grant isolation, ownership, exact expiry, withdrawal,
unchanged independent purposes, canonical correction and erasure.
