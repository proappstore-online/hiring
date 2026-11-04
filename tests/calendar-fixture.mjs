import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fixture } from './playbook-fixture.mjs'

const tools=JSON.parse(readFileSync(new URL('../mcp.json',import.meta.url))).tools
export const calendarScope={organization_id:'a',brand_id:'brand-a'}
export const calendarNow=Date.parse('2026-11-04T01:00:00Z')
export function calendarFixture() {
  const f=fixture(), logs=[], grants=new Map(), connectorCalls=[]
  const google={connected:false,event:{id:'event1',summary:'Interview',status:'confirmed',start:{dateTime:new Date(calendarNow-3_600_000).toISOString()},end:{dateTime:new Date(calendarNow-1_800_000).toISOString()},hangoutLink:'https://meet.google.com/abc-defg-hij'}}
  let user='owner-a',now=calendarNow
  f.call('create_application','owner-a',{...calendarScope,application_id:'app-a',requisition_id:'req-a',candidate_id:'candidate-a',operation_id:'candidate-create',candidate_name:'Candidate',email:'candidate@example.com',phone:'',source:'manual',source_detail:'Direct',basis_reference:'recruitment',contact_context:'Direct',assignee_user_id:'owner-a'})
  const call=(name,values={})=>{
    const t=tools.find(t=>t.name===name);assert.ok(t,name)
    const params={...Object.fromEntries(Object.entries(t.params).filter(([,v])=>v.optional).map(([k])=>[k,null])),...values,__user_id:user,__now:now}
    f.db.exec('BEGIN')
    try {
      const results=(t.statements??[t.sql]).map(sql=>{
        const bindings=[]
        const stmt=f.db.prepare(sql.replace(/:([a-z_][a-z0-9_]*)/gi,(_,key)=>{assert.notEqual(params[key],undefined,key);bindings.push(params[key]);return '?'}))
        return /^\s*(SELECT|WITH)\b/i.test(sql)?{rows:stmt.all(...bindings).map(r=>({...r}))}:{meta:{changes:stmt.run(...bindings).changes}}
      })
      f.db.exec('COMMIT');return t.operation==='batch'?{results}:results[0]
    }catch(e){f.db.exec('ROLLBACK');throw e}
  }
  const connector=async(name,input)=>{
    assert.equal(name,'calendar');connectorCalls.push({...input,user})
    if(input.operation==='status')return {configured:true,connected:google.connected,email:google.connected?'organizer@example.test':null,version:1}
    if(input.operation==='start')return {authorization_url:'https://accounts.google.com/o/oauth2/v2/auth?state='+ 'a'.repeat(43)}
    if(input.operation==='complete'){google.connected=true;return {return_to:'/recruiter/organizations/a/brands/brand-a/settings'}}
    if(input.operation==='calendars')return {calendars:[{id:'team@example.test',name:'Recruiting',primary:false}],next_page_token:null}
    if(input.operation==='grant'){
      if(!google.connected)return {error:'reconnect_required',status:409}
      const grant={grant_id:crypto.randomUUID(),calendar_id:input.calendar_id,calendar_name:'Recruiting',account_email:'organizer@example.test',user_id:user}
      grants.set(grant.grant_id,grant);return grant
    }
    const grant=grants.get(input.grant_id)
    if(!grant||grant.revoked)return {error:'reconnect_required',status:409}
    if(input.operation==='grant_status')return grant
    if(input.operation==='revoke_grant'){grant.revoked=true;return {revoked:true}}
    if(input.operation==='events')return {items:[google.event],nextPageToken:null}
    if(input.operation==='event')return google.event
    throw Error('Unexpected connector operation '+input.operation)
  }
  const pas={actions:{call:async(...args)=>call(...args)},connectors:{googleCalendar:connector},log:async(...args)=>logs.push(args)}
  return {...f,call,pas,logs,grants,google,connectorCalls,as:value=>{user=value},at:value=>{now=value},now:()=>now}
}
