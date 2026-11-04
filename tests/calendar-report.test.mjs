import { test } from 'node:test'
import assert from 'node:assert/strict'
import { handleCalendarReport, selectedCalendar, selectedSeries } from '../worker/calendar-report.mjs'
import { handleGoogleCalendar } from '../worker/google-calendar.mjs'
import { calendarFixture, calendarScope as scope } from './calendar-fixture.mjs'

async function setup() {
  const f = calendarFixture(), now = Date.now(), calls = []
  f.google.connected = true
  const selected = await handleGoogleCalendar(new Request('https://hiring.test/google/select', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...scope, calendar_id: selectedCalendar, expected_version: 0 }) }), f.pas)
  assert.equal(selected.status, 200)
  const event = { id: selectedSeries[0] + '_occurrence', recurringEventId: selectedSeries[0], summary: 'FAS Daily Meeting', start: { dateTime: new Date(now - 7200000).toISOString() }, end: { dateTime: new Date(now - 3600000).toISOString() }, hangoutLink: 'https://meet.google.com/abc-defg-hij' }
  const person = { name: 'conferenceRecords/c1/participants/p1', signedinUser: { user: 'users/123456', displayName: 'Same name' }, earliestStartTime: event.start.dateTime, latestEndTime: event.end.dateTime, receipt: 'p1' }
  const connector = f.pas.connectors.googleCalendar
  let override
  f.pas.connectors.googleCalendar = async (name, input) => {
    calls.push(input)
    if (override) { const value = await override(input); if (value !== undefined) return value }
    if (input.operation === 'instances') return { items: input.event_id === selectedSeries[0] ? [event] : [], nextPageToken: null }
    if (input.operation === 'event') return event
    if (input.operation === 'conferences') return { conferenceRecords: [{ name: 'conferenceRecords/c1', startTime: event.start.dateTime, endTime: event.end.dateTime, receipt: 'c1' }] }
    if (input.operation === 'participants') return { participants: [person, { name: 'conferenceRecords/c1/participants/p2', anonymousUser: { displayName: 'Same name' }, receipt: 'p2' }] }
    if (input.operation === 'sessions') return { participantSessions: [{ name: 's1', startTime: event.start.dateTime, endTime: event.end.dateTime }, { name: 's2', startTime: event.start.dateTime, endTime: event.end.dateTime }] }
    return connector(name, input)
  }
  const request = async (path, body = {}) => {
    const response = await handleCalendarReport(new Request('https://hiring.test/attendance/' + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...scope, ...body }) }), f.pas)
    return { status: response.status, data: await response.json(), cache: response.headers.get('Cache-Control') }
  }
  return { ...f, event, person, request, calls, now, override: fn => { override = fn } }
}
test('meeting-first report lists exact series and every provider participant, without enrollment or name matching', async () => {
  const f = await setup()
  try {
    const list = await f.request('meetings', { starts_at: f.now - 86400000, ends_at: f.now })
    assert.equal(list.status, 200); assert.equal(list.cache, 'no-store'); assert.equal(list.data.meetings.length, 1)
    assert.deepEqual(f.calls.filter(x => x.operation === 'instances').map(x => x.event_id), selectedSeries)
    const result = await f.request('people', { event_id: f.event.id })
    assert.equal(result.status, 200); assert.equal(result.data.people.length, 2)
    assert.equal(result.data.people[0].google_user_id, 'users/123456'); assert.equal(result.data.people[1].identity_kind, 'anonymous')
    assert.deepEqual(result.data.people.map(p => p.matches), [[], []])
    assert.equal(JSON.stringify(result.data).includes('receipt'), false)
    const sessions = await f.request('people', { event_id: f.event.id, participant_id: f.person.name })
    assert.equal(sessions.data.duration_seconds, 3600); assert.equal(sessions.data.sessions.length, 2)
    assert.equal((await f.request('people', { event_id: f.event.id, participant_id: 'conferenceRecords/other/participants/p1' })).status, 404)
  } finally { f.db.close() }
})
test('report requires current brand-wide staff, exact calendar and series, and bounded dates', async () => {
  const f = await setup()
  try {
    for (const user of ['owner-b', 'outsider', 'reviewer', 'auditor', 'scoped', 'system:worker']) {
      f.as(user); const before = f.calls.length
      assert.equal((await f.request('people', { event_id: f.event.id })).status, 403)
      assert.equal(f.calls.length, before)
    }
    f.as('owner-a')
    assert.equal((await f.request('people', { event_id: 'different-series_123' })).status, 403)
    assert.equal((await f.request('meetings', { starts_at: f.now - 29 * 86400000, ends_at: f.now })).status, 400)
    f.event.recurringEventId = 'wrong-series'
    assert.equal((await f.request('people', { event_id: f.event.id })).status, 403)
    f.db.exec("UPDATE hiring_google_calendar_connections SET calendar_id='wrong' WHERE brand_id='brand-a'")
    assert.equal((await f.request('meetings', { starts_at: f.now - 86400000, ends_at: f.now })).status, 403)
  } finally { f.db.close() }
})
test('pagination is complete or an explicit failure, never silent empty attendance', async () => {
  const f = await setup()
  try {
    f.override(input => input.operation === 'participants' ? { participants: input.page_token ? [{ ...f.person, name: 'conferenceRecords/c1/participants/p3' }] : [f.person], nextPageToken: input.page_token ? null : 'second' } : undefined)
    assert.equal((await f.request('people', { event_id: f.event.id })).data.people.length, 2)
    f.override(input => input.operation === 'participants' ? { participants: [f.person], nextPageToken: 'repeated' } : undefined)
    const invalid = await f.request('people', { event_id: f.event.id })
    assert.equal(invalid.status, 502); assert.equal(invalid.data.error, 'google_invalid_response'); assert.equal(invalid.data.people, undefined)
    f.override(input => input.operation === 'conferences' ? { error: 'google_forbidden', status: 502 } : undefined)
    assert.equal((await f.request('people', { event_id: f.event.id })).data.error, 'google_forbidden')
    f.override(input => input.operation === 'conferences' ? { conferenceRecords: [] } : undefined)
    assert.equal((await f.request('people', { event_id: f.event.id })).data.conference_count, 0)
    f.override(input => { if (input.operation === 'participants') f.db.exec("UPDATE hiring_google_calendar_connections SET status='disconnected' WHERE brand_id='brand-a'"); return undefined })
    assert.equal((await f.request('people', { event_id: f.event.id })).status, 409)
  } finally { f.db.close() }
})
test('candidate association is exact and erasure/brand-wide grants are enforced', async () => {
  const f = await setup()
  try {
    f.db.exec("INSERT INTO hiring_worker_profiles(user_id,display_name,created_at,updated_at) VALUES('google:123456','Candidate',0,0); UPDATE hiring_candidates SET worker_user_id='google:123456' WHERE id='candidate-a'")
    const params = { ...scope, google_user_ids: JSON.stringify(['users/123456', 'users/999']) }
    assert.equal(f.call('match_calendar_participants', params).rows[0].application_id, 'app-a')
    assert.equal((await f.request('people', { event_id: f.event.id })).data.people[0].matches[0].match_source, 'google_account')
    for (const user of ['scoped', 'owner-b', 'outsider']) { f.as(user); assert.deepEqual(f.call('match_calendar_participants', params).rows, []) }
    f.as('owner-a')
    assert.deepEqual(f.call('match_calendar_participants', { ...params, brand_id: 'brand-b' }).rows, [])
    // Fixture tombstones use the real schema; no participant name or email is used by this query.
    f.db.exec("INSERT INTO hiring_deletion_tombstones(request_id,organization_id,brand_id,candidate_id,application_id,created_at) VALUES ('erase','a','brand-a','candidate-a','app-a',1)")
    assert.deepEqual(f.call('match_calendar_participants', params).rows, [])
  } finally { f.db.close() }
})
