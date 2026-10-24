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

import { requestErasure } from '../scripts/erasure.mjs'
const scope = { organization_id: 'org', brand_id: 'brand' }
const input = { ...scope, application_id: 'app', operation_id: 'erase', identity_verified: 1, holds_reviewed: 1 }
function seeded() {
  const f = fixture()
  for (const brand of ['brand', 'sibling']) {
    f.call('create_workspace', 'owner', { organization_id:'org',brand_id:brand,requisition_id:'req-'+brand,organization_name:'Org',brand_name:brand,requisition_title:'Role',operation_id:'boot-'+brand })
    f.call('create_linkedin_application','owner',{organization_id:'org',brand_id:brand,requisition_id:'req-'+brand,candidate_id:'candidate-'+brand,application_id:brand==='brand'?'app':'sibling-app',candidate_name:'Private Person',email:'private@example.test',phone:'123',linkedin_url:'https://www.linkedin.com/in/private',source_detail:'Private source',basis_reference:'Private basis',contact_context:'Private context',assignee_user_id:'owner',operation_id:'person-'+brand})
  }
  return f
}
const core = db => db.prepare("SELECT * FROM hiring_candidates WHERE id='candidate-brand'").get()
const status = call => call('get_candidate_erasure_status','owner',input)[0]
function transport(call, user='owner') {
  return async (name, params) => { const value=call(name,user,params);return action(name).operation==='query'?{rows:value}:{meta:{changes:value.at(-1)}} }
}
const args = call => ({ actions:transport(call),scope,applicationId:'app',operationId:'erase',identityVerified:true,holdsReviewed:true })

test('owner erasure atomically redacts scoped core, appends tombstone and blocked processor evidence, preserving audit rows', () => {
  const {db,call}=seeded()
  const before=db.prepare('SELECT * FROM hiring_audit_events ORDER BY id').all()
  const sibling=db.prepare("SELECT * FROM hiring_candidates WHERE id='candidate-sibling'").get()
  assert.equal(call('request_candidate_erasure','owner',input).at(-1),1)
  const c=core(db)
  for(const field of ['name','email','phone','linkedin_url'])assert.equal(c[field],'[redacted]')
  assert.equal(c.linkedin_profile_url,null)
  const a=db.prepare("SELECT * FROM hiring_applications WHERE id='app'").get()
  for(const field of ['source_detail','basis_reference','contact_context'])assert.equal(a[field],'[redacted]')
  assert.equal(a.submitted_snapshot_json,null)
  assert.deepEqual(db.prepare("SELECT * FROM hiring_candidates WHERE id='candidate-sibling'").get(),sibling)
  assert.deepEqual(db.prepare("SELECT * FROM hiring_audit_events WHERE action<>'erasure.requested' ORDER BY id").all(),before)
  const tombstone=db.prepare("SELECT * FROM hiring_audit_events WHERE action='erasure.requested'").get()
  assert.equal(tombstone.actor_user_id,'owner');assert.doesNotMatch(JSON.stringify(tombstone),/Private|private@example/)
  assert.equal(status(call).processor_status,'blocked');assert.equal(status(call).processor_reason,'no_verified_deletion_route')
  assert.equal(status(call).status,'partial')
  for(const table of ['hiring_audit_events','erasure_requests','processor_erasure_log'])assert.throws(()=>db.exec(`DELETE FROM ${table}`),/append-only/)
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[])
  db.close()
})

test('owner-only exact brand permission and verified identity are enforced by SQL, not supplied role claims', () => {
  const {db,call}=seeded()
  call('add_workspace_member','owner',{...scope,member_user_id:'recruiter',role:'recruiter',operation_id:'member'})
  for(const user of ['outsider','recruiter']) {
    assert.equal(call('request_candidate_erasure',user,{...input,role:'owner',actor_user_id:'owner'}).at(-1),0)
    assert.deepEqual(call('get_candidate_erasure_status',user,input),[])
    assert.deepEqual(call('get_candidate_erasure_hold',user,input),[])
  }
  for(const patch of [{brand_id:'sibling'},{organization_id:'forged'},{identity_verified:0},{holds_reviewed:0},{application_id:'missing'},{operation_id:'boot-brand'}])assert.equal(call('request_candidate_erasure','owner',{...input,...patch}).at(-1),0)
  assert.equal(core(db).name,'Private Person');assert.equal(db.prepare('SELECT count(*) n FROM erasure_requests').get().n,0)
  db.close()
})

test('legal holds block all core changes until an explicit owner release; review dates do not expire holds',()=>{
  const {db,call}=seeded()
  const hold={...input,state:'active',review_at:1,reason_reference:'legal-case-opaque-reference',operation_id:'hold'}
  assert.equal(call('record_candidate_erasure_hold','outsider',hold).at(-1),0)
  call('record_candidate_erasure_hold','owner',hold)
  assert.throws(()=>call('request_candidate_erasure','owner',input),/active legal hold/)
  assert.equal(core(db).name,'Private Person');assert.equal(db.prepare('SELECT count(*) n FROM erasure_requests').get().n,0)
  call('record_candidate_erasure_hold','owner',{...hold,state:'released',operation_id:'release'})
  call('request_candidate_erasure','owner',input)
  assert.equal(core(db).name,'[redacted]');assert.equal(db.prepare('SELECT count(*) n FROM erasure_hold_events').get().n,2)
  db.close()
})

test('audit or processor persistence failure rolls back every redaction and request',()=>{
  for(const table of ['hiring_audit_events','processor_erasure_log']) {
    const {db,call}=seeded();const before=core(db)
    db.exec(`CREATE TRIGGER synthetic_failure BEFORE INSERT ON ${table} BEGIN SELECT RAISE(ABORT,'synthetic unavailable'); END`)
    assert.throws(()=>call('request_candidate_erasure','owner',input),/synthetic unavailable/)
    assert.deepEqual(core(db),before);assert.equal(db.prepare('SELECT count(*) n FROM erasure_requests').get().n,0)
    db.close()
  }
})

test('protected bodies remain visible as blockers, never reported deleted or complete; tombstones fence rehydration and sends',()=>{
  const {db,call}=seeded()
  call('create_communication_draft','owner',{...scope,application_id:'app',draft_id:'draft',recipient_email:'private@example.test',subject:'Private',body:'Private body',operation_id:'draft'})
  seedApprovedTemplates(db)
  call('queue_communication','owner',{...scope,application_id:'app',draft_id:'draft',operation_id:'queue'})
  call('request_candidate_erasure','owner',input)
  const report=status(call);const stores=JSON.parse(report.stores_json)
  assert.equal(stores.find(x=>x.store==='hiring_outbox').remaining_records,1)
  assert.equal(db.prepare("SELECT body FROM hiring_outbox WHERE id='draft'").get().body,'Private body')
  assert.equal(report.status,'partial');assert.equal(report.verification_code,'files_indexes_exports_backups_require_verification')
  assert.throws(()=>db.exec("UPDATE hiring_candidates SET name='Restored' WHERE id='candidate-brand'"),/erasure requested/)
  assert.ok(call('claim_communication','owner',{...scope,application_id:'app',draft_id:'draft',operation_id:'claim'}).every(n=>n===0))
  assert.throws(()=>call('add_application_note','owner',{...scope,application_id:'app',note_id:'note',body:'Restored PII',operation_id:'note'}),/erasure requested/)
  db.close()
})

test('in-flight sends require reconciliation before destructive core redaction',()=>{
  const {db,call}=seeded()
  call('create_communication_draft','owner',{...scope,application_id:'app',draft_id:'draft',recipient_email:'private@example.test',subject:'Private',body:'Private body',operation_id:'draft'})
  seedApprovedTemplates(db)
  call('queue_communication','owner',{...scope,application_id:'app',draft_id:'draft',operation_id:'queue'})
  call('claim_communication','owner',{...scope,application_id:'app',draft_id:'draft',operation_id:'claim'})
  assert.throws(()=>call('request_candidate_erasure','owner',input),/in-flight communication/)
  assert.equal(core(db).name,'Private Person');db.close()
})

test('script reconciles retries and lost commit responses, never trusting client owner role or write counts',async()=>{
  const {db,call}=seeded()
  const original=transport(call);const a=args(call)
  a.actions=async(name,params)=>{const value=await original(name,params);if(name==='request_candidate_erasure')throw Error('response lost with PRIVATE secret');return value}
  assert.equal((await requestErasure(a)).status,'partial')
  assert.equal((await requestErasure(args(call))).request_id,status(call).request_id)
  assert.equal(db.prepare('SELECT count(*) n FROM erasure_requests').get().n,1)
  assert.equal(db.prepare('SELECT count(*) n FROM processor_erasure_log').get().n,1)
  await assert.rejects(requestErasure({...args(call),identityVerified:false}),/Verify identity/)
  await assert.rejects(requestErasure({...args(call),actions:transport(call,'outsider'),role:'owner'}),/could not be confirmed/)
  db.close()
})
