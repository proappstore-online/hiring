# Google Calendar and meeting attendance

PAS owns the reusable Google Calendar/Meet connector and encrypted credentials.
Hiring owns the brand grants, candidate mapping and hourly app-worker job,
`meeting_attendance` (`0 * * * *`, UTC). A PAGS agent can configure/read scoped
attendance through Hiring's registered actions; no agent is needed to run the job.

This implements Serge's 2026-11-04 request using Seedstart's hourly Meet-session
sync and PAGS's platform-held connection / explicit grant pattern as references.
It uses PAS workers and D1 instead of Firebase. PAGS's existing Calendar connector
reads events/RSVPs; actual attendance additionally requires Meet conference and
participant-session access. PAS is independent of PAGS and holds its own tokens.
The connection is read-only: no invitations, calendar edits or hiring decisions.

## Production release verified — 2026-11-05 Australia/Melbourne

PAS owner-worker support is deployed at `d9925f6`: migration, backend health smoke,
CI, related worker deployments and published documentation all succeeded in
[platform run 41885998435](https://github.com/proappstore-online/platform/actions/runs/41885998435).
Hiring `bea7bd2` deployed successfully in
[run 41886840017](https://github.com/proappstore-online/hiring/actions/runs/41886840017),
including its worker, action registration and frontend. Hiring CI and compliance
also passed. The production bundle contains the attendance route and Calendar UI.

The worker is enabled on `loader` and `meeting_attendance` is active hourly.
Manual smoke run `8e60574b-554e-4092-9f47-238e55b3a5e7` succeeded with HTTP 200 at
2026-11-04 18:27:49 UTC. This verifies execution, not Google attendance ingestion.
The FreeAppStore brand currently reports `disconnected`, with no saved Calendar
grant. Scoped reports for this week and last week returned no participant records.
The organizer must personally complete Calendar/Meet consent, select the
FreeAppStore calendar, and then link the intended meeting occurrences to candidates.
The date-based release hold is removed; Google consent and attendance enrollment
remain application setup. Chrome automation became unavailable during the final
check, so a live visual smoke check remains unverified.

## User flow

The recruiter navigation's **More → Attendance** opens `/recruiter/attendance`
with the selected organization/brand scope. The report switches between this
week and last week using Monday boundaries in Australia/Melbourne, groups tracked
participants by occurrence, and links to each candidate's Interview section.
It shows only the two selected FreeAppStore recurring series below, identified by
calendar and series ID rather than title matching. Records are paged in groups
of 100 participant records; one meeting may span pages. Only owners and recruiters
can open the route, and SQL rechecks each participant's current requisition grants
and erasure boundary.

**Recent recorded checks** shows up to 20 observation batches for the selected
meeting week, including errors and counts of superseded configurations. It is not
scheduler run history: idle runs and failures before evidence storage cannot
appear. The screen explicitly leaves scheduler health unverified and distinguishes
unavailable data from an empty report. Future meetings and the reporting grace
period cannot appear as absences. Refresh reads evidence and connection status;
it does not trigger a job. No targets, identities, grants or attendance evidence
are created by opening the report.

### Initial rollout scope (confirmed 2026-11-05)

Track only **FAS Daily Meeting** occurrences on **FreeAppStore Dev Team Calendar**
(`35924e97c4e2ba297a4f4f925584e92ee21229a40a1592870be3414dead9c552@group.calendar.google.com`).
The calendar currently contains morning and afternoon recurring series with this
title; both are in scope. Use the exact calendar and selected event occurrences,
not a title match across other calendars. Other team meetings, interviews and
workshops are outside this rollout.

The requested initial report covers last week (2026-10-26 through 2026-11-01)
and this week (2026-11-02 through 2026-11-08), in Australia/Melbourne time.
Future occurrences must remain scheduled, and attendance requires actual Meet
participant sessions. Older occurrences need a bounded historical backfill beyond
the normal seven-day reconciliation window. This records the requested scope;
it does not activate the worker, create grants or enroll attendance targets.

1. A brand owner opens **Settings → Brand management → Google Calendar** and
   chooses **Connect Google Calendar**.
2. The organizer personally signs in and approves Calendar, Meet and account-email
   access in Google. Hiring shows the connected email and available calendars.
3. Choose the recruiting calendar and save. Access is scoped to this Hiring brand.
4. On a candidate's **Interview** section, open **Meeting attendance → Choose meeting
   from Google Calendar**, select an occurrence, and choose **Track meeting attendance**.
5. Review attendance in the same section. **Pause tracking** stops that target.
   **Disconnect Google Calendar** in settings stops the brand's checks and removes
   its calendar grant. The shared Google account remains connected. Existing attendance evidence is retained.

The meeting picker expands recurring events into individual occurrences for the
past seven days and next thirty days. It does not enroll an entire calendar or
assume that all invited people are candidates. Each tracked occurrence explicitly
belongs to one application. Linked Calendar occurrences are refreshed hourly,
including upcoming meetings, so moving a meeting earlier/later or cancelling it
is reconciled before looking for attendance. Changing the selected calendar pauses
checks of targets from the previous calendar.

Attendance matches a verified Google `users/<numeric id>`. A candidate's linked
PAS Google account is used when available. Staff can specify a verified ID under
**Specify Google identity**. Missing identity, anonymous joins and phone joins
remain unresolved; RSVP, matching names and email invitations are not proof of
attendance. No contacts/directory permission is requested.

## One-time operator setup

On 2026-11-04, deployment of Hiring `0bf3cb1` built successfully and applied
migrations `0071`/`0072`, then stopped before worker/frontend upload because the
worker was disabled. Enabling it returned HTTP 403: `app workers are limited to
first-party apps during the prototype`. The platform checks the registered app
owner against its administrator list. The platform release tracked in
[PAS #267](https://github.com/proappstore-online/platform/issues/267) removes this
prototype restriction through the supported owner deployment flow. No ownership
transfer or change to the platform administrator identities is required.

### Immediate release decision (2026-11-05 Australia/Melbourne)

The owner explicitly waived the remaining 14-day observation wait and directed
immediate release: “not needed anymore, stable enough!” The previously quoted
7 November UTC date came from the Oct 24–Nov 6 observation window recorded in
DuperDash #7 and PAS #306; it was a release policy, not a technical dependency.
That date is no longer a prerequisite for releasing Hiring. This decision does
not assert that the full observation window passed.

Release the tested platform support, then deploy Hiring main through its normal
workflow. Retain ownership authorization, tenant isolation, runtime limits,
conservative quotas and the administrator kill switch. Legacy DuperDash retirement
(PAS #263) and measured quota calibration (PAS #306) remain follow-ups rather than
Hiring release blockers. Do not delete legacy resources as part of this release.
Deployment success, Calendar/Meet consent and an actual attendance smoke check
must each be verified separately; the policy decision alone does not establish them.

Browser setup on 2026-11-04 confirmed **Enabled** for Calendar API and Google Meet
REST API in the `proappstore-online` Google Cloud project. The existing
`proappstore-api` OAuth client has the sign-in callback. The new connector callback
was saved after explicit user approval; Google confirmed “OAuth client saved”.
No client secret was created, copied or changed; no organizer consent was accepted.
Official ownership recovery request `#1` remains `escalated`, but the current
PAS connection for `serge.the.dev@gmail.com` already reports `you: owner` for
Hiring. Recovery is therefore not a prerequisite for this release. Worker
eligibility must be resolved by the supported platform release above.

Before this release, the Hiring refactor was saved to main with `[skip ci]` while
worker upload was explicitly denied. Local build, worker build, SQL/attendance tests and browser
checks passed; the three navigation timeouts in the concurrent full suite passed
when rerun sequentially. The normal main push above has now completed deployment.
Do not re-run the older app-owned-OAuth deployment.

Deploy in this order:

1. PAS connector source is committed as `81186ef`; SDK `1.16.98` is published
   and pinned in Hiring. Backend migration and deployment succeeded in
   [run 41754578858](https://github.com/proappstore-online/platform/actions/runs/41754578858).
   The live callback rejects invalid state with HTTP 400 and `no-store`.
   Existing PAS secrets `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`,
   `APP_SECRET_KEK` and `SESSION_SIGNING_KEY` are reused. No Hiring secrets are needed.
2. Enable Google Calendar API and Google Meet REST API in the PAS Google Cloud
   project. Add this exact redirect to the existing OAuth Web application client:
   `https://api.proappstore.online/v1/connectors/google-calendar/callback`.
   Keep the existing sign-in callback. Configure consent/test users as required.
3. Deploy PAS #267's supported owner worker eligibility, then check
   `pas worker status --app hiring`.
   Deploy Hiring main with the SDK version that includes `connectors.googleCalendar`.
   The workflow uploads the worker and registers the hourly schedule and actions.
4. The organizer personally completes Google consent, then saves a calendar for
   the brand. To smoke-test, track a known attended occurrence, run
   `pas schedule run meeting_attendance --app hiring`, inspect
   `pas schedule runs --app hiring`, and review the candidate's attendance result.

Ordinary PAS Google sign-in does not authorize Calendar/Meet. Requested scopes:
`openid`, `email`, and `calendar.events.readonly`, `calendar.calendarlist.readonly`,
`meetings.space.readonly` under `https://www.googleapis.com/auth/`.
Local tests use synthetic Google responses; they do not prove production consent
or live Google Meet access.

## Connection security and lifecycle

PAS uses PKCE S256 and a random, hashed, ten-minute, one-use state bound to the
initiating PAS user and app. The public PAS callback forwards the code to the
pinned app origin. Its authenticated worker completes the exchange for the same
user. The SPA removes the code from browser history. Credentials use PAS envelope
encryption and remain on the platform; neither tokens nor client secrets reach
Hiring, its database, the browser, action parameters or logs.

Connecting in one app does not authorize another app. Each app must complete its
own OAuth flow before listing the user's calendars or creating exact-calendar
grants. The worker manifest must declare the connector. Grant reads recheck the
app, account version and revocation. Publisher transfer removes app authorization,
pending callbacks and grants. Reconnecting Google increments the account version:
existing grants stop and each affected brand must save its calendar again.

Hiring checks live brand permissions on connection operations. Only brand-wide
owners can connect/select/disconnect; authorized recruiters can browse meetings.
The saved grant must belong to the recorded connecting owner and exact calendar,
so submitting another owner's grant ID through a metadata action grants no access.
Revoking the owner's Hiring permissions stops the job. Disconnect disables the
brand before revoking its grant; other brands and the shared account are unaffected.

Meet reads require an actual occurrence in the granted calendar with the exact
code and current timing. Short-lived signed resource receipts restrict participant
and session queries to records returned by that scoped lookup. Names, emails,
calendar descriptions and raw provider responses are not retained as evidence.

## Job behavior

The job checks at most ten targets per run, oldest checked first. It refreshes
linked upcoming occurrences within thirty days and reconciles completed meetings
for seven days. Meet checks begin fifteen minutes after the meeting ends. Larger
backlogs take multiple runs; review throughput before larger cohorts.

All Meet lists are paginated with a shared 120-call connector budget per invocation and a
10-second request timeout. Calendar listing is capped at five pages of 100 events;
exceeding it reports an error instead of silently truncating. Provider failures,
incomplete sessions and request limits never become absence.

| Status | Meaning |
| --- | --- |
| `scheduled` | Calendar timing refreshed; awaiting the end of the meeting and reporting grace period. |
| `attended` | Matching identity has completed sessions overlapping the expected window. |
| `not_observed` | Complete results contain no overlapping sessions for that identity; recruiter review is required. |
| `identity_unresolved` | Identity is missing, or anonymous/phone participation cannot be attributed. |
| `no_record` | No completed conference is available for the exact meeting code and time. |
| `error` | Connection, authorization, access, rate limit, incomplete sessions, response or request budget failure; see `error_code`. |

Duration is the union of sessions clipped to the expected window. Reconnects and
simultaneous devices cannot double-count time. All overlapping conferences for
that exact code are considered; Seedstart's fallback to a different conference
based only on time overlap is intentionally omitted. Stored evidence includes
duration, first/last presence, conference count, status and check time, without
other attendees' names/emails or raw provider responses. There is no automatic
attendance threshold or hiring rejection/no-show decision.

Provider failures are stored per target and rechecked in a later hourly run;
one failed connection does not stop other brands. Logs contain only run ID and
counts. Scheduler success means the batch ran, not that every Google check worked:
inspect per-target errors. Database failures use PAS delivery retries. Check
identity is `target + configuration version + interview version + event.id`.
Writes recheck scope, grant, connection, enabled state, versions and erasure.

The explicit candidate erasure workflow removes attendance identities and checks
when it writes the scoped tombstone. Erased candidates cannot be re-enrolled.
There is no scheduled age-based purge.

## Registered actions and manual interview tracking

`configure_meeting_attendance` and `list_meeting_attendance` are available to
scoped owners/recruiters and authorized agents. Creation uses `expected_version: 0`;
updates require the current version and a fresh `operation_id`. Set `enabled: 0`
to pause. Configuration writes are audited atomically.

For a Hiring interview, use `kind: interview` and `interview_id`; its current
schedule is authoritative and location must contain the exact Google Meet URL.
Rescheduling invalidates old results. Cancellation, missing time/duration or a
changed Meet link stops checks (`source_ready: 0`). For standalone occurrences,
use `working_interview` or `standup`, null interview ID, exact start/end epoch
milliseconds and the Meet code. Every target must link a Calendar occurrence using
`calendar_id` and `calendar_event_id`, set through the meeting picker. Legacy
manual targets without an event report `calendar_event_required`; they cannot read
unscoped Meet records. API callers
must not fabricate an identity from a participant display name.

## Validation and references

Tests cover real migration/action SQL, grants, cross-brand isolation, erasure,
stale writes, calendar timing/cancellations, pagination and session
aggregation. Platform tests cover OAuth expiry/replay/PKCE, scope denial, encrypted
credentials, app isolation, resource receipts and reconnect/disconnect races. Browser checks cover connection controls and responsive layout.
Live organizer consent and scheduler delivery still require the smoke check above.

- [Google web-server OAuth](https://developers.google.com/identity/protocols/oauth2/web-server)
- [Calendar lists](https://developers.google.com/workspace/calendar/api/v3/reference/calendarList/list)
- [Calendar events](https://developers.google.com/workspace/calendar/api/v3/reference/events/list)
- [Meet conferences and scopes](https://developers.google.com/workspace/meet/api/reference/rest/v2/conferenceRecords/list)
- [Meet participant identity](https://developers.google.com/workspace/meet/api/reference/rest/v2/conferenceRecords.participants)
- [Join/leave sessions](https://developers.google.com/workspace/meet/api/reference/rest/v2/conferenceRecords.participants.participantSessions/list)
