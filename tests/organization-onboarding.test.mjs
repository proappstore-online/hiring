import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { organizationOnboardingTools } from '../scripts/organization-onboarding.mjs'

const migrations=JSON.parse(readFileSync(new URL('../migrations.json',import.meta.url))).migrations
const tools=JSON.parse(readFileSync(new URL('../mcp.json',import.meta.url))).tools
const scope={organization_id:'org',brand_id:'brand',application_id:'app',requisition_id:'req'}
const steps=[{key:'slack',label:'Slack membership',kind:'membership',required:true},{key:'document',label:'Document reference',kind:'document',required:true},{key:'note',label:'Optional note',kind:'text',required:false}]

function fixture() {
  const db=new DatabaseSync(':memory:');db.exec('PRAGMA foreign_keys=ON')
  for(const m of migrations)db.exec(m.sql)
  function call(name,user='owner',values={}) {
    const t=tools.find(t=>t.name===name);assert.ok(t,name)
    const p={...Object.fromEntries(Object.entries(t.params??{}).filter(([,s])=>s.optional).map(([k])=>[k,null])),...values,__user_id:user,__now:Date.now(),__uuid:crypto.randomUUID()}
    db.exec('BEGIN')
    try {
      const result=(t.statements??[t.sql]).map(sql=>{const args=[];sql=sql.replace(/:([a-z_][a-z0-9_]*)/gi,(_,k)=>{assert.notEqual(p[k],undefined,`${name}: ${k}`);args.push(p[k]);return '?'});return t.operation==='query'?db.prepare(sql).all(...args):db.prepare(sql).run(...args).changes})
      db.exec('COMMIT');return t.operation==='query'?result[0]:result
    } catch(e) {db.exec('ROLLBACK');throw e}
  }
  call('create_workspace','owner',{...scope,organization_name:'Org',brand_name:'Brand',requisition_title:'Role',operation_id:'boot'})
  call('create_linkedin_application','owner',{...scope,candidate_id:'candidate',operation_id:'candidate',candidate_name:'Person',email:'person@example.com',phone:'',linkedin_url:'https://www.linkedin.com/in/synthetic-test',source_detail:'Applicant',basis_reference:'Applicant initiated',contact_context:'Applicant supplied',assignee_user_id:'owner'})
  call('save_offer_draft','owner',{tenant_id:'org',brand_id:'brand',application_id:'app',requisition_id:'req',terms_json:JSON.stringify({compensation_type:'unpaid',subject:'Offer',body:'Volunteer role'}),expected_version:0,operation_id:'offer-draft'})
  const offer=db.prepare('SELECT * FROM hiring_offers').get()
  for(const [name,version] of [['submit_offer_for_approval',1],['approve_offer',2]])call(name,'owner',{tenant_id:'org',brand_id:'brand',offer_id:offer.id,expected_version:version,operation_id:name})
  db.exec("UPDATE hiring_applications SET stage='offered'")
  call('record_acceptance','owner',{tenant_id:'org',brand_id:'brand',application_id:'app',expected_version:1,operation_id:'accept',acceptance_evidence:'Explicit candidate acceptance'})
  return {db,call}
}

function publish(f,patch={}) {return f.call('publish_onboarding_policy','owner',{organization_id:'org',brand_id:'brand',expected_version:0,steps_json:JSON.stringify(steps),invitation_mode:'none',operation_id:'policy',...patch})}
function transition(f,patch={}) {return f.call('record_lifecycle_transition','owner',{...scope,expected_version:2,from_stage:'accepted',to_stage:'onboarding',operation_id:'start',evidence:'Begin setup',...patch})}
function record(f,step_key,status,value_json,evidence,patch={}) {return f.call('record_onboarding_step','owner',{...scope,policy_version:1,step_key,expected_version:0,status,value_json,comment:'Reviewed',evidence,operation_id:`step-${step_key}`,...patch})}

test('registered onboarding tools and additive migration match source',()=>{
  for(const t of organizationOnboardingTools)assert.deepEqual(tools.find(x=>x.name===t.name),t)
  assert.equal(migrations.at(-1).name,'0073_organization_onboarding')
  assert.equal(migrations.at(-1).sql,readFileSync(new URL('../migrations/0073_organization_onboarding.sql',import.meta.url),'utf8'))
  assert.doesNotMatch(migrations.at(-1).sql,/\bDROP\s+(TRIGGER|TABLE|VIEW)\b/i)
})

test('owner policies are versioned, scoped, validated and immutable',()=>{
  const f=fixture();try {
    assert.deepEqual(f.call('get_onboarding_policy','outsider',{organization_id:'org',brand_id:'brand'}),[])
    assert.equal(f.call('publish_onboarding_policy','outsider',{organization_id:'org',brand_id:'brand',expected_version:0,steps_json:JSON.stringify(steps),invitation_mode:'none',operation_id:'bad'})[0],0)
    assert.throws(()=>publish(f,{steps_json:JSON.stringify([...steps,steps[0]])}),/Duplicate/)
    assert.throws(()=>publish(f,{steps_json:JSON.stringify([{key:'x',label:'X',kind:'bad',required:true}])}),/Invalid/)
    assert.equal(publish(f)[0],1)
    assert.equal(publish(f)[0],0)
    assert.equal(f.call('get_onboarding_policy_result','owner',{organization_id:'org',brand_id:'brand',expected_version:0,steps_json:JSON.stringify(steps),invitation_mode:'none',operation_id:'policy'})[0].version,1)
    assert.deepEqual(f.call('get_onboarding_policy_result','owner',{organization_id:'org',brand_id:'brand',expected_version:0,steps_json:'[]',invitation_mode:'none',operation_id:'policy'}),[])
    assert.throws(()=>publish(f,{operation_id:'policy2'}),/version conflict/)
    assert.throws(()=>f.db.exec("UPDATE hiring_onboarding_policies SET invitation_mode='freeappstore_interns'"),/immutable/)
  } finally {f.db.close()}
})

test('onboarded requires latest verified required steps from frozen policy',()=>{
  const f=fixture();try {
    publish(f);transition(f)
    assert.equal(f.db.prepare("SELECT interns_invite_status FROM hiring_applications WHERE id='app'").get().interns_invite_status,'not_started')
    assert.equal(f.db.prepare("SELECT count(*) n FROM hiring_notes WHERE body LIKE '%Interns invitation%'").get().n,0)
    const done={expected_version:3,from_stage:'onboarding',to_stage:'onboarded',operation_id:'done',evidence:'All requirements verified'}
    assert.throws(()=>transition(f,done),/checklist incomplete/)
    assert.equal(f.call('assign_onboarding_policy','owner',{...scope})[0],1)
    assert.equal(f.call('assign_onboarding_policy','owner',{...scope})[0],0)
    assert.equal(f.call('list_onboarding_checklist','owner',{...scope}).length,3)
    assert.throws(()=>transition(f,done),/checklist incomplete/)
    assert.throws(()=>record(f,'slack','completed',JSON.stringify({identity:'person',joined:false}),'Membership check'),/Invalid onboarding field value/)
    record(f,'slack','completed',JSON.stringify({identity:'person',joined:true}),'Verified Slack profile')
    assert.throws(()=>record(f,'document','completed',JSON.stringify('doc-1'),'Document checked',{expected_version:1,operation_id:'stale'}),/version conflict/)
    record(f,'document','completed',JSON.stringify('doc-1'),'Document checked')
    assert.deepEqual(f.call('list_onboarding_checklist','outsider',{...scope}),[])
    assert.throws(()=>transition(f,{...done,brand_id:'other'}),/scope|checklist/)
    assert.equal(transition(f,done)[0],1)
    assert.equal(f.call('get_application','owner',scope)[0].stage,'onboarded')
    assert.equal(f.call('get_lifecycle_result','owner',{...scope,...done}).length,1)
    assert.equal(f.db.prepare("SELECT registration_evidence FROM hiring_lifecycle_events_v2 WHERE operation_id='done'").get().registration_evidence,'checklist:1')
    assert.equal(f.db.prepare('SELECT count(*) n FROM hiring_onboarding_step_events').get().n,2)
  } finally {f.db.close()}
})

test('step evidence is append-only, exact-retry safe and gated by scope',()=>{
  const f=fixture();try {
    publish(f);transition(f);f.call('assign_onboarding_policy','owner',{...scope})
    assert.equal(record(f,'slack','in_progress','null','Waiting')[0],1)
    assert.equal(record(f,'slack','in_progress','null','Waiting')[0],0)
    assert.deepEqual(f.call('get_onboarding_step_result','owner',{...scope,policy_version:1,step_key:'slack',expected_version:0,status:'in_progress',value_json:'null',comment:'Reviewed',evidence:'Waiting',operation_id:'step-slack'}).length,1)
    assert.throws(()=>record(f,'slack','completed',JSON.stringify({identity:'person',joined:true}),'Verified',{expected_version:0,operation_id:'stale'}),/version conflict/)
    assert.equal(record(f,'slack','completed',JSON.stringify({identity:'person',joined:true}),'Verified',{expected_version:1,operation_id:'complete-slack'})[0],1)
    assert.equal(record(f,'document','completed',JSON.stringify('doc'),'Checked',{brand_id:'other'})[0],0)
    assert.throws(()=>f.db.exec("DELETE FROM hiring_onboarding_step_events"),/immutable/)
    assert.equal(f.db.prepare("SELECT count(*) n FROM hiring_audit_events WHERE action='onboarding.step_recorded'").get().n,2)
  } finally {f.db.close()}
})
