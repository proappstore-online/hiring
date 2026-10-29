import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'

const migrations = JSON.parse(readFileSync(new URL('../migrations.json', import.meta.url)))
const tools = JSON.parse(readFileSync(new URL('../mcp.json', import.meta.url))).tools
const action = name => { const found = tools.find(t => t.name === name); assert.ok(found, name); return found }
function fixture() {
  const db = new DatabaseSync(':memory:')
  db.exec('PRAGMA foreign_keys=ON')
  for (const migration of migrations.migrations) db.exec(migration.sql)
  const call = (name, user, values = {}) => {
    const tool = action(name)
    const optional = Object.fromEntries(Object.entries(tool.params ?? {}).filter(([, schema]) => schema.optional).map(([key]) => [key, null]))
    const params = { ...optional, ...values, __user_id: user, __now: Date.now(), __uuid: crypto.randomUUID() }
    const statements = tool.statements ?? [tool.sql]
    const result = []
    db.exec('BEGIN')
    try {
      for (const statement of statements) {
        // PAS rewrites each named occurrence to a positional placeholder and binds
        // the corresponding value, including repeated names, in occurrence order.
        const binds = []
        const sql = statement.replace(/:([a-z_][a-z0-9_]*)/gi, (_, key) => { binds.push(params[key]); return '?' })
        assert.ok(binds.every(v => v !== undefined), `${name}: missing param`)
        result.push(tool.operation === 'query' ? db.prepare(sql).all(...binds) : db.prepare(sql).run(...binds).changes)
      }
      db.exec('COMMIT')
      return tool.operation === 'query' ? result[0] : result
    } catch (e) { db.exec('ROLLBACK'); throw e }
  }
  return { db, call }
}


import { buildMutationTools, MUTATIONS_V1 } from '../scripts/mutation-tools.mjs'
import { mutationResult } from '../scripts/gateway-contract.mjs'
const scope = { organization_id:'org', brand_id:'brand', application_id:'app' }
function ready(name) {
  const f=fixture()
  f.call('create_workspace','owner',{...scope,requisition_id:'req',organization_name:'Org',brand_name:'Brand',requisition_title:'Role',operation_id:'boot'})
  f.call('create_linkedin_application','owner',{...scope,requisition_id:'req',candidate_id:'person',candidate_name:'Person',email:'person@example.com',phone:'',linkedin_url:'',source_detail:'Source',basis_reference:'Basis',contact_context:'Context',assignee_user_id:'owner',operation_id:'person'})
  let user='owner'
  let args={...scope,expected_version:1,operation_id:'mutation'}
  if(name==='hiring_v1_create_requisition') args={...args,requisition_id:'new-req',title:'New role',expected_version:0}
  if(name==='hiring_v1_update_requisition') args={...args,requisition_id:'req',expected_version:0,overview:'Overview',rolePurpose:'Purpose',responsibilities:'["Build"]',requirements:'["Skills"]',workingArrangement:'Remote',compensation:'Paid',benefits:'Leave',applicationProcess:'Apply',privacyContact:'Contact'}
  if(name==='hiring_v1_advance_application') args={...args,from_stage:'submitted',to_stage:'in_review',reason:'Reviewed'}
  if(name==='hiring_v1_record_decision') {
    f.db.exec("UPDATE hiring_applications SET stage='in_review' WHERE id='app'")
    args={...args,requisition_id:'req',disposition:'deferred',rationale:'Human review'}
  }
  if(name==='hiring_v1_record_lifecycle_transition') {
    const o={tenant_id:'org',brand_id:'brand',application_id:'app'}
    f.call('save_offer_draft','owner',{...o,requisition_id:'req',terms_json:JSON.stringify({compensation_type:'paid',subject:'Offer',body:'Terms'}),expected_version:0,operation_id:'offer-draft'})
    const offerArgs=()=>({...o,offer_id:f.call('get_offer','owner',o)[0].id,expected_version:f.call('get_offer','owner',o)[0].lock_version,operation_id:'offer-step-'+f.call('get_offer','owner',o)[0].lock_version})
    f.call('submit_offer_for_approval','owner',offerArgs())
    f.call('approve_offer','owner',offerArgs())
    f.db.exec("UPDATE hiring_applications SET stage='offered' WHERE id='app'")
    const appVersion=()=>f.call('get_application','owner',{organization_id:'org',brand_id:'brand',application_id:'app'})[0].version
    f.call('record_acceptance','owner',{...o,expected_version:appVersion(),operation_id:'accept',acceptance_evidence:'Candidate explicitly accepted paid terms by signed response'})
    args={...args,requisition_id:'req',expected_version:appVersion(),from_stage:'accepted',to_stage:'onboarding',evidence:'Setup handoff started',registration_evidence:'',requirements_evidence:'',handoff_evidence:''}
  }
  if(name==='hiring_v1_submit_scorecard') {
    f.call('grant_workspace_access','owner',{...scope,grant_id:'reviewer',member_user_id:'reviewer',role:'reviewer',requisition_id:'req',operation_id:'grant'})
    f.call('create_interview','owner',{tenant_id:'org',brand_id:'brand',application_id:'app',interview_id:'interview',assignment_id:'assignment',reviewer_id:'reviewer',format:'video',operation_id:'interview'})
    user='reviewer'
    args={...args,interview_id:'interview',assignment_id:'assignment',expected_version:0,status:'submitted',criteria_json:JSON.stringify([{criterion:'Skill',rating:4,evidence:'Observed concrete example'}])}
  }
  if(name==='hiring_v1_draft_message' || name==='hiring_v1_send_approved_message') {
    f.call('save_communication_template','owner',{...scope,template_id:'template',name:'Update',subject:'Update',body:'Approved text',expected_version:0,operation_id:'template'})
    f.call('approve_communication_template','owner',{...scope,template_id:'template',expected_version:1,operation_id:'approval'})
    const draft={...scope,draft_id:'draft',recipient_email:'person@example.com',subject:'Update',body:'Approved text',template_id:'template',template_version:1,operation_id:'draft'}
    if(name==='hiring_v1_draft_message') args={...draft,expected_version:1,operation_id:'mutation'}
    else { f.call('create_communication_draft','owner',draft); args={...args,draft_id:'draft'} }
  }
  return {...f,user,args}
}
const denied = counts => assert.ok(counts.every(n=>n===0),JSON.stringify(counts))
const deniedWrite = (call, name, user, args) => {
  try { denied(call(name, user, args)) }
  catch (error) {
    if (!['hiring_v1_advance_application', 'hiring_v1_record_decision', 'hiring_v1_record_lifecycle_transition'].includes(name)) throw error
    assert.match(error.message, /application|actor|operation|version|transition|required/)
  }
}

test('v1 registry is generated from current controls, has no caller identity claims and uses real platform gates',()=>{
  assert.deepEqual(tools.filter(t=>Object.hasOwn(MUTATIONS_V1,t.name)),buildMutationTools(tools))
  for(const name of Object.keys(MUTATIONS_V1)) {
    const tool=action(name)
    assert.equal(tool.requires_auth,true)
    for(const key of Object.keys(tool.params)) assert.doesNotMatch(key,/^(actor|user|role|human|confirm|tenant)(_|$)/)
    for(const sql of tool.statements) {
      const used=[...new Set([...sql.matchAll(/:([a-z_][a-z0-9_]*)/gi)].map(m=>m[1]).filter(k=>!k.startsWith('__')))]
      for(const key of used) assert.ok(Object.hasOwn(tool.params,key),`${name}: ${key}`)
    }
  }
  assert.equal(action('hiring_v1_record_decision').step_up, undefined, 'an authorised hiring manager confirms the action in the app; server role checks and audit remain authoritative')
  assert.equal(action('hiring_v1_send_approved_message').step_up, undefined, 'an authorised recruiter confirms the reviewed message in the app; recipient, template and audit controls remain enforced')
  assert.equal(action('hiring_v1_advance_application').step_up, true)
})

for(const name of Object.keys(MUTATIONS_V1)) {
  test(`${name}: stale versions, duplicate operations, scope, actor, atomic audit`,()=>{
    const {db,call,user,args}=ready(name)
    try {
      deniedWrite(call,name,'outsider',{...args,user_id:user,role:'owner',human_confirmed:true})
      deniedWrite(call,name,user,{...args,brand_id:'other'})
      deniedWrite(call,name,user,{...args,organization_id:'other'})
      deniedWrite(call,name,user,{...args,expected_version:99})
      deniedWrite(call,name,user,{...args,expected_version:0.5})
      deniedWrite(call,name,user,{...args,operation_id:'boot'})
      deniedWrite(call,name,user,{...args,operation_id:' '.repeat(2)})
      // Even an accidentally granted service principal cannot use agent mutations.
      db.exec("INSERT INTO hiring_memberships(id,organization_id,brand_id,user_id,role,created_at) VALUES('system-grant','org','brand','system:worker','owner',1)")
      deniedWrite(call,name,'system:worker',args)
      const before=db.prepare('SELECT count(*) AS n FROM hiring_audit_events').get().n
      db.exec("CREATE TEMP TRIGGER fail_audit BEFORE INSERT ON hiring_audit_events WHEN NEW.operation_id='mutation' BEGIN SELECT RAISE(ABORT,'audit unavailable'); END")
      assert.throws(()=>call(name,user,args),/audit unavailable/)
      db.exec('DROP TRIGGER fail_audit')
      assert.equal(db.prepare('SELECT count(*) AS n FROM hiring_audit_events').get().n,before)
      const result=call(name,user,args)
      assert.equal(mutationResult(result).ok,true)
      assert.equal(db.prepare('SELECT count(*) AS n FROM hiring_audit_events').get().n,before+1)
      denied(call(name,user,args))
      assert.throws(()=>mutationResult(call(name,user,args)),e=>e.code==='CONFLICT')
      const audit=db.prepare("SELECT actor_user_id FROM hiring_audit_events WHERE operation_id='mutation'").get()
      assert.equal(audit.actor_user_id,user)
    } finally {db.close()}
  })
}

test('v1 stage cannot bypass final decision workflow; scorecard is submit-only',()=>{
  const f=ready('hiring_v1_advance_application')
  try {
    f.db.exec("UPDATE hiring_applications SET stage='in_review' WHERE id='app'")
    denied(f.call('hiring_v1_advance_application',f.user,{...f.args,from_stage:'in_review',to_stage:'rejected'}))
    assert.equal(f.db.prepare('SELECT count(*) AS n FROM hiring_decisions').get().n,0)
  } finally {f.db.close()}
  const s=ready('hiring_v1_submit_scorecard')
  try {denied(s.call('hiring_v1_submit_scorecard',s.user,{...s.args,status:'draft'}))} finally {s.db.close()}
})

test('v1 withdraws an accepted, onboarding or onboarded application; decision and stage-change tools stay refused (#1400)',()=>{
  for(const fromStage of ['accepted','onboarding','onboarded']){
    const f=ready('hiring_v1_record_lifecycle_transition')
    try {
      const application=()=>f.call('get_application','owner',{organization_id:'org',brand_id:'brand',application_id:'app'})[0]
      if(fromStage!=='accepted') f.call('hiring_v1_record_lifecycle_transition',f.user,{...f.args,operation_id:'to-onboarding-'+fromStage,expected_version:application().version,to_stage:'onboarding'})
      if(fromStage==='onboarded') f.call('hiring_v1_record_lifecycle_transition',f.user,{...f.args,operation_id:'to-onboarded-'+fromStage,expected_version:application().version,from_stage:'onboarding',to_stage:'onboarded',evidence:'Onboarding complete',registration_evidence:'Registration #1',requirements_evidence:'Acknowledged v2',handoff_evidence:'Discord joined'})
      assert.equal(application().stage,fromStage)
      // The two tools Thanh Van's withdrawal was tried through (#1400) are correctly refused once the
      // application has entered the lifecycle workflow (hiring_workflow_decision_guard, migration 0051).
      deniedWrite(f.call,'hiring_v1_record_decision',f.user,{organization_id:'org',brand_id:'brand',requisition_id:'req',application_id:'app',expected_version:application().version,operation_id:'bad-decision-'+fromStage,disposition:'withdrawn',rationale:'Candidate withdrew'})
      deniedWrite(f.call,'hiring_v1_advance_application',f.user,{organization_id:'org',brand_id:'brand',application_id:'app',expected_version:application().version,from_stage:fromStage,to_stage:'withdrawn',reason:'Candidate withdrew',operation_id:'bad-advance-'+fromStage})
      const result=f.call('hiring_v1_record_lifecycle_transition',f.user,{...f.args,operation_id:'withdraw-'+fromStage,expected_version:application().version,from_stage:fromStage,to_stage:'withdrawn',evidence:'Candidate withdrew'})
      assert.equal(mutationResult(result).ok,true)
      assert.equal(application().stage,'withdrawn')
    } finally {f.db.close()}
  }
})

test('v1 send denies edited templates and changed recipients, and never claims provider delivery',()=>{
  for(const change of ['template','recipient']) {
    const f=ready('hiring_v1_send_approved_message')
    try {
      if(change==='template') f.call('save_communication_template',f.user,{...scope,template_id:'template',name:'Update',subject:'Update',body:'Changed',expected_version:1,operation_id:'edit'})
      else f.db.exec("UPDATE hiring_candidates SET email='changed@example.com' WHERE id='person'")
      denied(f.call('hiring_v1_send_approved_message',f.user,f.args))
      assert.equal(f.db.prepare("SELECT delivery_state FROM hiring_outbox WHERE id='draft'").get().delivery_state,'draft')
    } finally {f.db.close()}
  }
})
