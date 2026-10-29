import { test } from 'node:test'
import assert from 'node:assert/strict'
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
    assert.deepEqual(call('republish_expired_job','owner',scoped('repost',3,{ linkedin_job_id:'4499999999',reason:'New LinkedIn posting' })),[1,1,1])
    assert.equal(call('get_job_linkedin_status','owner',A)[0].status,'published')
    assert.equal(call('get_job_linkedin_status','owner',A)[0].linkedin_job_id,'4499999999')
    assert.equal(call('get_public_job',null,A).length,1)
    assert.equal(db.prepare('SELECT count(*) AS n FROM hiring_applications WHERE requisition_id=?').get(A.requisition_id).n,before)
    assert.deepEqual(call('find_job_by_linkedin_id','owner',{ organization_id:A.organization_id,brand_id:A.brand_id,linkedin_job_id:'4483241641' }).map(r=>r.requisition_id),[A.requisition_id])
    const history=call('list_repost_history','owner',A)
    assert.equal(history.length,2)
    assert.equal(history.find(h=>h.operation_id==='repost').previous_linkedin_job_id,'4483241641')
    assert.equal(history.find(h=>h.operation_id==='repost').new_linkedin_job_id,'4499999999')
    assert.deepEqual(call('list_repost_history','staff-b',A),[])
    assert.deepEqual(call('republish_expired_job','owner',scoped('repost',3,{ linkedin_job_id:'4499999999' })),[0,0,0])
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
    assert.deepEqual(call('republish_expired_job','staff-a',scoped('repost',3,{linkedin_job_id:'new-id',expiry_date:2000000000})),[1,1,1])
    assert.equal(call('get_public_job',null,A).length,1)
  } finally { db.close() }
})
