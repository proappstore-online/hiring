# Attendance moved to Interns

Daily FAS meeting attendance belongs to the internship program and is now
implemented in the **Interns** app, under **FreeAppStore.online → Workspace →
Attendance**. The Hiring attendance URL links there for old bookmarks.

Hiring no longer declares a Calendar connector, attendance actions or a scheduled
attendance job. Its retired worker returns HTTP 410 and does no work for queued
legacy scheduled deliveries. Calendar controls were removed from candidate and
brand settings. Google sign-in for Hiring remains available as before.

Applied migrations 0071 and 0072 are preserved. Their historical tables are not
deleted or moved; existing Hiring candidates and applications are untouched.
The previous production reports had no tracked candidate evidence to migrate.
Google's meeting records can be read again in Interns within provider retention.

PAS retains the reusable connector. OAuth grants are app-specific: the owner must
personally connect Google inside Interns and save the exact calendar. Do not copy
Hiring grants, credentials, or candidate records into Interns. Revoke only the
old Hiring calendar grant; do not disconnect the shared Google account globally.

Implementation and operational guidance now live in the Interns repository's
`docs/meeting-attendance.md`.
