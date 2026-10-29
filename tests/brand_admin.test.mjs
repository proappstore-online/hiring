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


test('identity editors enforce ownership, reject replay and forged scopes, and audit atomically', () => {
  const { db, call } = fixture()
  try {
    const org = { ...A, name: 'Updated organization', verified_contact: 'contact@example.com', operation_id: 'org-edit' }
    const brand = { ...A, name: 'Updated A', slug: 'brand-a', notice_version: 'v2', reply_identity: 'A reply', operation_id: 'brand-edit' }
    for (const user of ['staff-a', 'staff-b', 'outsider']) {
      assert.deepEqual(call('update_organization_identity', user, org), [0,0])
      assert.deepEqual(call('update_brand_settings', user, brand), [0,0])
      assert.deepEqual(call('list_organization_members', user, A), [])
      assert.deepEqual(call('get_admin_settings', user, A), [])
    }
    assert.deepEqual(call('update_brand_settings', 'owner', { ...brand, organization_id: 'forged' }), [0,0])
    assert.deepEqual(call('update_organization_identity', 'owner', { ...org, name: ' ' }), [0,0])
    assert.deepEqual(call('update_brand_settings', 'owner', { ...brand, slug: 'BAD SLUG' }), [0,0])
    assert.deepEqual(call('update_organization_identity','owner',org), [1,1])
    assert.deepEqual(call('update_brand_settings','owner',brand), [1,1])
    assert.deepEqual(call('update_organization_identity','owner',{ ...org, name: 'Replay' }), [0,0])
    assert.deepEqual(call('update_brand_settings','owner',{ ...brand, name: 'Replay' }), [0,0])
    const settings = call('get_admin_settings','owner',A)[0]
    assert.equal(settings.organization_name,org.name)
    assert.equal(settings.verified_contact,org.verified_contact)
    assert.equal(settings.brand_name,brand.name)
    assert.equal(settings.reply_identity,brand.reply_identity)
    assert.deepEqual(call('update_organization_identity','owner',{ ...A, verified_contact: 'new-contact', operation_id: 'contact-only' }),[1,1])
    assert.equal(call('get_admin_settings','owner',A)[0].organization_name,org.name)
    assert.deepEqual(call('update_organization_identity','owner',{ ...A, operation_id: 'empty-edit' }),[0,0])
    assert.equal(call('get_admin_settings','owner',B)[0].brand_name,'Brand b')
    db.exec("CREATE TRIGGER admin_audit_failure BEFORE INSERT ON hiring_audit_events WHEN NEW.action='brand.settings_updated' BEGIN SELECT RAISE(ABORT,'audit failed'); END")
    assert.throws(() => call('update_brand_settings','owner',{ ...brand, name: 'Rollback', operation_id: 'rollback' }), /audit failed/)
    assert.equal(call('get_admin_settings','owner',A)[0].brand_name,brand.name)
    const events=db.prepare("SELECT actor_user_id FROM hiring_audit_events WHERE operation_id IN ('org-edit','brand-edit')").all()
    assert.equal(events.length,2); assert.ok(events.every(e=>e.actor_user_id==='owner'))
  } finally { db.close() }
})

test('organization and sibling brand identities stay independent and publication names and notices remain frozen', () => {
  const { db, call, publish } = fixture()
  try {
    const C = { organization_id:'other-org',brand_id:'c',requisition_id:'req-c' }
    call('create_workspace','other-owner',{ ...C,organization_name:'Other organization',brand_name:'Brand c',requisition_title:'Other role',operation_id:'boot-c' })
    const change = s => ({ ...s, name:`New ${s.brand_id}`,slug:`slug-${s.brand_id}`,notice_version:`notice-${s.brand_id}`,reply_identity:`reply-${s.brand_id}`,operation_id:`edit-${s.brand_id}` })
    call('update_brand_settings','owner',change(A))
    call('update_brand_settings','owner',change(B))
    for (const s of [A,B]) call('publish_job_requisition','owner',{ ...publication(s),notice_version:`notice-${s.brand_id}`,notice_text:`Independent notice ${s.brand_id}` })
    call('update_organization_identity','owner',{ ...A,name:'Renamed org',verified_contact:'New contact',operation_id:'rename-org' })
    call('update_brand_settings','owner',{ ...change(A),name:'Later A',notice_version:'later',operation_id:'later-a' })
    assert.equal(call('get_admin_settings','other-owner',C)[0].organization_name,'Other organization')
    assert.deepEqual(call('update_organization_identity','owner',{ ...C,name:'Forged',verified_contact:'x',operation_id:'forged-org' }),[0,0])
    for (const s of [A,B]) {
      const job=call('get_public_job',null,s)[0]
      assert.equal(job.brand_name,`New ${s.brand_id}`)
      assert.equal(job.organization_name,'Org')
      assert.equal(job.notice_text,`Independent notice ${s.brand_id}`)
      assert.equal(job.notice_version,`notice-${s.brand_id}`)
    }
    assert.deepEqual(call('list_public_jobs',null,{after_id:''}).map(j=>j.brand_name),['New a','New b'])
    assert.throws(()=>db.exec("UPDATE hiring_publication_identities SET brand_name='tampered'"),/immutable/)
  } finally { db.close() }
})

test('scoped grant management immediately changes access and revokes both explicit and legacy grants', () => {
  const { db, call } = fixture()
  try {
    const list=()=>call('list_organization_members','owner',A)
    assert.equal(list().some(g=>g.user_id==='new-staff'),false)
    assert.deepEqual(call('list_requisitions','new-staff',A),[])
    const g={...A,member_user_id:'new-staff',role:'recruiter',grant_id:'new-grant',operation_id:'new-grant-op'}
    assert.deepEqual(call('grant_workspace_access','staff-a',g),[0,0])
    assert.deepEqual(call('grant_workspace_access','owner',g),[1,1])
    assert.equal(list().find(x=>x.id==='new-grant').scope_type,'requisition')
    assert.equal(call('list_requisitions','new-staff',A).length,1)
    assert.deepEqual(call('list_requisitions','new-staff',B),[])
    assert.deepEqual(call('revoke_workspace_grant','staff-a',{...A,grant_id:g.grant_id,operation_id:'bad-revoke'}),[0,0])
    assert.deepEqual(call('revoke_workspace_grant','owner',{...A,grant_id:g.grant_id,operation_id:'revoke'}),[1,1])
    assert.deepEqual(call('list_requisitions','new-staff',A),[])
    assert.equal(list().some(x=>x.id===g.grant_id),false)
    const legacy=list().find(x=>x.user_id==='staff-a')
    assert.equal(legacy.source,'membership')
    call('revoke_workspace_membership','owner',{...A,grant_id:legacy.id,operation_id:'revoke-legacy'})
    assert.deepEqual(call('list_requisitions','staff-a',A),[])
    call('grant_organization_access','owner',{...g,requisition_id:null,grant_id:'org-grant',operation_id:'org-grant'})
    assert.equal(list().find(x=>x.id==='org-grant').scope_type,'organization')
    assert.equal(call('list_requisitions','new-staff',B).length,1)
    call('revoke_workspace_grant','owner',{...A,grant_id:'org-grant',operation_id:'revoke-org'})
    assert.deepEqual(call('list_requisitions','new-staff',B),[])
  } finally { db.close() }
})

test('0014 snapshots populated legacy publications before identity edits', () => {
  const db=new DatabaseSync(':memory:')
  try {
    for(const m of migrations.slice(0,-1)) db.exec(m.sql)
    db.exec("INSERT INTO hiring_organizations(id,name,created_by,created_at) VALUES('o','Legacy org','u',1); INSERT INTO hiring_brands(id,organization_id,name,created_at) VALUES('b','o','Legacy brand',1); INSERT INTO hiring_requisitions(id,organization_id,brand_id,title,created_at) VALUES('r','o','b','Role',1); INSERT INTO hiring_job_publications(requisition_id,organization_id,brand_id,description,location,arrangement,compensation,notice_version,notice_text,contact,actor_user_id,operation_id,created_at) VALUES('r','o','b','Description','Remote','Paid','Salary','v1','Notice','Contact','u','publish',1)")
    db.exec(migrations.at(-1).sql)
    db.exec("UPDATE hiring_brands SET name='Edited'")
    assert.equal(db.prepare('SELECT brand_name FROM hiring_publication_identities').get().brand_name,'Legacy brand')
  } finally { db.close() }
})

test('brand ownership alone cannot administer organization identity or organization-wide grants', () => {
  const {db,call}=fixture()
  try {
    db.exec("INSERT INTO hiring_grants(id,organization_id,brand_id,user_id,role,granted_by,created_at) VALUES('brand-owner','org','a','brand-owner','owner','owner',1)")
    assert.equal(call('get_admin_settings','brand-owner',A)[0].can_manage_organization,0)
    assert.deepEqual(call('list_organization_members','brand-owner',A),[])
    assert.ok(call('list_brand_admin_members','brand-owner',A).every(g=>g.brand_id==='a'))
    assert.deepEqual(call('list_brand_admin_members','brand-owner',B),[])
    assert.deepEqual(call('update_organization_identity','brand-owner',{...A,name:'Escalation',verified_contact:'x',operation_id:'escalate-org'}),[0,0])
    const values={name:'Own brand',slug:'own',notice_version:'own-v1',reply_identity:'Own reply',operation_id:'own-settings'}
    assert.deepEqual(call('update_brand_settings','brand-owner',{...A,...values}),[1,1])
    assert.deepEqual(call('update_brand_settings','brand-owner',{...B,...values,operation_id:'sibling-settings'}),[0,0])
    assert.deepEqual(call('update_brand_settings','owner',{...B,...values,operation_id:'duplicate-slug'}),[0,0])
  } finally {db.close()}
})

test('organization owner grants can manage upload policy across sibling brands', () => {
  const { db, call } = fixture()
  try {
    db.exec("INSERT INTO hiring_grants(id,organization_id,brand_id,user_id,role,granted_by,created_at) VALUES('org-owner','org',NULL,'org-owner','owner','owner',1)")
    assert.equal(call('get_admin_settings', 'org-owner', A)[0].can_manage_candidate_uploads, 1)
    assert.equal(call('get_admin_settings', 'org-owner', A)[0].can_manage_organization, 0)
    assert.deepEqual(call('set_candidate_file_uploads', 'org-owner', { ...A, allow_candidate_file_uploads: 0, operation_id: 'org-owner-disable' }), [1, 1])
    assert.equal(call('get_admin_settings', 'owner', B)[0].allow_candidate_file_uploads, 0)
    db.exec("UPDATE hiring_grants SET status='revoked' WHERE id='org-owner'")
    assert.deepEqual(call('set_candidate_file_uploads', 'org-owner', { ...A, allow_candidate_file_uploads: 1, operation_id: 'revoked-owner-enable' }), [0, 0])
  } finally { db.close() }
})
