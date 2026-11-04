import { activeConnection, CalendarError, calendarCall, calendarEvent, calendarOccurrence } from './google-calendar.mjs'
import { platformMeetClient, summarizeSessions } from './meeting-attendance.mjs'

export const selectedCalendar = '35924e97c4e2ba297a4f4f925584e92ee21229a40a1592870be3414dead9c552@group.calendar.google.com'
export const selectedSeries = ['7ggsell6kej1abqp9v030et2ja', '3c69fv935ibfl22p9dpqufapum']
const fail = (code, status = 400) => { throw new CalendarError(code, status) }
const inSeries = event => selectedSeries.includes(event.recurringEventId)
const time = value => Number.isFinite(Date.parse(value)) ? Date.parse(value) : null
async function pages(pas, input) {
  const items = [], seen = new Set(); let page_token = ''
  for (let page = 0; page < 10; page++) {
    const result = await calendarCall(pas, { ...input, page_token })
    if (!Array.isArray(result.items)) fail('google_invalid_response', 502)
    items.push(...result.items)
    page_token = result.nextPageToken ?? ''
    if (!page_token) return items
    if (typeof page_token !== 'string' || seen.has(page_token)) fail('google_invalid_response', 502)
    seen.add(page_token)
  }
  fail('request_budget', 422)
}

// Read-through report: no copied Google identities in a second retention store.
// Each request checks current brand-wide staff access, connecting owner and PAS grant.
export async function handleCalendarReport(request, pas) {
  const url = new URL(request.url)
  if (!url.pathname.startsWith('/attendance/')) return null
  try {
    if (request.method !== 'POST') return new Response('Method not allowed', { status: 405 })
    if (!request.headers.get('content-type')?.startsWith('application/json')) fail('json_required', 415)
    let input
    try { input = await request.json() } catch { fail('invalid_json') }
    if (!input || !['organization_id', 'brand_id'].every(k => typeof input[k] === 'string' && input[k].length > 0 && input[k].length <= 128)) fail('invalid_scope')
    const scope = { organization_id: input.organization_id, brand_id: input.brand_id }
    const connection = await activeConnection(pas, scope)
    if (connection.calendar_id !== selectedCalendar) fail('wrong_calendar', 409)
    let result
    if (url.pathname === '/attendance/meetings') {
      const { starts_at, ends_at } = input, now = Date.now()
      if (!Number.isSafeInteger(starts_at) || !Number.isSafeInteger(ends_at) || starts_at < now - 28 * 86400000 || ends_at > now + 14 * 86400000 || ends_at <= starts_at || ends_at - starts_at > 8 * 86400000) fail('invalid_meeting_window')
      const events = []
      for (const series of selectedSeries) events.push(...await pages(pas, { operation: 'instances', grant_id: connection.connection_id, event_id: series, starts_at, ends_at }))
      const meetings = events.filter(inSeries).flatMap(event => {
        const start = time(event.start?.dateTime), end = time(event.end?.dateTime)
        // Cancelled exceptions sometimes have no timing. Keep them visibly identifiable.
        if (start !== null && (start < starts_at || start >= ends_at)) return []
        const occurrence = calendarOccurrence(event)
        return [{ id: event.id, title: event.summary ?? 'FAS Daily Meeting', series_id: event.recurringEventId,
          starts_at: start, ends_at: end, meeting_code: occurrence?.meeting_code ?? null,
          status: event.status === 'cancelled' ? 'cancelled' : !occurrence ? 'unavailable' : end > now ? (start > now ? 'scheduled' : 'in_progress') : 'ready' }]
      }).sort((a, b) => (b.starts_at ?? 0) - (a.starts_at ?? 0))
      result = { meetings, checked_at: Date.now() }
    } else if (url.pathname === '/attendance/people') {
      if (typeof input.event_id !== 'string' || !selectedSeries.some(s => input.event_id.startsWith(s + '_'))) fail('meeting_out_of_scope', 403)
      const event = await calendarEvent(pas, connection, input.event_id)
      if (event.id !== input.event_id || !inSeries(event)) fail('meeting_out_of_scope', 403)
      const occurrence = calendarOccurrence(event)
      if (!occurrence || occurrence.event_status !== 'confirmed') fail('meeting_unavailable', 409)
      if (occurrence.ends_at > Date.now() || occurrence.starts_at < Date.now() - 28 * 86400000) fail('invalid_meeting_window')
      const client = platformMeetClient(pas, { ...occurrence, calendar_event_id: event.id }, connection, { remaining: 100 })
      const conferences = await client.list('conferenceRecords', 'conferenceRecords'), people = []
      for (const record of conferences) {
        if (!/^conferenceRecords\/[A-Za-z0-9_-]+$/.test(record.name) || time(record.startTime) === null || time(record.endTime) === null) fail('incomplete_sessions', 409)
        if (time(record.startTime) >= occurrence.ends_at || time(record.endTime) <= occurrence.starts_at) fail('google_invalid_response', 502)
        for (const person of await client.list(record.name + '/participants', 'participants')) {
          if (typeof person.name !== 'string' || !person.name.startsWith(record.name + '/participants/')) fail('google_invalid_response', 502)
          const id = person.signedinUser?.user
          people.push({ id: person.name, google_user_id: /^users\/[0-9]+$/.test(id ?? '') ? id : null,
            name: person.signedinUser?.displayName || person.anonymousUser?.displayName || person.phoneUser?.displayName || 'Unnamed participant',
            identity_kind: person.signedinUser ? 'signed_in' : person.phoneUser ? 'phone' : 'anonymous',
            first_join_at: time(person.earliestStartTime), last_leave_at: time(person.latestEndTime),
          })
        }
      }
      if (input.participant_id) {
        if (!people.some(p => p.id === input.participant_id)) fail('participant_not_found', 404)
        const sessions = await client.list(input.participant_id + '/participantSessions', 'participantSessions')
        if (!sessions.length) fail('incomplete_sessions', 409)
        result = { ...summarizeSessions(sessions, occurrence.starts_at, occurrence.ends_at), sessions, checked_at: Date.now() }
      } else {
        const ids = [...new Set(people.map(p => p.google_user_id).filter(Boolean))]
        if (ids.length > 1000) fail('request_budget', 422)
        const matches = (await pas.actions.call('match_calendar_participants', { ...scope, google_user_ids: JSON.stringify(ids) }))?.rows
        if (!Array.isArray(matches) || matches.length > 1000) fail('identity_lookup_failed', 502)
        result = { people: people.map(p => ({ ...p, matches: matches.filter(m => m.google_user_id === p.google_user_id) })), conference_count: conferences.length, checked_at: Date.now() }
      }
    } else return new Response('Not found', { status: 404 })
    // Do not return data after a concurrent disconnect or loss of staff/owner access.
    const current = await activeConnection(pas, scope)
    if (current.connection_id !== connection.connection_id || current.version !== connection.version) fail('connection_changed', 409)
    return Response.json(result, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    const code = error instanceof CalendarError || typeof error?.code === 'string' ? error.code : 'calendar_request_failed'
    return Response.json({ error: code }, { status: error instanceof CalendarError ? error.status : 502, headers: { 'Cache-Control': 'no-store' } })
  }
}
