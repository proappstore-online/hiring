import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fixture } from './playbook-fixture.mjs'
import { checkMeetingAttendance, googleClient, observeAttendance, summarizeSessions } from '../worker/meeting-attendance.mjs'

const manifest = JSON.parse(readFileSync(new URL('../mcp.json', import.meta.url)))
const start = Date.parse('2026-11-04T00:00:00Z'), end = start + 1_800_000
const scope = { organization_id: 'a', brand_id: 'brand-a', application_id: 'app-a' }
const config = { ...scope, target_id: 'target-a', interview_id: null, kind: 'standup', meeting_code: 'abc-defg-hij', starts_at: start, ends_at: end, google_user_id: 'users/123456', enabled: 1, expected_version: 0, operation_id: 'attendance-setup' }
const observation = { connection_id: 'connection-a', target_id: 'target-a', organization_id: 'a', brand_id: 'brand-a', expected_version: 1, source_version: 0, event_id: 'run-1', status: 'attended', duration_seconds: 600, first_join_at: start, last_leave_at: start+600_000, conference_count: 1, error_code: null }

function setup() {
  const f = fixture()
  f.call('create_application', 'owner-a', { ...scope, requisition_id: 'req-a', candidate_id: 'candidate-a', operation_id: 'candidate-create', candidate_name: 'Candidate', email: 'candidate@example.com', phone: '', source: 'manual', source_detail: 'Direct', basis_reference: 'recruitment', contact_context: 'Direct', assignee_user_id: 'owner-a' })
  f.db.exec("INSERT INTO hiring_google_calendar_connections(organization_id,brand_id,connection_id,account_email,calendar_id,status,version,connected_by,connected_at,updated_at) VALUES ('a','brand-a','connection-a','organizer@example.com','primary','connected',1,'owner-a',1,1)")
  let now = end + 900_000
  const call = (name, user, values = {}) => {
    const t = manifest.tools.find(t => t.name === name)
    const params = { ...Object.fromEntries(Object.entries(t.params).filter(([, p]) => p.optional).map(([k]) => [k, null])), ...values, __user_id: user, __now: now }
    f.db.exec('BEGIN')
    try {
      const results = (t.statements ?? [t.sql]).map(sql => {
        const bindings = []
        const statement = f.db.prepare(sql.replace(/:([a-z_][a-z0-9_]*)/gi, (_, k) => { assert.notEqual(params[k], undefined, k); bindings.push(params[k]); return '?' }))
        return t.operation === 'query' ? statement.all(...bindings).map(r => ({ ...r })) : statement.run(...bindings).changes
      })
      f.db.exec('COMMIT')
      return t.operation === 'query' ? results[0] : results
    } catch (e) { f.db.exec('ROLLBACK'); throw e }
  }
  return { ...f, call, at: value => { now = value }, due: (event_id='run-1') => call('worker_list_due_attendance', 'system:worker', { event_id }) }
}

test('attendance configuration, access, audit and worker caller boundaries', () => {
  const f = setup()
  try {
    for (const user of ['owner-b', 'outsider', 'reviewer', 'auditor', 'system:worker']) assert.deepEqual(f.call('configure_meeting_attendance', user, config), [0,0,0,0])
    assert.deepEqual(f.call('configure_meeting_attendance', 'scoped', config), [1,1,0,0])
    assert.deepEqual(f.call('configure_meeting_attendance', 'scoped', config), [0,0,0,0])
    for (const user of ['owner-b','outsider','reviewer','auditor']) assert.deepEqual(f.call('list_meeting_attendance', user, scope), [])
    assert.equal(f.call('list_meeting_attendance', 'owner-a', scope).length, 1)
    assert.deepEqual(f.call('list_meeting_attendance', 'owner-a', {...scope, brand_id:'brand-b'}), [])
    assert.deepEqual(f.call('worker_list_due_attendance', 'owner-a', { event_id:'run-1' }), [])
    assert.deepEqual(f.call('worker_record_attendance', 'owner-a', observation), [0])
    assert.deepEqual(manifest.tools.find(t=>t.name==='worker_record_attendance').callers, ['worker'])
    assert.deepEqual(manifest.worker.schedules, [{name:'meeting_attendance',cron:'0 * * * *'}])
    assert.equal(f.due().length, 1)
    f.db.exec("UPDATE hiring_grants SET status='revoked' WHERE user_id='scoped'")
    assert.deepEqual(f.due(), [])
    assert.deepEqual(f.call('worker_record_attendance','system:worker',observation),[0])
  } finally { f.db.close() }
})

test('grace period, seven-day window, replay, hourly recheck and stale versions', () => {
  const f = setup()
  try {
    f.call('configure_meeting_attendance','owner-a',config)
    f.at(end+899_999); assert.equal(f.due().length,0)
    f.at(end+900_000); assert.equal(f.due().length,1)
    assert.deepEqual(f.call('worker_record_attendance','system:worker',{...observation,brand_id:'brand-b'}),[0])
    assert.deepEqual(f.call('worker_record_attendance','system:worker',{...observation,expected_version:2}),[0])
    assert.deepEqual(f.call('worker_record_attendance','system:worker',observation),[1])
    assert.deepEqual(f.call('worker_record_attendance','system:worker',observation),[0])
    assert.equal(f.due('run-2').length,0)
    f.at(end+900_000+3_600_000)
    assert.equal(f.due('run-1').length,0); assert.equal(f.due('run-2').length,1)
    const row=f.call('list_meeting_attendance','owner-a',scope)[0]
    assert.equal(JSON.parse(row.latest_check).duration_seconds,600)
    f.call('configure_meeting_attendance','owner-a',{...config,expected_version:1,enabled:0,operation_id:'disable'})
    assert.equal(f.due('run-3').length,0)
    assert.equal(f.call('list_meeting_attendance','owner-a',scope)[0].latest_check,null)
    assert.deepEqual(f.call('worker_record_attendance','system:worker',{...observation,event_id:'run-3'}),[0])
    f.call('configure_meeting_attendance','owner-a',{...config,expected_version:2,operation_id:'enable'})
    f.at(end+604_800_001); assert.equal(f.due('run-4').length,0)
  } finally { f.db.close() }
})

test('linked interviews follow reschedules and stop on cancellation or changed Meet location', () => {
  const f = setup()
  try {
    const interview={tenant_id:'a',brand_id:'brand-a',application_id:'app-a',interview_id:'interview-a',assignment_id:'assignment-a',reviewer_id:'owner-a',format:'video',scheduled_at:start,duration_minutes:30,location:'https://meet.google.com/abc-defg-hij',operation_id:'interview-create'}
    f.call('create_interview','owner-a',interview)
    f.call('configure_meeting_attendance','owner-a',{...config,kind:'interview',interview_id:'interview-a'})
    assert.equal(f.due()[0].source_version,1)
    f.call('update_interview_schedule','owner-a',{...interview,scheduled_at:start+86_400_000,expected_version:1,operation_id:'reschedule'})
    assert.equal(f.due().length,0)
    assert.deepEqual(f.call('worker_record_attendance','system:worker',{...observation,source_version:1}),[0])
    f.at(end+86_400_000+900_000)
    assert.equal(f.due()[0].starts_at,start+86_400_000)
    f.db.exec("UPDATE interviews SET status='cancelled' WHERE id='interview-a'")
    assert.equal(f.due().length,0)
    f.db.exec("UPDATE interviews SET status='scheduled',location='https://meet.google.com/zzz-zzzz-zzz' WHERE id='interview-a'")
    assert.equal(f.due().length,0)
  } finally { f.db.close() }
})

test('invalid configuration and audit failure roll back; erasure stops and removes attendance data', () => {
  const f = setup()
  try {
    for(const patch of [{meeting_code:'bad" filter'},{google_user_id:'users/not-a-number'},{ends_at:start},{enabled:2},{kind:'other'}]) assert.throws(()=>f.call('configure_meeting_attendance','owner-a',{...config,...patch}))
    f.db.exec("CREATE TRIGGER attendance_test_audit BEFORE INSERT ON hiring_audit_events WHEN NEW.action='attendance.configured' BEGIN SELECT RAISE(ABORT,'audit failed'); END")
    assert.throws(()=>f.call('configure_meeting_attendance','owner-a',config),/audit failed/)
    assert.equal(f.db.prepare('SELECT COUNT(*) n FROM hiring_attendance_targets').get().n,0)
    f.db.exec('DROP TRIGGER attendance_test_audit')
    f.call('configure_meeting_attendance','owner-a',config)
    f.call('worker_record_attendance','system:worker',observation)
    // Use the tombstone boundary exercised by the existing erasure workflow.
    f.db.exec("INSERT INTO hiring_deletion_tombstones(request_id,organization_id,brand_id,candidate_id,application_id,created_at) VALUES ('erase-attendance','a','brand-a','candidate-a','app-a',1)")
    assert.equal(f.db.prepare('SELECT COUNT(*) n FROM hiring_attendance_checks').get().n,0)
    assert.equal(f.due().length,0)
    assert.deepEqual(f.call('configure_meeting_attendance','owner-a',{...config,operation_id:'recreate'}),[0,0,0,0])
  } finally { f.db.close() }
})

const iso = n => new Date(n).toISOString()
test('session durations merge reconnects and simultaneous devices and clip the expected meeting window', () => {
  const sessions=[[-60,300],[120,600],[900,1200],[1800,2400]].map(([s,e])=>({startTime:iso(start+s*1000),endTime:iso(start+e*1000)}))
  assert.deepEqual(summarizeSessions(sessions,start,end),{duration_seconds:900,first_join_at:start,last_leave_at:start+1_200_000})
  assert.throws(()=>summarizeSessions([{startTime:iso(start)}],start,end),/incomplete_sessions/)
  assert.throws(()=>summarizeSessions([{startTime:'invalid',endTime:iso(end)}],start,end),/google_invalid_response/)
})

function provider({ anonymous=false, match=true, secondPage=true, failure=null }={}) {
  const requests=[]
  const fetchImpl=async (input,init)=>{
    const url=new URL(input);requests.push({url,init})
    if(url.hostname==='oauth2.googleapis.com') return Response.json({access_token:'access'})
    if(failure) return Response.json({error:'sensitive provider details'},{status:failure})
    if(url.pathname==='/v2/conferenceRecords') return Response.json({conferenceRecords:[{name:'conferenceRecords/c1',startTime:iso(start),endTime:iso(end)}]})
    if(url.pathname.endsWith('/participants')) {
      if(secondPage&&!url.searchParams.has('pageToken'))return Response.json({participants:[],nextPageToken:'page2'})
      return Response.json({participants:[{name:'conferenceRecords/c1/participants/p1',...(anonymous?{anonymousUser:{displayName:'Candidate'}}:{signedinUser:{user:match?'users/123456':'users/999999',displayName:'Candidate'}})}]})
    }
    if(url.pathname.endsWith('/participantSessions'))return Response.json({participantSessions:[{startTime:iso(start+60_000),endTime:iso(end)}]})
    throw Error('Unexpected provider path')
  }
  return {fetchImpl,requests}
}
const target={...config,id:config.target_id,version:1,source_version:0}

test('Google pagination, exact meeting filter and stable identity; same names never match', async () => {
  const p=provider()
  const result=await observeAttendance(target,googleClient(p.fetchImpl),'access')
  assert.equal(result.status,'attended');assert.equal(result.duration_seconds,1740)
  assert.match(p.requests[0].url.searchParams.get('filter'),/^space.meeting_code = "abc-defg-hij" AND/)
  assert.equal(p.requests.filter(r=>r.url.pathname.endsWith('/participants')).length,2)
  assert.equal((await observeAttendance(target,googleClient(provider({match:false}).fetchImpl),'access')).status,'not_observed')
  assert.equal((await observeAttendance(target,googleClient(provider({anonymous:true}).fetchImpl),'access')).status,'identity_unresolved')
  assert.equal((await observeAttendance({...target,google_user_id:null},googleClient(()=>{throw Error('No API call expected')}),'access')).status,'identity_unresolved')
})

test('missing records, incomplete pages, permission errors and rate limits cannot become absences', async () => {
  assert.equal((await observeAttendance(target,googleClient(async()=>Response.json({})),'access')).status,'no_record')
  for(const [status,code] of [[401,'google_auth'],[403,'google_forbidden'],[404,'google_not_found'],[429,'google_rate_limited'],[500,'google_unavailable']]) {
    await assert.rejects(observeAttendance(target,googleClient(provider({failure:status}).fetchImpl),'access'),new RegExp(code))
  }
  await assert.rejects(googleClient(async()=>Response.json({nextPageToken:'same'})).list('conferenceRecords','conferenceRecords','access'),/google_invalid_response/)
  await assert.rejects(observeAttendance(target,googleClient(provider().fetchImpl,1),'access'),/request_budget/)
  const incomplete = googleClient(async input => Response.json(new URL(input).pathname.endsWith('/participants') ? {} : {conferenceRecords:[{name:'conferenceRecords/c1',startTime:iso(start),endTime:iso(end)}]}))
  await assert.rejects(observeAttendance(target,incomplete,'access'),/incomplete_sessions/)
})

test('scheduled handler persists observations, retries idempotently, stops on disconnect and redacts logs', async () => {
  const f=setup(), logs=[]
  try {
    f.call('configure_meeting_attendance','owner-a',config)
    const pas={actions:{call:async(name,params)=>{const result=f.call(name,'system:worker',params);return name.startsWith('worker_list')||name==='worker_get_google_calendar_connection'?{rows:result}:{meta:{changes:result[0]}}}},log:async(...args)=>logs.push(args)}
    const p=provider(),options={fetchImpl:p.fetchImpl,tokenForConnection:async()=> 'access'}
    await checkMeetingAttendance({id:'scheduled-1'},pas,options)
    const calls=p.requests.length
    await checkMeetingAttendance({id:'scheduled-1'},pas,options)
    assert.equal(p.requests.length,calls)
    assert.equal(f.db.prepare('SELECT COUNT(*) n FROM hiring_attendance_checks').get().n,1)
    f.at(end+900_000+3_600_000)
    f.db.exec("UPDATE hiring_google_calendar_connections SET status='disconnected'")
    await checkMeetingAttendance({id:'scheduled-2'},pas,options)
    assert.equal(p.requests.length,calls)
    assert.deepEqual(f.call('worker_record_attendance','system:worker',{...observation,event_id:'after-disconnect'}),[0])
    assert.doesNotMatch(JSON.stringify(logs),/123456|Candidate|secret|refresh|abc-defg/)
  } finally { f.db.close() }
})
