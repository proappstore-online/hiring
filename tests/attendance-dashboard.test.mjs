import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fixture } from './playbook-fixture.mjs'
import { buildAttendanceDashboardTools } from '../scripts/attendance-dashboard-tools.mjs'
import { attendanceSelection, attendanceWeek, attendanceResult } from '../web/src/attendance-report.ts'

const start = Date.parse('2026-11-02T09:00:00+11:00'), end = start + 1800000
const scope = { organization_id: 'a', brand_id: 'brand-a' }
const query = { ...scope, ...attendanceSelection, ...attendanceWeek(Date.parse('2026-11-05T03:00:00+11:00')) }
function setup() {
  const f = fixture()
  f.call('create_application', 'owner-a', { ...scope, application_id: 'app-a', requisition_id: 'req-a', candidate_id: 'candidate-a', operation_id: 'create', candidate_name: 'Participant', email: 'participant@example.test', phone: '', source: 'manual', source_detail: 'Direct', basis_reference: 'recruitment', contact_context: 'Direct', assignee_user_id: 'owner-a' })
  const target = (id = 'target-a', patch = {}) => f.call('configure_meeting_attendance', 'owner-a', {
    ...scope, application_id: 'app-a', target_id: id, interview_id: null, kind: 'standup',
    meeting_code: 'abc-defg-hij', starts_at: start, ends_at: end, google_user_id: 'users/123',
    enabled: 1, expected_version: 0, operation_id: id, calendar_id: attendanceSelection.calendar_id,
    calendar_event_id: attendanceSelection.series_id + '_20261101T220000Z', ...patch,
  })
  const check = (id, version = 1, event = 'run-1', status = 'attended', checked = end + 900000) => {
    f.db.prepare(`INSERT INTO hiring_attendance_checks(target_id,target_version,source_version,event_id,status,duration_seconds,first_join_at,last_leave_at,conference_count,error_code,checked_at) VALUES (?,?,0,?,?,?,?,?,1,?,?)`)
      .run(id, version, event, status, status === 'attended' ? 60 : 0, status === 'attended' ? start : null, status === 'attended' ? start + 60000 : null, status === 'error' ? 'google_auth' : null, checked)
  }
  return { ...f, target, check }
}
test('dashboard reads exact calendar/series, bounded dates and current evidence with stable pagination', () => {
  const f = setup()
  try {
    f.target(); f.check('target-a')
    f.target('afternoon', { calendar_event_id: attendanceSelection.second_series_id + '_20261102T053000Z' })
    f.target('other-calendar', { calendar_id: 'another-calendar' })
    f.target('same-title-different-series', { calendar_event_id: 'other-series_20261102T053000Z' })
    f.target('prefix-collision', { calendar_event_id: attendanceSelection.series_id + 'extra_20261101T220000Z' })
    f.target('before', { starts_at: query.starts_at - 1, ends_at: query.starts_at + 1000 })
    f.target('after', { starts_at: query.ends_at, ends_at: query.ends_at + 1000 })
    const rows = f.call('list_attendance_overview', 'owner-a', query)
    assert.equal(rows.length, 2); assert.equal(rows[0].total_count, 2)
    assert.equal(rows.find(r => r.id === 'target-a').status, 'attended')
    assert.equal(rows.find(r => r.id === 'afternoon').status, null)
    assert.deepEqual(f.call('list_attendance_overview', 'owner-a', { ...query, ends_at: query.starts_at + 15 * 86400000 }), [])
    assert.deepEqual(f.call('list_attendance_overview', 'owner-a', { ...query, series_id: '', second_series_id: '' }), [])
    f.db.exec("UPDATE hiring_attendance_targets SET version=2 WHERE id='target-a'")
    assert.equal(f.call('list_attendance_overview', 'owner-a', query).find(r => r.id === 'target-a').status, null)
    assert.equal(f.call('list_attendance_check_history', 'owner-a', query)[0].superseded, 1)
    for (let i = 0; i < 105; i++) f.target('page-' + String(i).padStart(3, '0'))
    const first = f.call('list_attendance_overview', 'owner-a', query)
    const second = f.call('list_attendance_overview', 'owner-a', { ...query, offset: 100 })
    assert.equal(first.length, 100); assert.equal(second.length, 7); assert.equal(first[0].total_count, 107)
    assert.equal(new Set([...first, ...second].map(r => r.id)).size, 107)
  } finally { f.db.close() }
})
test('overview and history enforce tenant, brand, live requisition grants and erasure', () => {
  const f = setup()
  try {
    f.target(); f.check('target-a'); f.check('target-a', 1, 'run-2', 'error', end + 3600000)
    for (const name of ['list_attendance_overview', 'list_attendance_check_history']) {
      for (const user of ['outsider', 'owner-b', 'reviewer', 'auditor', 'system:worker']) assert.deepEqual(f.call(name, user, query), [])
      assert.deepEqual(f.call(name, 'owner-a', { ...query, brand_id: 'brand-b' }), [])
      assert.deepEqual(f.call(name, 'owner-a', { ...query, organization_id: 'b' }), [])
      assert.ok(f.call(name, 'scoped', query).length)
    }
    const history = f.call('list_attendance_check_history', 'owner-a', query)
    assert.equal(history[0].errors, 1); assert.equal(history[1].attended, 1)
    f.db.exec("UPDATE hiring_grants SET status='revoked' WHERE user_id='scoped'")
    for (const name of ['list_attendance_overview', 'list_attendance_check_history']) assert.deepEqual(f.call(name, 'scoped', query), [])
    f.db.exec("INSERT INTO hiring_deletion_tombstones(request_id,organization_id,brand_id,candidate_id,application_id,created_at) VALUES ('erase','a','brand-a','candidate-a','app-a',1)")
    for (const name of ['list_attendance_overview', 'list_attendance_check_history']) assert.deepEqual(f.call(name, 'owner-a', query), [])
  } finally { f.db.close() }
})
test('Melbourne weeks use local Mondays, not the browser zone, and respect DST boundaries', () => {
  assert.deepEqual(attendanceWeek(Date.parse('2026-11-01T14:00:00Z')), { starts_at: Date.parse('2026-11-02T00:00:00+11:00'), ends_at: Date.parse('2026-11-09T00:00:00+11:00') })
  assert.deepEqual(attendanceWeek(Date.parse('2026-11-05T00:00:00Z'), true), { starts_at: Date.parse('2026-10-26T00:00:00+11:00'), ends_at: Date.parse('2026-11-02T00:00:00+11:00') })
  const spring = attendanceWeek(Date.parse('2026-10-04T00:00:00Z'))
  assert.equal(spring.ends_at - spring.starts_at, 167 * 3600000)
  const autumn = attendanceWeek(Date.parse('2026-04-05T00:00:00Z'))
  assert.equal(autumn.ends_at - autumn.starts_at, 169 * 3600000)
})
test('future, grace-period, unresolved and error states never become absence', () => {
  const row = { enabled: 1, source_ready: 1, starts_at: start, ends_at: end, status: null }
  assert.equal(attendanceResult(row, start - 1), 'Scheduled')
  assert.equal(attendanceResult(row, start + 1), 'In progress')
  assert.equal(attendanceResult(row, end + 1), 'Waiting for reporting window')
  assert.equal(attendanceResult(row, end + 900000), 'Awaiting attendance check')
  assert.equal(attendanceResult({ ...row, status: 'not_observed' }, end + 900000), 'Not observed · review needed')
  assert.equal(attendanceResult({ ...row, status: 'error' }, end + 900000), 'Check failed')
})
test('registered dashboard tools match the reviewed read-only definitions', () => {
  const tools = JSON.parse(readFileSync(new URL('../mcp.json', import.meta.url))).tools
  for (const expected of buildAttendanceDashboardTools()) assert.deepEqual(tools.find(t => t.name === expected.name), expected)
})
