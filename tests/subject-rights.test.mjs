import { seedApprovedTemplates } from './communication-fixture.mjs'
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
const counts = db => ['hiring_candidates','hiring_applications','hiring_intake_receipts','hiring_consent_records','hiring_stage_events','hiring_audit_events'].map(t => db.prepare(`SELECT count(*) AS n FROM ${t}`).get().n)

const request = (request_type='access', request_id=crypto.randomUUID()) => ({...A, application_id:'application-a',request_type,request_id})
test('rights intake accepts four types only for exact authenticated candidate and masks other brands',()=>{
  const f=fixture();f.submit()
  const {db,call}=f
  for(const kind of ['access','correction','withdrawal','deletion']) {
    const p=request(kind)
    for(const [user,values] of [['other-worker',p],['staff-a',p],['owner',p],['worker',{...p,brand_id:'b'}],['worker',{...p,application_id:'missing'}]]) {
      assert.deepEqual(call('submit_my_rights_request',user,values),[0])
      assert.deepEqual(call('list_my_rights_requests',user,values),[])
    }
    assert.deepEqual(call('submit_my_rights_request','worker',p),[1])
    assert.deepEqual(call('submit_my_rights_request','worker',p),[0])
  }
  assert.deepEqual(call('submit_my_rights_request','worker',request('invalid')),[0])
  const rows=call('list_my_rights_requests','worker',request())
  assert.equal(rows.length,4);assert.equal(rows[0].status,'received');assert.equal(rows[0].deadline_at,null)
  assert.doesNotMatch(JSON.stringify(rows),/proof_reference|decision_reference|email|phone/)
  assert.equal(call('list_brand_rights_intake','owner',A).length,4)
  assert.equal(call('list_brand_rights_intake','staff-a',A).length,0)
  assert.equal(call('list_brand_rights_intake','owner',B).length,0)
  assert.equal(db.prepare("SELECT count(*) n FROM hiring_audit_events WHERE action='privacy.rights.intake'").get().n,4)
  assert.throws(()=>db.exec('DELETE FROM hiring_rights_intake'),/append-only/)
  db.close()
})
test('rights receipt and audit roll back together',()=>{
  const {db,call,submit}=fixture();submit()
  db.exec("CREATE TRIGGER fail_intake BEFORE INSERT ON hiring_audit_events WHEN NEW.action='privacy.rights.intake' BEGIN SELECT RAISE(ABORT,'audit unavailable'); END")
  assert.throws(()=>call('submit_my_rights_request','worker',request()),/audit unavailable/)
  assert.equal(db.prepare('SELECT count(*) n FROM hiring_rights_intake').get().n,0)
  db.close()
})
test('owner adopts exact receipt; verification and completion history remain private and auditable',()=>{
  const {db,call,submit}=fixture();submit()
  const p=request('correction','rights-one');call('submit_my_rights_request','worker',p)
  const event={...p,operation_id:'received',expected_version:0,status:'received',owner_user_id:'owner',deadline_at:2000000000}
  assert.throws(()=>call('record_candidate_rights_event','owner',{...event,request_type:'access'}),/scope mismatch/)
  assert.deepEqual(call('record_candidate_rights_event','owner',event),[1])
  assert.deepEqual(call('attest_candidate_rights_completion','owner',{...event,operation_id:'premature',status:'fulfilled',expected_version:1,proof_reference:'case',decision_reference:'done'}),[0])
  assert.deepEqual(call('record_candidate_rights_event','owner',{...event,operation_id:'review',expected_version:1,status:'identity_verification'}),[1])
  const processing={...event,operation_id:'process',expected_version:2,status:'processing',proof_reference:'private-identity-case'}
  assert.deepEqual(call('record_candidate_rights_event','owner',processing),[1])
  const completion={...processing,operation_id:'complete',expected_version:3,status:'fulfilled',decision_reference:'private-execution-evidence'}
  assert.deepEqual(call('attest_candidate_rights_completion','worker',completion),[0])
  assert.deepEqual(call('attest_candidate_rights_completion','owner',{...completion,decision_reference:null}),[0])
  assert.deepEqual(call('apply_candidate_correction','owner',{...p,operation_id:'correction-one',field:'phone',new_value:'123',reason_reference:'verified-correction-case',expected_version:3,expected_application_version:1}),[1])
  assert.deepEqual(call('record_candidate_rectification','owner',{...p,processor_id:'MAIL',operation_id:'mail-rectification',expected_version:0,state:'complete',evidence_reference:'private-provider-proof'}),[1])
  db.exec("CREATE TRIGGER fail_completion BEFORE INSERT ON hiring_audit_events WHEN NEW.action='privacy.rights.fulfilled' BEGIN SELECT RAISE(ABORT,'audit unavailable'); END")
  assert.throws(()=>call('attest_candidate_rights_completion','owner',completion),/audit unavailable/)
  assert.equal(call('list_my_rights_requests','worker',p)[0].status,'processing')
  db.exec('DROP TRIGGER fail_completion')
  assert.deepEqual(call('attest_candidate_rights_completion','owner',completion),[1])
  assert.deepEqual(call('attest_candidate_rights_completion','owner',completion),[0])
  const [row]=call('list_my_rights_requests','worker',p)
  assert.equal(row.status,'fulfilled');assert.equal(row.deadline_at,event.deadline_at);assert.equal(row.owner_user_id,'owner')
  assert.doesNotMatch(JSON.stringify(row),/private-/)
  assert.equal(call('list_candidate_rights_events','owner',p).length,4)
  assert.equal(db.prepare("SELECT count(*) n FROM hiring_audit_events WHERE request_id='rights-one'").get().n,7)
  db.close()
})
