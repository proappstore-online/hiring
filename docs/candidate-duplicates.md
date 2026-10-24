# Duplicate review and merge (#21)

Email is a review signal, never an identity or authorization credential. The application
profile exposes a “Check duplicates and merge history” control for owners and recruiters.
Suggestions compare nonempty, trimmed, case-insensitive email addresses, within the exact
organization and brand. Both candidates must have an application readable under the
caller's current owner/recruiter grants. Results are bounded to 50 records. No cross-brand
search, counts, matching hints or automatic mutation occurs. Candidate self-service
accounts and tokens are never linked by email.

Only a brand-wide owner may merge. Review the two profiles, select the source for each
canonical field (name, email, phone and LinkedIn URL), enter a reason and explicitly
confirm. The registered `merge_candidates` action requires PAS WebAuthn step-up as well
as a current SQL owner grant. A caller-supplied confirmation flag grants no authority.
Register a passkey using the control beside duplicate review if needed.

Migration `0033_candidate_duplicates` records a logical merge: the source candidate's
`merged_into` identifies the canonical target. Each pair can merge once; chains, cycles,
repeat merges and merging an already-used target are rejected. This intentionally limits
review to disjoint pairs. A further consolidation needs a separately designed workflow.
Email equality is not required for the authorized action; the human determines identity.
The current application candidate is the target; the selected suggestion is the source.

The immutable merge record stores original candidate IDs, per-field source IDs, actor,
time, reason and operation ID. Owner-only history resolves the canonical profile from
these sources. It stores no additional profile-value snapshot. Original application
candidate IDs, source records, notes, consents, candidate receipts, attachments, stages
and permissions remain intact. The original profile remains visible in the application;
the owner sees the canonical profile and field sources in merge history. Merging never
expands recruiter or candidate access or transfers an application to a different account.

Merge insertion, canonical link and redacted audit event execute atomically through a
trigger. Audit failure rolls back all three. Operation-ID collisions, replay, missing or
foreign candidates, invalid field sources, blank reason and candidates with erasure
requests write nothing. Erasure subsequently redacts the original fields used by the
canonical view; no retained snapshot can reintroduce their values. Reasons should use
opaque review references rather than copying personal data. Rights reviews must consider
both preserved records; merging does not itself fulfill a rights request.

The browser confirms success by reading the durable operation ID, including when the
mutation response is lost. Unconfirmed operations display an error and require a fresh
review of current suggestions/history. Runtime step-up is enforced by PAS; SQL tests
verify the registered requirement and simulate database authorization separately.
