# Google Calendar and meeting attendance

Hiring owns the Google connection and an hourly PAS app worker, `meeting_attendance`
(`0 * * * *`, UTC). A PAGS agent can configure/read scoped attendance through Hiring's
registered actions; credentials and unattended execution belong to the app.

This implements Serge's 2026-11-04 request, using Seedstart's Google OAuth and
hourly Meet-session sync as the reference. It uses PAS workers, encrypted private
worker storage and D1 instead of Firebase/Firestore. The connection is read-only:
no invitations, calendar edits, candidate exports or automatic hiring decisions.
It is separate from the invitation/scheduling work in
[integration-assessment.md](integration-assessment.md).

## User flow

1. A brand owner opens **Settings → Brand management → Google Calendar** and
   chooses **Connect Google Calendar**.
2. The organizer personally signs in and approves Calendar, Meet and account-email
   access in Google. Hiring shows the connected email and available calendars.
3. Choose the recruiting calendar and save. Access is scoped to this Hiring brand.
4. On a candidate's **Interview** section, open **Meeting attendance → Choose meeting
   from Google Calendar**, select an occurrence, and choose **Track meeting attendance**.
5. Review attendance in the same section. **Pause tracking** stops that target.
   **Disconnect Google Calendar** in settings stops the brand's checks and removes
   its saved credential. Existing attendance evidence is retained.

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

Production preflight on 2026-11-04 found the Hiring worker disabled and no app
secrets configured. `pas worker enable hiring` was refused with HTTP 403:
`app workers are limited to first-party apps during the prototype`. A platform
operator must resolve Hiring's eligibility through the supported control plane
before deployment. Do not push this worker while that gate remains closed: the
deployment applies migrations first, then fails at worker upload.

The PAS main branch checked on that date (`e8ed2a0`) supplies app workers,
schedules and app secrets, but its connector manifest accepts only `kind: github`.
Its Google sign-in requests `openid email profile`, and its proxy OAuth support
uses client credentials, not a Calendar user's authorization-code/refresh-token
grant. There is no existing platform Calendar connector to select for this flow.

Local builds do not configure a production Google client, deploy the worker, or
complete the organizer's consent. Before first deployment:

1. A platform administrator enables the app worker: `pas worker enable hiring`.
   Check `pas worker status --app hiring`. The existing deploy workflow refuses
   a worker that is not enabled.
2. Enable the **Google Calendar API** and **Google Meet REST API** in the Google
   Cloud project. Register an OAuth **Web application** client with this exact
   authorized redirect URI:

   `https://hiring.proappstore.online/recruiter/google-calendar/callback`

3. Set three PAS app secrets through the hidden `pas secret set NAME --app hiring`
   prompt, or `--stdin` from the approved secret store:

   - `HIRING_GOOGLE_CLIENT_ID`
   - `HIRING_GOOGLE_CLIENT_SECRET`
   - `HIRING_GOOGLE_TOKEN_KEY`: a cryptographically random 32-byte encryption key,
     encoded as 64 hexadecimal characters. Preserve it; changing it requires
     reconnecting stored accounts.

4. Deploy through main. The workflow applies migrations `0071`/`0072`, builds
   `worker/dist/app.js`, deploys it and registers the schedule/tools. CI also builds
   the worker. No Firebase function or GitHub Actions cron is required.
5. The owner completes the user flow above. For a live smoke check, track a known
   attended meeting, run `pas schedule run meeting_attendance --app hiring`, then
   inspect `pas schedule runs --app hiring` and the candidate's attendance.

No per-organizer refresh tokens need to be manually copied into secrets. Ordinary
PAS Google sign-in is separate and does not itself authorize Calendar/Meet.
Requested scopes are `calendar.readonly`, `meetings.space.readonly` and
`userinfo.email` under `https://www.googleapis.com/auth/`.

## Connection security

OAuth uses PKCE S256 and random state, bound to the initiating PAS user, exact
organization/brand, live owner grant, ten-minute expiry and connection version.
Callback claims are one-use. A stale callback cannot overwrite a reconnect or
undo a disconnect. The SPA callback removes the authorization code from browser
history and posts it to the authenticated app-worker route; refresh/access tokens
never reach the browser or registered-action parameters.

The server exchanges the code, checks granted scopes and the verified account
email, and encrypts the refresh token with AES-256-GCM. The encryption's associated
context includes the exact organization, brand and connection ID, preventing
credential substitution across scopes. Only non-secret connection metadata is in
D1. Private worker storage holds the encrypted credential; app secrets hold the
client secret and encryption key.

All connection operations recheck database permissions. Only brand-wide owners
can connect/select/disconnect; brand-wide owners/recruiters can browse meetings.
Application-scoped attendance actions also enforce requisition grants and erasure.
Revoking the connecting owner's grant stops credential use. Disconnect changes
D1 state before removing the encrypted credential, so a storage cleanup failure
cannot leave the connection active. It unlinks this brand; users can separately
remove Hiring's Google grant in their Google Account connections. Revoking the
Google grant automatically could also invalidate another brand using that account.

## Job behavior

The job checks at most ten targets per run, oldest checked first. It refreshes
linked upcoming occurrences within thirty days and reconciles completed meetings
for seven days. Meet checks begin fifteen minutes after the meeting ends. Larger
backlogs take multiple runs; review throughput before larger cohorts.

All Meet lists are paginated with a shared 180-request invocation budget and a
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
milliseconds and the Meet code. Calendar-linked targets additionally have
`calendar_id` and `calendar_event_id`, set through the meeting picker. API callers
must not fabricate an identity from a participant display name.

## Validation and references

Tests cover real migration/action SQL, grants, cross-brand isolation, erasure,
stale writes, OAuth expiry/replay/PKCE, scope denial, reconnect/disconnect races,
credential encryption, calendar timing/cancellations, pagination and session
aggregation. Browser checks cover connection controls and responsive layout.
Live organizer consent and scheduler delivery still require the smoke check above.

- [Google web-server OAuth](https://developers.google.com/identity/protocols/oauth2/web-server)
- [Calendar lists](https://developers.google.com/workspace/calendar/api/v3/reference/calendarList/list)
- [Calendar events](https://developers.google.com/workspace/calendar/api/v3/reference/events/list)
- [Meet conferences and scopes](https://developers.google.com/workspace/meet/api/reference/rest/v2/conferenceRecords/list)
- [Meet participant identity](https://developers.google.com/workspace/meet/api/reference/rest/v2/conferenceRecords.participants)
- [Join/leave sessions](https://developers.google.com/workspace/meet/api/reference/rest/v2/conferenceRecords.participants.participantSessions/list)
