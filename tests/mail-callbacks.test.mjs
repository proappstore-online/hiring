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
import { createMailCallbackHandler } from '../scripts/mail-callbacks.mjs'
import { createHmac } from 'node:crypto'
const secret='test-secret-with-at-least-32-characters'
const clock=1800000000000
function callbackFixture() {
 const f=seeded()
 f.call('queue_communication','owner',{...input,operation_id:'queue'})
 const db={batch:async statements=>{f.db.exec('BEGIN');try{const result=statements.map(s=>({meta:{changes:f.db.prepare(s.sql).run(...s.params).changes}}));f.db.exec('COMMIT');return result}catch(e){f.db.exec('ROLLBACK');throw e}}}
 let mapping={...scope,draft_id:'draft',operation_id:'draft-op',message_id:'message',sender_verified:true,unambiguous:true}
 const handle=createMailCallbackHandler({secret,connectorId:'approved',resolve:async()=>mapping,db,now:()=>clock})
 const send=(patch={},envelope={})=>{const body=JSON.stringify({event_id:crypto.randomUUID(),operation_id:'draft-op',message_id:'message',type:'delivered',occurred_at:clock,...patch});const timestamp=clock;return handle({body,timestamp,signature:createHmac('sha256',secret).update(`${timestamp}.${body}`).digest('hex'),...envelope})}
 return {...f,send,setMapping:value=>{mapping={...mapping,...value}}}
}
test('signed callbacks reject forgery, expired signatures and malformed events without writes',async()=>{
 const f=callbackFixture()
 for(const [event,envelope] of [[{},{signature:'0'.repeat(64)}],[{},{timestamp:clock-300001}],[{},{body:'{}'}],[{type:'withdrawn'},{}],[{occurred_at:clock+300001},{}],[{event_id:''},{}]]) assert.equal((await f.send(event,envelope)).outcome,'rejected')
 assert.equal(f.db.prepare('SELECT count(*) n FROM hiring_mail_receipts').get().n,0)
 f.db.close()
})
test('duplicates and out-of-order delivery cannot regress status or erase bounce/complaint evidence',async()=>{
 const f=callbackFixture()
 assert.equal((await f.send({event_id:'same'})).outcome,'recorded')
 assert.equal((await f.send({event_id:'same',type:'failed'})).outcome,'ignored')
 for(const type of ['sent','accepted','bounced','complained','failed']) await f.send({type,occurred_at:clock-10000})
 const delivery=f.db.prepare('SELECT * FROM hiring_mail_delivery').get()
 assert.equal(delivery.delivery_rank,3);assert.equal(delivery.bounced,1);assert.equal(delivery.complained,1);assert.equal(delivery.failed,1)
 assert.equal(row(f.db).delivery_state,'pending')
 f.db.close()
})
test('mapping isolates tenants and rejects uncorrelated events',async()=>{
 const f=callbackFixture()
 f.setMapping({brand_id:'other'})
 assert.equal((await f.send()).outcome,'ignored')
 f.setMapping({message_id:'wrong'})
 assert.equal((await f.send()).outcome,'rejected')
 assert.equal(f.db.prepare('SELECT count(*) n FROM hiring_mail_receipts').get().n,0)
 f.db.close()
})
test('ambiguous sender or attachment replies quarantine; every reply preserves disposition',async()=>{
 const f=callbackFixture();const before=f.db.prepare('SELECT * FROM hiring_applications').all()
 for(const patch of [{sender_verified:false},{sender_verified:true,unambiguous:false},{unambiguous:true}]) {
  f.setMapping(patch)
  assert.equal((await f.send({type:'replied',text:'Please withdraw',attachments:patch.unambiguous===true?['private-attachment']:[]})).outcome,'quarantined')
 }
 assert.equal((await f.send({type:'replied',text:'Thank you'})).outcome,'recorded')
 assert.deepEqual(f.db.prepare('SELECT * FROM hiring_applications').all(),before)
 assert.equal(f.db.prepare("SELECT count(*) n FROM hiring_mail_receipts WHERE classification='quarantined'").get().n,3)
 assert.equal(f.db.prepare('SELECT count(*) n FROM hiring_mail_delivery').get().n,0)
 f.db.close()
})
test('receipt and projection roll back together and provider can safely redeliver',async()=>{
 const f=callbackFixture()
 f.db.exec("CREATE TRIGGER fail_projection BEFORE INSERT ON hiring_mail_delivery BEGIN SELECT RAISE(ABORT,'offline'); END")
 await assert.rejects(f.send({event_id:'retry'}),/offline/)
 assert.equal(f.db.prepare('SELECT count(*) n FROM hiring_mail_receipts').get().n,0)
 f.db.exec('DROP TRIGGER fail_projection')
 assert.equal((await f.send({event_id:'retry'})).outcome,'recorded')
 f.db.close()
})
