import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { terminalMigration, terminalTools } from '../scripts/terminal-next-actions.mjs'

const migrations=JSON.parse(readFileSync(new URL('../migrations.json',import.meta.url))).migrations
const tools=JSON.parse(readFileSync(new URL('../mcp.json',import.meta.url))).tools
const scope={organization_id:'org',brand_id:'brand',requisition_id:'req',application_id:'app'}
function fixture({skipTerminal=false}={}){
 const db=new DatabaseSync(':memory:');db.exec('PRAGMA foreign_keys=ON')
 for(const m of migrations.filter(x=>!skipTerminal || x.name!==terminalMigration.name))db.exec(m.sql)
 const call=(name,user='owner',values={})=>{
  const t=tools.find(x=>x.name===name);assert.ok(t,name)
  const p={...Object.fromEntries(Object.entries(t.params??{}).filter(([,x])=>x.optional).map(([k])=>[k,null])),...values,__user_id:user,__now:Date.now(),__uuid:crypto.randomUUID()}
  db.exec('BEGIN');try{const results=(t.statements??[t.sql]).map(sql=>{const binds=[];const prepared=sql.replace(/:([a-z_][a-z0-9_]*)/gi,(_,k)=>{assert.notEqual(p[k],undefined,`${name}: ${k}`);binds.push(p[k]);return '?'});return t.operation==='query'?db.prepare(prepared).all(...binds):db.prepare(prepared).run(...binds).changes});db.exec('COMMIT');return t.operation==='query'?results[0]:results[0]}catch(e){db.exec('ROLLBACK');throw e}
 }
 call('create_workspace','owner',{...scope,organization_name:'Org',brand_name:'Brand',requisition_title:'Role',operation_id:'boot'})
 call('create_linkedin_application','owner',{...scope,candidate_id:'candidate',candidate_name:'Person',email:'person@example.com',phone:'',linkedin_url:'https://www.linkedin.com/in/synthetic-test',source_detail:'Applicant',basis_reference:'Applicant initiated',contact_context:'Applicant supplied',assignee_user_id:'owner',operation_id:'candidate'})
 return {db,call,close:()=>db.close()}
}
const plan=(patch={})=>({...scope,operation_id:'plan-1',expected_revision:0,kind:'actionable',owner:'Serge',action:'Review candidate record',blocker_reason:'',review_at:null,...patch})

test('additive terminal migration and scoped plan tools match the manifest',()=>{
 assert.deepEqual(migrations.find(x=>x.name===terminalMigration.name),terminalMigration)
 for(const t of terminalTools)assert.deepEqual(tools.find(x=>x.name===t.name),t)
})

test('missing plans are reported; valid plans are scoped, versioned and retry safe',()=>{
 const f=fixture();try{
  assert.equal(f.call('list_candidate_next_action_gaps','owner',{organization_id:'org',brand_id:'brand',limit:100}).length,1)
  assert.deepEqual(f.call('list_candidate_next_action_gaps','outsider',{organization_id:'org',brand_id:'brand',limit:100}),[])
  assert.throws(()=>f.call('set_candidate_next_action_plan','outsider',plan()),/scoped recruiter/)
  for(const patch of [{brand_id:'other'},{requisition_id:'other'},{owner:'candidate'},{action:''},{expected_revision:1},{kind:'blocked',blocker_reason:''},{kind:'deferred',review_at:null}])assert.throws(()=>f.call('set_candidate_next_action_plan','owner',plan({...patch,operation_id:crypto.randomUUID()})))
  assert.equal(f.call('set_candidate_next_action_plan','owner',plan()),1)
  assert.equal(f.call('set_candidate_next_action_plan','owner',plan()),0)
  assert.equal(f.call('get_candidate_next_action_plan_result','owner',plan()).length,1)
  assert.deepEqual(f.call('get_candidate_next_action_plan_result','owner',plan({action:'Changed'})),[])
  assert.equal(f.call('list_candidate_next_action_gaps','owner',{organization_id:'org',brand_id:'brand',limit:100}).length,0)
  assert.throws(()=>f.call('set_candidate_next_action_plan','owner',plan({operation_id:'stale',expected_revision:0})),/revision/)
  assert.equal(f.call('set_candidate_next_action_plan','owner',plan({operation_id:'blocked',expected_revision:1,kind:'blocked',action:'',blocker_reason:'Awaiting candidate response'})),1)
  assert.equal(f.call('set_candidate_next_action_plan','owner',plan({operation_id:'deferred',expected_revision:2,kind:'deferred',action:'',review_at:Date.now()+86400000})),1)
  assert.throws(()=>f.db.exec("UPDATE hiring_next_action_plan_events SET kind='actionable'"),/immutable/)
 }finally{f.close()}
})

test('owner activates the next-action gate only after backfill; stage writes require a candidate plan',()=>{
 const f=fixture();try{
  const gate={organization_id:'org',brand_id:'brand'}
  assert.equal(f.call('enable_candidate_plan_gate','owner',gate),0)
  assert.equal(f.call('enable_candidate_plan_gate','outsider',gate),0)
  f.call('set_candidate_next_action_plan','owner',plan())
  assert.equal(f.call('enable_candidate_plan_gate','owner',gate),1)
  f.call('create_linkedin_application','owner',{...scope,application_id:'second',candidate_id:'candidate-2',candidate_name:'Second',email:'second@example.com',phone:'',linkedin_url:'https://www.linkedin.com/in/synthetic-second',source_detail:'Applicant',basis_reference:'Applicant initiated',contact_context:'Applicant supplied',assignee_user_id:'owner',operation_id:'candidate-2'})
  assert.throws(()=>f.call('change_application_stage','owner',{organization_id:'org',brand_id:'brand',application_id:'second',expected_version:1,from_stage:'submitted',to_stage:'in_review',reason:'Review',operation_id:'advance-2'}),/Candidate-linked next action required/)
  assert.equal(f.db.prepare("SELECT workflow_stage FROM hiring_applications WHERE id='second'").get().workflow_stage,null)
  f.call('set_candidate_next_action_plan','owner',plan({application_id:'second',operation_id:'plan-2'}))
  f.call('change_application_stage','owner',{organization_id:'org',brand_id:'brand',application_id:'second',expected_version:1,from_stage:'submitted',to_stage:'in_review',reason:'Review',operation_id:'advance-2'})
  assert.equal(f.db.prepare("SELECT COALESCE(workflow_stage,lifecycle_stage,accepted_stage,stage_extension,stage) AS effective_stage FROM hiring_applications WHERE id='second'").get().effective_stage,'in_review')
 }finally{f.close()}
})

test('terminal classification archives without deleting history and suppresses a current plan',()=>{
 for(const stage of ['rejected','withdrawn','onboarded']){
  const f=fixture();try{
   f.call('set_candidate_next_action_plan','owner',plan())
   f.db.prepare("INSERT INTO next_actions(id,organization_id,brand_id,candidate_id,org_id,action,due_at,owner,status,created_at,updated_at,operation_id) VALUES('followup','org','brand','candidate','org','Chase candidate',1,'bot','open',1,1,'followup-op')").run()
   // Seed a terminal transition without recreating the older offer/decision
   // workflow; the new classifier and freeze triggers remain installed.
   f.db.exec('DROP TRIGGER hiring_workflow_stage_guard')
   const auditBefore=f.db.prepare('SELECT COUNT(*) n FROM hiring_audit_events').get().n
   f.db.prepare('UPDATE hiring_applications SET workflow_stage=?,version=version+1 WHERE id=?').run(stage,'app')
   const terminal=f.call('get_terminal_archive','owner',scope)[0]
   assert.equal(terminal.terminal_stage,stage)
   assert.equal(terminal.archive_status,stage==='onboarded'?'onboarded_inactive':stage)
   assert.equal(f.call('get_candidate_next_action_plan','owner',scope)[0].kind,'closed')
   assert.equal(f.call('list_candidate_next_action_gaps','owner',{organization_id:'org',brand_id:'brand',limit:100}).length,0)
   assert.equal(f.call('list_next_actions','owner',{organization_id:'org',brand_id:'brand'}).length,0)
   assert.equal(f.call('list_next_actions','owner',{organization_id:'org',brand_id:'brand',status:'open'}).length,1)
   assert.throws(()=>f.db.exec("UPDATE hiring_applications SET workflow_stage='onboarding' WHERE id='app'"),/Terminal application/)
   assert.ok(f.db.prepare('SELECT COUNT(*) n FROM hiring_audit_events').get().n>auditBefore)
   assert.equal(f.db.prepare('SELECT COUNT(*) n FROM hiring_candidates').get().n,1)
  }finally{f.close()}
 }
})

test('terminal archive exposes the actual transition reason after the stage event commits',()=>{
 const f=fixture();try{
  const change=(from_stage,to_stage,expected_version,reason)=>f.call('change_application_stage','owner',{organization_id:'org',brand_id:'brand',application_id:'app',from_stage,to_stage,expected_version,reason,operation_id:'move-'+to_stage})
  change('submitted','in_review',1,'Screened')
  change('in_review','rejected',2,'Candidate declined the role')
  const archive=f.call('get_terminal_archive','owner',scope)[0]
  assert.equal(archive.terminal_stage,'rejected')
  assert.equal(archive.terminal_reason,'Candidate declined the role')
  assert.equal(f.db.prepare("SELECT COUNT(*) n FROM hiring_stage_events WHERE application_id='app' AND id IN ('move-in_review','move-rejected')").get().n,2)
 }finally{f.close()}
})

test('legacy active is classified as onboarded without inventing checklist evidence',()=>{
 const f=fixture({skipTerminal:true});try{
  f.db.exec('DROP TRIGGER hiring_workflow_stage_guard')
  f.db.exec("UPDATE hiring_applications SET workflow_stage='active' WHERE id='app'")
  f.db.exec(terminalMigration.sql)
  const archived=f.call('get_terminal_archive','owner',scope)[0]
  assert.equal(archived.terminal_stage,'onboarded')
  assert.equal(archived.archive_status,'onboarded_inactive')
  assert.equal(archived.source,'legacy_active')
  assert.equal(f.db.prepare("SELECT workflow_stage FROM hiring_applications WHERE id='app'").get().workflow_stage,'active')
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM hiring_onboarding_snapshots').get().n,0)
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM hiring_terminal_archive').get().n,1)
 }finally{f.close()}
})
