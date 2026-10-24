import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
const tools = JSON.parse(readFileSync(new URL('../mcp.json', import.meta.url))).tools
const migrations = JSON.parse(readFileSync(new URL('../migrations.json', import.meta.url))).migrations
const A = { organization_id: 'org', brand_id: 'a', application_id: 'app-a' }
const B = { organization_id: 'org', brand_id: 'b', application_id: 'app-b' }
function fixture() {
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
const event = (s, version=0, status='received', extra={}) => ({...s,request_id:'rights-'+s.brand_id,operation_id:crypto.randomUUID(),request_type:'export',expected_version:version,status,owner_user_id:'owner-'+s.brand_id,deadline_at:5000000,...extra})
function verified(f,s=A) {
  for (const [n,status] of ['received','identity_verification','processing'].entries()) assert.equal(f.call('record_candidate_rights_event','owner-'+s.brand_id,event(s,n,status,n===2?{proof_reference:'identity-case-reference'}:{})),1)
}
const exp = (s=A,id=crypto.randomUUID()) => ({...s,rights_request_id:'rights-'+s.brand_id,request_id:id})

test('rights lifecycle has exact brand owner scope, identity evidence, deadlines, versions and immutable audit',()=>{
  const {db,call}=fixture()
  const input=event(A)
  for(const user of ['owner-b','outsider']) assert.equal(call('record_candidate_rights_event',user,{...input,role:'owner',actor_user_id:'owner-a'}),0)
  assert.equal(call('record_candidate_rights_event','owner-a',input),1)
  assert.equal(call('record_candidate_rights_event','owner-a',input),0)
  assert.equal(call('record_candidate_rights_event','owner-a',event(A,0)),0)
  assert.equal(call('record_candidate_rights_event','owner-a',event(A,1,'processing',{proof_reference:'proof'})),0)
  assert.equal(call('record_candidate_rights_event','owner-a',event(A,1,'identity_verification')),1)
  assert.equal(call('record_candidate_rights_event','owner-a',event(A,2,'processing')),0)
  assert.equal(call('record_candidate_rights_event','owner-a',event(A,2,'processing',{proof_reference:'proof'})),1)
  assert.equal(call('record_candidate_rights_event','owner-a',event(A,3,'fulfilled',{proof_reference:'proof'})),0)
  assert.equal(call('record_candidate_rights_event','owner-a',event(A,3,'fulfilled',{proof_reference:'proof',decision_reference:'delivery-evidence'})),1)
  assert.equal(call('record_candidate_rights_event','owner-a',event(A,4,'processing',{proof_reference:'proof'})),0)
  assert.equal(call('list_candidate_rights_events','owner-b',A).length,0)
  assert.equal(call('list_candidate_rights_events','owner-a',A).length,4)
  assert.equal(db.prepare("SELECT count(*) n FROM hiring_audit_events WHERE action LIKE 'privacy.rights.%'").get().n,4)
  assert.throws(()=>db.exec("UPDATE hiring_rights_events SET proof_reference='changed'"),/append-only/)
  assert.throws(()=>db.exec('DELETE FROM hiring_rights_events'),/append-only/)
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);db.close()
})

test('private export works independently for two brands, requires recorded verification, and excludes confidential data',()=>{
  const f=fixture(),{db,call}=f
  for(const s of [A,B]) {
    const user='owner-'+s.brand_id,p=exp(s)
    assert.equal(call('get_candidate_export',user,p).length,0)
    call('request_candidate_export',user,p)
    assert.equal(call('get_candidate_export',user,p).length,0)
    verified(f,s)
    const q=exp(s);call('request_candidate_export',user,q)
    const [row]=call('get_candidate_export',user,q)
    assert.equal(row.email,s.brand_id+'@example.test')
    assert.equal(JSON.parse(row.applications_json)[0].application_id,s.application_id)
    assert.doesNotMatch(JSON.stringify(row),/CONFIDENTIAL|storage_path|worker_user_id|proof_reference|scorecard/)
    assert.equal(row.coverage,'scoped_core_export')
    assert.equal(call('get_candidate_export',s===A?'owner-b':'owner-a',q).length,0)
    assert.equal(call('get_candidate_export',user,{...q,...(s===A?B:A)}).length,0)
    assert.equal(call('request_candidate_export',user,q),0)
  }
  assert.equal(db.prepare("SELECT count(*) n FROM hiring_privacy_access WHERE action='candidate_export'").get().n,4)
  db.close()
})

test('export is denied to recruiters and revoked owners, expires at server time, and is invalidated by erasure',()=>{
  const f=fixture(),{db,call}=f;verified(f)
  call('add_workspace_member','owner-a',{...A,member_user_id:'recruiter',role:'recruiter',operation_id:'member'})
  const p=exp();call('request_candidate_export','recruiter',p)
  assert.equal(call('get_candidate_export','recruiter',p).length,0)
  const q=exp();call('request_candidate_export','owner-a',q)
  assert.equal(call('get_candidate_export','owner-a',q).length,1)
  f.advance(900000);assert.equal(call('get_candidate_export','owner-a',q).length,0)
  const r=exp();call('request_candidate_export','owner-a',r)
  call('request_candidate_erasure','owner-a',{...A,operation_id:'erase',identity_verified:1,holds_reviewed:1})
  assert.equal(call('get_candidate_export','owner-a',r).length,0)
  const fresh=exp();call('request_candidate_export','owner-a',fresh)
  assert.equal(db.prepare('SELECT outcome FROM hiring_privacy_access WHERE id=?').get(fresh.request_id).outcome,'not_found')
  db.close()
})

test('audited MCP reads require actor/scope/target-bound receipts and recheck live grants and assignments',()=>{
  const f=fixture(),{db,call}=f
  const p={...A,request_id:'read-a'}
  assert.equal(call('audited_gateway_get_application','owner-a',p).length,0)
  assert.equal(call('authorize_gateway_get_application','owner-a',p),1)
  assert.equal(call('audited_gateway_get_application','owner-a',p).length,1)
  assert.equal(call('audited_gateway_get_application','owner-b',p).length,0)
  assert.equal(call('audited_gateway_get_application','owner-a',{...p,...B}).length,0)
  for(const [user,scope] of [['owner-b',A],['outsider',A],['owner-a',{...A,application_id:'missing'}],['owner-a',{...A,brand_id:'missing'}]]) {
    const q={...scope,request_id:crypto.randomUUID()};call('authorize_gateway_get_application',user,q)
    assert.equal(call('audited_gateway_get_application',user,q).length,0)
    assert.equal(db.prepare('SELECT outcome FROM hiring_privacy_access WHERE id=?').get(q.request_id).outcome,'not_found')
  }
  f.advance(60000);assert.equal(call('audited_gateway_get_application','owner-a',p).length,0)
  const q={...A,request_id:'revoked'};call('authorize_gateway_get_application','owner-a',q)
  db.exec("INSERT INTO hiring_membership_revocations(membership_id,actor_user_id,operation_id,created_at) SELECT id,'root','revoked',0 FROM hiring_memberships WHERE user_id='owner-a' AND brand_id='a'")
  assert.equal(call('audited_gateway_get_application','owner-a',q).length,0)
  db.close()
})

test('privacy audit failure prevents export authorization or rights mutation; committed denial evidence is immutable',()=>{
  const f=fixture(),{db,call}=f;verified(f)
  const p={...A,request_id:'denial'};call('authorize_gateway_get_application','outsider',p)
  assert.throws(()=>db.exec('DELETE FROM hiring_privacy_access'),/append-only/)
  assert.equal(call('list_privacy_access_events','owner-b',A).length,0)
  assert.equal(call('list_privacy_access_events','owner-a',A)[0].outcome,'not_found')
  db.exec("CREATE TRIGGER synthetic_audit_failure BEFORE INSERT ON hiring_audit_events BEGIN SELECT RAISE(ABORT,'audit unavailable'); END")
  const q=exp();assert.throws(()=>call('request_candidate_export','owner-a',q),/audit unavailable/)
  assert.equal(db.prepare('SELECT count(*) n FROM hiring_privacy_access WHERE id=?').get(q.request_id).n,0)
  assert.throws(()=>call('record_candidate_rights_event','owner-a',event(A,3,'fulfilled',{proof_reference:'proof',decision_reference:'evidence'})),/audit unavailable/)
  assert.equal(call('list_candidate_rights_events','owner-a',A).length,3);db.close()
})

test('every new SQL action declares its parameters and derives caller identity from platform bindings',()=>{
  for(const t of tools.filter(t=>/^(authorize_gateway_|audited_gateway_|.*candidate_(rights|export)|list_privacy_access)/.test(t.name))) {
    assert.equal(t.requires_auth,true);assert.match(t.sql,/:__user_id/)
    assert.ok(!t.sql.includes(';'))
    const used=[...new Set([...t.sql.matchAll(/:([a-z_][a-z0-9_]*)/gi)].map(x=>x[1]).filter(x=>!x.startsWith('__')))].sort()
    assert.deepEqual(used,Object.keys(t.params).sort(),t.name)
  }
})

import { auditedGatewayRead, retrieveCandidateExport } from '../scripts/privacy.mjs'
test('coordinators preserve authorization evidence after failed reads and reconcile lost export responses',async()=>{
  const f=fixture(),{db,call}=f;verified(f)
  const transport=async(name,params)=>{const out=call(name,'owner-a',params);return tools.find(t=>t.name===name).operation==='query'?{rows:out}:{meta:{changes:out}}}
  const broken=async(name,params)=>{if(name==='audited_gateway_get_application')throw Error('read unavailable');return transport(name,params)}
  await assert.rejects(()=>auditedGatewayRead(broken,'gateway_get_application',A,'failed-read'),/read unavailable/)
  assert.equal(db.prepare('SELECT count(*) n FROM hiring_privacy_read_failures WHERE request_id=?').get('failed-read').n,1)
  assert.equal(db.prepare('SELECT outcome FROM hiring_privacy_access WHERE id=?').get('failed-read').outcome,'authorized')
  assert.equal(call('record_privacy_read_failure','owner-b',{request_id:'failed-read'}),0)
  assert.equal(call('record_privacy_read_failure','owner-a',{request_id:'failed-read'}),0)
  assert.throws(()=>db.exec('DELETE FROM hiring_privacy_read_failures'),/append-only/)
  const p=exp()
  const lost=async(name,params)=>{const result=await transport(name,params);if(name==='request_candidate_export')throw Error('response lost');return result}
  assert.equal((await retrieveCandidateExport(lost,p)).email,'a@example.test')
  assert.equal((await retrieveCandidateExport(lost,p)).email,'a@example.test')
  assert.equal(db.prepare('SELECT count(*) n FROM hiring_privacy_access WHERE id=?').get(p.request_id).n,1)
  f.advance(900000)
  await assert.rejects(()=>retrieveCandidateExport(transport,p),/Export unavailable/)
  assert.equal(db.prepare('SELECT count(*) n FROM hiring_privacy_read_failures WHERE request_id=?').get(p.request_id).n,1)
  db.close()
})

test('all audited list/requisition actions are bounded, receipt-scoped and fail closed after grant revocation',()=>{
  const {db,call}=fixture()
  for(const name of ['gateway_list_applications','gateway_list_requisitions','gateway_get_requisition']) {
    const p={...A,requisition_id:'req-a',request_id:crypto.randomUUID()}
    assert.equal(call('authorize_'+name,'owner-a',p),1)
    const rows=call('audited_'+name,'owner-a',p);assert.ok(rows.length>0 && rows.length<=25)
    assert.equal(call('audited_'+name,'owner-b',p).length,0)
  }
  const p={...A,request_id:crypto.randomUUID()};call('authorize_gateway_get_application','owner-a',p)
  db.exec("INSERT INTO hiring_membership_revocations(membership_id,actor_user_id,operation_id,created_at) SELECT id,'root','revoke',0 FROM hiring_memberships WHERE user_id='owner-a' AND brand_id='a'")
  assert.equal(call('audited_gateway_get_application','owner-a',p).length,0)
  db.close()
})

test('export receipt cannot be rebound to another verified request and current owner revocation invalidates retrieval',()=>{
  const f=fixture(),{db,call}=f;verified(f)
  const p=exp();call('request_candidate_export','owner-a',p)
  for(const [version,status] of ['received','identity_verification','processing'].entries()) {
    assert.equal(call('record_candidate_rights_event','owner-a',event(A,version,status,{request_id:'second-rights',proof_reference:version===2?'proof':null})),1)
  }
  assert.equal(call('get_candidate_export','owner-a',{...p,rights_request_id:'second-rights'}).length,0)
  assert.equal(call('get_candidate_export','owner-a',p).length,1)
  db.exec("INSERT INTO hiring_membership_revocations(membership_id,actor_user_id,operation_id,created_at) SELECT id,'root','revoke-export',0 FROM hiring_memberships WHERE user_id='owner-a' AND brand_id='a'")
  assert.equal(call('get_candidate_export','owner-a',p).length,0)
  db.close()
})
