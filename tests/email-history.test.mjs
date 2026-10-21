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
const input = { ...scope, draft_id:'draft' }
const row = db => db.prepare("SELECT * FROM hiring_outbox WHERE id='draft'").get()
const history = (call, logical, extra={}) => call('list_email_status_history','owner',{...scope,logical_email_id:logical,...extra})
const archive = (logical, extra={}) => ({...scope,communication_id:'archive',direction:'outbound',from_email:'sender@example.test',to_email:'private@example.com',subject:'Private subject',body:'Secret body',provider_message_id:'provider-1',provider_thread_id:'thread-1',occurred_at:Date.now(),agent_instance_id:'agent',operation_id:'archive-op',logical_email_id:logical,...extra})
function claimed(f) {
 f.call('queue_communication','owner',{...input,operation_id:'queue'})
 f.call('claim_communication','owner',{...input,operation_id:'claim'})
 return row(f.db).logical_email_id
}
test('real transitions and provider evidence are atomic, scoped, attributed and idempotent',()=>{
 const f=seeded();const logical=claimed(f)
 assert.match(logical,/^[0-9a-f-]{36}$/)
 const a=archive(logical)
 f.call('record_candidate_email','owner',a)
 const before=history(f.call,logical)
 assert.deepEqual(before.map(e=>e.status),['draft','queued','sending','accepted'])
 assert.ok(before.every(e=>e.actor==='owner' && e.timestamp>0))
 assert.equal(before.at(-1).provider_reference,'provider-1')
 f.call('record_candidate_email','owner',a)
 assert.deepEqual(history(f.call,logical),before)
 assert.deepEqual(f.call('list_email_status_history','outsider',{...scope,logical_email_id:logical}),[])
 assert.deepEqual(history(f.call,logical,{brand_id:'forged'}),[])
 assert.equal(f.call('list_application_communications','owner',scope)[0].logical_email_id,logical)
 assert.equal(f.call('list_communication_drafts','owner',scope)[0].linked_archive_id,'archive')
 assert.throws(()=>f.call('record_candidate_email','owner',archive(logical,{communication_id:'other',provider_message_id:'other',operation_id:'other'})),/conflicting/)
 assert.throws(()=>f.call('record_candidate_email','owner',{...a,body:'forged',operation_id:'other'}),/conflicting/)
 assert.throws(()=>f.db.exec('DELETE FROM email_status_events'),/append-only/)
 assert.throws(()=>f.db.exec("UPDATE hiring_outbox SET logical_email_id='other'"),/immutable/)
 f.db.close()
})
test('scope and actor link forgery cannot create records or history',()=>{
 const f=seeded();const logical=claimed(f);const before=history(f.call,logical)
 for(const patch of [{logical_email_id:'missing'},{logical_email_id:'other-scope'}]) assert.throws(()=>f.call('record_candidate_email','owner',archive(logical,patch)),/invalid email link/)
 assert.ok(f.call('record_candidate_email','outsider',archive(logical)).every(n=>n===0))
 f.db.exec("INSERT INTO hiring_memberships(id,organization_id,brand_id,user_id,role,created_at) VALUES('second','org','brand','second','recruiter',1)")
 assert.throws(()=>f.call('record_candidate_email','second',archive(logical,{actor_user_id:'owner'})),/claimant/)
 assert.deepEqual(history(f.call,logical),before)
 f.db.close()
})
test('identical emails have different identities and failed/unknown completion records exact outcome',()=>{
 for(const outcome of ['failed','unknown','sent']) {
 const f=seeded();const logical=claimed(f)
 f.call('create_communication_draft','owner',{...scope,draft_id:'second',recipient_email:'private@example.com',subject:'Private subject',body:'Secret body',operation_id:'second'})
 assert.notEqual(f.db.prepare("SELECT logical_email_id FROM hiring_outbox WHERE id='second'").get().logical_email_id,logical)
 f.call('complete_communication','owner',{...input,claim_id:'claim',outcome,operation_id:'complete'})
 const events=history(f.call,logical)
 assert.equal(events.at(-1).status,outcome==='sent'?'accepted':outcome)
 f.call('complete_communication','owner',{...input,claim_id:'claim',outcome,operation_id:'complete'})
 assert.deepEqual(history(f.call,logical),events)
 f.db.close()
 }
})
test('chronological pagination preserves tied timestamps across all pages',()=>{
 const f=seeded();const logical=row(f.db).logical_email_id
 for(let i=0;i<110;i++) f.db.prepare('INSERT INTO email_status_events(id,logical_email_id,status,timestamp,actor) VALUES(?,?,?,?,?)').run(`page-${String(i).padStart(3,'0')}`,logical,'unknown',9999999999999,'owner')
 let seen=[],cursor={}
 for(;;){const page=history(f.call,logical,cursor);if(!page.length)break;seen.push(...page);const last=page.at(-1);cursor={cursor_at:last.timestamp,cursor_id:last.id}}
 assert.equal(seen.length,111);assert.equal(new Set(seen.map(e=>e.id)).size,111)
 f.db.close()
})
test('worker provider identities link truthfully and cross-provider conflicting links fail',()=>{
 const f=seeded();const logical=claimed(f)
 const a=archive(logical,{mailbox_address:'sender@example.test',provider_connection_id:'bridge',provider_receipt_id:'receipt',provider_event_id:'event'})
 f.call('record_worker_candidate_email','owner',a)
 const c=f.call('list_application_communications','owner',scope)[0]
 assert.equal(c.provider,'cloudflare');assert.equal(c.provider_receipt_id,'receipt');assert.equal(c.logical_email_id,logical)
 assert.throws(()=>f.call('record_candidate_email','owner',archive(logical,{communication_id:'gmail',operation_id:'gmail'})),/conflicting/)
 f.db.close()
})
test('existing identities cannot cross tenant/application boundaries and audit failure rolls back archive evidence',()=>{
 const f=seeded();const logical=claimed(f)
 const other={organization_id:'other-org',brand_id:'other-brand',application_id:'other-app'}
 f.call('create_workspace','owner',{...other,requisition_id:'other-req',organization_name:'Other',brand_name:'Other',requisition_title:'Role',operation_id:'other-boot'})
 f.call('create_linkedin_application','owner',{...other,requisition_id:'other-req',candidate_id:'other-candidate',candidate_name:'Synthetic',email:'private@example.com',phone:'',linkedin_url:'',source_detail:'Fixture',basis_reference:'Basis',contact_context:'Fixture',assignee_user_id:'owner',operation_id:'other-person'})
 assert.throws(()=>f.call('record_candidate_email','owner',archive(logical,other)),/invalid email link/)
 const before=history(f.call,logical)
 f.db.exec("CREATE TRIGGER fail_email_audit BEFORE INSERT ON hiring_audit_events BEGIN SELECT RAISE(ABORT,'audit unavailable'); END")
 assert.throws(()=>f.call('record_candidate_email','owner',archive(logical)),/audit unavailable/)
 assert.equal(f.db.prepare('SELECT count(*) n FROM hiring_email_archive_links').get().n,0)
 assert.equal(f.db.prepare('SELECT count(*) n FROM hiring_communication_events').get().n,0)
 assert.deepEqual(history(f.call,logical),before)
 f.db.close()
})
test('legacy upgrade preserves unproven archives and outbox rows without invented events',()=>{
 const db=new DatabaseSync(':memory:')
 for(const m of migrations.migrations.slice(0, migrations.migrations.findIndex(m => m.name === '0018_email_identity_history')))db.exec(m.sql)
 db.exec("INSERT INTO hiring_organizations(id,name,created_by,created_at) VALUES('org','Org','owner',1); INSERT INTO hiring_brands(id,organization_id,name,created_at) VALUES('brand','org','Brand',1); INSERT INTO hiring_requisitions(id,organization_id,brand_id,title,created_at) VALUES('req','org','brand','Role',1); INSERT INTO hiring_candidates(id,organization_id,brand_id,name,linkedin_url,created_by,created_at) VALUES('c','org','brand','Synthetic','','owner',1); INSERT INTO hiring_applications(id,organization_id,brand_id,requisition_id,candidate_id,source,source_detail,basis_reference,contact_context,assignee_user_id,stage,version,created_by,created_at,updated_at) VALUES('app','org','brand','req','c','linkedin','fixture','basis','fixture','owner','submitted',1,'owner',1,1); INSERT INTO hiring_outbox(id,organization_id,brand_id,application_id,recipient_email,subject,body,status,actor_user_id,created_at) VALUES('old','org','brand','app','candidate@example.test','Same','Same','draft','owner',1)")
 for (const m of migrations.migrations.slice(migrations.migrations.findIndex(m => m.name === '0018_email_identity_history'))) db.exec(m.sql)
 assert.equal(db.prepare("SELECT logical_email_id FROM hiring_outbox WHERE id='old'").get().logical_email_id,null)
 assert.equal(db.prepare('SELECT count(*) n FROM email_status_events').get().n,0)
 assert.equal(db.prepare('SELECT count(*) n FROM hiring_email_archive_links').get().n,0)
 db.close()
})
test('queueing a legacy unsent draft starts a new identity with only the real queued event',()=>{
 const f=seeded()
 f.db.exec("INSERT INTO hiring_outbox(id,organization_id,brand_id,application_id,recipient_email,subject,body,status,actor_user_id,created_at,operation_id) SELECT 'legacy',organization_id,brand_id,application_id,recipient_email,subject,body,status,actor_user_id,created_at,'legacy-op' FROM hiring_outbox WHERE id='draft'")
 f.call('queue_communication','owner',{...scope,draft_id:'legacy',operation_id:'legacy-queue'})
 const logical=f.db.prepare("SELECT logical_email_id FROM hiring_outbox WHERE id='legacy'").get().logical_email_id
 assert.match(logical,/^[0-9a-f-]{36}$/)
 assert.deepEqual(history(f.call,logical).map(e=>e.status),['queued'])
 f.db.close()
})

for (const outcome of ['unknown', 'failed', 'sent']) test(`archive acceptance survives ${outcome} completion without duplicate acceptance`, () => {
 for (const provider of ['gmail', 'worker']) {
  const f = seeded(); const logical = claimed(f)
  const payload = archive(logical, provider === 'worker' ? { mailbox_address: 'sender@example.test', provider_connection_id: 'bridge', provider_receipt_id: 'receipt', provider_event_id: 'event' } : {})
  f.call(provider === 'gmail' ? 'record_candidate_email' : 'record_worker_candidate_email', 'owner', payload)
  const before = history(f.call, logical)
  const completion = { ...input, claim_id: 'claim', outcome, operation_id: 'complete' }
  if (outcome === 'sent') {
   f.call('complete_communication', 'owner', completion)
   assert.equal(row(f.db).delivery_state, 'sent')
   assert.equal(f.db.prepare("SELECT count(*) n FROM hiring_audit_events WHERE action='outbox.completed'").get().n, 1)
   assert.ok(f.call('complete_communication', 'owner', completion).every(n => n === 0))
  } else {
   assert.throws(() => f.call('complete_communication', 'owner', completion), /completion contradicts recorded provider acceptance/)
   assert.equal(row(f.db).delivery_state, 'sending')
   assert.equal(f.db.prepare("SELECT count(*) n FROM hiring_audit_events WHERE action='outbox.completed'").get().n, 0)
  }
  assert.equal(f.call('list_communication_drafts', 'owner', scope)[0].current_status, 'accepted')
  assert.deepEqual(history(f.call, logical), before)
  f.db.close()
 }
})

test('worker linked replay rejects altered receipt, event, mailbox and connection without new evidence', () => {
 const f = seeded(); const logical = claimed(f)
 const payload = archive(logical, { mailbox_address: 'sender@example.test', provider_connection_id: 'bridge', provider_receipt_id: 'receipt', provider_event_id: 'event' })
 f.call('record_worker_candidate_email', 'owner', payload)
 const before = history(f.call, logical)
 assert.ok(f.call('record_worker_candidate_email', 'owner', payload).every(n => n === 0))
 for (const patch of [{ provider_receipt_id: 'other' }, { provider_event_id: 'other' }, { mailbox_address: 'other@example.test', from_email: 'other@example.test' }, { provider_connection_id: 'other' }]) {
  assert.throws(() => f.call('record_worker_candidate_email', 'owner', { ...payload, ...patch, operation_id: 'conflicting-replay' }), /conflicting email replay/)
  assert.deepEqual(history(f.call, logical), before)
  assert.equal(f.db.prepare('SELECT count(*) n FROM hiring_worker_communication_events').get().n, 1)
  assert.equal(f.db.prepare('SELECT count(*) n FROM hiring_email_archive_links').get().n, 1)
 }
 f.db.close()
})

test('rejected and no-op queue and claim calls append no status events', () => {
 const f = seeded(); const logical = row(f.db).logical_email_id
 for (const name of ['queue_communication', 'claim_communication']) {
  const before = history(f.call, logical)
  assert.ok(f.call(name, 'outsider', { ...input, operation_id: 'denied' }).every(n => n === 0))
  assert.ok(f.call(name, 'owner', { ...input, brand_id: 'forged', operation_id: 'forged' }).every(n => n === 0))
  assert.deepEqual(history(f.call, logical), before)
  const operation = { ...input, operation_id: name }
  f.call(name, 'owner', operation)
  const after = history(f.call, logical)
  assert.equal(after.length, before.length + 1)
  assert.ok(f.call(name, 'owner', operation).every(n => n === 0))
  assert.ok(f.call(name, 'owner', { ...input, operation_id: name + '-noop' }).every(n => n === 0))
  assert.deepEqual(history(f.call, logical), after)
 }
 f.db.close()
})
