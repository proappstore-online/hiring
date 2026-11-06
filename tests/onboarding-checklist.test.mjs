import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { checklistMigration, checklistTools } from '../scripts/onboarding-checklist.mjs'

const migrations=JSON.parse(readFileSync(new URL('../migrations.json',import.meta.url))).migrations
const tools=JSON.parse(readFileSync(new URL('../mcp.json',import.meta.url))).tools
const scope={organization_id:'org',brand_id:'brand',requisition_id:'req',application_id:'app'}
const steps=[{key:'identity',label:'Workspace identity',type:'identity',required:true,instructions:'Verify the identity and membership reference.'},{key:'document',label:'Document review',type:'document',required:true,instructions:'Check the document reference.'},{key:'note',label:'Optional note',type:'text',required:false,instructions:''}]
function fixture(){
 const db=new DatabaseSync(':memory:');db.exec('PRAGMA foreign_keys=ON')
 for(const migration of migrations)db.exec(migration.sql)
 const call=(name,user='owner',values={})=>{
  const t=tools.find(tool=>tool.name===name);assert.ok(t,name)
  const p={...Object.fromEntries(Object.entries(t.params??{}).filter(([,definition])=>definition.optional).map(([key])=>[key,null])),...values,__user_id:user,__now:Date.now(),__uuid:crypto.randomUUID()}
  db.exec('BEGIN');try{const results=(t.statements??[t.sql]).map(query=>{const args=[];const sql=query.replace(/:([a-z_][a-z0-9_]*)/gi,(_,key)=>{assert.notEqual(p[key],undefined,`${name}: ${key}`);args.push(p[key]);return '?'});return t.operation==='query'?db.prepare(sql).all(...args):db.prepare(sql).run(...args).changes});db.exec('COMMIT');return t.operation==='query'?results[0]:results[0]}catch(error){db.exec('ROLLBACK');throw error}
 }
 call('create_workspace','owner',{...scope,organization_name:'Org',brand_name:'Brand',requisition_title:'Role',operation_id:'boot'})
 call('create_linkedin_application','owner',{...scope,candidate_id:'candidate',operation_id:'candidate',candidate_name:'Person',email:'person@example.com',phone:'',linkedin_url:'https://www.linkedin.com/in/synthetic-test',source_detail:'Applicant',basis_reference:'Applicant initiated',contact_context:'Applicant supplied',assignee_user_id:'owner'})
 call('save_offer_draft','owner',{tenant_id:'org',brand_id:'brand',application_id:'app',requisition_id:'req',terms_json:JSON.stringify({compensation_type:'unpaid',subject:'Role',body:'Unpaid volunteer role'}),expected_version:0,operation_id:'offer-draft'})
 const offer=db.prepare('SELECT * FROM hiring_offers').get()
 call('submit_offer_for_approval','owner',{tenant_id:'org',brand_id:'brand',offer_id:offer.id,expected_version:1,operation_id:'submit-offer'})
 call('approve_offer','owner',{tenant_id:'org',brand_id:'brand',offer_id:offer.id,expected_version:2,operation_id:'approve-offer'})
 db.exec("UPDATE hiring_applications SET stage='offered'")
 call('record_acceptance','owner',{tenant_id:'org',brand_id:'brand',application_id:'app',expected_version:1,operation_id:'accept',acceptance_evidence:'Candidate accepted this role by email'})
 return {db,call,close:()=>db.close()}
}
const publish=(patch={})=>({...scope,operation_id:'policy-1',expected_version:0,steps_json:JSON.stringify(steps),invitation_mode:'off',candidate_note_mode:'off',...patch})
const snapshot=(patch={})=>({...scope,operation_id:'snapshot-1',policy_version:1,expected_application_version:3,...patch})
const record=(patch={})=>({...scope,operation_id:'identity-1',policy_version:1,step_key:'identity',revision:1,expected_application_version:3,status:'verified',value_text:'member-123',comment:'Matched candidate',evidence:'Directory record #123',...patch})
const transition=(patch={})=>({...scope,operation_id:'onboard',expected_version:3,from_stage:'onboarding',to_stage:'onboarded',evidence:'Completed configured criteria',registration_evidence:'',requirements_evidence:'',handoff_evidence:'',...patch})
const begin=f=>f.call('record_lifecycle_transition','owner',{...scope,operation_id:'begin',expected_version:2,from_stage:'accepted',to_stage:'onboarding',evidence:'Begin setup',registration_evidence:'',requirements_evidence:'',handoff_evidence:''})

test('additive migration exposes immutable organisation versions and exact scoped tools',()=>{
 assert.deepEqual(migrations.find(m=>m.name===checklistMigration.name),checklistMigration)
 for(const t of checklistTools)assert.deepEqual(tools.find(item=>item.name===t.name),t)
 const f=fixture();try{
  assert.equal(f.call('publish_onboarding_policy','owner',publish()),1)
  assert.equal(f.call('publish_onboarding_policy','owner',publish()),0)
  assert.equal(f.call('get_onboarding_policy_result','owner',publish()).length,1)
  assert.deepEqual(f.call('get_onboarding_policy_result','owner',publish({steps_json:'[]'})),[])
  assert.equal(f.db.prepare('SELECT count(*) n FROM hiring_onboarding_definitions').get().n,3)
  assert.throws(()=>f.db.exec("UPDATE hiring_onboarding_policies SET invitation_mode='manual'"),/immutable/)
  assert.throws(()=>f.db.exec('DELETE FROM hiring_onboarding_definitions'),/immutable/)
  assert.equal(f.call('publish_onboarding_policy','owner',publish({operation_id:'policy-2',expected_version:1,invitation_mode:'manual',candidate_note_mode:'manual'})),1)
  assert.equal(f.call('list_onboarding_policies','owner',scope)[0].version,2)
  assert.deepEqual(f.call('list_onboarding_policies','outsider',scope),[])
 }finally{f.close()}
})

test('owner publication validates definition shape, scope, actor and versions',()=>{
 const f=fixture();try{
  for(const user of ['outsider','system:worker'])assert.throws(()=>f.call('publish_onboarding_policy',user,publish()))
  for(const patch of [{organization_id:'other'},{brand_id:'other'},{expected_version:1},{steps_json:'[]'},{steps_json:'invalid'},{steps_json:JSON.stringify([{...steps[0],required:false}])},{steps_json:JSON.stringify([steps[0],steps[0]])},{steps_json:JSON.stringify([{...steps[0],type:'unknown'}])},{invitation_mode:'automatic'},{candidate_note_mode:'automatic'}])assert.throws(()=>f.call('publish_onboarding_policy','owner',publish(patch)))
  assert.equal(f.db.prepare('SELECT count(*) n FROM hiring_onboarding_policies').get().n,0)
 }finally{f.close()}
})

test('candidate snapshots are pinned; required latest verified steps gate onboarded atomically',()=>{
 const f=fixture();try{
  f.call('publish_onboarding_policy','owner',publish())
  begin(f)
  assert.throws(()=>f.call('record_lifecycle_transition','owner',transition()),/snapshot required|Lifecycle transition/)
  assert.equal(f.call('create_onboarding_snapshot','owner',snapshot()),1)
  assert.equal(f.call('create_onboarding_snapshot','owner',snapshot()),0)
  assert.equal(f.call('get_onboarding_snapshot_result','owner',snapshot()).length,1)
  assert.deepEqual(f.call('get_onboarding_snapshot_result','owner',snapshot({expected_application_version:2})),[])
  assert.throws(()=>f.call('record_lifecycle_transition','owner',transition()),/steps are not verified|Lifecycle transition/)
  assert.equal(f.call('record_onboarding_step','owner',record()),1)
  assert.equal(f.call('record_onboarding_step','owner',record()),0)
  assert.equal(f.call('get_onboarding_step_result','owner',record()).length,1)
  assert.deepEqual(f.call('get_onboarding_step_result','owner',record({evidence:'changed'})),[])
  f.call('record_onboarding_step','owner',record({operation_id:'document-1',step_key:'document',value_text:'document #5',evidence:'Reviewed document #5'}))
  assert.equal(f.call('list_onboarding_steps','owner',scope).filter(row=>row.required && row.status==='verified').length,2)
  f.call('publish_onboarding_policy','owner',publish({operation_id:'policy-2',expected_version:1,steps_json:JSON.stringify([...steps,{key:'new',label:'New required',type:'boolean',required:true,instructions:''}])}))
  assert.equal(f.call('get_onboarding_snapshot','owner',scope)[0].policy_version,1)
  assert.equal(f.call('record_lifecycle_transition','owner',transition()),1)
  assert.equal(f.call('get_lifecycle_result','owner',transition()).length,1)
  assert.equal(f.call('get_application','owner',scope)[0].stage,'onboarded')
  assert.equal(f.db.prepare("SELECT count(*) n FROM hiring_lifecycle_events_v2 WHERE to_stage='onboarded'").get().n,1)
 }finally{f.close()}
})

test('verification rejects stale revisions, invalid typed values, cross-scope writes and revoked access',()=>{
 const f=fixture();try{
  f.call('publish_onboarding_policy','owner',publish())
  begin(f)
  f.call('create_onboarding_snapshot','owner',snapshot())
  for(const user of ['outsider','system:worker'])assert.throws(()=>f.call('record_onboarding_step',user,record({operation_id:`bad-${user}`})))
  for(const patch of [{organization_id:'other'},{brand_id:'other'},{requisition_id:'other'},{application_id:'other'},{policy_version:2},{step_key:'missing'},{revision:2},{expected_application_version:2},{status:'verified',value_text:''},{status:'verified',evidence:''}]){
   assert.throws(()=>f.call('record_onboarding_step','owner',record({...patch,operation_id:'bad-'+crypto.randomUUID()})))
  }
  assert.equal(f.call('record_onboarding_step','owner',record()),1)
  assert.throws(()=>f.call('record_onboarding_step','owner',record({operation_id:'stale',revision:1})),/revision/)
  assert.throws(()=>f.db.exec("UPDATE hiring_onboarding_step_records SET status='verified'"),/immutable/)
  assert.deepEqual(f.call('list_onboarding_steps','outsider',scope),[])
  assert.deepEqual(f.call('get_current_onboarding_policy','outsider',scope),[])
 }finally{f.close()}
})
