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
        if (tool.operation !== 'query' && /^SELECT /i.test(sql)) { db.prepare(sql).all(...binds); continue }
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

const transitions = JSON.parse(readFileSync(new URL('../web/src/application-stages.json', import.meta.url)))
function seeded() {
  const f = fixture()
  f.call('create_workspace', 'staff-a', bootstrap)
  f.call('create_linkedin_application', 'staff-a', candidate)
  const offerScope={tenant_id:'org-a',brand_id:'brand-a',application_id:'app-a',requisition_id:'req-a'}
  f.call('save_offer_draft','staff-a',{...offerScope,terms_json:JSON.stringify({compensation_type:'paid',subject:'Offer',body:'Paid terms'}),expected_version:0,operation_id:'offer-fixture'})
  const offer=f.call('get_offer','staff-a',offerScope)[0]
  f.call('submit_offer_for_approval','staff-a',{...offerScope,offer_id:offer.id,expected_version:1,operation_id:'submit-fixture'})
  f.call('approve_offer','staff-a',{...offerScope,offer_id:offer.id,expected_version:2,operation_id:'approve-fixture'})
  return f
}
function setStage(db, stage) {
  db.prepare('UPDATE hiring_applications SET stage=?,stage_extension=?,version=1 WHERE id=?').run(stage === 'shortlisted' ? 'in_review' : stage, stage === 'shortlisted' ? stage : null, 'app-a')
}
const change = (from_stage, to_stage, extra = {}) => ({...scope, application_id:'app-a', expected_version:1, from_stage, to_stage, reason:'Human decision', operation_id:'transition', ...extra})

test('every allowed edge succeeds with canonical stage, one version, attributed history and audit', () => {
  for (const [from, targets] of Object.entries(transitions)) for (const to of targets) {
    const {db,call}=seeded()
    try {
      setStage(db,from)
      assert.equal(call('change_application_stage','staff-a',change(from,to)).at(-1),1,from+' -> '+to)
      const row=call('get_application','staff-a',{...scope,application_id:'app-a'})[0]
      assert.equal(row.stage,to);assert.equal(row.version,2)
      assert.equal(call('list_applications','staff-a',{...scope,stage:to})[0].stage,to)
      assert.equal(call('gateway_get_application','staff-a',{...scope,application_id:'app-a'})[0].stage,to)
      const event=db.prepare("SELECT * FROM hiring_stage_events WHERE id='transition'").get()
      if (['hired','rejected'].includes(to)) assert.equal(db.prepare("SELECT disposition FROM hiring_decisions WHERE operation_id='transition'").get().disposition,to)
      assert.equal(event.from_stage,from);assert.equal(event.to_stage,to);assert.equal(event.version,2);assert.equal(event.actor_user_id,'staff-a')
      assert.equal(db.prepare("SELECT count(*) n FROM hiring_audit_events WHERE operation_id='transition' AND action='application.stage_changed'").get().n,1)
      assert.ok(call('change_application_stage','staff-a',change(from,to)).every(n=>n===0))
    } finally {db.close()}
  }
})
test('every invalid edge including terminal, backwards, skipped and unknown stages writes nothing', () => {
  const {db,call}=seeded()
  try {
    for(const from of Object.keys(transitions)) for(const to of [...Object.keys(transitions),'forged']) {
      if(transitions[from].includes(to))continue
      setStage(db,from)
      const before=db.prepare('SELECT count(*) n FROM hiring_audit_events').get().n
      assert.ok(call('change_application_stage','staff-a',change(from,to)).every(n=>n===0),from+' -> '+to)
      assert.equal(call('get_application','staff-a',{...scope,application_id:'app-a'})[0].version,1)
      assert.equal(db.prepare('SELECT count(*) n FROM hiring_audit_events').get().n,before)
    }
  } finally {db.close()}
})
test('stale version, forged prior state, blank reason/operation and unauthorized actor are denied', () => {
 const {db,call}=seeded()
 try {
  for(const patch of [{expected_version:0},{expected_version:2},{from_stage:'offered'},{reason:' '},{operation_id:' '},{application_id:'forged'},{brand_id:'brand-b'},{organization_id:'org-b'}])
   assert.ok(call('change_application_stage','staff-a',change('submitted','in_review',patch)).every(n=>n===0))
  assert.ok(call('change_application_stage','outsider',change('submitted','in_review')).every(n=>n===0))
  assert.equal(call('get_application','staff-a',{...scope,application_id:'app-a'})[0].version,1)
 } finally {db.close()}
})
test('stage evidence rejects update and delete; audit failure rolls back transition',()=>{
 const {db,call}=seeded()
 try {
  assert.throws(()=>db.exec("DELETE FROM hiring_stage_events WHERE application_id='app-a'"),/append-only/)
  assert.throws(()=>db.exec("UPDATE hiring_stage_events SET reason='rewritten' WHERE application_id='app-a'"),/append-only/)
  db.exec("CREATE TRIGGER fail_stage_audit BEFORE INSERT ON hiring_audit_events WHEN NEW.action='application.stage_changed' BEGIN SELECT RAISE(ABORT,'audit unavailable'); END")
  assert.throws(()=>call('change_application_stage','staff-a',change('submitted','in_review')),/audit unavailable/)
  assert.equal(call('get_application','staff-a',{...scope,application_id:'app-a'})[0].version,1)
  assert.equal(db.prepare("SELECT count(*) n FROM hiring_stage_events WHERE id='transition'").get().n,0)
 } finally {db.close()}
})
test('direct full detail works outside the queue and denies sibling brands, tenants and restricted roles',()=>{
 const {db,call}=seeded()
 try {
  const insert=db.prepare("INSERT INTO hiring_applications(id,organization_id,brand_id,requisition_id,candidate_id,source,source_detail,basis_reference,contact_context,assignee_user_id,stage,version,created_by,created_at,updated_at) SELECT ?,organization_id,brand_id,requisition_id,candidate_id,source,source_detail,basis_reference,contact_context,assignee_user_id,stage,version,created_by,created_at,updated_at+1 FROM hiring_applications WHERE id='app-a'")
  for(let i=0;i<105;i++)insert.run('recent-'+i)
  const queue=call('list_applications','staff-a',scope)
  assert.equal(queue.length,100);assert.ok(!queue.some(a=>a.id==='app-a'))
  const row=call('get_application','staff-a',{...scope,application_id:'app-a'})[0]
  assert.equal(row.email,'a@example.com');assert.equal(row.contact_context,candidate.contact_context);assert.equal(row.candidate_name,'A Person')
  const B={organization_id:'org-a',brand_id:'brand-b'}
  call('create_workspace','staff-a',{...bootstrap,...B,requisition_id:'req-b',operation_id:'boot-b'})
  call('add_workspace_member','staff-a',{...B,member_user_id:'staff-b',role:'recruiter',operation_id:'member-b'})
  call('create_linkedin_application','staff-b',{...candidate,...B,requisition_id:'req-b',candidate_id:'cand-b',application_id:'app-b',assignee_user_id:'staff-b',operation_id:'create-b'})
  for(const params of [{...scope,application_id:'app-b'},{...scope,application_id:'missing'},{organization_id:'forged',brand_id:'brand-a',application_id:'app-a'}])assert.equal(call('get_application','staff-a',params).length,0)
  assert.equal(call('get_application','staff-b',{...scope,application_id:'app-a'}).length,0)
  assert.ok(call('change_application_stage','staff-b',change('submitted','in_review')).every(n=>n===0))
  call('grant_workspace_access','staff-a',{...scope,requisition_id:'req-a',member_user_id:'reviewer',role:'reviewer',grant_id:'reviewer',operation_id:'grant-reviewer'})
  call('reassign_application','staff-a',{...scope,application_id:'app-a',expected_version:1,from_user_id:'staff-a',to_user_id:'reviewer',reason:'Review',operation_id:'assign-reviewer'})
  assert.equal(call('gateway_get_application','reviewer',{...scope,application_id:'app-a'}).length,1)
  assert.equal(call('get_application','reviewer',{...scope,application_id:'app-a'}).length,0)
  assert.ok(call('change_application_stage','reviewer',change('submitted','in_review',{expected_version:2})).every(n=>n===0))
 } finally {db.close()}
})

test('registered server predicate is compiled from the same static map as the UI', async()=>{
 const {transitionPredicate}=await import('../scripts/application-stages.mjs')
 assert.ok(action('change_application_stage').statements.slice(0,2).every(statement => statement.includes(`AND ${transitionPredicate} AND`)))
})
