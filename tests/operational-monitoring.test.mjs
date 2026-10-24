import { seedApprovedTemplates } from './communication-fixture.mjs'
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
  const call = (name, user, values = {}, now = Date.now()) => {
    const tool = action(name)
    const optional = Object.fromEntries(Object.entries(tool.params ?? {}).filter(([, schema]) => schema.optional).map(([key]) => [key, null]))
    const params = { ...optional, ...values, __user_id: user, __now: now, __uuid: crypto.randomUUID() }
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

import { dispatchCommunication } from '../scripts/outbox.mjs'
const scope = { organization_id: 'org', brand_id: 'brand', application_id: 'app' }
function seeded() {
 const f = fixture()
 f.call('create_workspace', 'owner', { ...scope, requisition_id:'req', organization_name:'Org', brand_name:'Brand', requisition_title:'Role', operation_id:'boot' })
 f.call('create_linkedin_application','owner',{ ...scope,requisition_id:'req',candidate_id:'candidate',candidate_name:'Private Person',email:'private@example.com',phone:'',linkedin_url:'',source_detail:'Private',basis_reference:'Basis',contact_context:'Private',assignee_user_id:'owner',operation_id:'person' })
 f.call('create_communication_draft','owner',{...scope,draft_id:'draft',recipient_email:'private@example.com',subject:'Private subject',body:'Secret body',operation_id:'draft-op'})
 return f
}
const input = { ...scope, draft_id:'draft' }
const row = db => db.prepare("SELECT * FROM hiring_outbox WHERE id='draft'").get()

import { operationalAlerts, monitorOperations } from '../scripts/operational-alerts.mjs'
test('operational inspection is scoped, paged and content free',()=>{
 const {db,call}=seeded()
 seedApprovedTemplates(db)
 call('queue_communication','owner',{...input,operation_id:'queue'})
 call('claim_communication','owner',{...input,operation_id:'claim'})
 call('complete_communication','owner',{...input,claim_id:'claim',outcome:'failed',delivery_reason:'quota',operation_id:'complete'})
 const rows=call('inspect_operational_jobs','owner',scope)
 assert.equal(rows.length,1);assert.equal(rows[0].reason_code,'quota')
 assert.ok(!JSON.stringify(rows).match(/Private|Secret|private@example/))
 assert.deepEqual(call('inspect_operational_jobs','outsider',scope),[])
 assert.deepEqual(call('inspect_operational_jobs','owner',{...scope,brand_id:'other'}),[])
 assert.deepEqual(call('inspect_operational_jobs','owner',{...scope,after_key:'mail:draft'}),[])
 const health=call('get_operational_health','owner',scope)[0]
 assert.equal(health.quota_count,1);assert.equal(health.retention_failed_count,0)
 assert.ok(operationalAlerts(health).some(a=>a.code==='quota'))
 call('add_workspace_member','owner',{...scope,member_user_id:'recruiter',role:'recruiter',operation_id:'grant'})
 assert.equal(call('get_operational_health','recruiter',scope)[0].quota_count,null)
 assert.deepEqual(call('inspect_operational_jobs','recruiter',scope),[])
 db.close()
})
test('alerts allowlist output, handle thresholds and propagate notification failures',async()=>{
 const health={observed_at:100,oldest_pending_draft_age_ms:900000,retention_failed_count:1,denied_or_missing_24h:10,secret:'private@example.com'}
 const alerts=operationalAlerts(health,{callbackFailures:2})
 assert.deepEqual(alerts.map(a=>a.code),['queue_age','retention_failure','access_denial','callback_failure'])
 assert.ok(!JSON.stringify(alerts).includes('private'))
 assert.deepEqual(operationalAlerts({observed_at:100,failed_count:null,oldest_pending_draft_age_ms:899999}),[])
 await assert.rejects(monitorOperations({actions:async()=>({rows:[]}),scope,notify:async()=>{}}),/unavailable/)
 await assert.rejects(monitorOperations({actions:async()=>({rows:[health]}),scope,notify:async()=>{throw Error('transport unavailable')}}),/transport unavailable/)
})
test('callback diagnostics omit untrusted bodies and exceptions',async()=>{
 const {createMailCallbackHandler}=await import('../scripts/mail-callbacks.mjs')
 const events=[]
 const handle=createMailCallbackHandler({secret:'x'.repeat(32),connectorId:'mail',resolve:async()=>null,db:{batch:async()=>[]},observe:e=>events.push(e)})
 assert.equal((await handle({body:'private@example.com',timestamp:0,signature:'token'})).outcome,'rejected')
 assert.deepEqual(events,[{event:'mail.callback',outcome:'rejected'}])
})
test('retention inspection reports all store failures without candidate identifiers',()=>{
 const {db,call}=seeded()
 db.prepare("INSERT INTO hiring_deletion_requests(id,organization_id,brand_id,candidate_id,application_id,actor_user_id,created_at,origin) VALUES('delete','org','brand','candidate','app','owner',1,'explicit')").run()
 for(const [store,state] of [['d1','failed'],['r2','blocked'],['index','unknown']]) {
  db.prepare('INSERT INTO hiring_deletion_steps(request_id,organization_id,brand_id,store,state,attempts) VALUES(?,?,?,?,?,?)').run('delete','org','brand',store,state,1)
 }
 const health=call('get_operational_health','owner',scope)[0]
 assert.equal(health.retention_failed_count,1);assert.equal(health.retention_blocked_count,1);assert.equal(health.retention_unknown_count,1)
 const rows=call('inspect_operational_jobs','owner',scope)
 assert.equal(rows.length,3)
 assert.ok(rows.every(r=>r.kind==='retention' && !('candidate_id' in r)))
 db.close()
})
