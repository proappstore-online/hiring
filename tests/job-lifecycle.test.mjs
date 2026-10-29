import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fixture, A, B } from './receipt-fixture.mjs'

const scoped = (operation_id, expected_version, extra = {}) => ({ ...A, operation_id, expected_version, ...extra })

test('LinkedIn expiry and repost preserve the requisition and attached applicants', () => {
  const { db, call, submit } = fixture()
  try {
    submit()
    const before = db.prepare('SELECT count(*) AS n FROM hiring_applications WHERE requisition_id=?').get(A.requisition_id).n
    assert.deepEqual(call('set_linkedin_job_id','staff-b',scoped('denied-id',1,{ linkedin_job_id:'4483241641' })),[0,0,0])
    assert.deepEqual(call('set_linkedin_job_id','owner',scoped('initial-id',1,{ linkedin_job_id:'4483241641',expiry_date:2000000000 })),[1,1,1])
    assert.equal(call('get_job_linkedin_status','owner',A)[0].linkedin_job_id,'4483241641')
    assert.equal(call('list_requisitions','owner',{ organization_id:A.organization_id,brand_id:A.brand_id }).find(r=>r.id===A.requisition_id).status,'published')
    assert.deepEqual(call('find_job_by_linkedin_id','owner',{ organization_id:A.organization_id,brand_id:A.brand_id,linkedin_job_id:'4483241641' }).map(r=>r.requisition_id),[A.requisition_id])
    assert.deepEqual(call('expire_job_requisition','staff-a',scoped('expired',2,{ reason:'LinkedIn check found posting closed',observed_linkedin_status:'closed' })),[1,1])
    assert.equal(call('get_job_linkedin_status','owner',A)[0].status,'expired')
    assert.deepEqual(call('get_public_job',null,A),[])
    assert.deepEqual(call('republish_job_requisition','owner',scoped('repost',3,{ linkedin_job_id:'4499999999',reason:'New LinkedIn posting' })),[1,1,1])
    assert.equal(call('get_job_linkedin_status','owner',A)[0].status,'published')
    assert.equal(call('get_job_linkedin_status','owner',A)[0].linkedin_job_id,'4499999999')
    assert.equal(call('get_public_job',null,A).length,1)
    assert.equal(db.prepare('SELECT count(*) AS n FROM hiring_applications WHERE requisition_id=?').get(A.requisition_id).n,before)
    assert.deepEqual(call('find_job_by_linkedin_id','owner',{ organization_id:A.organization_id,brand_id:A.brand_id,linkedin_job_id:'4483241641' }).map(r=>r.requisition_id),[A.requisition_id])
    const history=call('list_linkedin_repost_history','owner',A)
    assert.equal(history.length,2)
    assert.equal(history.find(h=>h.operation_id==='repost').previous_linkedin_job_id,'4483241641')
    assert.equal(history.find(h=>h.operation_id==='repost').new_linkedin_job_id,'4499999999')
    assert.deepEqual(call('list_linkedin_repost_history','staff-b',A),[])
    assert.deepEqual(call('republish_job_requisition','owner',scoped('repost',3,{ linkedin_job_id:'4499999999' })),[0,0,0])
    assert.throws(()=>db.exec("DELETE FROM hiring_linkedin_repost_history"),/immutable/)
    assert.equal(db.prepare('SELECT count(*) AS n FROM hiring_requisitions WHERE id=?').get(A.requisition_id).n,1)
  } finally { db.close() }
})

test('expiry date controls public discovery and wrong brand cannot change job state', () => {
  const { db, call, publish }=fixture()
  try {
    publish()
    assert.deepEqual(call('expire_job_requisition','staff-b',scoped('wrong',1)),[0,0])
    assert.deepEqual(call('set_job_expiry_date','owner',scoped('date',1,{expiry_date:1})),[1,1])
    assert.deepEqual(call('get_public_job',null,A),[])
    assert.deepEqual(call('get_job_linkedin_status','owner',{...A,brand_id:B.brand_id}),[])
    assert.deepEqual(call('expire_job_requisition','owner',scoped('exp',2)),[1,1])
    assert.deepEqual(call('republish_job_requisition','staff-a',scoped('repost',3,{linkedin_job_id:'new-id',expiry_date:2000000000})),[1,1,1])
    assert.equal(call('get_public_job',null,A).length,1)
  } finally { db.close() }
})

test('recorded LinkedIn state drives pause, expiry, and audited closure', () => {
  const { db, call, publish }=fixture()
  try {
    publish()
    assert.equal(db.prepare('SELECT lifecycle_status FROM hiring_requisitions WHERE id=?').get(A.requisition_id).lifecycle_status,'published')
    assert.deepEqual(call('record_linkedin_status','staff-b',scoped('wrong-status',1,{linkedin_status:'paused',reason:'Observed pause'})),[0,0,0])
    assert.deepEqual(call('record_linkedin_status','staff-a',scoped('pause',1,{linkedin_status:'paused',reason:'Observed pause'})),[1,1,1])
    assert.equal(call('get_job_linkedin_status','owner',A)[0].status,'paused')
    assert.equal(call('list_requisitions','owner',{organization_id:A.organization_id,brand_id:A.brand_id}).find(r=>r.id===A.requisition_id).status,'paused')
    assert.equal(db.prepare('SELECT lifecycle_status FROM hiring_requisitions WHERE id=?').get(A.requisition_id).lifecycle_status,'paused')
    assert.deepEqual(call('record_linkedin_status','owner',scoped('active',2,{linkedin_status:'active',reason:'Observed active'})),[1,1,1])
    assert.deepEqual(call('record_linkedin_status','staff-a',scoped('expired-observed',3,{linkedin_status:'expired',reason:'Posting expired',expiry_date:1000000000})),[1,1,1])
    assert.equal(call('get_job_linkedin_status','owner',A)[0].status,'expired')
    assert.equal(db.prepare('SELECT lifecycle_status,linkedin_expiry_date FROM hiring_requisitions WHERE id=?').get(A.requisition_id).lifecycle_status,'expired')
    assert.deepEqual(call('record_linkedin_status','owner',scoped('no-reopen',4,{linkedin_status:'active',reason:'Wrong transition'})),[0,0,0])
    assert.deepEqual(call('record_linkedin_status','owner',scoped('close',4,{linkedin_status:'closed',reason:'Role withdrawn'})),[1,1,1])
    assert.equal(call('get_job_linkedin_status','owner',A)[0].status,'closed')
    assert.equal(db.prepare("SELECT count(*) AS n FROM hiring_audit_events WHERE action='requisition.linkedin_status_recorded'").get().n,4)
  } finally { db.close() }
})

test('FreeGameStore correction expires only the matching posted intern requisition with audit', () => {
  const { db }=fixture()
  try {
    db.exec("UPDATE hiring_brands SET name='FreeGameStore' WHERE id='a'")
    db.exec("INSERT INTO hiring_requisitions(id,organization_id,brand_id,title,created_at) VALUES('658e8dce-test','org','a','Developer Intern',1000000000)")
    db.exec("INSERT INTO hiring_job_publications(requisition_id,organization_id,brand_id,description,location,arrangement,compensation,notice_version,notice_text,contact,actor_user_id,operation_id,created_at) VALUES('658e8dce-test','org','a','Intern','Remote','Internship','Unpaid','v1','Notice','Contact','owner','seed-intern',1000000000)")
    const migration=JSON.parse(readFileSync(new URL('../migrations.json',import.meta.url))).migrations.find(m=>m.name==='0061_expire_freegamestore_intern')
    db.exec(migration.sql.slice(migration.sql.lastIndexOf('INSERT INTO hiring_audit_events(')))
    assert.equal(db.prepare("SELECT lifecycle_status FROM hiring_job_publications WHERE requisition_id='658e8dce-test'").get().lifecycle_status,'expired')
    assert.equal(db.prepare("SELECT lifecycle_status FROM hiring_requisitions WHERE id='658e8dce-test'").get().lifecycle_status,'expired')
    assert.equal(db.prepare("SELECT count(*) AS n FROM hiring_audit_events WHERE action='requisition.expired_data_fix'").get().n,1)
  } finally { db.close() }
})
