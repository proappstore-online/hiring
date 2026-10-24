# Restricted internship intake (#73)

Internship roles are unlisted. Public job/vacancy lists and detail endpoints exclude
roles classified as internships in a review, publication, or owner configuration.
Generic signed-in application submission rejects them before inserting a candidate.
Existing candidate accounts and passkeys are unchanged; configuration and progress
reads require the current scoped owner/recruiter grant. No anonymous candidate
creation, cross-brand campaign, or generic `linkedin` source bypass is supported.

An owner first approves an invitation template through Communications. It must
contain the exact direct onboarding URL under `https://interns.freeappstore.online/`.
Use the actual Interns onboarding route supplied by the programme owner; Hiring
does not invent a route, provision an Interns account, or transfer candidate data.
Configure its template ID/version and URL under Vacancy Management → Restricted
internship intake. This permanently classifies the requisition as restricted;
create a new configuration/requisition if the approved programme changes.
PD copy should explain recruiter/LinkedIn campaign sourcing and direct Interns
onboarding. Publishing the description does not expose an internship publicly.

Allowed sources:

- `recruiter_sourced`: a recruiter records candidate email, where/when sourced,
  the lawful-basis reference, and how contact details were obtained. The legacy
  authenticated `create_linkedin_application` action is also recruiter sourcing.
- `linkedin_campaign`: an owner explicitly registers the exact campaign ID,
  LinkedIn Campaign Manager URL and approval/notice evidence for this requisition.
  The recruiter supplies that campaign ID during intake. Disabled, unknown,
  sibling-brand and sibling-requisition campaign IDs are rejected server-side.
  No campaigns are enabled by default. A LinkedIn profile URL or arbitrary source
  label is insufficient campaign authorization.

For accepted candidates, use the configured approved invitation in Communications.
Hiring does not auto-send email. Existing MAIL authorization, suppression, template,
connector and idempotency checks still apply. Missing connector approval leaves
mail unsent. Provider acceptance is the existing outbox `sent` state, not proof of
inbox delivery; record that distinction in the evidence reference.

The application retains its backend-compatible pipeline stage. A separate,
append-only, attributed onboarding ledger supplies the internship forward path:
`sourced → invited → onboarding_pending → active`, or an explicit `exception`.
Each transition has an expected version and fixed reason code. `invited` requires
an outbox record with provider acceptance or archived outbound Cloudflare worker
correspondence, with the exact configured approved text and recipient.
Record the Interns application reference before onboarding pending, and verified
onboarding evidence before active. Discord invite pending, username pending and
joined are tracked independently; joined requires a username. Evidence references
are human attestations, not an automated verification of the external Interns app.

New internship interviews and transitions into interviewing are rejected by database
triggers. Recruiter detail shows the onboarding workflow instead of interview,
working-interview and paid-offer prompts. Historical interviews and stage events
remain readable without rewriting them. The onboarding ledger is included in
scoped candidate exports (status and Discord fields; confidential sourcing and
exception evidence remain private) and protected-record deletion verification.
