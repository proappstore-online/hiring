import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { onboardingMigration, correctionTools } from '../scripts/onboarding-contract.mjs'

const read = path => JSON.parse(readFileSync(new URL('../'+path,import.meta.url)))
const migrations=read('migrations.json').migrations, tools=read('mcp.json').tools
const scope={organization_id:'org',brand_id:'brand',application_id:'app',requisition_id:'req'}
function fixture({legacy=false, compensation='unpaid', legacyAcceptance=false}={}) {
 const db=new DatabaseSync(':memory:');db.exec('PRAGMA foreign_keys=ON')
 for(const m of migrations.filter(m=>m.name!==onboardingMigration.name))db.exec(m.sql)
 const call=(name,user='owner',values={})=>{
  const t=tools.find(t=>t.name===name),p={...Object.fromEntries(Object.entries(t.params??{}).filter(([,s])=>s.optional).map(([k])=>[k,null])),...values,__user_id:user,__now:Date.now(),__uuid:crypto.randomUUID()}
  db.exec('BEGIN');try{
   const result=(t.statements??[t.sql]).map(sql=>{const args=[];sql=sql.replace(/:([a-z_][a-z0-9_]*)/gi,(_,k)=>{assert.notEqual(p[k],undefined,`${name}: ${k}`);args.push(p[k]);return '?' });return t.operation==='query'?db.prepare(sql).all(...args):db.prepare(sql).run(...args).changes})
   db.exec('COMMIT');return t.operation==='query'?result[0]:result
  }catch(e){db.exec('ROLLBACK');throw e}
 }
 call('create_workspace','owner',{...scope,organization_name:'Org',brand_name:'Brand',requisition_title:'Role',operation_id:'boot'})
 call('create_linkedin_application','owner',{...scope,candidate_id:'candidate',operation_id:'candidate',candidate_name:'Person',email:'person@example.com',phone:'',linkedin_url:'',source_detail:'Applicant',basis_reference:'Applicant initiated',contact_context:'Applicant supplied',assignee_user_id:'owner'})
 call('save_offer_draft','owner',{tenant_id:'org',brand_id:'brand',application_id:'app',requisition_id:'req',terms_json:JSON.stringify({compensation_type:compensation,subject:'Original offer',body:legacyAcceptance?'Erroneous paid test terms, not sent':'Unpaid volunteer role'}),expected_version:0,operation_id:'offer-draft'})
 const offer=db.prepare('SELECT * FROM hiring_offers').get()
 for(const [name,version] of [['submit_offer_for_approval',1],['approve_offer',2]])call(name,'owner',{tenant_id:'org',brand_id:'brand',offer_id:offer.id,expected_version:version,operation_id:name})
 db.exec("UPDATE hiring_applications SET stage='offered'")
 if(legacyAcceptance)db.prepare("INSERT INTO hiring_acceptances VALUES('legacy-accept','org','brand','app',?,1,'owner',1,'Original paid test acceptance',1)").run(offer.id)
 if(!legacy)db.exec(onboardingMigration.sql)
 return {db,call,offer:db.prepare('SELECT * FROM hiring_offers').get()}
}
const accept={tenant_id:'org',brand_id:'brand',application_id:'app',expected_version:1,operation_id:'accept',acceptance_evidence:'Candidate explicitly accepted the unpaid volunteer role by email'}
const lifecycle={...scope,expected_version:2,from_stage:'accepted',to_stage:'onboarding',operation_id:'start',evidence:'Begin agreed setup',registration_evidence:'',requirements_evidence:'',handoff_evidence:''}
function correction(f,patch={}){return {...scope,offer_id:f.offer.id,expected_application_version:2,expected_offer_version:1,expected_offer_lock_version:3,expected_correction_version:0,terms_json:JSON.stringify({compensation_type:'unpaid',subject:'Actual volunteer offer',body:'Actual unpaid terms agreed by the candidate'}),acceptance_evidence:'Verified email explicitly accepts the actual unpaid volunteer role',reason:'Remove erroneous paid test terms; candidate never received those terms',operation_id:'correct',...patch}}

test('upgrade retains the original paid-only migration and commits unpaid acceptance without changing that guard',()=>{
 assert.deepEqual(migrations.find(m=>m.name==='0028_candidate_acceptance'),read('tests/fixtures/migration-0028-original.json'))
 assert.deepEqual(migrations.find(m=>m.name===onboardingMigration.name),onboardingMigration)
 for(const compensation of ['paid','unpaid','internship','volunteer']){
  const f=fixture({legacy:true,compensation});try{
   const before=f.db.prepare('SELECT * FROM hiring_applications').all()
   const original=f.db.prepare("SELECT sql FROM sqlite_schema WHERE name='hiring_acceptances_validate'").get().sql
   assert.match(original,/compensation_type.*paid/)
   if(compensation!=='paid')assert.throws(()=>f.db.prepare("INSERT INTO hiring_acceptances VALUES('old-attempt','org','brand','app',?,1,'owner',1,'accepted',1)").run(f.offer.id),/invalid acceptance/)
   f.db.exec(onboardingMigration.sql)
   assert.deepEqual(f.db.prepare('SELECT id,stage,version,accepted_stage FROM hiring_applications').all(),before.map(({id,stage,version,accepted_stage})=>Object.assign(Object.create(null),{id,stage,version,accepted_stage})))
   assert.equal(f.call('record_acceptance','owner',accept)[0],1)
   assert.equal(f.db.prepare("SELECT sql FROM sqlite_schema WHERE name='hiring_acceptances_validate'").get().sql,original)
   assert.equal(f.call('get_application','owner',scope)[0].stage,'accepted')
   assert.equal(f.db.prepare('SELECT count(*) n FROM hiring_acceptances').get().n,0)
   f.call('record_lifecycle_transition','owner',lifecycle)
   assert.equal(f.call('get_application','owner',scope)[0].stage,'onboarding')
   assert.equal(f.call('get_current_pipeline','owner',scope)[0].stage,'onboarding')
  }finally{f.db.close()}
 }
})

test('owner correction preserves immutable legacy records and makes actual terms/evidence effective',()=>{
 const f=fixture({compensation:'paid',legacyAcceptance:true});try{
  const originalOffer=f.db.prepare('SELECT * FROM hiring_offer_versions').all(), originalAcceptance=f.db.prepare('SELECT * FROM hiring_acceptances').all()
  const args=correction(f)
  assert.equal(f.call('correct_accepted_offer','owner',args)[0],1)
  assert.equal(f.call('correct_accepted_offer','owner',args)[0],0)
  assert.equal(f.call('get_offer_correction_result','owner',args)[0].correction_version,1)
  assert.deepEqual(f.call('get_offer_correction_result','owner',{...args,reason:'conflicting replay'}),[])
  assert.equal(f.call('get_offer','owner',{tenant_id:'org',brand_id:'brand',application_id:'app'})[0].terms_json,args.terms_json)
  const offer=f.call('get_offer','owner',{tenant_id:'org',brand_id:'brand',application_id:'app'})[0]
  assert.equal(JSON.parse(offer.original_terms_json).compensation_type,'paid');assert.equal(offer.correction_version,1)
  const app=f.call('get_application','owner',scope)[0];assert.equal(app.stage,'accepted');assert.equal(app.version,3);assert.equal(app.acceptance_evidence,args.acceptance_evidence)
  assert.deepEqual(f.db.prepare('SELECT * FROM hiring_offer_versions').all(),originalOffer)
  assert.deepEqual(f.db.prepare('SELECT * FROM hiring_acceptances').all(),originalAcceptance)
  f.call('record_lifecycle_transition','owner',{...lifecycle,expected_version:3})
  assert.equal(f.call('get_application','owner',scope)[0].stage,'onboarding')
  assert.throws(()=>f.db.exec("UPDATE hiring_offer_corrections SET reason='forged'"),/immutable/)
  assert.throws(()=>f.db.exec('DELETE FROM hiring_offer_corrections'),/immutable/)
  assert.equal(f.db.prepare("SELECT count(*) n FROM hiring_audit_events WHERE action='offer.accepted_terms_corrected'").get().n,1)
  assert.deepEqual(f.db.prepare('PRAGMA foreign_key_check').all(),[])
 }finally{f.db.close()}
})

test('correction requires owner, exact scopes/versions, meaningful terms, evidence and reason',()=>{
 const f=fixture({compensation:'paid',legacyAcceptance:true});try{
  f.call('add_workspace_member','owner',{...scope,member_user_id:'recruiter',role:'recruiter',operation_id:'grant'})
  for(const user of ['outsider','recruiter','system:worker'])assert.throws(()=>f.call('correct_accepted_offer',user,correction(f)),/owner|Human/)
  for(const patch of [{brand_id:'other'},{organization_id:'other'},{application_id:'missing'},{offer_id:'wrong'},{expected_application_version:1},{expected_offer_version:0},{expected_offer_lock_version:2},{expected_correction_version:1},{reason:' '},{acceptance_evidence:' '},{terms_json:'{}'},{terms_json:'invalid'},{terms_json:JSON.stringify({compensation_type:'unpaid',subject:'Role',body:123})}])assert.throws(()=>f.call('correct_accepted_offer','owner',correction(f,patch)))
  assert.equal(f.db.prepare('SELECT count(*) n FROM hiring_offer_corrections').get().n,0)
  assert.equal(f.call('get_application','owner',scope)[0].version,2)
  assert.deepEqual(f.call('list_offer_corrections','outsider',{...scope,offer_id:f.offer.id}),[])
 }finally{f.db.close()}
 const f2=fixture();try{assert.throws(()=>f2.call('correct_accepted_offer','owner',correction(f2,{expected_application_version:1})),/accepted/)}finally{f2.db.close()}
})

test('correction and acceptance fail atomically on audit failure, erasure or forged workflow writes',()=>{
 for(const legacyAcceptance of [false,true]){
  const f=fixture({legacyAcceptance,compensation:legacyAcceptance?'paid':'unpaid'});try{
   assert.throws(()=>f.db.exec("UPDATE hiring_applications SET workflow_stage='accepted'"),/Controlled/)
   assert.throws(()=>f.db.exec("UPDATE hiring_applications SET workflow_acceptance_evidence='forged'"),/Controlled/)
   f.db.exec("CREATE TRIGGER unavailable_audit BEFORE INSERT ON hiring_audit_events WHEN NEW.action IN ('application.accepted','offer.accepted_terms_corrected') BEGIN SELECT RAISE(ABORT,'audit unavailable'); END")
   assert.throws(()=>legacyAcceptance?f.call('correct_accepted_offer','owner',correction(f)):f.call('record_acceptance','owner',accept),/audit unavailable/)
   assert.equal(f.db.prepare('SELECT count(*) n FROM hiring_acceptances_v2').get().n,0)
   assert.equal(f.db.prepare('SELECT count(*) n FROM hiring_offer_corrections').get().n,0)
   assert.equal(f.call('get_application','owner',scope)[0].version,legacyAcceptance?2:1)
  }finally{f.db.close()}
 }
 const f=fixture();try{
  f.db.exec("INSERT INTO hiring_restore_sessions VALUES('restore','org','brand','digest',1,0,'importing',1)")
  f.db.prepare("INSERT INTO hiring_restore_tombstones VALUES('restore','request','org','brand','candidate','app',1)").run()
  assert.throws(()=>f.call('record_acceptance','owner',accept),/tombstone/)
 }finally{f.db.close()}
})

test('successor acceptance can be corrected and completion still requires every handoff evidence',()=>{
 const f=fixture();try{
  f.call('record_acceptance','owner',accept)
  const args=correction(f)
  f.call('correct_accepted_offer','owner',args)
  assert.equal(f.call('get_application','owner',scope)[0].acceptance_evidence,args.acceptance_evidence)
  f.call('record_lifecycle_transition','owner',{...lifecycle,expected_version:3})
  const done={...lifecycle,expected_version:4,from_stage:'onboarding',to_stage:'onboarded',operation_id:'complete'}
  assert.throws(()=>f.call('record_lifecycle_transition','owner',done),/evidence are required/)
  f.call('record_lifecycle_transition','owner',{...done,registration_evidence:'Verified Interns membership',requirements_evidence:'Profile, agreement and checklist complete',handoff_evidence:'Team introduction verified'})
  assert.equal(f.call('get_application','owner',scope)[0].stage,'onboarded')
  assert.equal(f.call('get_offer','owner',{tenant_id:'org',brand_id:'brand',application_id:'app'})[0].terms_json,args.terms_json)
 }finally{f.db.close()}
})

test('manifest exposes exact guarded correction tools and retention counts successor evidence',()=>{
 for(const expected of correctionTools)assert.deepEqual(tools.find(t=>t.name===expected.name),expected)
 for(const table of ['hiring_acceptances_v2','hiring_lifecycle_events_v2','hiring_offer_corrections'])assert.match(tools.find(t=>t.name==='verify_store_d1').sql,new RegExp(table))
})
