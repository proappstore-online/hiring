import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fixture } from './playbook-fixture.mjs'

const tools=JSON.parse(readFileSync(new URL('../mcp.json',import.meta.url))).tools
export const calendarScope={organization_id:'a',brand_id:'brand-a'}
export const calendarNow=Date.parse('2026-11-04T01:00:00Z')
export function calendarFixture() {
  const f=fixture(), storage=new Map(), logs=[]
  let user='owner-a',now=calendarNow
  const secrets={HIRING_GOOGLE_CLIENT_ID:'client-id',HIRING_GOOGLE_CLIENT_SECRET:'client-secret',HIRING_GOOGLE_TOKEN_KEY:'ab'.repeat(32)}
  f.call('create_application','owner-a',{...calendarScope,application_id:'app-a',requisition_id:'req-a',candidate_id:'candidate-a',operation_id:'candidate-create',candidate_name:'Candidate',email:'candidate@example.com',phone:'',source:'manual',source_detail:'Direct',basis_reference:'recruitment',contact_context:'Direct',assignee_user_id:'owner-a'})
  const call=(name,values={})=>{
    const t=tools.find(t=>t.name===name);assert.ok(t,name)
    const params={...Object.fromEntries(Object.entries(t.params).filter(([,v])=>v.optional).map(([k])=>[k,null])),...values,__user_id:user,__now:now}
    f.db.exec('BEGIN')
    try {
      const results=(t.statements??[t.sql]).map(sql=>{
        const bindings=[]
        const stmt=f.db.prepare(sql.replace(/:([a-z_][a-z0-9_]*)/gi,(_,key)=>{assert.notEqual(params[key],undefined,key);bindings.push(params[key]);return '?'}))
        return /^\s*SELECT\b/i.test(sql)?{rows:stmt.all(...bindings).map(r=>({...r}))}:{meta:{changes:stmt.run(...bindings).changes}}
      })
      f.db.exec('COMMIT');return t.operation==='batch'?{results}:results[0]
    }catch(e){f.db.exec('ROLLBACK');throw e}
  }
  const pas={actions:{call:async(...args)=>call(...args)},secrets:{get:async key=>secrets[key]??null},storage:{put:async(key,value)=>{storage.set(key,value);return{key,size:value.length}},get:async key=>storage.has(key)?{body:new TextEncoder().encode(storage.get(key)).buffer}:null},log:async(...args)=>logs.push(args)}
  return {...f,call,pas,storage,logs,secrets,as:value=>{user=value},at:value=>{now=value},now:()=>now}
}
