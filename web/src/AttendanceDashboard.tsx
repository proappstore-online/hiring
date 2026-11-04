import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { read, type Scope } from './api'
import { calendarRequest, type CalendarStatus } from './GoogleCalendar'
import { Page, Section, Toolbar, secondaryButton } from './design-system'
import { EmptyState, ErrorState, LoadingState } from './route-ui'
import { brandSettingsUrl, recruiterApplicationUrl } from './routes'
import { field } from './ui'
import { attendanceDate, attendanceDay, attendanceResult, attendanceSelection, attendanceWeek, type AttendanceRow } from './attendance-report'

type CheckBatch = { event_id: string; started_at: number; checked_at: number; observations: number; attended: number; errors: number; scheduled: number; superseded: number }
type Results<T> = { key: string; rows: T[]; failed: boolean }
const errorHelp: Record<string, string> = {
  google_auth: 'Reconnect the organizer’s Google account.',
  reconnect_required: 'Reconnect Google Calendar and save the calendar again.',
  google_forbidden: 'The organizer’s account needs permission to read this Meet session.',
  incomplete_sessions: 'Google has not returned complete join and leave records. The job will retry.',
  google_rate_limited: 'Google limited the request. The job will retry.',
  request_budget: 'The check reached its request limit. The job will retry.',
  calendar_event_required: 'Link this occurrence from the candidate’s Interview section.',
}

export function AttendanceDashboard({ scope, canManage }: { scope: Scope; canManage: boolean }) {
  const [previous, setPrevious] = useState(false), [offset, setOffset] = useState(0), [revision, setRevision] = useState(0)
  const [now, setNow] = useState(Date.now)
  const window = attendanceWeek(now, previous)
  const periodKey = JSON.stringify([scope, window, revision]), key = periodKey + ':' + offset
  const [result, setResult] = useState<Results<AttendanceRow> | null>(null)
  const [history, setHistory] = useState<Results<CheckBatch> | null>(null)
  const [connection, setConnection] = useState<{ key: string; value: CalendarStatus | null; failed: boolean } | null>(null)
  const connectionKey = JSON.stringify([scope, revision])
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 60000); return () => clearInterval(timer) }, [])
  useEffect(() => {
    let active = true
    void read<AttendanceRow>('list_attendance_overview', { ...scope, ...attendanceSelection, ...window, offset })
      .then(rows => { if (active) setResult({ key, rows, failed: false }) })
      .catch(() => { if (active) setResult({ key, rows: [], failed: true }) })
    return () => { active = false }
  }, [key])
  useEffect(() => {
    let active = true
    void read<CheckBatch>('list_attendance_check_history', { ...scope, ...attendanceSelection, ...window })
      .then(rows => { if (active) setHistory({ key: periodKey, rows, failed: false }) })
      .catch(() => { if (active) setHistory({ key: periodKey, rows: [], failed: true }) })
    return () => { active = false }
  }, [periodKey])
  useEffect(() => {
    let active = true
    void calendarRequest<CalendarStatus>('/google/status', scope)
      .then(value => { if (active) setConnection({ key: connectionKey, value, failed: false }) })
      .catch(() => { if (active) setConnection({ key: connectionKey, value: null, failed: true }) })
    return () => { active = false }
  }, [connectionKey])
  const refresh = () => { setNow(Date.now()); setRevision(v => v + 1) }
  const loaded = result?.key === key, historyLoaded = history?.key === periodKey
  const rows = loaded ? result.rows : [], batches = historyLoaded ? history.rows : []
  const groups = new Map<string, AttendanceRow[]>()
  for (const row of rows) {
    const groupKey = JSON.stringify([row.calendar_event_id, row.starts_at, row.ends_at])
    groups.set(groupKey, [...(groups.get(groupKey) ?? []), row])
  }
  const total = rows[0]?.total_count ?? 0
  const state = connection?.key === connectionKey ? connection : null
  const calendar = state?.value
  const connectionMessage = !state ? 'Checking calendar connection…' : state.failed
    ? 'Calendar service unavailable. Activation or connection could not be verified.'
    : !calendar?.configured ? 'Calendar service needs setup.'
    : calendar.status !== 'connected' ? 'No calendar connected to this brand.'
    : !calendar.owner_active || calendar.connection_valid === false ? 'Calendar connection needs attention.'
    : calendar.calendar_id !== attendanceSelection.calendar_id ? 'A different calendar is connected. Select FreeAppStore Dev Team Calendar to check these meetings.'
    : 'FreeAppStore calendar connection verified.'
  const applicationsUrl = '/recruiter/applications?' + new URLSearchParams(scope)
  return <Page title="Attendance" action={<button className={secondaryButton} onClick={refresh}>Refresh attendance</button>}>
    <p className="text-lg font-medium">FAS Daily Meeting</p>
    <p className="text-sm text-[var(--muted)]">FreeAppStore Dev Team Calendar · Morning and afternoon series · Melbourne time</p>
    <Toolbar label="Attendance period">
      <label>Report period<select className={field} value={previous ? 'last' : 'this'} onChange={e => { setPrevious(e.target.value === 'last'); setOffset(0) }}><option value="this">This week</option><option value="last">Last week</option></select></label>
      <p>{attendanceDay(window.starts_at)} – {attendanceDay(window.ends_at - 1)}</p>
    </Toolbar>
    <Section title="Check status">
      <p role="status">{connectionMessage}</p>
      {calendar?.account_email && <p className="break-words text-sm">Organizer account: {calendar.account_email}</p>}
      {historyLoaded && !history.failed && <p className="mt-2">{batches.length ? `Latest recorded check for this period: ${attendanceDate(batches[0].checked_at)}` : 'No attendance checks recorded for this period.'}</p>}
      <p className="mt-2 text-sm text-[var(--muted)]">Checks are intended to run hourly, starting 15 minutes after a meeting ends. Scheduler health is not available on this screen; recorded checks do not confirm that the job is currently running.</p>
      <div className="mt-2 flex flex-wrap gap-4">
        {canManage && <Link className="inline-flex min-h-11 items-center underline" to={brandSettingsUrl(scope)}>Manage calendar connection</Link>}
        <Link className="inline-flex min-h-11 items-center underline" to={applicationsUrl}>Manage tracked participants</Link>
      </div>
    </Section>
    <Section title="Meeting attendance">
      <p className="mb-3 text-sm">Only explicitly tracked participants appear here. Untracked meetings and people are not counted. Missing evidence is not a confirmed absence.</p>
      {!loaded ? <LoadingState>Loading attendance…</LoadingState> : result.failed ? <ErrorState retry={refresh}>Attendance records could not be loaded. The attendance feature may not be deployed yet, or access may have changed.</ErrorState> : !rows.length ? <EmptyState>{offset > 0 ? 'No more participant records on this page. Return to the previous page.' : 'No tracked participants found for these meeting series in this week. Open a candidate’s Interview section to link a meeting occurrence.'}</EmptyState> : <>
        <p className="mb-3 text-sm text-[var(--muted)]">Showing {offset + 1}–{offset + rows.length} of {total} participant records. A person can appear in more than one meeting.</p>
        {[...groups.entries()].map(([groupKey, people]) => {
          const meeting = people[0]
          return <article key={groupKey} className="border-t border-[var(--line)] py-4">
            <h3 className="font-semibold">{attendanceDate(meeting.starts_at)} – {new Intl.DateTimeFormat('en-AU', { timeZone: 'Australia/Melbourne', hour: 'numeric', minute: '2-digit' }).format(meeting.ends_at)}</h3>
            <p className="text-sm text-[var(--muted)]">FAS Daily Meeting · {meeting.meeting_code}</p>
            <ul className="mt-3 divide-y divide-[var(--line)]">
              {people.map(row => <li key={row.id} className="grid gap-2 py-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
                <div><Link className="inline-flex min-h-11 items-center font-medium underline" to={recruiterApplicationUrl(row.application_id, scope) + '&view=interview'}>{row.candidate_name}</Link>
                  {!row.identity_linked && <p className="text-sm">Google identity needs linking.</p>}</div>
                <div><p className="font-medium">{attendanceResult(row, now)}{row.status === 'attended' && row.ends_at <= now && row.enabled === 1 && row.source_ready === 1 ? ` · ${Math.floor((row.duration_seconds ?? 0) / 60)}m ${(row.duration_seconds ?? 0) % 60}s` : ''}</p>
                  {row.first_join_at != null && row.last_leave_at != null && <p className="text-sm">Present {attendanceDate(row.first_join_at)} – {attendanceDate(row.last_leave_at)}</p>}
                  {row.checked_at != null && <p className="text-sm text-[var(--muted)]">Checked {attendanceDate(row.checked_at)}</p>}
                  {row.error_code && <p className="text-sm">{errorHelp[row.error_code] ?? 'The check could not complete. Review the calendar connection and try again after the next scheduled check.'}</p>}
                  {row.ends_at < now - 7 * 86400000 && <p className="text-sm">Outside the automatic seven-day check window. Historical backfill is required for new evidence.</p>}
                </div>
              </li>)}
            </ul>
          </article>
        })}
      </>}
      {loaded && !result.failed && (offset > 0 || total > 100) && <Toolbar label="Attendance pages"><button className={secondaryButton} disabled={!offset} onClick={() => setOffset(v => Math.max(0, v - 100))}>Previous page</button><button className={secondaryButton} disabled={offset + rows.length >= total} onClick={() => setOffset(v => v + 100)}>Next page</button></Toolbar>}
    </Section>
    <Section title="Recent recorded checks">
      <p className="mb-3 text-sm">Up to 20 batches for meetings in the selected week. Counts include only participants you can access. A batch may contain errors; this is not a record of complete scheduler runs.</p>
      {!historyLoaded ? <LoadingState>Loading check history…</LoadingState> : history.failed ? <ErrorState retry={refresh}>Check history could not be loaded.</ErrorState> : !batches.length ? <EmptyState>No recorded checks for these meetings yet.</EmptyState> : <ul className="divide-y divide-[var(--line)]">{batches.map(batch => <li key={batch.event_id} className="flex flex-wrap justify-between gap-2 py-3"><p>{attendanceDate(batch.checked_at)}</p><div><p>{batch.observations} observations · {batch.attended} attended · {batch.errors} errors · {batch.scheduled} scheduled</p>{batch.superseded > 0 && <p className="text-sm text-[var(--muted)]">{batch.superseded} observations are from earlier meeting configurations.</p>}</div></li>)}</ul>}
    </Section>
  </Page>
}
