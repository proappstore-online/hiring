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


const scope = { organization_id: 'org', brand_id: 'brand', application_id: 'app' }
function seeded() {
 const f = fixture()
 f.call('create_workspace', 'owner', { ...scope, requisition_id:'req', organization_name:'Org', brand_name:'Brand', requisition_title:'Role', operation_id:'boot' })
 f.call('create_linkedin_application','owner',{ ...scope,requisition_id:'req',candidate_id:'candidate',candidate_name:'Private Person',email:'private@example.com',phone:'',linkedin_url:'',source_detail:'Private',basis_reference:'Basis',contact_context:'Private',assignee_user_id:'owner',operation_id:'person' })
 f.call('create_communication_draft','owner',{...scope,draft_id:'draft',recipient_email:'private@example.com',subject:'Private subject',body:'Secret body',operation_id:'draft-op'})
 return f
}

const template = { ...scope, template_id:'template', name:'Update', subject:'Private subject', body:'Secret body', expected_version:0, operation_id:'template-create' }
const approve = { ...scope, template_id:'template', expected_version:1, operation_id:'approval' }
const queue = { ...scope, draft_id:'draft', operation_id:'queue' }
const pending = f => f.db.prepare("SELECT * FROM hiring_outbox WHERE id='draft'").get()
function approved(f) {
 f.call('save_communication_template','owner',template)
 assert.equal(f.call('approve_communication_template','owner',approve)[0],1)
}
test('only current owner-approved exact template text can queue; approval is scoped and replay safe',()=>{
 const f=seeded()
 assert.equal(f.call('queue_communication','owner',queue)[0],0)
 f.call('save_communication_template','owner',template)
 f.db.exec("INSERT INTO hiring_memberships(id,organization_id,brand_id,user_id,role,created_at) VALUES('recruiter','org','brand','recruiter','recruiter',1)")
 for(const user of ['outsider','recruiter']) assert.equal(f.call('approve_communication_template',user,approve)[0],0)
 assert.equal(f.call('approve_communication_template','owner',{...approve,brand_id:'other'})[0],0)
 assert.equal(f.call('approve_communication_template','owner',{...approve,expected_version:2})[0],0)
 assert.equal(f.call('approve_communication_template','owner',approve)[0],1)
 assert.equal(f.call('approve_communication_template','owner',approve)[0],0)
 assert.equal(f.call('queue_communication','outsider',queue)[0],0)
 assert.equal(f.call('queue_communication','owner',queue)[0],1)
 assert.equal(pending(f).template_id,'template');assert.equal(pending(f).template_version,1)
 assert.throws(()=>f.db.exec("UPDATE hiring_template_approvals SET body='forged'"),/immutable/)
 f.db.close()
})
test('edits invalidate approval and queued version; reapproval cannot silently replace queued content',()=>{
 const f=seeded();approved(f)
 f.call('queue_communication','owner',queue)
 f.call('save_communication_template','owner',{...template,expected_version:1,body:'New version',operation_id:'edit'})
 assert.equal(f.call('claim_communication','owner',{...queue,operation_id:'claim'})[0],0)
 f.call('approve_communication_template','owner',{...approve,expected_version:2,operation_id:'new-approval'})
 assert.equal(f.call('claim_communication','owner',{...queue,operation_id:'claim2'})[0],0)
 assert.equal(pending(f).delivery_state,'pending')
 f.db.close()
})
test('recipient changes block queue and claim; mismatched text cannot use template approval',()=>{
 for(const afterQueue of [false,true]) {
  const f=seeded();approved(f)
  if(afterQueue)f.call('queue_communication','owner',queue)
  f.db.exec("UPDATE hiring_candidates SET email='new@example.com' WHERE id='candidate'")
  assert.equal(f.call(afterQueue?'claim_communication':'queue_communication','owner',{...queue,operation_id:'try'})[0],0)
  f.db.close()
 }
 const f=seeded();approved(f)
 f.db.exec("UPDATE hiring_outbox SET body='Altered' WHERE id='draft'")
 assert.equal(f.call('queue_communication','owner',queue)[0],0)
 f.db.close()
})
test('approved previews and delivery history remain restricted to application and brand',()=>{
 const f=seeded();approved(f)
 assert.equal(f.call('list_approved_communication_templates','owner',scope).length,1)
 for(const user of ['outsider'])assert.deepEqual(f.call('list_approved_communication_templates',user,scope),[])
 assert.deepEqual(f.call('list_approved_communication_templates','owner',{...scope,brand_id:'other'}),[])
 assert.deepEqual(f.call('list_email_status_history','owner',{...scope,brand_id:'other',logical_email_id:pending(f).logical_email_id}),[])
 f.db.close()
})
