// Browser requests arrive with a platform-authenticated caller grant. Every
// credential access first authorizes the exact brand through registered SQL.
const ORIGIN = 'https://hiring.proappstore.online'
export const REDIRECT_URI = ORIGIN + '/recruiter/google-calendar/callback'
export const GOOGLE_SCOPES = ['https://www.googleapis.com/auth/calendar.readonly', 'https://www.googleapis.com/auth/meetings.space.readonly', 'https://www.googleapis.com/auth/userinfo.email']
const encode = bytes => btoa(String.fromCharCode(...bytes)).replaceAll('+','-').replaceAll('/','_').replace(/=+$/,'')
const decode = text => Uint8Array.from(atob(text.replaceAll('-','+').replaceAll('_','/')), c => c.charCodeAt(0))
const bytes = text => new TextEncoder().encode(text)
const random = () => encode(crypto.getRandomValues(new Uint8Array(32)))
const digest = async value => new Uint8Array(await crypto.subtle.digest('SHA-256', bytes(value)))
const hash = async value => [...await digest(value)].map(b=>b.toString(16).padStart(2,'0')).join('')
const settingsPath = scope => `/recruiter/organizations/${encodeURIComponent(scope.organization_id)}/brands/${encodeURIComponent(scope.brand_id)}/settings`
const objectKey = c => `google-calendar/${encodeURIComponent(c.organization_id)}/${encodeURIComponent(c.brand_id)}/${encodeURIComponent(c.connection_id)}.json`
class CalendarError extends Error {
  constructor(code, status = 400) { super(code); this.code = code; this.status = status }
}
const fail = (code,status) => { throw new CalendarError(code,status) }
const rows = r => r?.rows ?? r?.results?.at(-1)?.rows ?? []
const changed = r => (r?.results?.at(-1)?.meta?.changes ?? r?.meta?.changes ?? 0)>0
const scopeOf = value => {
  if(!value || !['organization_id','brand_id'].every(k=>typeof value[k]==='string'&&value[k].length>0&&value[k].length<=128))fail('invalid_scope')
  return {organization_id:value.organization_id,brand_id:value.brand_id}
}
async function settings(pas,scope,manage=false) {
  const c=rows(await pas.actions.call('get_google_calendar_settings',scope))[0]
  if(!c || (manage&&!c.can_manage))fail('forbidden',403)
  return {...scope,...c}
}
async function configuration(pas) {
  const [client_id,client_secret,key]=await Promise.all(['HIRING_GOOGLE_CLIENT_ID','HIRING_GOOGLE_CLIENT_SECRET','HIRING_GOOGLE_TOKEN_KEY'].map(name=>pas.secrets.get(name)))
  if(!client_id||!client_secret||!key||!/^[a-f0-9]{64}$/i.test(key))fail('google_not_configured',503)
  return {client_id,client_secret,key}
}
const rawKey = key => Uint8Array.from(key.match(/../g), s=>parseInt(s,16))
async function verifier(key,state) {
  const signingKey=await crypto.subtle.importKey('raw',rawKey(key),{name:'HMAC',hash:'SHA-256'},false,['sign'])
  return encode(new Uint8Array(await crypto.subtle.sign('HMAC',signingKey,bytes('hiring-google-pkce:'+state))))
}
export async function sealCredential(value,key,context) {
  const aes=await crypto.subtle.importKey('raw',rawKey(key),'AES-GCM',false,['encrypt'])
  const iv=crypto.getRandomValues(new Uint8Array(12))
  const ciphertext=await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:bytes(context)},aes,bytes(JSON.stringify(value)))
  return JSON.stringify({v:1,iv:encode(iv),ciphertext:encode(new Uint8Array(ciphertext))})
}
export async function openCredential(value,key,context) {
  try {
    const sealed=JSON.parse(value)
    if(sealed.v!==1)fail('reconnect_required',409)
    const aes=await crypto.subtle.importKey('raw',rawKey(key),'AES-GCM',false,['decrypt'])
    const plain=await crypto.subtle.decrypt({name:'AES-GCM',iv:decode(sealed.iv),additionalData:bytes(context)},aes,decode(sealed.ciphertext))
    const result=JSON.parse(new TextDecoder().decode(plain))
    if(typeof result.refresh_token!=='string'||!result.refresh_token)fail('reconnect_required',409)
    return result
  } catch { fail('reconnect_required',409) }
}

export async function googleJson(url,init={},fetchImpl=fetch) {
  let response
  try { response=await fetchImpl(url,{...init,redirect:'error',signal:AbortSignal.timeout(8000)}) }
  catch { fail('google_unavailable',502) }
  if(!response.ok)fail(({400:'google_auth',401:'google_auth',403:'google_forbidden',404:'google_not_found',429:'google_rate_limited'})[response.status]??'google_unavailable',502)
  try { const data=await response.json();if(!data||typeof data!=='object'||Array.isArray(data))fail('google_invalid_response',502);return data }
  catch { fail('google_invalid_response',502) }
}
export async function getConnectionToken(pas,connection,fetchImpl=fetch) {
  const config=await configuration(pas)
  const stored=await pas.storage.get(objectKey(connection))
  if(!stored)fail('reconnect_required',409)
  const credential=await openCredential(new TextDecoder().decode(stored.body),config.key,objectKey(connection))
  const token=await googleJson('https://oauth2.googleapis.com/token',{method:'POST',body:new URLSearchParams({client_id:config.client_id,client_secret:config.client_secret,refresh_token:credential.refresh_token,grant_type:'refresh_token'})},fetchImpl)
  if(typeof token.access_token!=='string'||!token.access_token)fail('google_auth',502)
  return token.access_token
}
async function activeConnection(pas,scope) {
  const c=await settings(pas,scope)
  if(c.status!=='connected'||!c.connection_id||!c.owner_active)fail('reconnect_required',409)
  return c
}
const authorized = token => ({headers:{Authorization:'Bearer '+token}})
export function calendarOccurrence(event) {
  if(event.status==='cancelled')return {event_status:'cancelled',starts_at:0,ends_at:1,meeting_code:''}
  const uri=event.hangoutLink??event.conferenceData?.entryPoints?.find(p=>p.entryPointType==='video')?.uri
  let code
  try { const u=new URL(uri);if(u.protocol==='https:'&&u.hostname==='meet.google.com')code=u.pathname.slice(1) }catch{ /* Not a Meet event. */ }
  const starts_at=Date.parse(event.start?.dateTime),ends_at=Date.parse(event.end?.dateTime)
  if(!/^[a-z]{3}-[a-z]{4}-[a-z]{3}$/.test(code??'')||!Number.isFinite(starts_at)||!Number.isFinite(ends_at)||ends_at<=starts_at||ends_at-starts_at>86_400_000)return null
  return {event_status:'confirmed',meeting_code:code,starts_at,ends_at}
}
export async function calendarEvent(calendarId,eventId,token,fetchImpl=fetch) {
  return googleJson(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,authorized(token),fetchImpl)
}
async function listGoogle(path,token,query={},fetchImpl=fetch) {
  const items=[],seen=new Set()
  let pageToken=''
  for(let page=0;page<5;page++) {
    const url=new URL('https://www.googleapis.com/calendar/v3/'+path)
    url.search=new URLSearchParams({...query,maxResults:'100',...(pageToken?{pageToken}:{})}).toString()
    const data=await googleJson(url,authorized(token),fetchImpl)
    if(data.items!==undefined&&!Array.isArray(data.items))fail('google_invalid_response',502)
    items.push(...(data.items??[]));pageToken=data.nextPageToken??''
    if(!pageToken)return items
    if(typeof pageToken!=='string'||seen.has(pageToken))fail('google_invalid_response',502)
    seen.add(pageToken)
  }
  fail('calendar_too_large',422)
}

export async function handleGoogleCalendar(request,pas,{fetchImpl=fetch,now=Date.now}={}) {
  try {
    const url=new URL(request.url),path=url.pathname
    if(!path.startsWith('/google/'))return new Response('Not found',{status:404})
    let body={}
    if(request.method==='POST') {
      if(!request.headers.get('content-type')?.startsWith('application/json'))fail('json_required',415)
      try{body=await request.json()}catch{fail('invalid_json')}
      if(!body||typeof body!=='object'||Array.isArray(body))fail('invalid_json')
    }
    if(path==='/google/complete'&&request.method==='POST') {
      if(typeof body.state!=='string'||!/^[A-Za-z0-9_-]{43}$/.test(body.state)||typeof body.code!=='string'||!body.code||body.code.length>4096)fail('invalid_callback')
      const state_hash=await hash(body.state),claim_id=crypto.randomUUID()
      if(!changed(await pas.actions.call('consume_google_calendar_oauth',{state_hash,claim_id})))fail('expired_or_used_callback',409)
      const claim=rows(await pas.actions.call('get_google_calendar_oauth_claim',{state_hash,claim_id}))[0]
      if(!claim)fail('expired_or_used_callback',409)
      const scope=scopeOf(claim),config=await configuration(pas)
      const old=await settings(pas,scope,true)
      const result=await googleJson('https://oauth2.googleapis.com/token',{method:'POST',body:new URLSearchParams({client_id:config.client_id,client_secret:config.client_secret,code:body.code,code_verifier:await verifier(config.key,body.state),grant_type:'authorization_code',redirect_uri:REDIRECT_URI})},fetchImpl)
      const granted=new Set(typeof result.scope==='string'?result.scope.split(' '):[])
      if(!GOOGLE_SCOPES.every(s=>granted.has(s)))fail('missing_google_permissions',403)
      if(typeof result.refresh_token!=='string'||!result.refresh_token||typeof result.access_token!=='string'||!result.access_token)fail('reconnect_required',409)
      const profile=await googleJson('https://www.googleapis.com/oauth2/v2/userinfo',authorized(result.access_token),fetchImpl)
      if(typeof profile.email!=='string'||profile.verified_email!==true)fail('google_account_unverified',403)
      const connection={...scope,connection_id:crypto.randomUUID()}
      await pas.storage.put(objectKey(connection),await sealCredential({refresh_token:result.refresh_token},config.key,objectKey(connection)),{contentType:'application/json'})
      let saved=false
      try {
        saved=changed(await pas.actions.call('finish_google_calendar_oauth',{...connection,state_hash,claim_id,expected_version:claim.expected_version,account_email:profile.email,operation_id:crypto.randomUUID()}))
      } catch { /* Read back after an uncertain database response before erasing the credential. */ }
      if(!saved)saved=(await settings(pas,scope,true)).connection_id===connection.connection_id
      if(!saved) {
        await pas.storage.put(objectKey(connection),'{}',{contentType:'application/json'})
        fail('connection_changed',409)
      }
      if(old.connection_id)await pas.storage.put(objectKey(old),'{}',{contentType:'application/json'})
      return Response.json({return_to:settingsPath(scope)})
    }
    const scope=scopeOf(request.method==='GET'?Object.fromEntries(url.searchParams):body)
    if(path==='/google/status'&&request.method==='GET') {
      const c=await settings(pas,scope)
      let configured=true
      try{await configuration(pas)}catch{configured=false}
      return Response.json({status:c.status,account_email:c.account_email,calendar_id:c.calendar_id,calendar_name:c.calendar_name,version:c.version,can_manage:!!c.can_manage,configured,owner_active:!!c.owner_active})
    }
    if(path==='/google/start'&&request.method==='POST') {
      await settings(pas,scope,true)
      const config=await configuration(pas),state=random(),state_hash=await hash(state)
      if(!changed(await pas.actions.call('begin_google_calendar_oauth',{...scope,state_hash})))fail('oauth_start_limited',429)
      const auth=new URL('https://accounts.google.com/o/oauth2/v2/auth')
      auth.search=new URLSearchParams({client_id:config.client_id,redirect_uri:REDIRECT_URI,response_type:'code',scope:GOOGLE_SCOPES.join(' '),access_type:'offline',prompt:'consent',state,code_challenge:encode(await digest(await verifier(config.key,state))),code_challenge_method:'S256'}).toString()
      return Response.json({authorization_url:auth.href})
    }
    if(path==='/google/disconnect'&&request.method==='POST') {
      const c=await settings(pas,scope,true)
      if(body.expected_version!==c.version)fail('connection_changed',409)
      const result=await pas.actions.call('disconnect_google_calendar',{...scope,expected_version:body.expected_version,operation_id:crypto.randomUUID()})
      if(!changed(result))fail('connection_changed',409)
      if(c.connection_id)await pas.storage.put(objectKey(c),'{}',{contentType:'application/json'})
      return Response.json({ok:true})
    }
    if(!['/google/calendars','/google/select','/google/events','/google/track'].includes(path))return new Response('Not found',{status:404})
    if((['/google/calendars','/google/events'].includes(path)&&request.method!=='GET')||(['/google/select','/google/track'].includes(path)&&request.method!=='POST'))return new Response('Method not allowed',{status:405})
    const c=await activeConnection(pas,scope)
    if(path==='/google/select'&&!c.can_manage)fail('forbidden',403)
    const token=await getConnectionToken(pas,c,fetchImpl)
    if(path==='/google/calendars') {
      const calendars=await listGoogle('users/me/calendarList',token,{minAccessRole:'reader',fields:'items(id,summary,primary),nextPageToken'},fetchImpl)
      return Response.json({calendars:calendars.map(v=>({id:v.id,name:v.summary,primary:!!v.primary}))})
    }
    if(path==='/google/select') {
      if(body.expected_version!==c.version)fail('connection_changed',409)
      if(typeof body.calendar_id!=='string'||!body.calendar_id||body.calendar_id.length>1024)fail('invalid_calendar')
      const calendar=await googleJson('https://www.googleapis.com/calendar/v3/users/me/calendarList/'+encodeURIComponent(body.calendar_id),authorized(token),fetchImpl)
      if(!['reader','writer','owner'].includes(calendar.accessRole)||calendar.id!==body.calendar_id)fail('google_forbidden',403)
      if(!changed(await pas.actions.call('select_google_calendar',{...scope,connection_id:c.connection_id,expected_version:body.expected_version,calendar_id:calendar.id,calendar_name:String(calendar.summary??calendar.id).slice(0,1000),operation_id:crypto.randomUUID()})))fail('connection_changed',409)
      return Response.json({ok:true})
    }
    if(!c.calendar_id)fail('select_calendar_first',409)
    if(path==='/google/events') {
      const events=await listGoogle(`calendars/${encodeURIComponent(c.calendar_id)}/events`,token,{singleEvents:'true',orderBy:'startTime',timeMin:new Date(now()-7*86_400_000).toISOString(),timeMax:new Date(now()+30*86_400_000).toISOString(),fields:'items(id,summary,status,start,end,hangoutLink,conferenceData),nextPageToken'},fetchImpl)
      return Response.json({events:events.flatMap(e=>{const occurrence=calendarOccurrence(e);return occurrence&&occurrence.event_status==='confirmed'?[{id:e.id,title:e.summary??'Meeting',...occurrence}]:[]})})
    }
    if(typeof body.event_id!=='string'||!body.event_id||body.event_id.length>1024)fail('invalid_event')
    if(typeof body.application_id!=='string'||!body.application_id||body.application_id.length>128)fail('invalid_application')
    const occurrence=calendarOccurrence(await calendarEvent(c.calendar_id,body.event_id,token,fetchImpl))
    if(!occurrence||occurrence.event_status!=='confirmed')fail('meeting_unavailable',409)
    const {event_status,...timing}=occurrence
    const target_id='calendar-'+await hash(JSON.stringify([scope.organization_id,scope.brand_id,body.application_id,c.calendar_id,body.event_id]))
    const lookup={...scope,application_id:body.application_id,target_id}
    const existing=rows(await pas.actions.call('list_meeting_attendance',lookup))[0]
    if(existing?.enabled===1&&existing.google_user_id&&(!body.google_user_id||body.google_user_id===existing.google_user_id))return Response.json({ok:true,target_id})
    // The existing scoped action also checks application access and erasure.
    await pas.actions.call('configure_meeting_attendance',{...scope,target_id,application_id:body.application_id,kind:'working_interview',interview_id:null,calendar_id:c.calendar_id,calendar_event_id:body.event_id,google_user_id:body.google_user_id||existing?.google_user_id||null,...timing,enabled:1,expected_version:existing?.version??0,operation_id:crypto.randomUUID()})
    const saved=rows(await pas.actions.call('list_meeting_attendance',lookup)).some(t=>t.id===target_id&&t.enabled===1)
    if(!saved)fail('forbidden',403)
    return Response.json({ok:true,target_id})
  } catch(error) {
    return Response.json({error:error instanceof CalendarError?error.code:'calendar_request_failed'},{status:error instanceof CalendarError?error.status:500})
  }
}
