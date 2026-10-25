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

test('exact workspace lookup validates organisation, brand and owner scope', () => {
  const { db, call } = fixture()
  try {
    assert.equal(call('get_my_workspace','owner',{ organization_id:'org', brand_id:'a' })[0].brand_id,'a')
    assert.equal(call('get_my_workspace','owner',{ organization_id:'org', owner_only:1 })[0].role,'owner')
    assert.equal(call('get_my_workspace','staff-a',{ organization_id:'org', brand_id:'a' })[0].role,'recruiter')
    assert.deepEqual(call('get_my_workspace','staff-a',{ organization_id:'org', owner_only:1 }),[])
    assert.deepEqual(call('get_my_workspace','staff-a',{ organization_id:'org', brand_id:'b' }),[])
    assert.deepEqual(call('get_my_workspace','owner',{ organization_id:'wrong', brand_id:'a' }),[])
  } finally { db.close() }
})

test('PD drafts enforce tenant/role, version, validation, replay and review reset', () => {
  const { db, call } = fixture()
  try {
    for (const user of ['worker','outsider','staff-b']) assert.deepEqual(call('save_pd_draft', user, pd()), [0,0])
    assert.deepEqual(call('save_pd_draft','owner',pd({ ...A, requisition_id:B.requisition_id })),[0,0])
    assert.deepEqual(call('save_pd_draft','staff-a',pd(A,0,'pd-first')),[1,1])
    assert.equal(call('get_pd_draft','staff-a',A)[0].version,1)
    assert.deepEqual(call('get_pd_draft','staff-b',A),[])
    assert.deepEqual(call('get_pd_draft','owner',{ ...A,brand_id:'b' }),[])
    assert.deepEqual(call('save_pd_draft','owner',pd(A,0)),[0,0])
    assert.deepEqual(call('save_pd_draft','owner',pd(A,1,'pd-first')),[0,0])
    for (const responsibilities of ['not json','{}','[1]','["'+ 'x'.repeat(2001)+'"]']) assert.deepEqual(call('save_pd_draft','owner',{ ...pd(A,1),responsibilities }),[0,0])
    call('save_requisition_review','owner',{ ...publication(),compensation_type:'paid',state:'pending_review',expected_version:0,operation_id:'review' })
    assert.deepEqual(call('save_pd_draft','staff-a',pd(A,1)),[1,1])
    assert.equal(db.prepare('SELECT state FROM hiring_requisition_reviews').get().state,'draft')
    assert.equal(db.prepare('SELECT version FROM hiring_requisition_reviews').get().version,2)
    assert.deepEqual(call('preview_pd','owner',A),call('get_pd_draft','owner',A))
    assert.equal(db.prepare("SELECT count(*) AS n FROM hiring_audit_events WHERE action='requisition.pd_saved'").get().n,2)
    assert.throws(()=>db.exec("UPDATE hiring_pd_versions SET payload='{}'"),/immutable/)
  } finally { db.close() }
})

test('public vacancies contain only immutable published PD snapshots and preserve legacy jobs', () => {
  const { db, call, publish } = fixture()
  try {
    call('save_pd_draft','owner',pd())
    assert.deepEqual(call('list_vacancies',null,{ after_id:'' }),[])
    assert.deepEqual(call('get_vacancy_detail',null,A),[])
    publish()
    const list = call('list_vacancies',null,{ after_id:'',organization_id:'org',brand_id:'a' })
    assert.equal(list.length,1)
    const detail = call('get_vacancy_detail',null,A)[0]
    assert.equal(call('get_vacancy_detail',null,{ requisition_id:A.requisition_id })[0].requisition_id,A.requisition_id)
    assert.equal(JSON.parse(detail.pd_json).overview,'Engineer overview')
    assert.equal(detail.pd_version,1)
    for (const key of ['actor_user_id','operation_id','candidate_name','email','internal_notes','payload']) assert.equal(key in detail,false,key)
    assert.deepEqual(call('get_vacancy_detail',null,{ ...A,brand_id:'b' }),[])
    assert.deepEqual(call('get_vacancy_detail',null,{ ...A,requisition_id:'missing' }),[])
    assert.deepEqual(call('list_vacancies',null,{ after_id:'',organization_id:'wrong' }),[])
    assert.equal(call('list_vacancies',null,{ after_id:A.requisition_id }).length,1)
    assert.equal(call('get_vacancy_detail',null,B)[0].pd_json,null)
    assert.equal(call('get_public_job',null,A)[0].description,publication().description)
    assert.equal(call('get_public_job',null,{ requisition_id:A.requisition_id })[0].requisition_id,A.requisition_id)
    assert.deepEqual(call('get_public_job',null,{ requisition_id:A.requisition_id,organization_id:'wrong',brand_id:'a' }),[])
    assert.deepEqual(call('get_public_job',null,{ requisition_id:A.requisition_id,brand_id:'a' }),[])
    assert.deepEqual(call('save_pd_draft','owner',pd(A,1)),[0,0])
    assert.throws(()=>db.exec("UPDATE hiring_pd_publications SET payload='{}'"),/immutable/)
    call('pause_job_requisition','owner',{ ...A,expected_version:1,operation_id:'pause' })
    assert.deepEqual(call('get_vacancy_detail',null,A),[])
    assert.equal(call('list_vacancies',null,{ after_id:'' }).length,1)
    call('close_job_requisition','owner',{ ...B,expected_version:1,operation_id:'close' })
    assert.deepEqual(call('list_vacancies',null,{ after_id:'' }),[])
    call('resume_job_requisition','owner',{ ...A,expected_version:2,operation_id:'resume' })
    db.exec("UPDATE hiring_organizations SET status='suspended'")
    assert.deepEqual(call('get_vacancy_detail',null,A),[])
  } finally { db.close() }
})

test('PD audit failure rolls back the version and review reset atomically',()=>{
  const { db,call }=fixture()
  try {
    db.exec("CREATE TRIGGER fail_pd BEFORE INSERT ON hiring_audit_events WHEN NEW.action='requisition.pd_saved' BEGIN SELECT RAISE(ABORT,'audit failure'); END")
    assert.throws(()=>call('save_pd_draft','owner',pd()),/audit failure/)
    assert.deepEqual(call('get_pd_draft','owner',A),[])
  } finally { db.close() }
})

test('vacancy management derives complete lifecycle and masks ungranted scopes',()=>{
  const { db,call }=fixture()
  try {
    const state=()=>call('list_vacancy_management','owner',A)[0].state
    assert.equal(state(),'draft')
    assert.deepEqual(call('list_vacancy_management','staff-b',A),[])
    const content={ ...publication(), compensation_type:'paid' }
    call('save_requisition_review','owner',{ ...content,state:'pending_review',expected_version:0,operation_id:'review' })
    assert.equal(state(),'in review')
    assert.equal(call('get_requisition_review','staff-a',A)[0].state,'pending_review')
    assert.deepEqual(call('get_requisition_review','staff-b',A),[])
    call('publish_job_requisition','owner',content)
    assert.equal(state(),'published')
    const exact = call('get_vacancy_management','staff-a',A)[0]
    assert.equal(exact.review_state,'pending_review')
    assert.equal(exact.published_description,content.description)
    assert.equal(exact.published_notice_text,content.notice_text)
    assert.equal(exact.publication_version,1)
    call('pause_job_requisition','owner',{ ...A,expected_version:1,operation_id:'pause' })
    assert.equal(state(),'paused')
    call('close_job_requisition','owner',{ ...A,expected_version:2,operation_id:'close' })
    assert.equal(state(),'closed')
    assert.ok(call('list_vacancy_management','staff-a',A)[0].updated_at)
  } finally { db.close() }
})
test('exact vacancy detail resolves beyond the recent list and masks denied IDs', () => {
  const { db, call, advance } = fixture()
  try {
    advance()
    for (let i = 0; i < 101; i++) call('create_requisition', 'owner', { organization_id: 'org', brand_id: 'a', requisition_id: `new-${i}`, title: `New ${i}`, operation_id: `new-op-${i}` })
    assert.equal(call('list_vacancy_management', 'owner', A).some(row => row.id === A.requisition_id), false)
    const detail = call('get_vacancy_management', 'staff-a', A)
    assert.equal(detail.length, 1)
    assert.equal(detail[0].id, A.requisition_id)
    assert.equal(detail[0].status, 'draft')
    assert.equal(detail[0].can_publish, 1)
    call('grant_workspace_access', 'owner', { ...A, member_user_id: 'scoped-recruiter', role: 'recruiter', grant_id: 'scoped-vacancy', operation_id: 'scoped-vacancy-op' })
    assert.equal(call('get_vacancy_management', 'scoped-recruiter', A)[0].can_publish, 0)
    assert.deepEqual(call('get_requisition_review', 'scoped-recruiter', A), [])
    assert.deepEqual(call('get_vacancy_management', 'staff-b', A), [])
    assert.deepEqual(call('get_vacancy_management', 'staff-a', { ...A, brand_id: 'b' }), [])
    assert.deepEqual(call('get_vacancy_management', 'staff-a', { ...A, requisition_id: 'missing' }), [])
  } finally { db.close() }
})

const volunteerTerms = (overrides = {}) => ({ ...A, engagement_basis:'volunteer', programme_kind:'internship', compensation_type:'unpaid', compensation_amount:null, compensation_currency:null, weekly_hours_min:8, weekly_hours_max:8, programme_weeks:10, weeks_basis:'approved', expected_version:0, operation_id:crypto.randomUUID(), ...overrides })
test('structured terms explicitly backfill legacy records, enforce scope, versions and immutable audit history', () => {
  const { db,call } = fixture()
  try {
    assert.equal(call('get_vacancy_management','owner',A)[0].terms_json,null)
    for (const user of ['worker','outsider','staff-b']) assert.deepEqual(call('save_vacancy_terms',user,volunteerTerms()),[0])
    assert.deepEqual(call('save_vacancy_terms','owner',volunteerTerms({ brand_id:'b' })),[0])
    assert.deepEqual(call('save_vacancy_terms','staff-a',volunteerTerms()),[1])
    const row = call('get_vacancy_management','owner',A)[0]
    assert.equal(row.terms_version,1)
    assert.equal(JSON.parse(row.terms_json).weekly_hours_min,8)
    assert.equal(JSON.parse(row.terms_json).weeks_basis,'approved')
    assert.equal(call('get_vacancy_management','owner',B)[0].terms_version,0)
    assert.deepEqual(call('save_vacancy_terms','owner',volunteerTerms()),[0])
    assert.deepEqual(call('save_vacancy_terms','owner',volunteerTerms({ expected_version:1 })),[1])
    assert.equal(db.prepare("SELECT count(*) n FROM hiring_audit_events WHERE action='requisition.terms_reviewed'").get().n,2)
    assert.throws(() => db.exec("UPDATE hiring_vacancy_terms SET weekly_hours_min=1"),/immutable/)
    assert.equal(db.prepare('SELECT title FROM hiring_requisitions WHERE id=?').get(A.requisition_id).title,'Engineer')
  } finally { db.close() }
})
test('structured terms reject invalid and incompatible combinations at database boundary', () => {
  const { db,call } = fixture()
  try {
    for (const change of [
      {engagement_basis:'unknown'}, {programme_kind:'unknown'}, {compensation_type:'paid'},
      {compensation_type:'salary',compensation_amount:100,compensation_currency:'AUD'},
      {compensation_amount:100}, {compensation_currency:'AUD'},
      {engagement_basis:'employment',compensation_type:'hourly'},
      {engagement_basis:'employment',compensation_type:'hourly',compensation_amount:20,compensation_currency:'aud'},
      {weekly_hours_min:0}, {weekly_hours_max:7}, {weekly_hours_max:169},
      {programme_weeks:null,weeks_basis:null}, {weeks_basis:null}, {weeks_basis:''}, {programme_weeks:1.5},
    ]) assert.throws(() => call('save_vacancy_terms','owner',volunteerTerms(change)),/CHECK/,JSON.stringify(change))
    assert.equal(db.prepare('SELECT count(*) n FROM hiring_vacancy_terms').get().n,0)
  } finally { db.close() }
})
test('reviewed volunteer internship publishes exact public terms and blocks incompatible compensation', () => {
  const { db,call } = fixture()
  try {
    call('save_vacancy_terms','owner',volunteerTerms())
    assert.throws(() => call('publish_job_requisition','owner',{ ...publication(),compensation_type:'paid' }),/conflicts/)
    call('publish_job_requisition','owner',{ ...publication(),compensation_type:'internship',compensation:'unpaid' })
    const snapshot = db.prepare('SELECT * FROM hiring_published_vacancy_terms').get()
    assert.equal(snapshot.engagement_basis,'volunteer')
    assert.equal(snapshot.programme_weeks,10)
    assert.equal(snapshot.compensation_type,'unpaid')
    assert.throws(() => call('save_vacancy_terms','owner',volunteerTerms({ expected_version:1 })),/immutable/)
    assert.throws(() => db.exec("UPDATE hiring_published_vacancy_terms SET compensation_type='salary'"),/immutable/)
  } finally { db.close() }
})
test('terms edits invalidate review; legacy published terms require explicit backfill and then remain frozen', () => {
  const { db,call,publish } = fixture()
  try {
    call('save_requisition_review','owner',{ ...publication(),compensation_type:'paid',state:'pending_review',expected_version:0,operation_id:'review-terms' })
    call('save_vacancy_terms','owner',volunteerTerms())
    assert.equal(call('get_requisition_review','owner',A)[0].state,'draft')
    // The other legacy vacancy is not guessed from title or publication text.
    call('publish_job_requisition','owner',publication(B))
    assert.equal(call('get_vacancy_detail',null,B)[0].terms_json,null)
    call('save_vacancy_terms','owner',volunteerTerms({ ...B,programme_kind:'ongoing contribution',programme_weeks:null,weeks_basis:null }))
    assert.equal(JSON.parse(call('get_vacancy_detail',null,B)[0].terms_json).engagement_basis,'volunteer')
    assert.throws(() => call('save_vacancy_terms','owner',volunteerTerms({ ...B,expected_version:1 })),/immutable/)
  } finally { db.close() }
})
test('terms audit failure rolls back both terms and publication review reset', () => {
  const { db,call } = fixture()
  try {
    db.exec("CREATE TRIGGER fail_terms BEFORE INSERT ON hiring_audit_events WHEN NEW.action='requisition.terms_reviewed' BEGIN SELECT RAISE(ABORT,'audit failed'); END")
    assert.throws(() => call('save_vacancy_terms','owner',volunteerTerms()),/audit failed/)
    assert.equal(call('get_vacancy_management','owner',A)[0].terms_version,0)
  } finally { db.close() }
})
test('creation with explicit terms is atomic and preserves a terms-free title', () => {
  const { db,call } = fixture()
  try {
    const args = volunteerTerms({ requisition_id:'new-role', title:'Community developer' })
    assert.throws(() => call('create_vacancy_with_terms','owner',{...args, weekly_hours_max:2}),/CHECK/)
    assert.equal(db.prepare("SELECT count(*) n FROM hiring_requisitions WHERE id='new-role'").get().n,0)
    assert.deepEqual(call('create_vacancy_with_terms','owner',args),[1,1,1])
    const row=call('get_vacancy_management','owner',{...A,requisition_id:'new-role'})[0]
    assert.equal(row.title,'Community developer')
    assert.equal(JSON.parse(row.terms_json).programme_weeks,10)
    assert.deepEqual(call('create_vacancy_with_terms','owner',args),[0,0,0])
  } finally { db.close() }
})
test('publication rejects a stale structured terms review version', () => {
  const { db,call } = fixture()
  try {
    call('save_vacancy_terms','owner',volunteerTerms())
    call('save_vacancy_terms','owner',volunteerTerms({expected_version:1,programme_weeks:12}))
    assert.deepEqual(call('publish_job_requisition','owner',{...publication(),compensation_type:'internship',expected_terms_version:1}),[0,0])
    assert.equal(db.prepare('SELECT count(*) n FROM hiring_job_publications').get().n,0)
    assert.deepEqual(call('publish_job_requisition','owner',{...publication(),compensation_type:'internship',expected_terms_version:2}),[1,1])
  } finally { db.close() }
})
test('other compensation remains explicitly unspecified rather than silently paid', () => {
  const { db,call } = fixture()
  try {
    call('save_vacancy_terms','owner',volunteerTerms({engagement_basis:'other',programme_kind:'ongoing contribution',compensation_type:'other',programme_weeks:null,weeks_basis:null}))
    const p={...publication(),compensation_type:'unspecified'}
    assert.deepEqual(call('save_requisition_review','owner',{...p,state:'pending_review',expected_version:0}),[1,1])
    assert.deepEqual(call('publish_job_requisition','owner',{...p,operation_id:crypto.randomUUID(),expected_terms_version:1}),[1,1])
    assert.equal(JSON.parse(call('get_vacancy_detail',null,A)[0].terms_json).compensation_type,'other')
  } finally { db.close() }
})
