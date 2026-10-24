import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
const tools=JSON.parse(readFileSync(new URL('../mcp.json',import.meta.url))).tools
const migrations=JSON.parse(readFileSync(new URL('../migrations.json',import.meta.url))).migrations
export const A={organization_id:'org',brand_id:'a',application_id:'app-a'}
export const B={organization_id:'org',brand_id:'b',application_id:'app-b'}
export function correctionFixture() {
  const db = new DatabaseSync(':memory:'); db.exec('PRAGMA foreign_keys=ON')
  for (const m of migrations) db.exec(m.sql)
  let now = 1000000
  const call = (name, user, values = {}) => {
    const t = tools.find(t => t.name === name); assert.ok(t, name)
    const p = { ...Object.fromEntries(Object.entries(t.params).filter(([,v]) => v.optional).map(([k]) => [k,null])), ...values, __user_id: user, __now: now, __uuid: crypto.randomUUID() }
    db.exec('BEGIN')
    try {
      const out = (t.statements ?? [t.sql]).map(s => {
        const binds=[]; const sql=s.replace(/:([a-z_][a-z0-9_]*)/gi, (_,k) => { assert.notEqual(p[k],undefined,k); binds.push(p[k]); return '?' })
        return t.operation === 'query' ? db.prepare(sql).all(...binds).map(x=>({...x})) : db.prepare(sql).run(...binds).changes
      }); db.exec('COMMIT'); return t.operation === 'query' ? out[0] : out.at(-1)
    } catch(e) { db.exec('ROLLBACK'); throw e }
  }
  for (const s of [A,B]) {
    const b=s.brand_id
    call('create_workspace','root',{...s,requisition_id:'req-'+b,organization_name:'Org',brand_name:b,requisition_title:'Role',operation_id:'boot-'+b})
    db.prepare("INSERT INTO hiring_memberships(id,organization_id,brand_id,user_id,role,created_at) VALUES (?,'org',?,?,'owner',0)").run('owner-'+b,b,'owner-'+b)
    call('create_linkedin_application','owner-'+b,{...s,requisition_id:'req-'+b,candidate_id:'c-'+b,candidate_name:'Private '+b,email:b+'@example.test',phone:'123',linkedin_url:'',source_detail:'CONFIDENTIAL SOURCE',basis_reference:'basis',contact_context:'CONFIDENTIAL CONTEXT',assignee_user_id:'owner-'+b,operation_id:'person-'+b})
  }
  return {db,call,advance:ms=>{now+=ms}}
}
export const correctionEvent = (s, version=0, status='received', extra={}) => ({...s,request_id:'rights-'+s.brand_id,operation_id:crypto.randomUUID(),request_type:'correction',expected_version:version,status,owner_user_id:'owner-'+s.brand_id,deadline_at:5000000,...extra})
export function correctionVerified(f,s=A) {
  for (const [n,status] of ['received','identity_verification','processing'].entries()) assert.equal(f.call('record_candidate_rights_event','owner-'+s.brand_id,correctionEvent(s,n,status,n===2?{proof_reference:'identity-case-reference'}:{})),1)
}
const exp = (s=A,id=crypto.randomUUID()) => ({...s,rights_request_id:'rights-'+s.brand_id,request_id:id})
