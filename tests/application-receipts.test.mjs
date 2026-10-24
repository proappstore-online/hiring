import { test } from 'node:test'
import assert from 'node:assert/strict'
import { fixture, A, B, application } from './receipt-fixture.mjs'
import { dispatchCommunication } from '../scripts/outbox.mjs'

function configure(f, scope=A) {
 const p={...scope,template_id:'template-'+scope.brand_id,expected_version:0,name:'Receipt',subject:`Brand ${scope.brand_id} application received`,body:`Brand ${scope.brand_id} has saved your application. View status in your Hiring account.`,operation_id:'template-'+scope.brand_id}
 f.call('save_communication_template','owner',p)
 f.call('approve_communication_template','owner',{...p,expected_version:1,operation_id:'approve-'+scope.brand_id})
 assert.deepEqual(f.call('configure_application_receipt','owner',{...p,expected_version:1}),[1])
 return p
}
const receipt = f => f.db.prepare("SELECT * FROM hiring_outbox WHERE receipt_application_id='application-a'").get()
test('submission atomically creates one approved brand receipt; all submission retries preserve identity and payload',()=>{
 const f=fixture();configure(f);f.submit()
 const row=receipt(f)
 assert.equal(row.delivery_state,'pending');assert.equal(row.recipient_email,'candidate@example.com')
 assert.equal(row.subject,'Brand a application received');assert.equal(row.template_version,1)
 assert.equal(row.idempotency_key,row.operation_id)
 for(const input of [application(),{...application(),idempotency_key:'other',operation_id:'other',application_id:'other',candidate_id:'other'}]) f.call('submit_job_application','worker',input)
 assert.equal(f.db.prepare('SELECT count(*) n FROM hiring_outbox').get().n,1)
 assert.deepEqual(receipt(f),row)
 assert.equal(f.call('get_my_application_receipt','worker',{idempotency_key:'retry-a'})[0].receipt_delivery_state,'pending')
 assert.deepEqual(f.call('get_my_application_receipt','other-worker',{idempotency_key:'retry-a'}),[])
 assert.deepEqual(f.call('list_communication_drafts','staff-b',{...A,application_id:'application-a'}),[])
 f.db.close()
})
test('template selection requires exact current approved brand owner authority and brand identity',()=>{
 const f=fixture();const p=configure(f)
 for(const [user,input] of [['staff-a',p],['worker',p],['owner',{...p,brand_id:'b'}],['owner',{...p,expected_version:2}]]) assert.deepEqual(f.call('configure_application_receipt',user,{...input,expected_version:input.expected_version===2?2:1}),[0])
 f.call('save_communication_template','owner',{...p,expected_version:1,operation_id:'edit',body:'Changed Brand a text'})
 f.submit();assert.equal(receipt(f).delivery_state,'draft');assert.equal(receipt(f).template_id,null)
 assert.equal(f.call('get_my_requisition_receipt','worker',A)[0].receipt_delivery_state,'pending_setup')
 f.db.close()
})
test('missing MAIL setup saves application with inspectable pending setup and no send',()=>{
 const f=fixture();f.submit()
 assert.equal(receipt(f).delivery_state,'draft')
 assert.match(receipt(f).body,/Brand a/);assert.doesNotMatch(receipt(f).body,/owner|staff|Brand b/)
 assert.equal(f.call('claim_communication','owner',{...A,application_id:'application-a',draft_id:receipt(f).id,operation_id:'claim'}).at(-1),0)
 f.db.close()
})
test('receipt enqueue and application roll back together on audit failure',()=>{
 const f=fixture();configure(f);f.publish()
 f.db.exec("CREATE TRIGGER receipt_audit_failure BEFORE INSERT ON hiring_audit_events WHEN NEW.action='outbox.queued' BEGIN SELECT RAISE(ABORT,'audit unavailable'); END")
 assert.throws(()=>f.call('submit_job_application','worker',application()),/audit unavailable/)
 assert.equal(f.db.prepare('SELECT count(*) n FROM hiring_applications').get().n,0)
 assert.equal(f.db.prepare('SELECT count(*) n FROM hiring_outbox').get().n,0)
 f.db.close()
})
test('quota, outage, acceptance and timeout keep application saved and prevent duplicate attempts',async()=>{
 for(const result of [{outcome:'not_accepted',reason:'quota'},{outcome:'not_accepted',reason:'unavailable'},{outcome:'accepted'},null]) {
  const f=fixture();configure(f);f.submit();let sends=0
  const args={scope:{...A,application_id:'application-a'},draftId:receipt(f).id,actions:async(name,p)=>{const r=f.call(name,'owner',p);return name==='get_claimed_communication'?{rows:r}:{results:r.map(changes=>({meta:{changes}}))}},send:async(row,context)=>{sends++;assert.equal(context.idempotencyKey,receipt(f).idempotency_key);if(!result)throw Error('timeout');return result}}
  await dispatchCommunication(args);await dispatchCommunication(args)
  assert.equal(sends,1)
  assert.equal(f.call('get_my_application_receipt','worker',{idempotency_key:'retry-a'})[0].receipt_delivery_state,result?.outcome==='accepted'?'accepted':result?'failed':'unknown')
  assert.equal(f.db.prepare('SELECT stage FROM hiring_applications').get().stage,'submitted')
  if(result?.outcome!=='accepted') {
   f.call('reconcile_communication','owner',{...args.scope,draft_id:args.draftId,operation_id:'reconcile',outcome:'not_accepted',evidence:'Provider check'})
   assert.equal(f.db.prepare('SELECT count(*) n FROM hiring_outbox').get().n,1)
  }
  f.db.close()
 }
})
test('two branded receipts isolate payloads and bounded keys support maximum application identifiers',()=>{
 const f=fixture();configure(f);configure(f,B);f.publish()
 const p={...application(),application_id:'a'.repeat(128)}
 f.call('submit_job_application','worker',p);f.advance()
 f.call('submit_job_application','worker',{...application(B,'b'),email:'other@example.com'})
 const rows=f.db.prepare('SELECT * FROM hiring_outbox ORDER BY brand_id').all()
 assert.equal(rows.length,2)
 for(const r of rows) { assert.equal(r.delivery_state,'pending');assert.ok(r.idempotency_key.length<=128);assert.equal(r.subject,`Brand ${r.brand_id} application received`) }
 assert.equal(rows[0].recipient_email,'candidate@example.com');assert.equal(rows[1].recipient_email,'other@example.com')
 assert.throws(()=>f.db.prepare('DELETE FROM hiring_outbox WHERE id=?').run(rows[0].id),/durable/)
 assert.deepEqual(f.call('claim_communication','staff-b',{...A,application_id:p.application_id,draft_id:rows[0].id,operation_id:'forged'}),[0,0])
 f.db.close()
})

test('provider acceptance reconciliation is reflected in candidate receipt without a replacement',async()=>{
 const f=fixture();configure(f);f.submit()
 const scope={...A,application_id:'application-a',draft_id:receipt(f).id}
 f.call('claim_communication','owner',{...scope,operation_id:'claim'})
 f.call('complete_communication','owner',{...scope,claim_id:'claim',outcome:'unknown',delivery_reason:'reconcile_required',operation_id:'complete'})
 f.call('reconcile_communication','owner',{...scope,operation_id:'reconcile',outcome:'accepted',evidence:'Provider acceptance verified'})
 assert.equal(f.call('get_my_application_receipt','worker',{idempotency_key:'retry-a'})[0].receipt_delivery_state,'accepted')
 assert.equal(f.db.prepare('SELECT count(*) n FROM hiring_outbox').get().n,1)
 f.db.close()
})
