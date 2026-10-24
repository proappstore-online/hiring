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

function seeded() {
  const f = fixture()
  f.call('create_workspace', 'staff-a', bootstrap)
  f.call('create_linkedin_application', 'staff-a', candidate)
  return f
}

const base={tenant_id:'org-a',brand_id:'brand-a',application_id:'app-a',requisition_id:'req-a'}
const terms=JSON.stringify({compensation_type:'paid',subject:'Offer',body:'Paid employment terms'})
const draft={...base,terms_json:terms,expected_version:0,operation_id:'offer-1'}
const offer=f=>f.call('get_offer','staff-a',base)[0]
const step=(f,name,patch={})=>f.call(name,'staff-a',{tenant_id:'org-a',brand_id:'brand-a',offer_id:offer(f).id,expected_version:offer(f).lock_version,operation_id:name,...patch})
function ready(){const f=seeded();f.call('save_offer_draft','staff-a',draft);return f}
test('human decisions are attributed, immutable, scoped and versioned',()=>{
 for(const disposition of ['hired','rejected','withdrawn','deferred']){
  const f=seeded();try{
   if(disposition==='hired') { f.call('save_offer_draft','staff-a',draft);step(f,'submit_offer_for_approval');step(f,'approve_offer') }
   f.db.exec("UPDATE hiring_applications SET stage='"+(disposition==='hired'?'offered':'in_review')+"' WHERE id='app-a'")
   const args={...base,disposition,rationale:'Reviewed by hiring staff',expected_version:1,operation_id:'decision'}
   assert.equal(f.call('record_decision','staff-a',args).at(-1),1)
   const rows=f.call('list_application_decisions','staff-a',base);assert.equal(rows.length,1);assert.equal(rows[0].actor_id,'staff-a')
   assert.ok(f.call('record_decision','staff-a',args).every(n=>n===0))
   assert.deepEqual(f.call('list_application_decisions','outsider',base),[])
   assert.throws(()=>f.db.exec('DELETE FROM hiring_decisions'),/append-only/)
   assert.throws(()=>f.db.exec("UPDATE hiring_decisions SET rationale='changed'"),/append-only/)
  }finally{f.db.close()}
 }
})
test('automated and forged actor claims cannot decide or approve',()=>{
 const f=ready();try{
 for(const actor_role of ['system','automation','api_key','reviewer'])assert.ok(f.call('record_decision','staff-a',{...base,disposition:'deferred',actor_role,expected_version:1,operation_id:'forged'}).every(n=>n===0))
 assert.ok(f.call('record_decision','staff-a',{...base,disposition:'deferred',actor_id:'someone-else',expected_version:1,operation_id:'forged'}).every(n=>n===0))
 assert.ok(f.call('record_decision','system:worker',{...base,disposition:'deferred',expected_version:1,operation_id:'system'}).every(n=>n===0))
 step(f,'submit_offer_for_approval')
 assert.ok(step(f,'approve_offer',{actor_role:'automation'}).every(n=>n===0));assert.equal(offer(f).status,'pending_approval')
 for(const name of ['record_decision','approve_offer','submit_offer_for_approval','revoke_offer','authorize_offer_dispatch','change_application_stage'])assert.equal(action(name).step_up,true)
 }finally{f.db.close()}
})
test('offer revisions, optimistic locking, approval and revocation preserve evidence',()=>{
 const f=ready();try{
 assert.equal(offer(f).current_version,1)
 assert.throws(()=>step(f,'approve_offer'),/approval conflict/)
 assert.ok(f.call('save_offer_draft','staff-a',{...draft,operation_id:'stale'}).every(n=>n===0))
 assert.equal(f.call('save_offer_draft','staff-a',{...draft,expected_version:1,operation_id:'offer-2'}).at(-1),1)
 assert.equal(offer(f).current_version,2)
 step(f,'submit_offer_for_approval');assert.equal(offer(f).status,'pending_approval')
 step(f,'approve_offer');assert.equal(offer(f).status,'approved')
 assert.ok(step(f,'approve_offer',{expected_version:1,operation_id:'stale-approval'}).every(n=>n===0))
 assert.ok(f.call('save_offer_draft','staff-a',{...draft,expected_version:4,operation_id:'locked'}).every(n=>n===0))
 step(f,'revoke_offer');assert.equal(offer(f).status,'revoked')
 assert.throws(()=>step(f,'approve_offer',{operation_id:'reapprove'}),/approval conflict/)
 assert.equal(f.db.prepare('SELECT count(*) n FROM hiring_offer_approval_events').get().n,3)
 assert.equal(f.db.prepare("SELECT count(*) n FROM hiring_audit_events WHERE action LIKE 'offer.%'").get().n,5)
 assert.throws(()=>f.db.exec('DELETE FROM hiring_offer_versions'),/append-only/)
 assert.throws(()=>f.db.exec('DELETE FROM hiring_offer_approval_events'),/append-only/)
 }finally{f.db.close()}
})
function communication(f){f.call('create_communication_draft','staff-a',{...scope,application_id:'app-a',draft_id:'message',recipient_email:'a@example.com',subject:'Offer',body:'Paid employment terms',operation_id:'message-op'})}
test('dispatch requires approved paid exact revision and payload; revocation blocks queued jobs',()=>{
 for(const compensation_type of ['paid','unpaid','internship','volunteer']){
 const f=seeded();try{
 f.call('save_offer_draft','staff-a',{...draft,terms_json:JSON.stringify({...JSON.parse(terms),compensation_type})});communication(f)
 assert.throws(()=>step(f,'authorize_offer_dispatch',{draft_id:'message'}),/unapproved or unpaid/)
 step(f,'submit_offer_for_approval');step(f,'approve_offer')
 if(compensation_type!=='paid'){assert.throws(()=>step(f,'authorize_offer_dispatch',{draft_id:'message'}),/unapproved or unpaid/);continue}
 assert.equal(step(f,'authorize_offer_dispatch',{draft_id:'message'}).at(-1),1)
 const queue={...scope,application_id:'app-a',draft_id:'message',operation_id:'queue'}
 assert.equal(f.call('queue_communication','staff-a',queue).at(-1),1)
 step(f,'revoke_offer')
 assert.throws(()=>f.call('claim_communication','staff-a',{...queue,operation_id:'claim'}),/not authorized/)
 assert.equal(f.db.prepare("SELECT delivery_state FROM hiring_outbox WHERE id='message'").get().delivery_state,'pending')
 }finally{f.db.close()}
 }
})
test('cross-brand IDs, revoked grants, stale operations and audit outages are denied atomically',()=>{
 const f=ready();try{
 const args={tenant_id:'org-a',brand_id:'brand-b',offer_id:offer(f).id,expected_version:1,operation_id:'forged'}
 assert.deepEqual(f.call('get_offer','staff-a',args),[])
 assert.ok(f.call('submit_offer_for_approval','staff-a',args).every(n=>n===0))
 assert.ok(f.call('submit_offer_for_approval','outsider',{...args,brand_id:'brand-a'}).every(n=>n===0))
 assert.ok(f.call('save_offer_draft','staff-a',{...draft,expected_version:1}).every(n=>n===0))
 f.db.exec("CREATE TRIGGER fail_offer_audit BEFORE INSERT ON hiring_audit_events WHEN NEW.action LIKE 'offer.%' BEGIN SELECT RAISE(ABORT,'audit unavailable'); END")
 assert.throws(()=>step(f,'submit_offer_for_approval'),/audit unavailable/);assert.equal(offer(f).status,'draft')
 assert.equal(f.db.prepare('SELECT count(*) n FROM hiring_offer_approval_events').get().n,0)
 }finally{f.db.close()}
})

test('exact retries return committed records, conflicting replays never claim another action succeeded',()=>{
 const f=ready();try{
 f.call('save_offer_draft','staff-a',draft);assert.equal(f.call('get_offer_draft_result','staff-a',draft)[0].version,1)
 assert.deepEqual(f.call('get_offer_draft_result','staff-a',{...draft,terms_json:terms.replace('Paid','Different')}),[])
 step(f,'submit_offer_for_approval')
 const submitted=f.db.prepare("SELECT * FROM hiring_offer_approval_events WHERE event_type='submitted'").get()
 const args={offer_id:offer(f).id,tenant_id:'org-a',brand_id:'brand-a',expected_version:submitted.lock_version,operation_id:submitted.operation_id}
 assert.equal(f.call('get_offer_submission_result','staff-a',args)[0].event_type,'submitted')
 assert.deepEqual(f.call('get_offer_approval_result','staff-a',args),[])
 assert.equal(offer(f).status,'pending_approval')
 }finally{f.db.close()}
})
test('final dispositions and offer payloads cannot bypass approval or immutability',()=>{
 const f=ready();try{
 f.db.exec("UPDATE hiring_applications SET stage='offered' WHERE id='app-a'")
 assert.throws(()=>f.call('record_decision','staff-a',{...base,disposition:'hired',expected_version:1,operation_id:'unapproved-hire'}),/approved paid/)
 step(f,'submit_offer_for_approval');step(f,'approve_offer');communication(f)
 step(f,'authorize_offer_dispatch',{draft_id:'message'})
 assert.throws(()=>f.db.exec("UPDATE hiring_outbox SET recipient_email='other@example.com' WHERE id='message'"),/immutable/)
 assert.throws(()=>f.db.exec("UPDATE hiring_outbox SET body='different terms' WHERE id='message'"),/immutable/)
 f.call('record_decision','staff-a',{...base,disposition:'rejected',expected_version:1,operation_id:'reject'})
 assert.throws(()=>f.call('queue_communication','staff-a',{...scope,application_id:'app-a',draft_id:'message',operation_id:'terminal-queue'}),/terminal/)
 assert.throws(()=>f.call('record_decision','staff-a',{...base,disposition:'hired',expected_version:2,operation_id:'second-final'}))
 }finally{f.db.close()}
})

test('actual sibling grants, reviewer assignments and suspended organizations confer no decision authority',()=>{
 const f=ready();try{
 const b={organization_id:'org-a',brand_id:'brand-b',requisition_id:'req-b'}
 f.call('create_workspace','staff-a',{...bootstrap,...b,operation_id:'boot-b'})
 f.call('add_workspace_member','staff-a',{...b,member_user_id:'staff-b',role:'recruiter',operation_id:'grant-b'})
 const args={tenant_id:'org-a',brand_id:'brand-a',offer_id:offer(f).id,expected_version:1,operation_id:'sibling'}
 assert.deepEqual(f.call('get_offer','staff-b',args),[])
 assert.ok(f.call('submit_offer_for_approval','staff-b',args).every(n=>n===0))
 f.call('grant_workspace_access','staff-a',{...scope,member_user_id:'reviewer',role:'reviewer',requisition_id:'req-a',grant_id:'reviewer',operation_id:'review-grant'})
 assert.deepEqual(f.call('get_offer','reviewer',args),[])
 assert.ok(f.call('record_decision','reviewer',{...base,disposition:'deferred',expected_version:1,operation_id:'review-decision'}).every(n=>n===0))
 f.db.exec("UPDATE hiring_organizations SET status='suspended' WHERE id='org-a'")
 assert.deepEqual(f.call('get_offer','staff-a',args),[])
 assert.ok(f.call('submit_offer_for_approval','staff-a',args).every(n=>n===0))
 }finally{f.db.close()}
})

test('registered mutation batches contain only deployable write statements',()=>{
 for(const t of tools.filter(t=>t.operation==='batch')) for(const statement of t.statements) assert.match(statement,/^(INSERT|UPDATE|DELETE)\s/i,t.name)
})

const acceptanceArgs={...base,expected_version:1,operation_id:'acceptance',acceptance_evidence:'Candidate explicitly accepted paid terms by signed response'}
function acceptanceReady(){const f=ready();step(f,'submit_offer_for_approval');step(f,'approve_offer');f.db.exec("UPDATE hiring_applications SET stage='offered' WHERE id='app-a'");return f}
test('acceptance commits explicit evidence, canonical reads, filtering and exact replay once',()=>{
 const f=acceptanceReady();try{
 assert.equal(action('record_acceptance').step_up,true)
 assert.equal(f.call('record_acceptance','staff-a',acceptanceArgs)[0],1)
 const row=f.call('get_acceptance_result','staff-a',acceptanceArgs)[0];assert.equal(row.stage,'accepted');assert.equal(row.version,2)
 assert.ok(f.call('record_acceptance','staff-a',acceptanceArgs).every(n=>n===0))
 assert.deepEqual(f.call('get_acceptance_result','staff-a',acceptanceArgs)[0],row)
 assert.equal(f.call('get_acceptance_result','staff-a',{...acceptanceArgs,acceptance_evidence:'different'}).length,0)
 for(const name of ['list_applications','gateway_list_applications']){assert.equal(f.call(name,'staff-a',{...scope,stage:'accepted'})[0].stage,'accepted');assert.equal(f.call(name,'staff-a',{...scope,stage:'offered'}).length,0)}
 for(const name of ['get_application','gateway_get_application'])assert.equal(f.call(name,'staff-a',{...scope,application_id:'app-a'})[0].acceptance_evidence,acceptanceArgs.acceptance_evidence)
 const event=f.db.prepare("SELECT * FROM hiring_stage_events WHERE id='acceptance'").get();assert.equal(event.from_stage,'offered');assert.equal(event.to_stage,'accepted');assert.equal(event.actor_user_id,'staff-a');assert.equal(event.reason,acceptanceArgs.acceptance_evidence)
 assert.equal(f.db.prepare("SELECT count(*) n FROM hiring_audit_events WHERE operation_id='acceptance'").get().n,1)
 assert.throws(()=>f.db.exec("UPDATE hiring_applications SET acceptance_evidence='forged'"),/controlled/)
 assert.throws(()=>f.call('record_decision','staff-a',{...base,disposition:'deferred',expected_version:2,operation_id:'after-accept'}),/terminal/)
 }finally{f.db.close()}
})
test('acceptance denies unauthorized, cross-brand, stale, blank, unapproved and non-offered requests',()=>{
 const f=acceptanceReady();try{
 for(const patch of [{expected_version:0},{brand_id:'brand-b'},{tenant_id:'other'},{acceptance_evidence:' '},{operation_id:' '}])assert.equal(f.call('record_acceptance','staff-a',{...acceptanceArgs,...patch})[0],0)
 f.call('grant_workspace_access','staff-a',{...scope,member_user_id:'reviewer',role:'reviewer',requisition_id:'req-a',grant_id:'reviewer',operation_id:'review-grant'})
 f.call('create_workspace','staff-a',{...bootstrap,brand_id:'brand-b',requisition_id:'req-b',operation_id:'sibling-bootstrap'});f.call('add_workspace_member','staff-a',{...scope,brand_id:'brand-b',member_user_id:'sibling',role:'recruiter',operation_id:'sibling-member'});
 for(const user of ['reviewer','outsider','system:worker','sibling'])assert.equal(f.call('record_acceptance',user,acceptanceArgs)[0],0)
 for(const stage of ['submitted','interviewing','decision_pending']){f.db.prepare('UPDATE hiring_applications SET stage=?').run(stage);assert.equal(f.call('record_acceptance','staff-a',acceptanceArgs)[0],0)}
 f.db.exec("UPDATE hiring_applications SET stage='offered'");step(f,'revoke_offer');assert.equal(f.call('record_acceptance','staff-a',acceptanceArgs)[0],0)
 }finally{f.db.close()}
})
test('acceptance audit failure rolls back evidence, history and version',()=>{
 const f=acceptanceReady();try{
 f.db.exec("CREATE TRIGGER fail_acceptance BEFORE INSERT ON hiring_audit_events WHEN NEW.action='application.accepted' BEGIN SELECT RAISE(ABORT,'audit unavailable'); END")
 assert.throws(()=>f.call('record_acceptance','staff-a',acceptanceArgs),/audit unavailable/)
 assert.equal(f.db.prepare('SELECT count(*) n FROM hiring_acceptances').get().n,0)
 const a=f.call('get_application','staff-a',{...scope,application_id:'app-a'})[0];assert.equal(a.stage,'offered');assert.equal(a.version,1);assert.equal(a.acceptance_evidence,null)
 }finally{f.db.close()}
})
test('additive acceptance upgrade preserves existing submitted and interview states without inferred evidence',()=>{
 const db=new DatabaseSync(':memory:');try{
 const acceptanceIndex=migrations.migrations.findIndex(m=>m.name.startsWith('0028_'))
 assert.ok(acceptanceIndex>0)
 for(const m of migrations.migrations.slice(0,acceptanceIndex))db.exec(m.sql)
 // Seed via old-schema registered actions that do not reference new columns.
 db.exec("INSERT INTO hiring_organizations(id,name,created_by,created_at) VALUES('org','Org','owner',1)")
 db.exec("INSERT INTO hiring_brands(id,organization_id,name,created_at) VALUES('brand','org','Brand',1)")
 db.exec("INSERT INTO hiring_requisitions(id,organization_id,brand_id,title,status,created_at) VALUES('req','org','brand','Role','draft',1)")
 db.exec("INSERT INTO hiring_candidates(id,organization_id,brand_id,name,email,phone,linkedin_url,created_by,created_at) VALUES('candidate','org','brand','Person','','','','owner',1)")
 for(const stage of ['submitted','interviewing','decision_pending'])db.prepare("INSERT INTO hiring_applications(id,organization_id,brand_id,requisition_id,candidate_id,source,source_detail,basis_reference,contact_context,assignee_user_id,stage,created_by,created_at,updated_at) VALUES(?,'org','brand','req','candidate','linkedin','source','basis','context','owner',?,'owner',1,1)").run(stage,stage)
 db.exec(migrations.migrations[acceptanceIndex].sql)
 for(const row of db.prepare('SELECT * FROM hiring_applications').all()){assert.equal(row.stage,row.id);assert.equal(row.accepted_stage,null);assert.equal(row.acceptance_evidence,null);assert.equal(row.version,1)}
 }finally{db.close()}
})


test('failed offer reconciliation preserves the immutable one-draft authorization gate',()=>{
 const f=ready();try{
 step(f,'submit_offer_for_approval');step(f,'approve_offer');communication(f)
 step(f,'authorize_offer_dispatch',{draft_id:'message'})
 const message={...scope,application_id:'app-a',draft_id:'message'}
 f.call('queue_communication','staff-a',{...message,operation_id:'queue'})
 f.call('claim_communication','staff-a',{...message,operation_id:'claim'})
 f.call('complete_communication','staff-a',{...message,operation_id:'complete',claim_id:'claim',outcome:'failed'})
 f.call('reconcile_communication','staff-a',{...message,operation_id:'recover',outcome:'not_accepted',evidence:'Provider rejected before acceptance'})
 const recovery=f.call('get_communication_reconciliation','staff-a',message)[0]
 assert.equal(recovery.replacement_draft_id,null)
 assert.equal(f.db.prepare('SELECT count(*) n FROM hiring_outbox').get().n,1)
 assert.ok(f.call('claim_communication','staff-a',{...message,operation_id:'old-retry'}).every(n=>n===0))
 assert.equal(f.db.prepare("SELECT count(*) n FROM hiring_outbox WHERE delivery_state='sending'").get().n,0)
 }finally{f.db.close()}
})
