import { calendarCall, verifyConnection, calendarEvent, calendarOccurrence } from './google-calendar.mjs'

// Actual Google Meet sessions, never calendar RSVP or display-name matching.
// No candidate data or provider response bodies are written to logs.
const codes = new Set(['connection_missing', 'connection_changed', 'invalid_meeting_window', 'connection_invalid', 'google_auth', 'google_forbidden', 'google_not_found', 'google_rate_limited', 'google_unavailable', 'google_invalid_response', 'request_budget', 'incomplete_sessions', 'reconnect_required', 'google_not_configured', 'calendar_event_required', 'meeting_changed', 'meeting_unavailable', 'invalid_resource_receipt', 'calendar_service_failed', 'connector_not_declared'])
export class AttendanceError extends Error {
  constructor(code) { super(code); this.code = code }
}
const fail = code => { throw new AttendanceError(code) }
const resource = (value, pattern) => typeof value === 'string' && pattern.test(value) ? value : fail('google_invalid_response')
const timestamp = value => {
  const n = typeof value === 'string' ? Date.parse(value) : NaN
  return Number.isFinite(n) ? n : fail('google_invalid_response')
}

// A shared budget leaves room inside PAS's 200-call invocation limit for SQL and metadata.
export function platformMeetClient(pas, target, connection, budget = { remaining: 120 }) {
  const receipts = new Map()
  return {
    async list(path, field) {
      if (!target.calendar_event_id) fail('calendar_event_required')
      const operation = path === 'conferenceRecords' ? 'conferences' : path.endsWith('/participantSessions') ? 'sessions' : path.endsWith('/participants') ? 'participants' : fail('google_invalid_response')
      const resource = path.slice(0, path.lastIndexOf('/'))
      const params = operation === 'conferences'
        ? { event_id: target.calendar_event_id, starts_at: target.starts_at, ends_at: target.ends_at, meeting_code: target.meeting_code }
        : { resource, receipt: receipts.get(resource) }
      const all = [], seen = new Set()
      let page_token = ''
      do {
        if (--budget.remaining < 0) fail('request_budget')
        const data = await calendarCall(pas, { operation, grant_id: connection.connection_id, ...params, page_token })
        if (data[field] !== undefined && !Array.isArray(data[field])) fail('google_invalid_response')
        for (const item of data[field] ?? []) {
          if (item.receipt && item.name) receipts.set(item.name, item.receipt)
          all.push(item)
        }
        page_token = data.nextPageToken ?? ''
        if (typeof page_token !== 'string' || (page_token && seen.has(page_token))) fail('google_invalid_response')
        seen.add(page_token)
      } while (page_token)
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

export async function observeAttendance(target, client) {
  const empty = { duration_seconds: 0, first_join_at: null, last_leave_at: null, conference_count: 0 }
  if (!target.google_user_id) return { ...empty, status: 'identity_unresolved' }
  const records = await client.list('conferenceRecords', 'conferenceRecords')
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
    const participants = await client.list(name + '/participants', 'participants')
    if (!participants.length) fail('incomplete_sessions')
    for (const participant of participants) {
      if (!participant.signedinUser?.user) unknownParticipants = true
      if (participant.signedinUser?.user !== target.google_user_id) continue
      matched = true
      const participantName = resource(participant.name, /^conferenceRecords\/[A-Za-z0-9_-]+\/participants\/[A-Za-z0-9_-]+$/)
      if (!participantName.startsWith(name + '/participants/')) fail('google_invalid_response')
      sessions.push(...await client.list(participantName + '/participantSessions', 'participantSessions'))
    }
  }
  if (matched && !sessions.length) fail('incomplete_sessions')
  const summary = summarizeSessions(sessions, target.starts_at, target.ends_at)
  return { ...summary, conference_count: seenRecords.size, status: summary.duration_seconds > 0 ? 'attended' : unknownParticipants ? 'identity_unresolved' : 'not_observed' }
}

export async function checkMeetingAttendance(event, pas) {
  const response = await pas.actions.call('worker_list_due_attendance', { event_id: event.id })
  if (!Array.isArray(response?.rows)) throw new Error('Attendance query failed')
  if (!response.rows.length) return
  const budget = { remaining: 120 }, connections = new Map()
  let errors = 0, checked = 0
  for (const initialTarget of response.rows) {
    let target = initialTarget, result, connection
    try {
      const key = JSON.stringify([target.organization_id, target.brand_id])
      if (!connections.has(key)) {
        const current = await pas.actions.call('worker_get_google_calendar_connection', { organization_id: target.organization_id, brand_id: target.brand_id })
        const c = current?.rows?.[0]
        if (!c) continue // Disconnected/revoked since queue discovery.
        connections.set(key, { connection: c, verified: verifyConnection(pas, c) })
      }
      const cached = connections.get(key)
      connection = cached.connection
      await cached.verified
      if (target.calendar_event_id) {
        if (connection.calendar_id !== target.calendar_id) continue
        const occurrence = calendarOccurrence(await calendarEvent(pas, connection, target.calendar_event_id))
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
        : await observeAttendance(target, platformMeetClient(pas, target, connection, budget))
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
