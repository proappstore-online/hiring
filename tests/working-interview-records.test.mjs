import { test } from 'node:test'
import assert from 'node:assert/strict'
import { fixture } from './playbook-fixture.mjs'
const scope = { organization_id:'a', brand_id:'brand-a', application_id:'app' }
const invitation = { ...scope, record_id:'working', invitation:'Observe daily stand-up, then remain for a one-to-one. Join details sent privately.', owner_user_id:'recruiter', playbook_version:1, secure_join_confirmed:1, operation_id:'invite' }
const outcome = { ...scope, record_id:'working', expected_version:1, outcome:'Proceed', exceptions:'None', operation_id:'outcome' }
function setup(configured=true) {
 const f=fixture()
 f.call('create_linkedin_application','owner-a',{...scope,requisition_id:'req-a',candidate_id:'candidate',candidate_name:'Alex',email:'alex@example.com',phone:'',linkedin_url:'',campaign_id:null,source_detail:'Recruiter',basis_reference:'Basis',contact_context:'Context',assignee_user_id:'recruiter',operation_id:'application'})
 if(configured) f.save(0,'owner-a',JSON.stringify({meeting:{time:'09:30',timezone:'Australia/Melbourne',secret_meeting_reference:'private',nested:[{MEETING_PASSWORD:'password'}]}}))
 return f
}
test('durable invitation guards tenant, brand, requisition, roles, owner, configuration and replay',()=>{
 const {db,call}=setup()
 try {
  for(const user of ['outsider','owner-b','reviewer','auditor',null]) assert.deepEqual(call('create_working_interview_invitation',user,invitation),[0])
  for(const patch of [{organization_id:'b'},{brand_id:'brand-b'},{application_id:'missing'},{owner_user_id:'reviewer'},{secure_join_confirmed:0},{playbook_version:2},{invitation:' '}]) assert.deepEqual(call('create_working_interview_invitation','recruiter',{...invitation,...patch}),[0])
  assert.deepEqual(call('create_working_interview_invitation','recruiter',invitation),[1])
  assert.deepEqual(call('create_working_interview_invitation','recruiter',invitation),[0])
  const row=call('get_working_interview_records','recruiter',scope)[0]
  assert.equal(row.outcome,null);assert.equal(row.completed_at,null);assert.equal(row.version,1)
  assert.equal(db.prepare('SELECT count(*) n FROM working_interview_records').get().n,1)
  assert.deepEqual(call('create_working_interview_invitation','owner-a',{...invitation,record_id:'manager',operation_id:'manager-invite'}),[1])
 } finally {db.close()}
})
test('only owning recruiter or manager may append outcomes; versions and audit survive corrections',()=>{
 const {db,call}=setup()
 try {
  call('create_working_interview_invitation','recruiter',invitation)
  for(const user of ['agent','reviewer','auditor','outsider','owner-b']) assert.deepEqual(call('record_working_interview_outcome',user,outcome),[0])
  assert.deepEqual(call('record_working_interview_outcome','recruiter',outcome),[1])
  assert.deepEqual(call('record_working_interview_outcome','recruiter',outcome),[0])
  assert.throws(()=>call('record_working_interview_outcome','owner-a',{...outcome,operation_id:'stale'}),/version conflict/)
  assert.deepEqual(call('record_working_interview_outcome','owner-a',{...outcome,expected_version:2,operation_id:'correction',outcome:'Hold'}),[1])
  assert.equal(call('get_working_interview_records','recruiter',scope)[0].version,3)
  assert.equal(call('get_working_interview_records','recruiter',scope)[0].outcome,'Hold')
  assert.deepEqual(db.prepare("SELECT action,actor_user_id,redacted_summary FROM hiring_audit_events WHERE object_type='working_interview' ORDER BY rowid").all().map(r=>[r.action,r.actor_user_id,r.redacted_summary]),[
   ['working_interview.invited','recruiter','Working interview version 1'],['working_interview.outcome','recruiter','Working interview version 2'],['working_interview.outcome','owner-a','Working interview version 3']])
  assert.equal(db.prepare('SELECT outcome FROM working_interview_records WHERE version=1').get().outcome,null)
  for(const sql of ['DELETE FROM working_interview_records',"UPDATE working_interview_records SET outcome='forged'"]) assert.throws(()=>db.exec(sql),/immutable/)
  db.exec("CREATE TRIGGER reject_working_audit BEFORE INSERT ON hiring_audit_events WHEN NEW.action='working_interview.outcome' BEGIN SELECT RAISE(ABORT,'audit unavailable'); END")
  assert.throws(()=>call('record_working_interview_outcome','owner-a',{...outcome,expected_version:3,operation_id:'failed'}),/audit unavailable/)
  assert.equal(call('get_working_interview_records','recruiter',scope)[0].version,3)
 } finally {db.close()}
})
test('nonprivileged reads return no data; policy recursively redacts secrets; revoked access fails closed',()=>{
 const {db,call,get}=setup()
 try {
  call('create_working_interview_invitation','recruiter',invitation)
  for(const user of ['reviewer','auditor','outsider','owner-b',null]) assert.deepEqual(call('get_working_interview_records',user,scope),[])
  for(const patch of [{organization_id:'b'},{brand_id:'brand-b'},{application_id:'missing'}]) assert.deepEqual(call('get_working_interview_records','recruiter',{...scope,...patch}),[])
  for(const user of ['owner-a','recruiter']) {
   assert.doesNotMatch(JSON.stringify(get(user)),/private|password|secret_meeting_reference|MEETING_PASSWORD/)
   const rows=call('get_working_interview_records',user,scope)
   assert.equal(rows.length,1);assert.doesNotMatch(JSON.stringify(rows),/"private"|password|secret_meeting_reference/)
  }
  db.exec("UPDATE hiring_grants SET status='revoked' WHERE user_id='recruiter'")
  assert.deepEqual(call('get_working_interview_records','recruiter',scope),[])
  assert.deepEqual(call('record_working_interview_outcome','recruiter',outcome),[0])
  db.exec("UPDATE hiring_organizations SET status='suspended' WHERE id='a'")
  assert.deepEqual(call('get_working_interview_records','owner-a',scope),[])
 } finally {db.close()}
})
test('missing or stale policy cannot create invitations; historical applications need no backfill',()=>{
 const {db,call,get,save}=setup(false)
 try {
  assert.equal(get()[0].version,0)
  assert.deepEqual(call('get_working_interview_records','owner-a',scope),[])
  assert.deepEqual(call('create_working_interview_invitation','owner-a',invitation),[0])
  save(0,'owner-a','{}')
  assert.deepEqual(call('create_working_interview_invitation','owner-a',invitation),[0])
  save(1,'owner-a','{"meeting":{"time":"09:30","timezone":"UTC"}}')
  assert.deepEqual(call('create_working_interview_invitation','owner-a',invitation),[0])
  assert.deepEqual(call('create_working_interview_invitation','owner-a',{...invitation,playbook_version:2}),[1])
  assert.equal(db.prepare("SELECT stage FROM hiring_applications WHERE id='app'").get().stage,'submitted')
  assert.equal(call('get_working_interview_records','owner-a',scope)[0].outcome,null)
 } finally {db.close()}
})

test('requisition-scoped grants cannot cross requisitions and internship onboarding stays separate',()=>{
 const {db,call}=setup()
 try {
  db.exec("INSERT INTO hiring_requisitions(id,organization_id,brand_id,title,created_at) VALUES('other','a','brand-a','Other',0)")
  db.exec("INSERT INTO hiring_grants(id,organization_id,brand_id,requisition_id,user_id,role,granted_by,created_at) VALUES('other-recruiter','a','brand-a','other','other-recruiter','recruiter','owner-a',0)")
  assert.deepEqual(call('create_working_interview_invitation','other-recruiter',invitation),[0])
  assert.deepEqual(call('create_working_interview_invitation','scoped',invitation),[1])
  assert.deepEqual(call('get_working_interview_records','other-recruiter',scope),[])
  assert.deepEqual(call('record_working_interview_outcome','other-recruiter',outcome),[0])
  db.exec("INSERT INTO hiring_internship_requisitions VALUES('req-a','a','brand-a','https://interns.freeappstore.online/','template',1,'owner-a',0)")
  assert.deepEqual(call('create_working_interview_invitation','owner-a',{...invitation,record_id:'new',operation_id:'new'}),[0])
  assert.equal(call('get_working_interview_records','owner-a',scope).length,1)
 } finally {db.close()}
})
