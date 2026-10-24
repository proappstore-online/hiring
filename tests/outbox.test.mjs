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
test('queue, exclusive claim and completion are scoped, attributed, durable and replay safe', () => {
 const {db,call}=seeded()
 for (const user of ['outsider']) assert.ok(call('queue_communication',user,{...input,operation_id:'bad'}).every(n=>n===0))
 assert.ok(call('queue_communication','owner',{...input,brand_id:'forged',operation_id:'bad'}).every(n=>n===0))
 const queue={...input,operation_id:'queue'}
 assert.equal(call('queue_communication','owner',queue).at(-1),1)
 assert.equal(row(db).idempotency_key,'draft-op')
 assert.ok(call('queue_communication','owner',queue).every(n=>n===0))
 assert.throws(()=>db.exec("UPDATE hiring_outbox SET body='changed'"),/immutable/)
 assert.throws(()=>db.exec('DELETE FROM hiring_outbox'),/durable/)
 assert.equal(call('claim_communication','owner',{...input,operation_id:'claim'}).at(-1),1)
 assert.ok(call('claim_communication','owner',{...input,operation_id:'claim-2'}).every(n=>n===0))
 assert.deepEqual(call('get_claimed_communication','outsider',{...input,claim_id:'claim'}),[])
 assert.ok(call('complete_communication','owner',{...input,claim_id:'wrong',outcome:'sent',operation_id:'wrong'}).every(n=>n===0))
 assert.equal(call('complete_communication','owner',{...input,claim_id:'claim',outcome:'unknown',operation_id:'complete'}).at(-1),1)
 assert.ok(call('claim_communication','owner',{...input,operation_id:'retry'}).every(n=>n===0))
 assert.equal(row(db).attempt_count,1)
 const audit=db.prepare("SELECT * FROM hiring_audit_events WHERE action LIKE 'outbox.%'").all()
 assert.equal(audit.length,3)
 assert.ok(audit.every(e=>e.actor_user_id==='owner' && e.created_at>0 && e.object_id==='draft' && e.request_id===e.operation_id))
 assert.ok(!JSON.stringify(audit).includes('private@example.com'))
 for(const sql of ["UPDATE hiring_audit_events SET action='forged'",'DELETE FROM hiring_audit_events']) assert.throws(()=>db.exec(sql),/append-only/)
 db.close()
})
test('audit failure rolls back queue, claim and completion, including attempt counters',()=>{
 for(const target of ['queue_communication','claim_communication','complete_communication']) {
  const {db,call}=seeded()
  if(target!=='queue_communication') call('queue_communication','owner',{...input,operation_id:'queue'})
  if(target==='complete_communication') call('claim_communication','owner',{...input,operation_id:'claim'})
  const before=row(db)
  db.exec("CREATE TRIGGER fail_outbox_audit BEFORE INSERT ON hiring_audit_events BEGIN SELECT RAISE(ABORT,'audit unavailable'); END")
  assert.throws(()=>call(target,'owner',{...input,operation_id:'test',claim_id:'claim',outcome:'sent'}),/audit unavailable/)
  assert.deepEqual(row(db),before)
  db.close()
 }
})
test('dispatcher sends once across retries and redacts provider exceptions and payloads',async()=>{
 for(const result of ['accepted','not_accepted','timeout']) {
 const {db,call}=seeded()
 call('queue_communication','owner',{...input,operation_id:'queue'})
 let sends=0; const logs=[]
 const actions=async(name,params)=>{const value=call(name,'owner',params);return action(name).operation==='query'?{rows:value}:{results:value.map(changes=>({meta:{changes}}))}}
 const send=async(payload,options)=>{sends++;assert.equal(options.idempotencyKey,'draft-op');assert.equal(payload.body,'Secret body');if(result==='timeout')throw new Error('private@example.com Secret body token');return result}
 const args={actions,send,scope,draftId:'draft',log:e=>logs.push(e)}
 assert.equal(await dispatchCommunication(args),result==='accepted'?'sent':result==='not_accepted'?'failed':'unknown')
 assert.equal(await dispatchCommunication(args),'not_claimed')
 assert.equal(sends,1)
 assert.ok(!JSON.stringify(logs).match(/private|Secret|token/))
 db.close()
 }
})

test('lost completion responses and process crashes cannot make a job claimable again', async () => {
 for (const loseAfterCommit of [true, false]) {
  const {db,call}=seeded()
  call('queue_communication','owner',{...input,operation_id:'queue'})
  let sends=0
  const actions=async(name,params)=>{
   if(name==='complete_communication' && !loseAfterCommit) throw new Error('offline')
   const value=call(name,'owner',params)
   if(name==='complete_communication') throw new Error('response lost')
   return action(name).operation==='query'?{rows:value}:{results:value.map(changes=>({meta:{changes}}))}
  }
  const args={actions,scope,draftId:'draft',send:async()=>{sends++;return 'accepted'}}
  await assert.rejects(dispatchCommunication(args))
  assert.equal(await dispatchCommunication(args),'not_claimed')
  assert.equal(sends,1)
  assert.equal(row(db).delivery_state,loseAfterCommit?'sent':'sending')
  assert.throws(()=>db.exec("UPDATE hiring_outbox SET delivery_state='pending'"),/invalid outbox transition/)
  db.close()
 }
})

test('draft creation and audit commit atomically',()=>{
 const {db,call}=seeded()
 const before=db.prepare('SELECT count(*) n FROM hiring_outbox').get().n
 db.exec("CREATE TRIGGER fail_draft_audit BEFORE INSERT ON hiring_audit_events BEGIN SELECT RAISE(ABORT,'audit unavailable'); END")
 assert.throws(()=>call('create_communication_draft','owner',{...scope,draft_id:'other',recipient_email:'private@example.com',subject:'Other',body:'Body',operation_id:'other'}),/audit unavailable/)
 assert.equal(db.prepare('SELECT count(*) n FROM hiring_outbox').get().n,before)
 db.close()
})

test('human reconciliation creates one safe replacement, requires scope and evidence, and audits atomically', () => {
 for (const outcome of ['accepted','not_accepted']) {
  const {db,call}=seeded()
  call('queue_communication','owner',{...input,operation_id:'queue'})
  call('claim_communication','owner',{...input,operation_id:'claim'})
  call('complete_communication','owner',{...input,claim_id:'claim',outcome:'unknown',operation_id:'complete'})
  const args={...input,operation_id:'recover',outcome,evidence:'Provider dashboard confirms final outcome; incident 123'}
  for (const [user,extra] of [['outsider',{}],['owner',{brand_id:'other'}],['owner',{evidence:' '}],['owner',{outcome:'invented'}]]) {
   assert.ok(call('reconcile_communication',user,{...args,...extra}).every(n=>n===0))
  }
  db.exec("CREATE TRIGGER recovery_audit_failure BEFORE INSERT ON hiring_audit_events BEGIN SELECT RAISE(ABORT,'audit unavailable'); END")
  assert.throws(()=>call('reconcile_communication','owner',args),/audit unavailable/)
  assert.equal(db.prepare('SELECT count(*) n FROM hiring_mail_reconciliations').get().n,0)
  assert.equal(db.prepare('SELECT count(*) n FROM hiring_outbox').get().n,1)
  db.exec('DROP TRIGGER recovery_audit_failure')
  call('reconcile_communication','owner',args)
  assert.ok(call('reconcile_communication','owner',args).every(n=>n===0))
  assert.ok(call('reconcile_communication','owner',{...args,operation_id:'another'}).every(n=>n===0))
  const r=db.prepare('SELECT * FROM hiring_mail_reconciliations').get()
  assert.equal(call('get_communication_reconciliation','owner',args)[0].operation_id,'recover')
  assert.deepEqual(call('get_communication_reconciliation','outsider',input),[])
  assert.deepEqual(call('get_communication_reconciliation','owner',{...args,evidence:'Different'}),[])
  assert.equal(r.actor_user_id,'owner'); assert.ok(r.created_at>0)
  assert.equal(row(db).delivery_state,'unknown')
  assert.ok(call('claim_communication','owner',{...input,operation_id:'retry-original'}).every(n=>n===0))
  assert.throws(()=>db.exec('DELETE FROM hiring_mail_reconciliations'),/append-only/)
  const audit=db.prepare("SELECT * FROM hiring_audit_events WHERE action='outbox.reconciled'").get()
  assert.ok(!JSON.stringify(audit).includes('incident'))
  if(outcome==='not_accepted') {
   const replacement=db.prepare('SELECT * FROM hiring_outbox WHERE id=?').get(r.replacement_draft_id)
   assert.equal(replacement.delivery_state,'draft')
   assert.equal(replacement.body,row(db).body)
   assert.notEqual(replacement.logical_email_id,row(db).logical_email_id)
  } else assert.equal(r.replacement_draft_id,null)
  db.close()
 }
})

test('reconciliation cannot retry recorded acceptance, pending jobs or active claims',()=>{
 for(const state of ['pending','sending','failed']) {
  const {db,call}=seeded()
  call('queue_communication','owner',{...input,operation_id:'queue'})
  if(state!=='pending') call('claim_communication','owner',{...input,operation_id:'claim'})
  if(state==='failed') {
   call('complete_communication','owner',{...input,claim_id:'claim',outcome:'failed',operation_id:'complete'})
   db.prepare("INSERT INTO email_status_events(id,logical_email_id,status,timestamp,actor) VALUES('proof',?,'accepted',1,'owner')").run(row(db).logical_email_id)
  }
  assert.ok(call('reconcile_communication','owner',{...input,operation_id:'recover',outcome:'not_accepted',evidence:'Evidence'}).every(n=>n===0))
  assert.equal(db.prepare('SELECT count(*) n FROM hiring_outbox').get().n,1)
  db.close()
 }
 assert.equal(action('reconcile_communication').step_up,true)
})
