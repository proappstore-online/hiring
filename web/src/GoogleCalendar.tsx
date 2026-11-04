import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { app, read, write, type Scope } from './api'
import { ConfirmDialog } from './ConfirmDialog'
import { secondaryButton } from './design-system'
import { button, date, field, panel } from './ui'

type Status = { status: string; account_email: string | null; calendar_id: string | null; calendar_name: string | null; version: number; configured: boolean; owner_active: boolean; can_manage: boolean }
type Calendar = { id: string; name: string; primary: boolean }
type Meeting = { id: string; title: string; starts_at: number; ends_at: number; meeting_code: string }
type Attendance = { source_ready: number; configured_starts_at: number; configured_ends_at: number; id: string; version: number; kind: string; interview_id: string | null; meeting_code: string; starts_at: number; ends_at: number; google_user_id: string | null; calendar_id: string | null; calendar_event_id: string | null; enabled: number; latest_check: string | null }
const messages: Record<string, string> = {
  google_not_configured: 'Google Calendar is not available yet. Ask the app administrator to finish setup.',
  forbidden: 'You do not have access to this calendar connection.',
  reconnect_required: 'Reconnect Google Calendar to restore access.',
  google_auth: 'Google authorization has expired or was revoked. Reconnect Google Calendar.',
  google_forbidden: 'Google did not grant access. Check the organizer account and permissions.',
  missing_google_permissions: 'Calendar and Meet permissions are required. Reconnect and approve both in Google.',
  expired_or_used_callback: 'This connection request has expired or was already used. Start again from brand settings.',
  connection_changed: 'The connection changed. Refresh and try again.',
  select_calendar_first: 'Choose a calendar in brand settings first.',
  google_rate_limited: 'Google is busy. Try again shortly.',
  calendar_too_large: 'This calendar has too many meetings to show. Choose a dedicated recruiting calendar.',
}
async function request<T>(path: string, scope?: Scope, body?: Record<string, unknown>): Promise<T> {
  const suffix = body ? path : path + (scope ? '?' + new URLSearchParams(scope) : '')
  const response = await app.worker.fetch(suffix, body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...scope, ...body }) } : {})
  let result: { error?: string }
  try { result = await response.json() } catch { throw Error('Calendar service is unavailable. Please try again later.') }
  if (!response.ok) throw Error(messages[result.error ?? ''] ?? 'Could not complete the calendar request. Refresh and try again.')
  return result as T
}

export function GoogleCalendarSettings({ scope }: { scope: Scope }) {
  const [open, setOpen] = useState(false)
  return <details className={panel + ' mt-4'} onToggle={e => setOpen(e.currentTarget.open)}><summary>Google Calendar</summary>{open && <CalendarSettingsForm key={JSON.stringify(scope)} scope={scope} />}</details>
}
function CalendarSettingsForm({ scope }: { scope: Scope }) {
  const [status, setStatus] = useState<Status | null>(null), [calendars, setCalendars] = useState<Calendar[]>([])
  const [selected, setSelected] = useState(''), [busy, setBusy] = useState(false), [error, setError] = useState(''), [revision, setRevision] = useState(0)
  const [confirm, setConfirm] = useState(false)
  useEffect(() => {
    let active = true
    setError(''); setStatus(null); setCalendars([])
    void request<Status>('/google/status', scope).then(async state => {
      if (!active) return
      setStatus(state); setSelected(state.calendar_id ?? '')
      if (state.configured && state.status === 'connected' && state.owner_active) {
        const result = await request<{ calendars: Calendar[] }>('/google/calendars', scope)
        if (active) setCalendars(result.calendars)
      }
    }).catch(e => { if (active) setError(e.message) })
    return () => { active = false }
  }, [scope.organization_id, scope.brand_id, revision])
  async function run(action: () => Promise<void>) {
    setBusy(true); setError('')
    try { await action() } catch (e) { setError(e instanceof Error ? e.message : 'Calendar request failed.') } finally { setBusy(false) }
  }
  return <div className="mt-4 space-y-3">
    <p>Link the organizer’s Google account to find meetings and check actual Meet attendance hourly. Access is read-only.</p>
    {error && <p role="alert">{error}</p>}
    {!status && !error && <p role="status">Loading calendar connection…</p>}
    {status && !status.configured && <p role="status">Google Calendar is not available yet. Ask the app administrator to finish setup.</p>}
    {status?.configured && <>
      <p className="break-words">{status.status === 'connected' ? `Connected as ${status.account_email}` : 'No Google Calendar connected.'}</p>
      {status.status === 'connected' && !status.owner_active && <p role="alert">The connection owner no longer has access to this brand. Reconnect to continue.</p>}
      {status.can_manage && <button className={status.status === 'connected' ? secondaryButton : button} disabled={busy} onClick={() => void run(async () => {
        const result = await request<{ authorization_url: string }>('/google/start', scope, {})
        const url = new URL(result.authorization_url)
        if (url.origin !== 'https://accounts.google.com') throw Error('Invalid Google authorization response.')
        window.location.assign(url.href)
      })}>{status.status === 'connected' ? 'Reconnect Google Calendar' : 'Connect Google Calendar'}</button>}
      {status.status === 'connected' && status.owner_active && <form className="space-y-3" onSubmit={e => { e.preventDefault(); void run(async () => { await request('/google/select', scope, { calendar_id: selected, expected_version: status.version }); setRevision(v => v + 1) }) }}>
        <label className="block">Calendar<select aria-label="Calendar" className={field} value={selected} onChange={e => setSelected(e.target.value)} disabled={busy || !status.can_manage} required><option value="">Choose a calendar</option>{calendars.map(c => <option key={c.id} value={c.id}>{c.name}{c.primary ? ' (primary)' : ''}</option>)}</select></label>
        <p className="text-sm">Use a recruiting calendar. Track a specific meeting from the candidate’s Interview section.</p>
        {status.can_manage && <button className={button} disabled={busy || !selected || selected === status.calendar_id}>Save calendar</button>}
      </form>}
      {status.status === 'connected' && status.can_manage && <button type="button" className={secondaryButton + ' mr-3'} disabled={busy} onClick={() => setConfirm(true)}>Disconnect Google Calendar</button>}
    </>}
    <button type="button" className={secondaryButton} disabled={busy} onClick={() => setRevision(v => v + 1)}>Refresh connection</button>
    {confirm && status && <ConfirmDialog title="Disconnect Google Calendar?" body="Attendance checks for this brand will stop and Hiring will remove the saved Google credential. Existing attendance records remain." confirmLabel="Disconnect" onCancel={() => setConfirm(false)} onConfirm={() => { setConfirm(false); void run(async () => { await request('/google/disconnect', scope, { expected_version: status.version }); setRevision(v => v + 1) }) }} />}
  </div>
}

export function GoogleCalendarCallback() {
  const navigate = useNavigate(), pending = useRef<Promise<{ return_to: string }> | null>(null)
  const [parameters] = useState(() => new URLSearchParams(window.location.search))
  const [error, setError] = useState('')
  useEffect(() => {
    let active = true
    // Remove the short-lived authorization code from history and copied URLs.
    window.history.replaceState(window.history.state, '', window.location.pathname)
    if (parameters.has('error')) { setError('Google connection was cancelled. You can try again from brand settings.'); return }
    if (!parameters.get('code') || !parameters.get('state')) { setError('Missing Google connection response. Start again from brand settings.'); return }
    pending.current ??= request('/google/complete', undefined, { code: parameters.get('code'), state: parameters.get('state') })
    void pending.current.then(result => {
      if (!active) return
      if (!/^\/recruiter\/organizations\/[^/]+\/brands\/[^/]+\/settings$/.test(result.return_to)) throw Error('Invalid return route.')
      navigate(result.return_to, { replace: true })
    }).catch(e => { if (active) setError(e.message) })
    return () => { active = false }
  }, [navigate, parameters])
  return <section className={panel}><h1 className="text-2xl font-semibold">Google Calendar</h1>{error ? <><p role="alert">{error}</p><Link className="underline" to="/recruiter/settings">Back to settings</Link></> : <p role="status">Completing Google Calendar connection…</p>}</section>
}

export function MeetingAttendance({ scope, applicationId }: { scope: Scope; applicationId: string }) {
  const [open, setOpen] = useState(false)
  return <details className={panel + ' mt-4'} onToggle={e => setOpen(e.currentTarget.open)}><summary>Meeting attendance</summary>{open && <AttendanceForm key={JSON.stringify([scope, applicationId])} scope={scope} applicationId={applicationId} />}</details>
}
function AttendanceForm({ scope, applicationId }: { scope: Scope; applicationId: string }) {
  const [records, setRecords] = useState<Attendance[]>([]), [meetings, setMeetings] = useState<Meeting[]>([])
  const [selected, setSelected] = useState(''), [identity, setIdentity] = useState(''), [busy, setBusy] = useState(false), [error, setError] = useState(''), [revision, setRevision] = useState(0)
  useEffect(() => {
    let active = true
    setError(''); setRecords([]); setMeetings([])
    void read<Attendance>('list_meeting_attendance', { ...scope, application_id: applicationId }).then(r => { if (active) setRecords(r) }).catch(() => { if (active) setError('Could not load attendance.') })
    return () => { active = false }
  }, [scope.organization_id, scope.brand_id, applicationId, revision])
  async function run(action: () => Promise<void>) { setBusy(true); setError(''); try { await action() } catch (e) { setError(e instanceof Error ? e.message : 'Attendance request failed.') } finally { setBusy(false) } }
  return <div className="mt-4 space-y-3">
    <p>Attendance uses actual Google Meet sessions. Missing or unmatched records require review and do not change the hiring decision.</p>
    {error && <p role="alert">{error}</p>}
    {!records.length && <p>No meetings tracked for this candidate.</p>}
    {records.map(r => { const check = r.latest_check ? JSON.parse(r.latest_check) as { status: string; duration_seconds: number; error_code?: string; checked_at: number } : null; return <article key={r.id} className="border-t border-[var(--line)] py-3"><p>{date(r.starts_at)} · {r.meeting_code}</p><p>{!r.enabled ? 'Tracking paused' : !r.source_ready ? 'Update the interview time and Google Meet location to resume checks.' : check ? `${check.status.replaceAll('_', ' ')}${check.duration_seconds ? ` · ${Math.round(check.duration_seconds / 60)} minutes` : ''}` : 'Awaiting attendance check'}</p>{check?.error_code && <p>{messages[check.error_code] ?? 'Attendance could not be checked; the job will retry.'}</p>}{check && <p className="text-sm">Checked {date(check.checked_at)}</p>}{r.enabled === 1 && <button className={secondaryButton} disabled={busy} onClick={() => void run(async () => { await write('configure_meeting_attendance', { ...scope, application_id: applicationId, target_id: r.id, interview_id: r.interview_id, kind: r.kind, meeting_code: r.meeting_code, starts_at: r.configured_starts_at, ends_at: r.configured_ends_at, google_user_id: r.google_user_id, calendar_id: r.calendar_id, calendar_event_id: r.calendar_event_id, expected_version: r.version, enabled: 0, operation_id: crypto.randomUUID() }); setRevision(v => v + 1) })}>Pause tracking</button>}</article> })}
    <button className={secondaryButton + ' mr-3'} disabled={busy} onClick={() => void run(async () => { const result = await request<{ events: Meeting[] }>('/google/events', scope); setMeetings(result.events); if (!result.events.length) setError('No Google Meet meetings found in the selected calendar.') })}>Choose meeting from Google Calendar</button>
    {!!meetings.length && <form className="space-y-3" onSubmit={e => { e.preventDefault(); void run(async () => { await request('/google/track', scope, { application_id: applicationId, event_id: selected, google_user_id: identity.trim() || null }); setSelected(''); setMeetings([]); setRevision(v => v + 1) }) }}>
      <label className="block">Meeting<select aria-label="Meeting" className={field} required value={selected} onChange={e => setSelected(e.target.value)}><option value="">Choose a meeting</option>{meetings.map(m => <option key={m.id} value={m.id}>{date(m.starts_at)} · {m.title}</option>)}</select></label>
      <p className="text-sm">Uses the candidate’s linked Google account when available. Otherwise identity remains unresolved.</p>
      <details><summary>Specify Google identity</summary><label className="block">Verified Google user ID (optional)<input className={field} value={identity} onChange={e => setIdentity(e.target.value)} placeholder="users/123456789" pattern="users/[0-9]+" /></label></details>
      <button className={button} disabled={busy || !selected}>Track meeting attendance</button>
    </form>}
    <button type="button" className={secondaryButton} disabled={busy} onClick={() => setRevision(v => v + 1)}>Refresh attendance</button>
  </div>
}
