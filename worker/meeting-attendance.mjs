import { getConnectionToken, calendarEvent, calendarOccurrence } from './google-calendar.mjs'

// Actual Google Meet sessions, never calendar RSVP or display-name matching.
// No candidate data or provider response bodies are written to logs.
const codes = new Set(['connection_missing', 'connection_invalid', 'google_auth', 'google_forbidden', 'google_not_found', 'google_rate_limited', 'google_unavailable', 'google_invalid_response', 'request_budget', 'incomplete_sessions', 'reconnect_required', 'google_not_configured'])
export class AttendanceError extends Error {
  constructor(code) { super(code); this.code = code }
}
const fail = code => { throw new AttendanceError(code) }
const resource = (value, pattern) => typeof value === 'string' && pattern.test(value) ? value : fail('google_invalid_response')
const timestamp = value => {
  const n = typeof value === 'string' ? Date.parse(value) : NaN
  return Number.isFinite(n) ? n : fail('google_invalid_response')
}

// A shared invocation budget bounds all pagination and retries. Reaching it is
// an error, never evidence that an expected participant was absent.
export function googleClient(fetchImpl = fetch, maxRequests = 180) {
  let remaining = maxRequests
  async function json(url, init = {}) {
    if (--remaining < 0) fail('request_budget')
    let response
    try { response = await fetchImpl(url, { ...init, redirect: 'error', signal: AbortSignal.timeout(10_000) }) }
    catch { fail('google_unavailable') }
    if (!response.ok) {
      fail(({400: 'google_auth', 401: 'google_auth', 403: 'google_forbidden', 404: 'google_not_found', 429: 'google_rate_limited'})[response.status] ?? 'google_unavailable')
    }
    try {
      const value = await response.json()
      if (!value || typeof value !== 'object' || Array.isArray(value)) fail('google_invalid_response')
      return value
    } catch { fail('google_invalid_response') }
  }
  return {
    async list(path, field, token, params = {}) {
      const all = [], seen = new Set()
      let pageToken = ''
      do {
        const url = new URL('https://meet.googleapis.com/v2/' + path)
        url.search = new URLSearchParams({ pageSize: '100', ...params, ...(pageToken ? { pageToken } : {}) }).toString()
        const data = await json(url, { headers: { Authorization: 'Bearer ' + token } })
        if (data[field] !== undefined && !Array.isArray(data[field])) fail('google_invalid_response')
        all.push(...(data[field] ?? []))
        pageToken = data.nextPageToken ?? ''
        if (typeof pageToken !== 'string' || (pageToken && seen.has(pageToken))) fail('google_invalid_response')
        seen.add(pageToken)
      } while (pageToken)
      return all
    },
  }
}

// Merge reconnects and simultaneous devices, then clip to the expected window.
export function summarizeSessions(sessions, startsAt, endsAt) {
  const intervals = sessions.map(s => {
    if (!s.endTime) fail('incomplete_sessions')
    const start = timestamp(s.startTime), end = timestamp(s.endTime)
    if (end < start) fail('google_invalid_response')
    return [Math.max(start, startsAt), Math.min(end, endsAt)]
  }).filter(([start, end]) => end > start).sort((a, b) => a[0] - b[0])
  const merged = []
  for (const [start, end] of intervals) {
    const last = merged.at(-1)
    if (last && start <= last[1]) last[1] = Math.max(last[1], end)
    else merged.push([start, end])
  }
  const duration_seconds = Math.floor(merged.reduce((n, [s, e]) => n + e - s, 0) / 1000)
  return {
    duration_seconds,
    first_join_at: duration_seconds ? merged[0][0] : null,
    last_leave_at: duration_seconds ? merged.at(-1)[1] : null,
  }
}

export async function observeAttendance(target, client, token) {
  const empty = { duration_seconds: 0, first_join_at: null, last_leave_at: null, conference_count: 0 }
  if (!target.google_user_id) return { ...empty, status: 'identity_unresolved' }
  const filter = `space.meeting_code = "${target.meeting_code}" AND start_time < "${new Date(target.ends_at).toISOString()}" AND end_time > "${new Date(target.starts_at).toISOString()}"`
  const records = await client.list('conferenceRecords', 'conferenceRecords', token, { filter })
  if (!records.length) return { ...empty, status: 'no_record' }
  const sessions = [], seenRecords = new Set()
  let unknownParticipants = false, matched = false
  for (const record of records) {
    const name = resource(record.name, /^conferenceRecords\/[A-Za-z0-9_-]+$/)
    if (seenRecords.has(name)) continue
    seenRecords.add(name)
    // Never fall back to another meeting based on time overlap alone.
    if (!record.endTime) fail('incomplete_sessions')
    if (timestamp(record.startTime) >= target.ends_at || timestamp(record.endTime) <= target.starts_at) fail('google_invalid_response')
    const participants = await client.list(name + '/participants', 'participants', token)
    if (!participants.length) fail('incomplete_sessions')
    for (const participant of participants) {
      if (!participant.signedinUser?.user) unknownParticipants = true
      if (participant.signedinUser?.user !== target.google_user_id) continue
      matched = true
      const participantName = resource(participant.name, /^conferenceRecords\/[A-Za-z0-9_-]+\/participants\/[A-Za-z0-9_-]+$/)
      if (!participantName.startsWith(name + '/participants/')) fail('google_invalid_response')
      sessions.push(...await client.list(participantName + '/participantSessions', 'participantSessions', token))
    }
  }
  if (matched && !sessions.length) fail('incomplete_sessions')
  const summary = summarizeSessions(sessions, target.starts_at, target.ends_at)
  return { ...summary, conference_count: seenRecords.size, status: summary.duration_seconds > 0 ? 'attended' : unknownParticipants ? 'identity_unresolved' : 'not_observed' }
}

export async function checkMeetingAttendance(event, pas, { fetchImpl = fetch, tokenForConnection = getConnectionToken } = {}) {
  const response = await pas.actions.call('worker_list_due_attendance', { event_id: event.id })
  if (!Array.isArray(response?.rows)) throw new Error('Attendance query failed')
  if (!response.rows.length) return
  const client = googleClient(fetchImpl), connections = new Map()
  let errors = 0, checked = 0
  for (const initialTarget of response.rows) {
    let target = initialTarget, result, connection
    try {
      const key = JSON.stringify([target.organization_id, target.brand_id])
      if (!connections.has(key)) {
        const current = await pas.actions.call('worker_get_google_calendar_connection', { organization_id: target.organization_id, brand_id: target.brand_id })
        const c = current?.rows?.[0]
        if (!c) continue // Disconnected/revoked since queue discovery.
        connections.set(key, { connection: c, token: tokenForConnection(pas, c, fetchImpl) })
      }
      const cached = connections.get(key)
      connection = cached.connection
      const token = await cached.token
      if (target.calendar_event_id) {
        if (connection.calendar_id !== target.calendar_id) continue
        const occurrence = calendarOccurrence(await calendarEvent(target.calendar_id, target.calendar_event_id, token, fetchImpl))
        const refresh = await pas.actions.call('worker_refresh_calendar_attendance', {
          target_id: target.id, organization_id: target.organization_id, brand_id: target.brand_id,
          expected_version: target.version, connection_id: connection.connection_id,
          ...(occurrence ?? { event_status: 'cancelled', starts_at: 0, ends_at: 1, meeting_code: '' }),
        })
        if (refresh?.meta?.changes) {
          // Re-read through the same due/grant/erasure filters after a reschedule.
          const refreshed = await pas.actions.call('worker_list_due_attendance', { event_id: event.id })
          target = refreshed?.rows?.find(t => t.id === target.id)
          if (!target) continue
        }
      }
      result = target.attendance_due === 0
        ? { status: 'scheduled', duration_seconds: 0, first_join_at: null, last_leave_at: null, conference_count: 0 }
        : await observeAttendance(target, client, token)
    } catch (error) {
      if (!codes.has(error?.code)) throw new Error('Attendance storage operation failed')
      errors++
      result = { status: 'error', error_code: codes.has(error?.code) ? error.code : 'google_unavailable', duration_seconds: 0, first_join_at: null, last_leave_at: null, conference_count: 0 }
    }
    if (!connection) continue
    await pas.actions.call('worker_record_attendance', {
      target_id: target.id, organization_id: target.organization_id, brand_id: target.brand_id,
      expected_version: target.version, source_version: target.source_version, connection_id: connection.connection_id,
      event_id: event.id, ...result, error_code: result.error_code ?? null,
    })
    checked++
  }
  await pas.log(errors ? 'warn' : 'info', 'Meeting attendance checked', { run: event.id, checked, errors })
  // Provider failures are durably visible per target and retried on the next
  // hourly run. Database failures throw for the platform's delivery retries.
}
