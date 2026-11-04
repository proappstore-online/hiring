import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import type { Scope } from './api'
import { calendarRequest } from './GoogleCalendar'
import { Section, secondaryButton } from './design-system'
import { LoadingState, ErrorState, EmptyState } from './route-ui'
import { attendanceDate } from './attendance-report'
import { recruiterApplicationUrl } from './routes'

type Meeting = { id: string; title: string; series_id: string; starts_at: number | null; ends_at: number | null; meeting_code: string | null; status: string }
type Match = { application_id: string; candidate_name: string; match_source: string }
type Person = { id: string; name: string; google_user_id: string | null; identity_kind: string; first_join_at: number | null; last_leave_at: number | null; matches: Match[] }
type People = { people: Person[]; conference_count: number; checked_at: number }
type Sessions = { sessions: { name: string; startTime: string; endTime: string }[]; duration_seconds: number; checked_at: number }
const labels: Record<string, string> = { scheduled: 'Scheduled', in_progress: 'In progress', cancelled: 'Cancelled', unavailable: 'No usable Google Meet link', ready: 'View Google records' }
const stamp = (value: number | null) => value === null ? 'Not supplied by Google' : attendanceDate(value)

export function MeetingPeople({ scope, startsAt, endsAt, revision }: { scope: Scope; startsAt: number; endsAt: number; revision: number }) {
  const [result, setResult] = useState<{ meetings: Meeting[]; checked_at: number } | null>(null), [error, setError] = useState(''), [retry, setRetry] = useState(0)
  useEffect(() => {
    let active = true
    setResult(null); setError('')
    void calendarRequest<{ meetings: Meeting[]; checked_at: number }>('/attendance/meetings', scope, { starts_at: startsAt, ends_at: endsAt })
      .then(value => { if (active) setResult(value) }).catch(e => { if (active) setError(e.message) })
    return () => { active = false }
  }, [scope.organization_id, scope.brand_id, startsAt, endsAt, revision, retry])
  return <Section title="All meeting participants">
    <p className="mb-3 text-sm">Open a meeting to read everyone Google Meet recorded, including guests and people without a Hiring profile. Invitations and RSVPs do not establish attendance.</p>
    {error ? <ErrorState retry={() => setRetry(v => v + 1)}>{error}</ErrorState> : !result ? <LoadingState>Loading calendar meetings…</LoadingState> : <>
      <p className="mb-3 text-sm text-[var(--muted)]">{result.meetings.length} meeting occurrences · Calendar read {attendanceDate(result.checked_at)}</p>
      {!result.meetings.length ? <EmptyState>No occurrences of the selected daily meeting series were returned for this week.</EmptyState> : result.meetings.map(meeting => <MeetingRecord key={JSON.stringify([meeting.id, result.checked_at])} scope={scope} meeting={meeting} />)}
    </>}
    <details className="mt-4"><summary className="flex min-h-11 cursor-pointer items-center">How people are associated</summary>
      <p className="mt-2 text-sm">Signed-in participants have a stable Google user ID. An exact match to a candidate’s linked Google account is shown automatically. Previously configured attendance identities appear as explicit links. Multiple matches are shown for review; names are never used to guess identity.</p>
      <p className="mt-2 text-sm">To associate an unlinked person, verify their Google identity, open the candidate’s Interview section → Meeting attendance, choose the meeting, and enter the Google user ID shown here under Specify Google identity. Anonymous and phone participants cannot be reliably linked automatically.</p>
      <p className="mt-2 text-sm">These are live Google records, separate from the hourly checks for tracked candidates below. Google retains Meet conference records for 30 days. First and last sightings include any breaks; use Show join/leave sessions for time actually present within the scheduled meeting.</p>
    </details>
  </Section>
}
function MeetingRecord({ scope, meeting }: { scope: Scope; meeting: Meeting }) {
  const [open, setOpen] = useState(false), [people, setPeople] = useState<People | null>(null), [error, setError] = useState(''), [retry, setRetry] = useState(0)
  useEffect(() => {
    if (!open || meeting.status !== 'ready') return
    let active = true
    setPeople(null); setError('')
    void calendarRequest<People>('/attendance/people', scope, { event_id: meeting.id })
      .then(value => { if (active) setPeople(value) }).catch(e => { if (active) setError(e.message) })
    return () => { active = false }
  }, [open, retry, scope.organization_id, scope.brand_id, meeting.id, meeting.status])
  return <details className="border-t border-[var(--line)] py-3" onToggle={e => setOpen(e.currentTarget.open)}>
    <summary className="min-h-11 cursor-pointer break-words py-2"><span className="font-semibold">{stamp(meeting.starts_at)} · {meeting.title}</span><span className="ml-2 text-sm">{labels[meeting.status]}</span></summary>
    <p className="text-sm text-[var(--muted)] break-all">Calendar occurrence: {meeting.id}{meeting.meeting_code ? ` · Meet ${meeting.meeting_code}` : ''}</p>
    {open && meeting.status === 'ready' && (error ? <ErrorState retry={() => setRetry(v => v + 1)}>{error}</ErrorState> : !people ? <LoadingState>Reading Google Meet participants…</LoadingState> : <>
      <p className="my-3 text-sm">{people.people.length} participant records · {people.conference_count} conference records · Read {attendanceDate(people.checked_at)}</p>
      {!people.conference_count ? <EmptyState>Google returned no conference record. This does not prove that nobody attended.</EmptyState> : !people.people.length ? <EmptyState>Google returned a conference but no participant records. Attendance is unresolved.</EmptyState> : <ul className="divide-y divide-[var(--line)]">{people.people.map(person => <PersonRecord key={person.id} person={person} meeting={meeting} scope={scope} />)}</ul>}
    </>)}
  </details>
}
function PersonRecord({ person, meeting, scope }: { person: Person; meeting: Meeting; scope: Scope }) {
  const [sessions, setSessions] = useState<Sessions | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState('')
  async function load() {
    setBusy(true); setError('')
    try { setSessions(await calendarRequest<Sessions>('/attendance/people', scope, { event_id: meeting.id, participant_id: person.id })) }
    catch (e) { setError(e instanceof Error ? e.message : 'Could not read sessions.') } finally { setBusy(false) }
  }
  return <li className="grid gap-3 py-4 md:grid-cols-2">
    <div><p className="font-semibold break-words">{person.name}</p><p className="text-sm">{person.identity_kind === 'signed_in' ? 'Signed-in Google account' : person.identity_kind === 'phone' ? 'Phone participant' : 'Anonymous participant'}</p>
      {person.google_user_id && <p className="break-all text-sm select-all">Google ID: {person.google_user_id}</p>}
      {!person.matches.length ? <p className="mt-2 text-sm">Not linked to a Hiring record in this workspace.</p> : <ul className="mt-2">{person.matches.map(match => <li key={match.application_id + match.match_source}><Link className="inline-flex min-h-11 items-center underline" to={recruiterApplicationUrl(match.application_id, scope) + '&view=interview'}>{match.candidate_name}</Link><p className="text-sm">{match.match_source === 'google_account' ? 'Exact linked Google account' : 'Explicit attendance identity link'}</p></li>)}</ul>}
      {new Set(person.matches.map(m => m.application_id)).size > 1 && <p className="text-sm">Multiple records match this identity; review the links.</p>}
    </div>
    <div><p className="text-sm">First joined: {stamp(person.first_join_at)}</p><p className="text-sm">Last left: {stamp(person.last_leave_at)}</p>
      {!sessions && <button className={secondaryButton + ' mt-2'} disabled={busy} onClick={() => void load()}>{busy ? 'Reading sessions…' : 'Show join/leave sessions'}</button>}
      {error && <p role="alert" className="mt-2 text-sm">{error}</p>}
      {sessions && <div className="mt-2"><p className="font-medium">{Math.floor(sessions.duration_seconds / 60)}m {sessions.duration_seconds % 60}s present during scheduled meeting</p><ul className="text-sm">{sessions.sessions.map(s => <li key={s.name}>{attendanceDate(Date.parse(s.startTime))} – {attendanceDate(Date.parse(s.endTime))}</li>)}</ul><p className="text-sm text-[var(--muted)]">Overlapping devices and reconnects counted once. Read {attendanceDate(sessions.checked_at)}.</p></div>}
    </div>
  </li>
}
