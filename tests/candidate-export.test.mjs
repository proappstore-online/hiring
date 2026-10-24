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

import { assembleCandidateExports } from '../worker/exports.mjs'
import { requestAsyncCandidateExport, downloadAsyncCandidateExport } from '../scripts/privacy.mjs'
const worker='system:worker'
function queued(f) { verified(f);const p=exp();f.call('request_candidate_export','owner-a',p);assert.equal(f.call('queue_candidate_export','owner-a',p),1);return p }
const assembled=(f,p)=>f.call('assemble_candidate_export',worker,p)
const download=(f,p,user='owner-a')=>{
  const v={...p,access_id:crypto.randomUUID()}
  f.call('authorize_candidate_export_download',user,v)
  return f.call('download_candidate_export',user,v)
}
test('async snapshot is private, brand scoped, immutable on retry and excludes confidential fields', async()=>{
  const f=fixture(),{db,call}=f,p=queued(f)
  assert.equal(call('queue_candidate_export','owner-a',p),0)
  assert.equal(call('get_candidate_export_status','owner-a',p)[0].state,'queued')
  assert.deepEqual(download(f,p),[])
  assert.deepEqual(call('list_candidate_export_queue','owner-a',{}),[])
  assert.equal(call('assemble_candidate_export','owner-a',p),0)
  const actions=async(name,values)=>({rows:call(name,worker,values)})
  assert.deepEqual(await assembleCandidateExports({actions}),{attempted:1})
  assert.equal(call('get_candidate_export_status','owner-a',p)[0].state,'ready')
  const [row]=download(f,p),payload=JSON.parse(row.payload_json)
  assert.equal(payload.candidate.email,'a@example.test')
  assert.equal(payload.applications.length,1)
  assert.deepEqual(payload.submissions,[]);assert.deepEqual(payload.attachments,[])
  assert.doesNotMatch(row.payload_json,/CONFIDENTIAL|Private b|b@example|storage_path|proof_reference|actor_user_id/)
  db.exec("UPDATE hiring_candidates SET name='Changed' WHERE id='c-a'")
  assert.equal(assembled(f,p),0)
  assert.equal(JSON.parse(download(f,p)[0].payload_json).candidate.name,'Private a')
  for(const user of ['owner-b','outsider']) {
    assert.deepEqual(download(f,p,user),[])
    assert.deepEqual(call('get_candidate_export_status',user,p),[])
  }
  assert.deepEqual(download(f,{...p,...B}),[])
  assert.equal(db.prepare("SELECT count(*) n FROM hiring_audit_events WHERE action='privacy.export.ready'").get().n,1)
  assert.ok(db.prepare("SELECT count(*) n FROM hiring_privacy_access WHERE action='candidate_export_download'").get().n>=6)
  db.close()
})
test('expiry is absolute for queue, worker and download; access receipt cannot extend it',()=>{
  const f=fixture(),p=queued(f);assembled(f,p)
  const v={...p,access_id:crypto.randomUUID()};f.call('authorize_candidate_export_download','owner-a',v)
  f.advance(60000);assert.deepEqual(f.call('download_candidate_export','owner-a',v),[])
  assert.equal(download(f,p).length,1)
  f.advance(840000)
  assert.deepEqual(download(f,p),[])
  assert.deepEqual(f.call('get_candidate_export_status','owner-a',p),[])
  assert.equal(f.call('queue_candidate_export','owner-a',p),0)
  assert.equal(assembled(f,p),0)
  f.db.close()
})
test('revocation and terminal identity-review state invalidate both queued and assembled access',()=>{
  for(const ready of [false,true]) {
    const f=fixture(),p=queued(f);if(ready)assembled(f,p)
    f.db.exec("DELETE FROM hiring_memberships WHERE user_id IN ('owner-a','root') AND brand_id='a'")
    assert.equal(assembled(f,p),0);assert.deepEqual(download(f,p),[]);f.db.close()
    const g=fixture(),q=queued(g);if(ready)assembled(g,q)
    g.call('record_candidate_rights_event','owner-a',event(A,3,'denied_with_reason',{proof_reference:'case',decision_reference:'denial'}))
    assert.equal(assembled(g,q),0);assert.deepEqual(download(g,q),[]);g.db.close()
  }
})
test('erasure removes durable artifact and blocks later resurrection or redemption',()=>{
  const f=fixture(),p=queued(f);assembled(f,p)
  // Same durable erasure request used by all existing export and retention fences.
  f.db.prepare("INSERT INTO erasure_requests(id,organization_id,brand_id,application_id,candidate_id,operation_id,actor_user_id,identity_verified,holds_reviewed,created_at) VALUES ('delete','org','a','app-a','c-a','delete-op','owner-a',1,1,1000000)").run()
  assert.equal(f.db.prepare('SELECT count(*) n FROM hiring_export_jobs').get().n,0)
  assert.equal(f.call('queue_candidate_export','owner-a',p),0)
  assert.deepEqual(download(f,p),[]);f.db.close()
})
test('audit failures roll back snapshot readiness and access receipts',()=>{
  const f=fixture(),p=queued(f)
  f.db.exec("CREATE TRIGGER fail_export_audit BEFORE INSERT ON hiring_audit_events WHEN NEW.action='privacy.export.ready' BEGIN SELECT RAISE(ABORT,'audit unavailable'); END")
  assert.throws(()=>assembled(f,p),/audit unavailable/)
  assert.equal(f.call('get_candidate_export_status','owner-a',p)[0].state,'queued')
  f.db.exec('DROP TRIGGER fail_export_audit');assembled(f,p)
  f.db.exec("CREATE TRIGGER fail_download_audit BEFORE INSERT ON hiring_audit_events WHEN NEW.object_id='candidate_export_download' BEGIN SELECT RAISE(ABORT,'audit unavailable'); END")
  const v={...p,access_id:crypto.randomUUID()}
  assert.throws(()=>f.call('authorize_candidate_export_download','owner-a',v),/audit unavailable/)
  assert.deepEqual(f.call('download_candidate_export','owner-a',v),[]);f.db.close()
})
test('client queues separately and logs every private artifact download',async()=>{
  const f=fixture();verified(f);const p=exp()
  const actions=async(name,values)=>{const result=f.call(name,'owner-a',values);return {rows:Array.isArray(result)?result:[]}}
  assert.equal((await requestAsyncCandidateExport(actions,p)).state,'queued')
  assert.equal(f.call('get_candidate_export_status','owner-a',p)[0].state,'ready')
  assembled(f,p)
  assert.equal((await downloadAsyncCandidateExport(actions,p)).candidate.email,'a@example.test')
  assert.equal((await requestAsyncCandidateExport(actions,p)).state,'ready')
  f.db.close()
})

test('interactive assembly is scoped to the requesting owner and resumes after response loss',()=>{
  const f=fixture(),p=queued(f)
  assert.equal(f.call('prepare_candidate_export','owner-b',p),0)
  assert.equal(f.call('prepare_candidate_export','owner-a',{...p,rights_request_id:'other'}),0)
  assert.equal(f.call('prepare_candidate_export','owner-a',p),1)
  assert.equal(f.call('prepare_candidate_export','owner-a',p),0)
  assert.equal(download(f,p).length,1);f.db.close()
})
test('subject submission and file metadata are projected without storage keys or account identifiers',()=>{
  const f=fixture(),p=queued(f)
  f.db.exec("INSERT INTO hiring_worker_profiles(user_id,display_name,created_at,updated_at) VALUES ('worker-secret','Private account',0,0)")
  f.db.prepare("INSERT INTO hiring_intake_receipts VALUES ('app-a','org','a','req-a','worker-secret','secret-key',?,0)").run(JSON.stringify({statement:'My application statement',notice_acknowledged:1,private_extra:'NEVER EXPORT'}))
  f.db.exec("INSERT INTO hiring_attachments(id,organization_id,brand_id,application_id,uploader_user_id,filename,storage_path,mime_type,size_bytes,checksum,scan_state,operation_id,created_at) VALUES ('file','org','a','app-a','worker-secret','cv.pdf','private/storage/key','application/pdf',100,'"+'a'.repeat(64)+"','clean','file-op',0)")
  assembled(f,p)
  const body=download(f,p)[0].payload_json,row=JSON.parse(body)
  assert.equal(row.submissions[0].statement,'My application statement')
  assert.equal(row.attachments[0].filename,'cv.pdf')
  assert.doesNotMatch(body,/private\/storage|worker-secret|secret-key|NEVER EXPORT/)
  f.db.close()
})
test('restored and cross-store deletion tombstones revoke persisted exports',()=>{
  const f=fixture(),p=queued(f);assembled(f,p)
  f.db.exec("INSERT INTO hiring_deletion_requests(id,organization_id,brand_id,candidate_id,application_id,actor_user_id,created_at,origin) VALUES ('restore-delete','org','a','c-a','app-a','system:worker',1000000,'restore')")
  assert.equal(f.db.prepare('SELECT count(*) n FROM hiring_export_jobs').get().n,0)
  assert.equal(f.call('queue_candidate_export','owner-a',p),0)
  assert.deepEqual(download(f,p),[]);f.db.close()
})
