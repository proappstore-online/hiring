import {test} from 'node:test'
import assert from 'node:assert/strict'
import {handleGoogleCalendar,GOOGLE_SCOPES,REDIRECT_URI,sealCredential,openCredential,calendarOccurrence} from '../worker/google-calendar.mjs'
import {checkMeetingAttendance} from '../worker/meeting-attendance.mjs'
import {calendarFixture,calendarScope,calendarNow} from './calendar-fixture.mjs'

const code='abc-defg-hij'
const event={id:'event-a',summary:'Working interview',status:'confirmed',hangoutLink:'https://meet.google.com/'+code,start:{dateTime:'2026-11-04T00:00:00Z'},end:{dateTime:'2026-11-04T00:30:00Z'}}
function provider() {
  const calls=[],state={scope:GOOGLE_SCOPES.join(' '),event,fail:false}
  const fetchImpl=async(input,init={})=>{
    const url=new URL(input),body=init.body instanceof URLSearchParams?Object.fromEntries(init.body):null
    calls.push({url,body,init})
    if(state.fail)return Response.json({error:'sensitive detail'},{status:403})
    if(url.hostname==='oauth2.googleapis.com')return Response.json({access_token:'access-token',refresh_token:'secret-refresh-token',scope:state.scope})
    if(url.pathname==='/oauth2/v2/userinfo')return Response.json({email:'organizer@example.com',verified_email:true})
    if(url.pathname==='/calendar/v3/users/me/calendarList')return Response.json({items:[{id:'calendar@example.com',summary:'Recruiting',primary:true}]})
    if(url.pathname==='/calendar/v3/users/me/calendarList/calendar%40example.com')return Response.json({id:'calendar@example.com',summary:'Recruiting',accessRole:'owner'})
    if(url.pathname==='/calendar/v3/calendars/calendar%40example.com/events')return Response.json({items:[state.event]})
    if(url.pathname==='/calendar/v3/calendars/calendar%40example.com/events/event-a')return Response.json(state.event)
    if(url.pathname==='/v2/conferenceRecords')return Response.json({conferenceRecords:[{name:'conferenceRecords/c1',startTime:state.event.start.dateTime,endTime:state.event.end.dateTime}]})
    if(url.pathname.endsWith('/participants'))return Response.json({participants:[{name:'conferenceRecords/c1/participants/p1',signedinUser:{user:'users/123456'}}]})
    if(url.pathname.endsWith('/participantSessions'))return Response.json({participantSessions:[{startTime:state.event.start.dateTime,endTime:state.event.end.dateTime}]})
    throw Error('Unexpected provider path: '+url.pathname)
  }
  return {calls,state,fetchImpl}
}
function client(f,p) {
  return async(path,body,scope=calendarScope)=>{
    const url='https://hiring.proappstore.online/google/'+path+(body===undefined?'?'+new URLSearchParams(scope):'')
    const response=await handleGoogleCalendar(new Request(url,body===undefined?{}:{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...scope,...body})}),f.pas,{fetchImpl:p.fetchImpl,now:f.now})
    return {status:response.status,body:await response.json()}
  }
}
async function connect(request) {
  const start=await request('start',{})
  assert.equal(start.status,200)
  const auth=new URL(start.body.authorization_url)
  const complete=await request('complete',{state:auth.searchParams.get('state'),code:'authorization-code'})
  assert.equal(complete.status,200,JSON.stringify(complete.body))
  return {auth,complete}
}
async function select(request) {
  const status=await request('status')
  const selection=await request('select',{calendar_id:'calendar@example.com',expected_version:status.body.version})
  assert.equal(selection.status,200,JSON.stringify(selection.body))
}

test('owner OAuth uses PKCE, one-time user-bound state and encrypted credentials; no tokens reach responses',async()=>{
  const f=calendarFixture(),p=provider(),request=client(f,p)
  try {
    f.as('recruiter');assert.equal((await request('start',{})).status,403)
    f.as('owner-a')
    const start=await request('start',{}),auth=new URL(start.body.authorization_url),state=auth.searchParams.get('state')
    assert.equal(auth.searchParams.get('redirect_uri'),REDIRECT_URI)
    assert.equal(auth.searchParams.get('access_type'),'offline')
    assert.equal(auth.searchParams.get('code_challenge_method'),'S256')
    assert.deepEqual(auth.searchParams.get('scope').split(' '),GOOGLE_SCOPES)
    f.as('owner-b');assert.equal((await request('complete',{state,code:'code'})).status,409);assert.equal(p.calls.length,0)
    f.as('owner-a');const result=await request('complete',{state,code:'code'})
    assert.equal(result.status,200);assert.equal(result.body.return_to,'/recruiter/organizations/a/brands/brand-a/settings')
    const tokenCall=p.calls.find(c=>c.body?.grant_type==='authorization_code')
    const challenge=Buffer.from(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(tokenCall.body.code_verifier))).toString('base64url')
    assert.equal(challenge,auth.searchParams.get('code_challenge'))
    assert.equal(f.storage.size,1)
    const [key,sealed]=[...f.storage][0]
    assert.doesNotMatch(sealed,/secret-refresh-token/)
    assert.equal((await openCredential(sealed,f.secrets.HIRING_GOOGLE_TOKEN_KEY,key)).refresh_token,'secret-refresh-token')
    const status=await request('status');assert.equal(status.body.account_email,'organizer@example.com')
    assert.doesNotMatch(JSON.stringify(status),/refresh_token|client.secret|ciphertext|connection_id/)
    const count=p.calls.length
    assert.equal((await request('complete',{state,code:'code'})).status,409)
    assert.equal(p.calls.length,count)
  }finally{f.db.close()}
})

test('expired state, denied scopes, absent configuration and stale reconnects fail closed',async()=>{
  const f=calendarFixture(),p=provider(),request=client(f,p)
  try{
    delete f.secrets.HIRING_GOOGLE_CLIENT_SECRET
    assert.equal((await request('status')).body.configured,false)
    assert.equal((await request('start',{})).status,503)
    f.secrets.HIRING_GOOGLE_CLIENT_SECRET='secret'
    const s=await request('start',{}),state=new URL(s.body.authorization_url).searchParams.get('state')
    f.at(calendarNow+600001)
    assert.equal((await request('complete',{state,code:'code'})).status,409)
    assert.equal(p.calls.length,0)
    p.state.scope=GOOGLE_SCOPES[0]
    const next=await request('start',{})
    assert.equal((await request('complete',{state:new URL(next.body.authorization_url).searchParams.get('state'),code:'code'})).status,403)
    assert.equal(f.storage.size,0)
    p.state.scope=GOOGLE_SCOPES.join(' ')
    const pending=await request('start',{})
    await connect(request)
    const before=f.db.prepare('SELECT connection_id FROM hiring_google_calendar_connections').get().connection_id
    assert.equal((await request('complete',{state:new URL(pending.body.authorization_url).searchParams.get('state'),code:'code'})).status,409)
    assert.equal(f.db.prepare('SELECT connection_id FROM hiring_google_calendar_connections').get().connection_id,before)
  }finally{f.db.close()}
})

test('calendar selection, reads, candidate tracking and disconnect enforce scope and versions',async()=>{
  const f=calendarFixture(),p=provider(),request=client(f,p)
  try{
    await connect(request)
    const cals=await request('calendars');assert.equal(cals.body.calendars[0].name,'Recruiting')
    assert.equal((await request('events')).body.error,'select_calendar_first')
    f.as('recruiter');assert.equal((await request('select',{calendar_id:'calendar@example.com',expected_version:1})).status,403)
    f.as('owner-b');assert.equal((await request('status')).status,403)
    f.as('owner-a');await select(request)
    assert.equal((await request('select',{calendar_id:'calendar@example.com',expected_version:1})).status,409)
    const events=await request('events');assert.equal(events.body.events.length,1)
    f.as('google:123456');f.call('save_my_worker_profile',{display_name:'Candidate'});f.as('owner-a')
    f.db.exec("UPDATE hiring_candidates SET worker_user_id='google:123456' WHERE id='candidate-a'")
    const tracked=await request('track',{application_id:'app-a',event_id:'event-a'})
    assert.equal(tracked.status,200,JSON.stringify(tracked.body))
    const repeated=await request('track',{application_id:'app-a',event_id:'event-a',google_user_id:'users/123456'})
    assert.equal(repeated.body.target_id,tracked.body.target_id)
    assert.equal(f.db.prepare('SELECT COUNT(*) n FROM hiring_attendance_targets').get().n,1)
    assert.equal((await request('track',{application_id:'app-b',event_id:'event-a'})).status,403)
    const target=f.db.prepare('SELECT * FROM hiring_attendance_targets').get()
    assert.equal(target.calendar_event_id,'event-a');assert.equal(target.calendar_id,'calendar@example.com')
    assert.equal(target.google_user_id,'users/123456')
    const pending=await request('start',{})
    assert.equal((await request('disconnect',{expected_version:2})).status,200)
    assert.equal((await request('status')).body.status,'disconnected')
    assert.ok([...f.storage.values()].every(v=>v==='{}'))
    assert.equal((await request('events')).body.error,'reconnect_required')
    assert.equal((await request('complete',{state:new URL(pending.body.authorization_url).searchParams.get('state'),code:'code'})).status,409)
    f.as('system:worker')
    assert.deepEqual(f.call('worker_get_google_calendar_connection',calendarScope).rows,[])
  }finally{f.db.close()}
})

test('encrypted Google credentials cannot be moved across scopes or tampered with',async()=>{
  const key='ab'.repeat(32),sealed=await sealCredential({refresh_token:'refresh'},key,'brand-a/connection-a')
  assert.equal((await openCredential(sealed,key,'brand-a/connection-a')).refresh_token,'refresh')
  await assert.rejects(openCredential(sealed,key,'brand-b/connection-a'),/reconnect_required/)
  const changed=JSON.parse(sealed);changed.ciphertext=(changed.ciphertext[0]==='A'?'B':'A')+changed.ciphertext.slice(1)
  await assert.rejects(openCredential(JSON.stringify(changed),key,'brand-a/connection-a'),/reconnect_required/)
  assert.equal(calendarOccurrence({...event,hangoutLink:'https://meet.google.com.evil.example/abc-defg-hij'}),null)
  assert.equal(calendarOccurrence({...event,start:{date:'2026-11-04'}}),null)
})

test('hourly job uses connected Google tokens and updates reschedules/cancellations before attendance',async()=>{
  const f=calendarFixture(),p=provider(),request=client(f,p)
  try{
    await connect(request);await select(request)
    assert.equal((await request('track',{application_id:'app-a',event_id:'event-a',google_user_id:'users/123456'})).status,200)
    f.as('system:worker')
    await checkMeetingAttendance({id:'run-1'},f.pas,{fetchImpl:p.fetchImpl})
    assert.equal(f.db.prepare('SELECT status FROM hiring_attendance_checks').get().status,'attended')
    f.at(calendarNow+3_600_000)
    p.state.event={...event,start:{dateTime:'2026-11-05T00:00:00Z'},end:{dateTime:'2026-11-05T00:30:00Z'}}
    await checkMeetingAttendance({id:'run-2'},f.pas,{fetchImpl:p.fetchImpl})
    assert.equal(f.db.prepare('SELECT starts_at FROM hiring_attendance_targets').get().starts_at,Date.parse('2026-11-05T00:00:00Z'))
    assert.equal(f.db.prepare('SELECT COUNT(*) n FROM hiring_attendance_checks').get().n,2)
    f.at(calendarNow+86_400_000)
    p.state.event={id:'event-a',status:'cancelled'}
    await checkMeetingAttendance({id:'run-3'},f.pas,{fetchImpl:p.fetchImpl})
    assert.equal(f.db.prepare('SELECT enabled FROM hiring_attendance_targets').get().enabled,0)
    assert.equal(f.db.prepare('SELECT COUNT(*) n FROM hiring_attendance_checks').get().n,2)
  }finally{f.db.close()}
})

test('upcoming tracked meetings are refreshed so an earlier reschedule is not missed',async()=>{
  const f=calendarFixture(),p=provider(),request=client(f,p)
  try{
    await connect(request);await select(request)
    p.state.event={...event,start:{dateTime:'2026-11-05T00:00:00Z'},end:{dateTime:'2026-11-05T00:30:00Z'}}
    assert.equal((await request('track',{application_id:'app-a',event_id:'event-a',google_user_id:'users/123456'})).status,200)
    f.as('system:worker')
    await checkMeetingAttendance({id:'future-1'},f.pas,{fetchImpl:p.fetchImpl})
    assert.equal(f.db.prepare('SELECT status FROM hiring_attendance_checks').get().status,'scheduled')
    assert.equal(p.calls.filter(c=>c.url.hostname==='meet.googleapis.com').length,0)
    f.at(calendarNow+3_600_000);p.state.event=event
    await checkMeetingAttendance({id:'earlier-2'},f.pas,{fetchImpl:p.fetchImpl})
    assert.equal(f.db.prepare('SELECT status FROM hiring_attendance_checks ORDER BY checked_at DESC LIMIT 1').get().status,'attended')
    // Grant revocation stops both credentials and result writes.
    f.db.exec("UPDATE hiring_organizations SET status='suspended' WHERE id='a'")
    f.at(calendarNow+7_200_000)
    const calls=p.calls.length
    await checkMeetingAttendance({id:'revoked-3'},f.pas,{fetchImpl:p.fetchImpl})
    assert.equal(p.calls.length,calls)
  }finally{f.db.close()}
})
