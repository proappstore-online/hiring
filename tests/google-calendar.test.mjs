import {test} from 'node:test'
import assert from 'node:assert/strict'
import {handleGoogleCalendar,calendarOccurrence,verifyConnection} from '../worker/google-calendar.mjs'
import {calendarFixture,calendarScope} from './calendar-fixture.mjs'

const scope=calendarScope
async function request(f,path,body) {
  const url='https://hiring.proappstore.online/google/'+path+(body?'':'?'+new URLSearchParams(scope))
  const response=await handleGoogleCalendar(new Request(url,body?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...scope,...body})}:{}),f.pas)
  return {status:response.status,...await response.json()}
}
async function connect(f) {
  assert.equal((await request(f,'start',{})).status,200)
  assert.equal((await request(f,'complete',{state:'a'.repeat(43),code:'one-use-code'})).status,200)
  assert.equal((await request(f,'select',{calendar_id:'team@example.test',expected_version:0})).status,200)
  return f.call('get_google_calendar_settings',scope).rows[0]
}

test('Google account connects through PAS; an exact calendar is separately granted to the brand',async()=>{
  const f=calendarFixture()
  try {
    assert.equal((await request(f,'status')).account_connected,false)
    await request(f,'start',{})
    assert.deepEqual(f.connectorCalls.at(-1),{operation:'start',callback_path:'/recruiter/google-calendar/callback',return_to:'/recruiter/organizations/a/brands/brand-a/settings',user:'owner-a'})
    await request(f,'complete',{state:'a'.repeat(43),code:'one-use-code'})
    const ready=await request(f,'status')
    assert.equal(ready.account_connected,true);assert.equal(ready.status,'disconnected')
    assert.equal(f.grants.size,0)
    assert.equal((await request(f,'select',{calendar_id:'team@example.test',expected_version:0})).status,200)
    const c=f.call('get_google_calendar_settings',scope).rows[0]
    assert.equal(c.calendar_id,'team@example.test');assert.equal(c.connected_by,'owner-a')
    assert.equal(f.grants.get(c.connection_id).user_id,'owner-a')
    assert.equal((await request(f,'status')).connection_valid,true)
    assert.equal(f.db.prepare("SELECT COUNT(*) n FROM hiring_audit_events WHERE action='calendar.connected'").get().n,1)
  }finally{f.db.close()}
})

test('brand grants and stale versions are enforced before connector calls',async()=>{
  const f=calendarFixture()
  try{
    for(const actor of ['outsider','owner-b','reviewer','auditor','scoped']){
      f.as(actor);assert.equal((await request(f,'start',{})).status,403)
    }
    assert.equal(f.connectorCalls.length,0)
    f.as('owner-a');const c=await connect(f)
    const before=f.connectorCalls.length
    assert.equal((await request(f,'select',{calendar_id:'other@example.test',expected_version:0})).status,409)
    assert.equal(f.connectorCalls.length,before)
    assert.equal((await request(f,'select',{calendar_id:'other@example.test',expected_version:c.version})).status,200)
    assert.equal(f.grants.get(c.connection_id).revoked,true)
    assert.equal(f.call('get_google_calendar_settings',scope).rows[0].version,2)
  }finally{f.db.close()}
})

test('disconnect stops this brand, preserves the shared account and prevents stale writes',async()=>{
  const f=calendarFixture()
  try{
    const c=await connect(f)
    assert.equal((await request(f,'disconnect',{expected_version:c.version})).status,200)
    assert.equal(f.google.connected,true);assert.equal(f.grants.get(c.connection_id).revoked,true)
    assert.equal((await request(f,'events')).status,409)
    assert.equal((await request(f,'select',{calendar_id:'team@example.test',expected_version:c.version})).status,409)
    assert.equal(f.connectorCalls.some(c=>c.operation==='disconnect_account'),false)
  }finally{f.db.close()}
})

test('a fabricated metadata link cannot read or revoke another owner’s PAS grant',async()=>{
  const f=calendarFixture()
  try{
    const c=await connect(f)
    f.grants.get(c.connection_id).user_id='other-owner'
    await assert.rejects(verifyConnection(f.pas,c),/connection_invalid/)
    assert.equal((await request(f,'events')).status,403)
    assert.equal((await request(f,'disconnect',{expected_version:c.version})).status,200)
    assert.ok(!f.grants.get(c.connection_id).revoked)
  }finally{f.db.close()}
})

test('a failed or uncertain local link never leaks a usable orphan grant',async()=>{
  const f=calendarFixture()
  try{
    f.google.connected=true
    const real=f.pas.actions.call
    f.pas.actions.call=async(name,p)=>name==='link_google_calendar_grant'?{results:[{meta:{changes:0}}]}:real(name,p)
    assert.equal((await request(f,'select',{calendar_id:'team@example.test',expected_version:0})).status,409)
    assert.equal([...f.grants.values()][0].revoked,true)
    f.pas.actions.call=async(name,p)=>{const result=await real(name,p);if(name==='link_google_calendar_grant')throw Error('response lost');return result}
    assert.equal((await request(f,'select',{calendar_id:'team@example.test',expected_version:0})).status,200)
    const active=f.call('get_google_calendar_settings',scope).rows[0]
    assert.ok(!f.grants.get(active.connection_id).revoked)
  }finally{f.db.close()}
})

test('tracked occurrences are scoped, idempotent, and follow calendar updates',async()=>{
  const f=calendarFixture()
  try{
    await connect(f)
    assert.equal((await request(f,'events')).events[0].meeting_code,'abc-defg-hij')
    const body={application_id:'app-a',event_id:'event1',google_user_id:'users/123456'}
    const tracked=await request(f,'track',body)
    assert.equal(tracked.status,200);assert.equal((await request(f,'track',body)).target_id,tracked.target_id)
    assert.equal(f.call('list_meeting_attendance',{...scope,application_id:'app-a',target_id:null}).rows.length,1)
    assert.equal((await request(f,'track',{...body,application_id:'ungranted'})).status,403)
    f.as('recruiter')
    assert.equal((await request(f,'events')).status,200)
    f.db.exec("UPDATE hiring_grants SET status='revoked' WHERE user_id='recruiter'")
    assert.equal((await request(f,'events')).status,403)
  }finally{f.db.close()}
})

test('occurrence normalization refuses all-day and non-Meet events and retains cancellation',()=>{
  assert.equal(calendarOccurrence({start:{date:'2026-11-04'},end:{date:'2026-11-05'}}),null)
  assert.deepEqual(calendarOccurrence({status:'cancelled'}),{event_status:'cancelled',starts_at:0,ends_at:1,meeting_code:''})
  assert.equal(calendarOccurrence({hangoutLink:'https://evil.example/abc-defg-hij',start:{dateTime:'2026-11-04T00:00:00Z'},end:{dateTime:'2026-11-04T01:00:00Z'}}),null)
})
