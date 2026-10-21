import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'

const migrations = JSON.parse(readFileSync(new URL('../migrations.json', import.meta.url))).migrations
const tools = JSON.parse(readFileSync(new URL('../mcp.json', import.meta.url))).tools
const tool = name => { const result = tools.find(t => t.name === name); assert.ok(result, name); return result }
const A = { organization_id: 'org', brand_id: 'a', requisition_id: 'req-a' }
const B = { organization_id: 'org', brand_id: 'b', requisition_id: 'req-b' }
const publication = (s = A) => ({ ...s, description: '<script>untrusted()</script> Engineer role', location: 'Remote', arrangement: 'Paid employment; 38 hours per week', compensation: 'AUD 100,000', notice_version: 'v1', notice_text: 'Application processing and indefinite retention. Optional talent pool and communications are separate.', contact: 'Hiring contact', operation_id: `publish-${s.brand_id}` })
const application = (s = A, suffix = 'a') => ({ ...s, candidate_id: `candidate-${suffix}`, application_id: `application-${suffix}`, operation_id: `submit-${suffix}`, idempotency_key: `retry-${suffix}`, candidate_name: 'Candidate', email: 'candidate@example.com', phone: '', statement: '<img src=x onerror=alert(1)>', notice_version: 'v1', expected_version: 1, notice_acknowledged: 1, talent_pool_consent: 0, communications_consent: 0 })
const attachment = (s = A, suffix = 'a') => ({ ...s, application_id: `application-${suffix}`, attachment_id: `file-${suffix}`, filename: 'resume.pdf', mime_type: 'application/pdf', size_bytes: 100, checksum: 'a'.repeat(64), operation_id: `file-create-${suffix}` })
function fixture({ open = true } = {}) {
  const db = new DatabaseSync(':memory:')
  db.exec('PRAGMA foreign_keys=ON')
  for (const m of migrations) db.exec(m.sql)
  let now = 1_000_000_000
  const call = (name, user = 'worker', values = {}) => {
    const t = tool(name)
    const params = { ...Object.fromEntries(Object.entries(t.params).filter(([,p]) => p.optional).map(([k]) => [k,null])), ...values, __user_id: user, __now: now, __uuid: crypto.randomUUID() }
    db.exec('BEGIN')
    try {
      const results = (t.statements ?? [t.sql]).map(statement => {
        const bindings = []
        const sql = statement.replace(/:([a-z_][a-z0-9_]*)/gi, (_, key) => { assert.notEqual(params[key], undefined, `${name}: ${key}`); bindings.push(params[key]); return '?' })
        return t.operation === 'query' ? db.prepare(sql).all(...bindings).map(r => ({ ...r })) : db.prepare(sql).run(...bindings).changes
      })
      db.exec('COMMIT')
      return t.operation === 'query' ? results[0] : results
    } catch (e) { db.exec('ROLLBACK'); throw e }
  }
  for (const scope of [A,B]) call('create_workspace','owner', { ...scope, organization_name: 'Org', brand_name: `Brand ${scope.brand_id}`, requisition_title: 'Engineer', operation_id: `boot-${scope.brand_id}` })
  call('add_workspace_member','owner', { ...A, member_user_id: 'staff-a', role: 'recruiter', operation_id: 'member-a' })
  call('add_workspace_member','owner', { ...B, member_user_id: 'staff-b', role: 'recruiter', operation_id: 'member-b' })
  call('save_my_worker_profile','worker', { display_name: 'Candidate' })
  call('save_my_worker_profile','other-worker', { display_name: 'Other' })
  if (open) db.exec("UPDATE hiring_runtime_gate SET intake_status='open' WHERE id=1")
  const publish = () => { for (const scope of [A,B]) assert.deepEqual(call('publish_job_requisition','owner',publication(scope)), [1,1]) }
  const submit = () => { publish(); assert.deepEqual(call('submit_job_application','worker',application()), [1,1,1,1,0,1,1]) }
  return { db, call, publish, submit, advance: (ms = 10001) => { now += ms } }
}
const pd = (scope = A, version = 0, operation_id = crypto.randomUUID()) => ({ ...scope, overview: 'Engineer overview', rolePurpose: 'Build things', responsibilities: '["Ship safely","Review changes"]', requirements: '["Engineering experience"]', workingArrangement: 'Remote', compensation: 'AUD 100,000', benefits: 'Leave', applicationProcess: 'Apply online', privacyContact: 'hiring@example.com', expected_version: version, operation_id })

test('PD drafts enforce tenant/role, version, validation, replay and review reset', () => {
  const { db, call } = fixture()
  try {
    for (const user of ['worker','outsider','staff-b']) assert.deepEqual(call('savePDDraft', user, pd()), [0,0])
    assert.deepEqual(call('savePDDraft','owner',pd({ ...A, requisition_id:B.requisition_id })),[0,0])
    assert.deepEqual(call('savePDDraft','staff-a',pd(A,0,'pd-first')),[1,1])
    assert.equal(call('getPDDraft','staff-a',A)[0].version,1)
    assert.deepEqual(call('getPDDraft','staff-b',A),[])
    assert.deepEqual(call('getPDDraft','owner',{ ...A,brand_id:'b' }),[])
    assert.deepEqual(call('savePDDraft','owner',pd(A,0)),[0,0])
    assert.deepEqual(call('savePDDraft','owner',pd(A,1,'pd-first')),[0,0])
    for (const responsibilities of ['not json','{}','[1]','["'+ 'x'.repeat(2001)+'"]']) assert.deepEqual(call('savePDDraft','owner',{ ...pd(A,1),responsibilities }),[0,0])
    call('save_requisition_review','owner',{ ...publication(),compensation_type:'paid',state:'pending_review',expected_version:0,operation_id:'review' })
    assert.deepEqual(call('savePDDraft','staff-a',pd(A,1)),[1,1])
    assert.equal(db.prepare('SELECT state FROM hiring_requisition_reviews').get().state,'draft')
    assert.equal(db.prepare('SELECT version FROM hiring_requisition_reviews').get().version,2)
    assert.deepEqual(call('previewPD','owner',A),call('getPDDraft','owner',A))
    assert.equal(db.prepare("SELECT count(*) AS n FROM hiring_audit_events WHERE action='requisition.pd_saved'").get().n,2)
    assert.throws(()=>db.exec("UPDATE hiring_pd_versions SET payload='{}'"),/immutable/)
  } finally { db.close() }
})

test('public vacancies contain only immutable published PD snapshots and preserve legacy jobs', () => {
  const { db, call, publish } = fixture()
  try {
    call('savePDDraft','owner',pd())
    assert.deepEqual(call('listVacancies',null,{ after_id:'' }),[])
    assert.deepEqual(call('getVacancyDetail',null,A),[])
    publish()
    const list = call('listVacancies',null,{ after_id:'',organization_id:'org',brand_id:'a' })
    assert.equal(list.length,1)
    const detail = call('getVacancyDetail',null,A)[0]
    assert.equal(JSON.parse(detail.pd_json).overview,'Engineer overview')
    assert.equal(detail.pd_version,1)
    for (const key of ['actor_user_id','operation_id','candidate_name','email','internal_notes','payload']) assert.equal(key in detail,false,key)
    assert.deepEqual(call('getVacancyDetail',null,{ ...A,brand_id:'b' }),[])
    assert.deepEqual(call('getVacancyDetail',null,{ ...A,requisition_id:'missing' }),[])
    assert.deepEqual(call('listVacancies',null,{ after_id:'',organization_id:'wrong' }),[])
    assert.equal(call('listVacancies',null,{ after_id:A.requisition_id }).length,1)
    assert.equal(call('getVacancyDetail',null,B)[0].pd_json,null)
    assert.equal(call('get_public_job',null,A)[0].description,publication().description)
    assert.deepEqual(call('savePDDraft','owner',pd(A,1)),[0,0])
    assert.throws(()=>db.exec("UPDATE hiring_pd_publications SET payload='{}'"),/immutable/)
    call('pause_job_requisition','owner',{ ...A,expected_version:1,operation_id:'pause' })
    assert.deepEqual(call('getVacancyDetail',null,A),[])
    assert.equal(call('listVacancies',null,{ after_id:'' }).length,1)
    call('close_job_requisition','owner',{ ...B,expected_version:1,operation_id:'close' })
    assert.deepEqual(call('listVacancies',null,{ after_id:'' }),[])
    call('resume_job_requisition','owner',{ ...A,expected_version:2,operation_id:'resume' })
    db.exec("UPDATE hiring_organizations SET status='suspended'")
    assert.deepEqual(call('getVacancyDetail',null,A),[])
  } finally { db.close() }
})

test('PD audit failure rolls back the version and review reset atomically',()=>{
  const { db,call }=fixture()
  try {
    db.exec("CREATE TRIGGER fail_pd BEFORE INSERT ON hiring_audit_events WHEN NEW.action='requisition.pd_saved' BEGIN SELECT RAISE(ABORT,'audit failure'); END")
    assert.throws(()=>call('savePDDraft','owner',pd()),/audit failure/)
    assert.deepEqual(call('getPDDraft','owner',A),[])
  } finally { db.close() }
})

test('vacancy management derives complete lifecycle and masks ungranted scopes',()=>{
  const { db,call }=fixture()
  try {
    const state=()=>call('listVacancyManagement','owner',A)[0].state
    assert.equal(state(),'draft')
    assert.deepEqual(call('listVacancyManagement','staff-b',A),[])
    const content={ ...publication(), compensation_type:'paid' }
    call('save_requisition_review','owner',{ ...content,state:'pending_review',expected_version:0,operation_id:'review' })
    assert.equal(state(),'in review')
    call('publish_job_requisition','owner',content)
    assert.equal(state(),'published')
    call('pause_job_requisition','owner',{ ...A,expected_version:1,operation_id:'pause' })
    assert.equal(state(),'paused')
    call('close_job_requisition','owner',{ ...A,expected_version:2,operation_id:'close' })
    assert.equal(state(),'closed')
    assert.ok(call('listVacancyManagement','staff-a',A)[0].updated_at)
  } finally { db.close() }
})
