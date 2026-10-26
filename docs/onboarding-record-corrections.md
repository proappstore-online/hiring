# Upgrading acceptance and correcting mistaken accepted terms

Migration `0051_onboarding_ledger_upgrade` adds successor acceptance and lifecycle
ledgers, a guarded effective workflow state, and administrative offer corrections.
It does not replace a trigger, rewrite an existing acceptance, or automatically
advance any candidate. The original `0028_candidate_acceptance` definition is
restored and pinned by a historical fixture: editing that migration in #101 did
not update databases that had already applied its paid-only guard.

`record_acceptance` now writes the successor ledger. The same exact application
version, offered stage, approved scoped offer, real candidate acceptance evidence,
human identity and recruiter grant are required for paid and unpaid roles.
Historical acceptances remain readable through the stable reconciliation tools.
Lifecycle transitions use the successor ledger and require registration,
requirements acknowledgement and team handoff evidence before `onboarded`.

An owner can use `correct_accepted_offer` when an already accepted or onboarding
candidate's approved offer was recorded incorrectly. Supply the exact application
version, offer revision, offer lock version and previous correction version, the
actual agreed terms, candidate acceptance evidence, and the reason for correction.
This is an administrative correction of a recorded mistake, not a new offer or
new candidate acceptance. It cannot correct a merely offered candidate, reopen a
terminated application, or authorise dispatch. A correction increments the
application version and appends an audit record; original offer versions and
acceptance evidence remain immutable.

After a write or uncertain response, call `get_offer_correction_result` with the
same payload and operation ID. A changed payload cannot reconcile as success.
`get_offer` returns effective `terms_json`, `original_terms_json`, correction
version and content-free correction metadata. The recruiter view identifies the
correction and can display the original terms. Owner-only `list_offer_corrections`
returns the full correction history. Application reads show the corrected
acceptance evidence while the original acceptance ledger is retained.

All three new ledgers enforce scope, actor, optimistic versions, immutable history,
audit rollback, and erasure/restore fences. Retention verification counts them as
protected records; adding these records never implies subject erasure is complete.

Hiring does not create an Interns membership, accept a calendar invitation, or send
email as a side effect of these tools. Those actions retain their own verified
prerequisites and communication receipts.
