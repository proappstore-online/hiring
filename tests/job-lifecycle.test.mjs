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
    assert.throws(()=>call('set_linkedin_job_id','staff-b',scoped('denied-id',1,{ linkedin_job_id:'4483241641' })),/APP:not_found/)
    assert.deepEqual(call('set_linkedin_job_id','owner',scoped('initial-id',1,{ linkedin_job_id:'4483241641',expiry_date:2000000000 })),[0,1,1,1,1])
    assert.equal(call('get_job_linkedin_status','owner',A)[0].linkedin_job_id,'4483241641')
    assert.equal(call('list_requisitions','owner',{ organization_id:A.organization_id,brand_id:A.brand_id }).find(r=>r.id===A.requisition_id).status,'published')
    assert.deepEqual(call('find_job_by_linkedin_id','owner',{ organization_id:A.organization_id,brand_id:A.brand_id,linkedin_job_id:'4483241641' }).map(r=>r.requisition_id),[A.requisition_id])
    assert.deepEqual(call('expire_job_requisition','staff-a',scoped('expired',2,{ reason:'LinkedIn check found posting closed',observed_linkedin_status:'closed' })),[0,1,1,1])
    assert.equal(call('get_job_linkedin_status','owner',A)[0].status,'expired')
    assert.deepEqual(call('get_public_job',null,A),[])
    assert.deepEqual(call('republish_job_requisition','owner',scoped('repost',3,{ linkedin_job_id:'4499999999',reason:'New LinkedIn posting' })),[0,1,1,1,1])
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
    assert.throws(()=>call('republish_job_requisition','owner',scoped('repost',3,{ linkedin_job_id:'4499999999' })),/APP:version_mismatch/)
    assert.throws(()=>db.exec("DELETE FROM hiring_linkedin_repost_history"),/immutable/)
    assert.equal(db.prepare('SELECT count(*) AS n FROM hiring_requisitions WHERE id=?').get(A.requisition_id).n,1)
  } finally { db.close() }
})

test('expiry date controls public discovery and wrong brand cannot change job state', () => {
  const { db, call, publish }=fixture()
  try {
    publish()
    assert.throws(()=>call('expire_job_requisition','staff-b',scoped('wrong',1)),/APP:not_found/)
    assert.deepEqual(call('set_job_expiry_date','owner',scoped('date',1,{expiry_date:1})),[0,1,1,1])
    assert.deepEqual(call('get_public_job',null,A),[])
    assert.deepEqual(call('get_job_linkedin_status','owner',{...A,brand_id:B.brand_id}),[])
    assert.deepEqual(call('expire_job_requisition','owner',scoped('exp',2)),[0,1,1,1])
    assert.deepEqual(call('republish_job_requisition','staff-a',scoped('repost',3,{linkedin_job_id:'new-id',expiry_date:2000000000})),[0,1,1,1,1])
    assert.equal(call('get_public_job',null,A).length,1)
  } finally { db.close() }
})

test('recorded LinkedIn state drives pause, expiry, and audited closure', () => {
  const { db, call, publish }=fixture()
  try {
    publish()
    assert.equal(db.prepare('SELECT lifecycle_status FROM hiring_requisitions WHERE id=?').get(A.requisition_id).lifecycle_status,'published')
    assert.throws(()=>call('record_linkedin_status','staff-b',scoped('wrong-status',1,{linkedin_status:'paused',reason:'Observed pause'})),/APP:not_found/)
    assert.deepEqual(call('record_linkedin_status','staff-a',scoped('pause',1,{linkedin_status:'paused',reason:'Observed pause'})),[0,1,1,1,1])
    assert.equal(call('get_job_linkedin_status','owner',A)[0].status,'paused')
    assert.equal(call('list_requisitions','owner',{organization_id:A.organization_id,brand_id:A.brand_id}).find(r=>r.id===A.requisition_id).status,'paused')
    assert.equal(db.prepare('SELECT lifecycle_status FROM hiring_requisitions WHERE id=?').get(A.requisition_id).lifecycle_status,'paused')
    assert.deepEqual(call('record_linkedin_status','owner',scoped('active',2,{linkedin_status:'active',reason:'Observed active'})),[0,1,1,1,1])
    assert.deepEqual(call('record_linkedin_status','staff-a',scoped('expired-observed',3,{linkedin_status:'expired',reason:'Posting expired',expiry_date:1000000000})),[0,1,1,1,1])
    assert.equal(call('get_job_linkedin_status','owner',A)[0].status,'expired')
    assert.equal(db.prepare('SELECT lifecycle_status,linkedin_expiry_date FROM hiring_requisitions WHERE id=?').get(A.requisition_id).lifecycle_status,'expired')
    assert.throws(()=>call('record_linkedin_status','owner',scoped('no-reopen',4,{linkedin_status:'active',reason:'Wrong transition'})),/APP:invalid_transition/)
    assert.deepEqual(call('record_linkedin_status','owner',scoped('close',4,{linkedin_status:'closed',reason:'Role withdrawn'})),[0,1,1,1,1])
    assert.equal(call('get_job_linkedin_status','owner',A)[0].status,'closed')
    assert.equal(db.prepare("SELECT count(*) AS n FROM hiring_audit_events WHERE action='requisition.linkedin_status_recorded'").get().n,4)
  } finally { db.close() }
})

test('FreeGameStore correction expires only the matching posted intern requisition with audit', () => {
  const { db, call }=fixture()
  try {
    db.exec("UPDATE hiring_brands SET name='FreeGameStore' WHERE id='a'")
    db.exec("INSERT INTO hiring_requisitions(id,organization_id,brand_id,title,created_at) VALUES('658e8dce-test','org','a','Developer Intern',1000000000)")
    db.exec("INSERT INTO hiring_job_publications(requisition_id,organization_id,brand_id,description,location,arrangement,compensation,notice_version,notice_text,contact,actor_user_id,operation_id,created_at) VALUES('658e8dce-test','org','a','Intern','Remote','Internship','Unpaid','v1','Notice','Contact','owner','seed-intern',1000000000)")
    const migration=JSON.parse(readFileSync(new URL('../migrations.json',import.meta.url))).migrations.find(m=>m.name==='0061_expire_freegamestore_intern')
    db.exec(migration.sql.slice(migration.sql.lastIndexOf('INSERT INTO hiring_audit_events(')))
    assert.equal(db.prepare("SELECT lifecycle_status FROM hiring_job_publications WHERE requisition_id='658e8dce-test'").get().lifecycle_status,'expired')
    assert.equal(db.prepare("SELECT lifecycle_status FROM hiring_requisitions WHERE id='658e8dce-test'").get().lifecycle_status,'expired')
    assert.equal(db.prepare("SELECT count(*) AS n FROM hiring_audit_events WHERE action='requisition.expired_data_fix'").get().n,1)
    assert.equal(call('query_audit_log','owner',{organization_id:A.organization_id,brand_id:A.brand_id,entity_id:'658e8dce-test'}).some(r=>r.tool_name==='requisition.expired_data_fix'),true)
  } finally { db.close() }
})

test('accepted lifecycle and external writes appear in audit, timeline, and session reads', () => {
  const { db, call, publish } = fixture()
  try {
    publish()
    const writes = [
      ['set_linkedin_job_id', scoped('id-e2e',1,{linkedin_job_id:'linkedin-1',expiry_date:2_000_000_000})],
      ['set_job_expiry_date', scoped('date-e2e',2,{expiry_date:2_100_000_000})],
      ['expire_job_requisition', scoped('expire-e2e',3,{observed_linkedin_status:'expired',reason:'Expired on LinkedIn'})],
      ['record_linkedin_status', scoped('observed-e2e',4,{linkedin_status:'expired',reason:'Confirmed expired'})],
      ['republish_job_requisition', scoped('repost-e2e',5,{linkedin_job_id:'linkedin-2',expiry_date:2_200_000_000})],
    ]
    for (const [name, args] of writes) {
      const changes = call(name,'owner',args)
      assert.ok(changes[1]>0, `${name} changed publication or history`)
      assert.equal(db.prepare('SELECT count(*) n FROM hiring_audit_events WHERE operation_id=?').get(args.operation_id).n,1)
      assert.equal(call('query_audit_log','owner',{organization_id:A.organization_id,brand_id:A.brand_id,entity_id:A.requisition_id}).filter(r=>r.operation_id===args.operation_id).length,1)
      assert.equal(call('get_activity_timeline','owner',{organization_id:A.organization_id,brand_id:A.brand_id}).filter(r=>r.operation_id===args.operation_id).length,1)
    }
    assert.equal(call('get_job_linkedin_status','owner',A)[0].expected_version,6)
    assert.equal(call('find_job_by_linkedin_id','owner',{organization_id:A.organization_id,brand_id:A.brand_id,linkedin_job_id:'linkedin-2'})[0].expected_version,6)
    assert.equal(call('list_requisitions','owner',{organization_id:A.organization_id,brand_id:A.brand_id}).find(r=>r.id===A.requisition_id).expected_version,6)
    const external = { organization_id:A.organization_id,brand_id:A.brand_id,kind:'linkedin',target_org_id:A.organization_id,performed_by:'owner',performed_at:1_000_000_000_000,params_json:'{}',operation_id:'external-e2e' }
    assert.deepEqual(call('log_external_action','owner',external),[0,1,1,1])
    assert.equal(db.prepare("SELECT performed_at FROM external_actions WHERE id='external-e2e'").get().performed_at,1_000_000_000_000)
    assert.equal(db.prepare("SELECT count(*) n FROM hiring_audit_events WHERE operation_id='external-e2e'").get().n,1)
    assert.equal(call('get_activity_timeline','owner',{organization_id:A.organization_id,brand_id:A.brand_id}).filter(r=>r.operation_id==='external-e2e').length,2)
    assert.ok(JSON.parse(call('session_start','owner',{organization_id:A.organization_id,brand_id:A.brand_id})[0].recent_activity).some(r=>r.kind==='republish_job_requisition'))
    assert.throws(()=>call('expire_job_requisition','owner',scoped('stale-e2e',5)),/APP:version_mismatch/)
    assert.throws(()=>call('republish_job_requisition','owner',scoped('wrong-state-e2e',6,{linkedin_job_id:'linkedin-3'})),/APP:invalid_transition/)
    assert.throws(()=>call('expire_job_requisition','owner',scoped('bad-observed-e2e',6,{observed_linkedin_status:'paused'})),/APP:invalid_linkedin_status/)
    assert.throws(()=>call('log_external_action','owner',{...external,operation_id:'invalid-kind-e2e',kind:'phone'}),/APP:invalid_kind/)
  } finally { db.close() }
})

test('closed posting refusals, text actor, and second-based activity filters use the migrated schema', () => {
  const { db, call, publish } = fixture()
  try {
    publish()
    assert.deepEqual(call('set_linkedin_job_id','owner',scoped('linkedin-id-live',1,{linkedin_job_id:'4483241641'})),[0,1,1,1,1])
    assert.equal(db.prepare("SELECT count(*) AS n FROM hiring_audit_events WHERE operation_id='linkedin-id-live'").get().n,1)
    assert.equal(call('get_activity_timeline','owner',{organization_id:A.organization_id,brand_id:A.brand_id}).some(row=>row.operation_id==='linkedin-id-live'),true)
    assert.deepEqual(call('record_linkedin_status','owner',scoped('close-live',2,{linkedin_status:'closed',reason:'Role closed'})),[0,1,1,1,1])
    assert.throws(()=>call('expire_job_requisition','owner',scoped('expire-closed-live',3,{observed_linkedin_status:'closed'})),/APP:invalid_transition/)
    assert.throws(()=>call('record_linkedin_status','owner',scoped('pause-closed-live',3,{linkedin_status:'paused',reason:'Observed pause'})),/APP:invalid_transition/)
    assert.equal(db.prepare("SELECT count(*) AS n FROM hiring_audit_events WHERE operation_id IN ('expire-closed-live','pause-closed-live')").get().n,0)
    const external={organization_id:A.organization_id,brand_id:A.brand_id,kind:'linkedin',target_org_id:A.organization_id,performed_by:'Serge',performed_at:1_793_246_400,params_json:'{"channel":"linkedin"}',notes:'Posted update',operation_id:'linkedin-external-live'}
    assert.deepEqual(call('log_external_action','owner',external),[0,1,1,1])
    assert.equal(db.prepare("SELECT performed_at FROM external_actions WHERE operation_id='linkedin-external-live'").get().performed_at,1_793_246_400_000)
    const scope={organization_id:A.organization_id,brand_id:A.brand_id}
    assert.equal(call('get_activity_timeline','owner',{...scope,from_ts:1_793_246_400}).filter(row=>row.operation_id===external.operation_id).length,2)
    assert.equal(call('get_activity_timeline','owner',{...scope,from_ts:1_793_246_401}).some(row=>row.operation_id===external.operation_id),false)
    assert.equal(call('query_audit_log','owner',{...scope,from_ts:1_793_246_400}).some(row=>row.operation_id===external.operation_id),true)
    assert.equal(JSON.parse(call('session_start','owner',{...scope,since:1_793_246_400})[0].recent_activity).some(row=>row.ts===1_793_246_400_000),true)
    assert.equal(JSON.parse(call('session_start','owner',{...scope,since:1_793_246_401})[0].recent_activity).some(row=>row.id===external.operation_id),false)
    assert.equal(db.prepare("SELECT status FROM hiring_job_publications WHERE requisition_id=?").get(B.requisition_id).status,'published')
  } finally { db.close() }
})

test('log_external_action refuses a blank or oversized operation_id instead of silently applying nothing (#1396)', () => {
  const { db, call } = fixture()
  try {
    const base = { organization_id:A.organization_id, brand_id:A.brand_id, kind:'linkedin', performed_by:'owner', performed_at:1_000_000_000_000, params_json:'{}' }
    const auditBefore = db.prepare('SELECT count(*) AS n FROM hiring_audit_events').get().n
    for (const operation_id of ['', '   ', 'x'.repeat(200)]) {
      assert.throws(()=>call('log_external_action','owner',{...base,operation_id}),/APP:operation_conflict/,JSON.stringify(operation_id))
      assert.equal(db.prepare('SELECT count(*) AS n FROM external_actions').get().n,0)
      assert.equal(db.prepare('SELECT count(*) AS n FROM hiring_audit_events').get().n,auditBefore)
      assert.equal(db.prepare('SELECT count(*) AS n FROM mcp_audit_log').get().n,0)
    }
    assert.deepEqual(call('log_external_action','owner',{...base,operation_id:'external-valid'}),[0,1,1,1])
  } finally { db.close() }
})

test('every write tool gated by hiring_mcp_refusals refuses a blank operation_id explicitly, never a silent no-op (#1396)', () => {
  const { db, call, publish } = fixture()
  try {
    publish()
    const invalid = { organization_id:A.organization_id, brand_id:A.brand_id, requisition_id:A.requisition_id, expected_version:1, operation_id:'' }
    const attempts = [
      ['set_linkedin_job_id', { ...invalid, linkedin_job_id:'111' }],
      ['set_job_expiry_date', { ...invalid, expiry_date:2_000_000_000 }],
      ['expire_job_requisition', { ...invalid, reason:'test' }],
      ['record_linkedin_status', { ...invalid, linkedin_status:'paused', reason:'test' }],
      ['republish_job_requisition', { ...invalid, linkedin_job_id:'111' }],
      ['log_external_action', { organization_id:A.organization_id, brand_id:A.brand_id, kind:'linkedin', performed_by:'owner', performed_at:1_000_000_000_000, params_json:'{}', operation_id:'' }],
    ]
    for (const [name, args] of attempts) {
      assert.throws(()=>call(name,'owner',args),/APP:/,name)
      assert.equal(db.prepare("SELECT count(*) AS n FROM hiring_audit_events WHERE operation_id=''").get().n,0,name)
    }
    assert.equal(db.prepare("SELECT version FROM hiring_job_publications WHERE requisition_id=?").get(A.requisition_id).version,1,'nothing partially applied')
  } finally { db.close() }
})
