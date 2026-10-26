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
const scope = { organization_id: 'org-a', brand_id: 'brand-a' }
const bootstrap = { ...scope, requisition_id: 'req-a', organization_name: 'Org A', brand_name: 'Brand A', requisition_title: 'Engineer', operation_id: 'bootstrap-a' }
const candidate = { ...scope, requisition_id: 'req-a', candidate_id: 'cand-a', application_id: 'app-a', operation_id: 'create-a', candidate_name: 'A Person', email: 'a@example.com', phone: '', linkedin_url: 'https://www.linkedin.com/in/a-person', source_detail: 'LinkedIn search on 2026-10-20', basis_reference: 'recruitment legitimate interests assessment v1', contact_context: 'Public profile; email supplied directly', assignee_user_id: 'staff-a' }

const url='https://interns.proappstore.online/onboarding'
const config={...scope,requisition_id:'req-a',onboarding_url:url,template_id:'intern-template',template_version:1}
function setup(){
 const f=fixture();f.call('create_workspace','staff-a',bootstrap)
 f.db.prepare('INSERT INTO hiring_communication_templates(id,organization_id,brand_id,name,subject,body,version,updated_at,operation_id) VALUES(?,?,?,?,?,?,1,1,?)').run('intern-template','org-a','brand-a','Interns','Your Interns invitation','Start your Interns onboarding: '+url,'template-op')
 f.db.prepare('INSERT INTO hiring_template_approvals VALUES(?,1,?,?,?,?,?,1,?)').run('intern-template','org-a','brand-a','Your Interns invitation','Start your Interns onboarding: '+url,'staff-a','approval-op')
 return f
}
function configured(){const f=setup(); assert.deepEqual(f.call('configure_internship_requisition','staff-a',config),[1]);return f}
const intake={...candidate,source:'recruiter_sourced',profile_url:''}
const progress={...scope,requisition_id:'req-a',application_id:'app-a',expected_version:0,status:'sourced',reason_code:'source_verified',evidence:'Source and lawful basis verified',discord_status:'invite_pending',discord_username:'',operation_id:'progress-1'}
test('internship configuration requires owner, exact direct Interns origin and approved matching template',()=>{
 const f=setup();try{
  for(const patch of [{onboarding_url:'https://evil.test/'},{onboarding_url:'https://interns.proappstore.online.evil.test/'},{onboarding_url:url+'?other'},{template_version:2},{brand_id:'brand-b'}])assert.deepEqual(f.call('configure_internship_requisition','staff-a',{...config,...patch}),[0])
  assert.deepEqual(f.call('configure_internship_requisition','outsider',config),[0])
  assert.deepEqual(f.call('configure_internship_requisition','staff-a',config),[1])
  assert.deepEqual(f.call('get_internship_policy','outsider',config),[])
  assert.equal(f.db.prepare('SELECT count(*) n FROM hiring_outbox').get().n,0)
 }finally{f.db.close()}
})
test('owner can relink to a newer approved version with immutable attribution and clear rejection',()=>{
 const f=configured();try{
  const args={...scope,requisition_id:'req-a',template_version:2}
  assert.deepEqual(f.call('configure_internship_requisition','staff-a',{...config,template_version:2}),[0])
  assert.deepEqual(f.call('relink_internship_requisition','staff-a',args),[0])
  f.db.prepare('INSERT INTO hiring_template_approvals VALUES(?,2,?,?,?,?,?,2,?)').run('intern-template','org-a','brand-a','Your Interns invitation','Unrelated body','staff-a','approval-2')
  assert.deepEqual(f.call('relink_internship_requisition','staff-a',args),[0])
  f.db.prepare('INSERT INTO hiring_template_approvals VALUES(?,3,?,?,?,?,?,3,?)').run('intern-template','org-a','brand-a','Your Interns invitation','Start your Interns onboarding: '+url,'staff-a','approval-3')
  const next={...args,template_version:3}
  assert.deepEqual(f.call('relink_internship_requisition','outsider',next),[0])
  assert.deepEqual(f.call('relink_internship_requisition','staff-a',{...next,brand_id:'other'}),[0])
  assert.deepEqual(f.call('relink_internship_requisition','staff-a',next),[1])
  assert.equal(f.call('get_internship_policy','staff-a',next)[0].template_version,3)
  const history=f.call('list_internship_template_relinks','staff-a',next)
  assert.equal(history.length,1)
  assert.deepEqual([history[0].old_version,history[0].new_version,history[0].changed_by],[1,3,'staff-a'])
  assert.ok(history[0].changed_at>0)
  const audit=f.db.prepare("SELECT action,actor_user_id,redacted_summary FROM hiring_audit_events WHERE action='internship.template_relinked'").get()
  assert.deepEqual([audit.action,audit.actor_user_id,audit.redacted_summary],['internship.template_relinked','staff-a','Template version 1 → 3'])
  assert.deepEqual(f.call('relink_internship_requisition','staff-a',next),[0])
  assert.deepEqual(f.call('relink_internship_requisition','staff-a',{...args,template_version:1}),[0])
  assert.throws(()=>f.db.exec('UPDATE hiring_internship_template_relinks SET old_version=2'),/immutable/)
  assert.throws(()=>f.db.exec('DELETE FROM hiring_internship_template_relinks'),/immutable/)
 }finally{f.db.close()}
})
test('generic sources and forged campaigns cannot create internship candidates; recruiter intake retains provenance',()=>{
 const f=configured();try{
  for(const source of ['manual','direct','linkedin','email','referral','linkedin_campaign'])assert.ok(f.call('create_application','staff-a',{...intake,source}).every(n=>n===0))
  assert.equal(f.db.prepare('SELECT count(*) n FROM hiring_candidates').get().n,0)
  assert.ok(f.call('create_application','outsider',intake).every(n=>n===0))
  assert.ok(f.call('create_application','staff-a',{...intake,email:''}).every(n=>n===0))
  assert.equal(f.call('create_application','staff-a',intake).at(-1),1)
  const a=f.call('get_application','staff-a',{...scope,application_id:'app-a'})[0]
  assert.equal(a.is_internship,1);assert.equal(a.source,'recruiter_sourced');assert.equal(a.basis_reference,intake.basis_reference);assert.equal(a.contact_context,intake.contact_context)
 }finally{f.db.close()}
})
test('LinkedIn ad intake validates exact configured campaign, scope and revocation server-side',()=>{
 const f=configured();try{
  const c={...scope,requisition_id:'req-a',campaign_id:'campaign-73',source_url:'https://www.linkedin.com/campaignmanager/accounts/1/campaigns/73',evidence:'Owner approved LinkedIn lead ad, notice v1',enabled:1}
  assert.deepEqual(f.call('configure_internship_campaign','outsider',c),[0])
  assert.deepEqual(f.call('configure_internship_campaign','staff-a',{...c,source_url:'https://evil.test'}),[0])
  assert.deepEqual(f.call('configure_internship_campaign','staff-a',c),[1])
  for(const patch of [{campaign_id:'unknown'},{brand_id:'other'},{organization_id:'other'}])assert.ok(f.call('create_application','staff-a',{...intake,source:'linkedin_campaign',campaign_id:c.campaign_id,...patch}).every(n=>n===0))
  f.call('configure_internship_campaign','staff-a',{...c,enabled:0})
  assert.ok(f.call('create_application','staff-a',{...intake,source:'linkedin_campaign',campaign_id:c.campaign_id}).every(n=>n===0))
  f.call('configure_internship_campaign','staff-a',c)
  assert.equal(f.call('create_application','staff-a',{...intake,source:'linkedin_campaign',campaign_id:c.campaign_id}).at(-1),1)
  assert.match(f.db.prepare('SELECT source_detail FROM hiring_applications').get().source_detail,/campaign:campaign-73/)
 }finally{f.db.close()}
})
test('new internship interviews and interview transitions are rejected while historical interview records stay readable',()=>{
 const f=setup();try{
  f.call('create_linkedin_application','staff-a',candidate)
  const args={tenant_id:'org-a',brand_id:'brand-a',application_id:'app-a',interview_id:'old-interview',operation_id:'old-interview',reviewer_id:'staff-a',assignment_id:'old-assignment',format:'video'}
  f.call('create_interview','staff-a',args)
  f.call('configure_internship_requisition','staff-a',config)
  assert.equal(f.call('list_application_interviews','staff-a',args).length,1)
  assert.throws(()=>f.call('create_interview','staff-a',{...args,interview_id:'new-interview',operation_id:'new-interview',assignment_id:'new-assignment'}),/direct Interns onboarding/)
  f.db.exec("UPDATE hiring_applications SET stage='in_review' WHERE id='app-a'")
  assert.throws(()=>f.call('change_application_stage','staff-a',{...scope,application_id:'app-a',expected_version:1,from_stage:'in_review',to_stage:'interviewing',reason:'New interview',operation_id:'bad-stage'}),/direct Interns onboarding/)
  assert.equal(f.call('list_application_interviews','staff-a',args)[0].id,'old-interview')
 }finally{f.db.close()}
})
test('onboarding evidence is ordered, attributed, versioned, private and requires a confirmed direct invitation',()=>{
 const f=configured();try{
  f.call('create_application','staff-a',intake)
  assert.deepEqual(f.call('record_internship_progress','outsider',progress),[0])
  assert.deepEqual(f.call('record_internship_progress','staff-a',{...progress,brand_id:'other'}),[0])
  assert.throws(()=>f.call('record_internship_progress','staff-a',{...progress,status:'active',reason_code:'interns_onboarding_verified'}),/ordering/)
  assert.deepEqual(f.call('record_internship_progress','staff-a',progress),[1])
  assert.deepEqual(f.call('record_internship_progress','staff-a',{...progress,operation_id:'stale'}),[0])
  const invited={...progress,expected_version:1,status:'invited',reason_code:'direct_invitation_sent',operation_id:'invited'}
  assert.throws(()=>f.call('record_internship_progress','staff-a',invited),/sent direct invitation/)
  assert.deepEqual(f.call('list_internship_progress','outsider',progress),[])
  assert.equal(f.call('list_internship_progress','staff-a',progress)[0].actor_user_id,'staff-a')
  assert.throws(()=>f.db.exec("UPDATE hiring_internship_progress SET evidence='rewrite'"),/immutable/)
  assert.throws(()=>f.db.exec('DELETE FROM hiring_internship_progress'),/immutable/)
  assert.equal(f.db.prepare("SELECT count(*) n FROM hiring_audit_events WHERE action='internship.sourced'").get().n,1)
 }finally{f.db.close()}
})
test('all anonymous discovery and detail actions exclude restricted internships',()=>{
 for(const name of ['list_public_jobs','get_public_job','list_vacancies','get_vacancy_detail'])assert.match(action(name).sql,/NOT EXISTS \(SELECT 1 FROM hiring_restricted_internships ri WHERE ri.requisition_id=j.requisition_id\)/)
 const submit=action('submit_job_application');assert.match(submit.statements[0],/NOT EXISTS \(SELECT 1 FROM hiring_restricted_internships WHERE requisition_id=:requisition_id\)/)
})

test('published internships are absent from every public route and generic signed-in intake writes nothing',async()=>{
 const {fixture:publicFixture,A,application,publication}=await import('./receipt-fixture.mjs')
 const f=publicFixture();try{
  f.call('publish_job_requisition','owner',{...publication(),compensation_type:'internship'})
  for(const name of ['list_public_jobs','list_vacancies'])assert.deepEqual(f.call(name,null,{after_id:''}),[])
  for(const name of ['get_public_job','get_vacancy_detail'])assert.deepEqual(f.call(name,null,A),[])
  assert.ok(f.call('submit_job_application','worker',application()).every(n=>n===0))
  assert.equal(f.db.prepare('SELECT count(*) n FROM hiring_candidates').get().n,0)
  assert.equal(f.db.prepare('SELECT count(*) n FROM hiring_applications').get().n,0)
 }finally{f.db.close()}
})

test('approved direct email followed by Interns evidence reaches active without interviews',async()=>{
 const {dispatchCommunication}=await import('../scripts/outbox.mjs')
 const f=configured();try{
  f.call('create_application','staff-a',intake)
  f.call('record_internship_progress','staff-a',progress)
  const mail={...scope,application_id:'app-a',draft_id:'intern-invite',recipient_email:intake.email,subject:'Your Interns invitation',body:'Start your Interns onboarding: '+url,operation_id:'intern-invite',template_id:'intern-template',template_version:1}
  assert.equal(f.call('create_communication_draft','staff-a',mail).at(-1),1)
  assert.equal(f.call('queue_communication','staff-a',{...mail,operation_id:'queue-invite'}).at(-1),1)
  const outcome=await dispatchCommunication({scope:{...scope,application_id:'app-a'},draftId:mail.draft_id,actions:async(name,p)=>{const r=f.call(name,'staff-a',p);return action(name).operation==='query'?{rows:r}:{results:r.map(changes=>({meta:{changes}}))}},send:async(row)=>{assert.equal(row.body,mail.body);assert.equal(row.recipient_email,intake.email);return {outcome:'accepted'}}})
  assert.equal(outcome,'sent')
  for(const [i,status] of ['invited','onboarding_pending','active'].entries()) {
   const evidence=status==='invited'?'Provider accepted intern-invite':status==='onboarding_pending'?'Interns application 73 submitted':'Interns onboarding 73 verified'
   assert.deepEqual(f.call('record_internship_progress','staff-a',{...progress,status,reason_code:{invited:'direct_invitation_sent',onboarding_pending:'interns_application_recorded',active:'interns_onboarding_verified'}[status],expected_version:i+1,operation_id:status,evidence,discord_status:'username_pending'}),[1])
  }
  assert.equal(f.call('list_internship_progress','staff-a',progress)[0].status,'active')
  assert.equal(f.db.prepare('SELECT count(*) n FROM interviews').get().n,0)
 }finally{f.db.close()}
})
