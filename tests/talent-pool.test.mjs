import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { fixture, A, B, application } from './receipt-fixture.mjs'

function enrolled() {
  const f = fixture(); f.publish()
  f.call('submit_job_application', 'worker', { ...application(), talent_pool_consent: 1, communications_consent: 1 })
  return f
}
test('talent pool requires independent affirmative consent and excludes historical evidence without terms', () => {
  const f = fixture(); try {
    f.submit()
    assert.deepEqual(f.call('list_talent_pool','owner',A), [])
    f.db.exec("INSERT INTO hiring_consent_records(id,organization_id,brand_id,application_id,purpose,legal_basis,notice_version,evidence_reference,actor_user_id,recorded_at) VALUES('historical','org','a','application-a','talent_pool','consent','old','checkbox','worker',0)")
    f.db.exec("DELETE FROM hiring_talent_pool_terms WHERE consent_id='historical'")
    assert.deepEqual(f.call('list_talent_pool','owner',A), [])
  } finally { f.db.close() }
})
test('pool is brand-only, full-brand recruiter/owner only, and expires exactly 180 days after consent', () => {
  const f = enrolled(); try {
    const rows = f.call('list_talent_pool','owner',A)
    assert.equal(rows.length,1); assert.equal(rows[0].email,'candidate@example.com')
    for (const [user,scope] of [['staff-b',A],['worker',A],['outsider',A],['staff-a',B],['owner',B]]) assert.deepEqual(f.call('list_talent_pool',user,scope),[])
    f.call('grant_workspace_access','owner',{...A,grant_id:'limited',member_user_id:'limited',role:'recruiter',requisition_id:A.requisition_id,operation_id:'grant-limited'})
    assert.deepEqual(f.call('list_talent_pool','limited',A),[])
    assert.equal(f.call('list_talent_pool','staff-a',A).length,1)
    assert.equal(f.call('get_my_talent_pool','other-worker',{...A,application_id:'application-a'}).length,0)
    f.advance(15552000000-1); assert.equal(f.call('list_talent_pool','owner',A).length,1)
    f.advance(1); assert.deepEqual(f.call('list_talent_pool','owner',A),[])
    assert.deepEqual(f.call('get_my_talent_pool','worker',{...A,application_id:'application-a'}),[])
    assert.throws(()=>f.db.exec('UPDATE hiring_talent_pool_terms SET expires_at=999999999999'),/immutable/)
  } finally { f.db.close() }
})
test('candidate can withdraw only own scoped pool consent; other purposes and application remain unchanged', () => {
  const f = enrolled(); try {
    const p={...A,application_id:'application-a',operation_id:'pool-withdraw'}
    assert.deepEqual(f.call('withdraw_my_talent_pool','other-worker',p),[0,0])
    assert.deepEqual(f.call('withdraw_my_talent_pool','worker',{...p,...B}),[0,0])
    assert.deepEqual(f.call('withdraw_my_talent_pool','worker',p),[1,1])
    assert.deepEqual(f.call('withdraw_my_talent_pool','worker',p),[0,0])
    assert.deepEqual(f.call('list_talent_pool','owner',A),[])
    assert.equal(f.db.prepare("SELECT COUNT(*) n FROM hiring_consent_records WHERE purpose<>'talent_pool' AND withdrawn_at IS NOT NULL").get().n,0)
    assert.equal(f.db.prepare("SELECT stage FROM hiring_applications WHERE id='application-a'").get().stage,'submitted')
    assert.equal(f.db.prepare("SELECT COUNT(*) n FROM hiring_audit_events WHERE action='privacy.talent_pool.withdrawn'").get().n,1)
  } finally { f.db.close() }
})
test('erasure removes pool terms immediately; pool uses current canonical profile without duplicate personal data', () => {
  const f=enrolled(); try {
    f.db.exec("UPDATE hiring_candidates SET name='Corrected' WHERE id='candidate-a'")
    assert.equal(f.call('list_talent_pool','owner',A)[0].name,'Corrected')
    const schema=f.db.prepare('PRAGMA table_info(erasure_requests)').all();
    const values={id:'erase',organization_id:'org',brand_id:'a',candidate_id:'candidate-a',application_id:'application-a',actor_user_id:'owner',created_at:1000000000}
    const cols=schema.filter(c=>c.dflt_value===null)
    f.db.prepare(`INSERT INTO erasure_requests(${cols.map(c=>c.name)}) VALUES(${cols.map(()=>'?')})`).run(...cols.map(c=>values[c.name]??(c.type==='INTEGER'?1:'verified')))
    assert.deepEqual(f.call('list_talent_pool','owner',A),[])
    assert.equal(f.db.prepare('SELECT COUNT(*) n FROM hiring_talent_pool_terms').get().n,0)
  } finally { f.db.close() }
})
test('brand withdrawal covers independently created profiles owned by the same worker and preserves other brands', () => {
  const f=enrolled(); try {
    f.advance()
    f.call('submit_job_application','worker',{...application(B,'b'),talent_pool_consent:1})
    // Separate imported application/profile still belongs to the same signed-in candidate.
    f.call('create_linkedin_application','owner',{...A,candidate_id:'second',application_id:'second-app',candidate_name:'Second',email:'second@example.com',phone:'',linkedin_url:'',source_detail:'manual',basis_reference:'basis',contact_context:'context',assignee_user_id:'owner',operation_id:'second-create'})
    f.db.exec("UPDATE hiring_candidates SET worker_user_id='worker' WHERE id='second'; INSERT INTO hiring_consent_records(id,organization_id,brand_id,application_id,purpose,legal_basis,notice_version,evidence_reference,actor_user_id,recorded_at) VALUES('second-consent','org','a','second-app','talent_pool','consent','v1','affirmative','worker',1000010001)")
    assert.equal(f.call('list_talent_pool','owner',A).length,2)
    f.call('withdraw_my_talent_pool','worker',{...A,application_id:'application-a',operation_id:'all-brand'})
    assert.equal(f.call('list_talent_pool','owner',A).length,0)
    assert.equal(f.call('list_talent_pool','owner',B).length,1)
  } finally { f.db.close() }
})

test('populated upgrade never enrolls historical talent consent', () => {
  const migrations=JSON.parse(readFileSync(new URL('../migrations.json',import.meta.url))).migrations
  const db=new DatabaseSync(':memory:')
  try {
    for(const m of migrations.slice(0,-1)) db.exec(m.sql)
    db.exec("INSERT INTO hiring_organizations(id,name,created_by,created_at) VALUES('org','Org','owner',1); INSERT INTO hiring_brands(id,organization_id,name,created_at) VALUES('a','org','A',1); INSERT INTO hiring_requisitions(id,organization_id,brand_id,title,created_at) VALUES('req','org','a','Role',1); INSERT INTO hiring_candidates(id,organization_id,brand_id,name,linkedin_url,created_by,created_at) VALUES('c','org','a','Candidate','','owner',1); INSERT INTO hiring_applications(id,organization_id,brand_id,requisition_id,candidate_id,source,source_detail,basis_reference,contact_context,assignee_user_id,stage,version,created_by,created_at,updated_at) VALUES('app','org','a','req','c','linkedin','manual','basis','context','owner','submitted',1,'owner',1,1); INSERT INTO hiring_consent_records(id,organization_id,brand_id,application_id,purpose,legal_basis,notice_version,evidence_reference,actor_user_id,recorded_at) VALUES('old','org','a','app','talent_pool','consent','old','checkbox','candidate',1)")
    db.exec(migrations.at(-1).sql)
    assert.equal(db.prepare('SELECT COUNT(*) n FROM hiring_consent_records').get().n,1)
    assert.equal(db.prepare('SELECT COUNT(*) n FROM hiring_talent_pool_terms').get().n,0)
  } finally { db.close() }
})
