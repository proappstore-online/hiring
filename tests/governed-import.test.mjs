import test from 'node:test'
import assert from 'node:assert/strict'
import {fixture,A,B} from './receipt-fixture.mjs'
import {dispatchImportWebhook,dispatchImportWebhookQueue,verifyImportWebhook} from '../worker/import-webhooks.mjs'
const scope={...A,installation_id:'installation'}
const input={...scope,batch_id:'batch',source_reference:'source-v1',basis_reference:'public-job-data-no-candidate-consent',rows_json:JSON.stringify([{source_id:'1',title:'Engineer'},{source_id:'2',title:'Designer'}])}
function setup() {
 const f=fixture()
 for(const capability of ['import','outbound_webhooks']) f.db.prepare("INSERT INTO hiring_integration_approvals(id,organization_id,brand_id,installation_id,capability,contract_version,evidence_reference,endpoint,secret_ref,source_reference,basis_reference,expires_at,revoked_at) VALUES(?,?,?,?,?,'requisition-import-v1','review-v1','https://receiver.example/events','secret','source-v1','public-job-data-no-candidate-consent',2000000000,NULL)").run(capability,'org','a','installation',capability)
 return f
}
const count=f=>f.db.prepare("SELECT count(*) n FROM hiring_requisitions WHERE operation_id='import-batch'").get().n
const sub=f=>f.call('subscribe_import_webhooks','owner',{...scope,subscription_id:'sub',approval_id:'outbound_webhooks'})
const worker=(f)=>async(name,p)=>{const r=f.call(name,'system:worker',p);return ['read_import_webhook','list_import_webhook_queue'].includes(name)?{rows:r}:{results:r.map(changes=>({meta:{changes}}))}}
test('dry run validates isolated mapping, malformed input and forged row claims without writes',()=>{
 const f=setup();try {
  assert.deepEqual(f.call('dry_run_requisition_import','owner',input),[])
  for(const value of ['{','null','[]',JSON.stringify([{source_id:'1',title:'OK',organization_id:'victim'}]),JSON.stringify([{source_id:'1',title:''}]),JSON.stringify([{source_id:'1',title:'A'},{source_id:'1',title:'B'}])]) {
   assert.ok(f.call('dry_run_requisition_import','owner',{...input,rows_json:value}).length)
   f.call('commit_requisition_import','owner',{...input,rows_json:value});assert.equal(count(f),0)
  }
  for(const field of ['source_reference','basis_reference']) {f.call('commit_requisition_import','owner',{...input,[field]:'forged'});assert.equal(count(f),0)}
  for(const user of ['worker','staff-a','outsider']) {f.call('commit_requisition_import',user,input);assert.equal(count(f),0)}
  f.call('commit_requisition_import','owner',{...input,...B});assert.equal(count(f),0)
  f.call('commit_requisition_import','owner',{...input,installation_id:'forged'});assert.equal(count(f),0)
 }finally{f.db.close()}
})
test('import, provenance, duplicates and guarded rollback are atomic and tenant scoped',()=>{
 const f=setup();try {
  sub(f);f.call('commit_requisition_import','owner',input);assert.equal(count(f),2)
  f.call('commit_requisition_import','owner',input);assert.equal(count(f),2)
  assert.equal(f.db.prepare('SELECT count(*) n FROM hiring_webhook_deliveries').get().n,1)
  f.db.exec("UPDATE hiring_requisitions SET title='Edited' WHERE id='import-batch-0'")
  f.call('rollback_requisition_import','owner',input);assert.equal(count(f),2)
  f.db.exec("UPDATE hiring_requisitions SET title='Engineer' WHERE id='import-batch-0'")
  f.call('rollback_requisition_import','owner',{...input,...B});assert.equal(count(f),2)
  f.call('rollback_requisition_import','owner',input);assert.equal(count(f),0)
  assert.equal(f.db.prepare('SELECT count(*) n FROM hiring_webhook_deliveries').get().n,2)
  assert.equal(f.db.prepare("SELECT count(*) n FROM hiring_audit_events WHERE action LIKE 'import.%'").get().n,2)
 }finally{f.db.close()}
})
test('a failure after one inserted row rolls back the entire import, audit and outbox',()=>{
 const f=setup();try {
  sub(f);f.db.exec("CREATE TRIGGER fail_import BEFORE INSERT ON hiring_requisitions WHEN NEW.title='Designer' BEGIN SELECT RAISE(ABORT,'simulated storage failure'); END")
  assert.throws(()=>f.call('commit_requisition_import','owner',input),/simulated/)
  assert.equal(count(f),0)
  for(const table of ['hiring_import_batches','hiring_import_rows','hiring_webhook_deliveries']) assert.equal(f.db.prepare(`SELECT count(*) n FROM ${table}`).get().n,0)
  assert.equal(f.db.prepare("SELECT count(*) n FROM hiring_audit_events WHERE action='import.committed'").get().n,0)
 }finally{f.db.close()}
})
test('missing, expired, revoked, sibling and wrong-brand approvals deny import and subscription',()=>{
 const f=setup();try {
  for(const mutate of ["UPDATE hiring_integration_approvals SET expires_at=1", "UPDATE hiring_integration_approvals SET revoked_at=1", "DELETE FROM hiring_integration_approvals"]){f.db.exec(mutate);f.call('commit_requisition_import','owner',input);sub(f);assert.equal(count(f),0);assert.equal(f.db.prepare('SELECT count(*) n FROM hiring_webhook_subscriptions').get().n,0)}
 }finally{f.db.close()}
})
test('signed minimized webhooks retry with stable event id, bounded attempts and receiver verification',async()=>{
 const f=setup();try {
  sub(f);f.call('commit_requisition_import','owner',input)
  const deliveryId='sub|batch|import.committed';const secret='s'.repeat(32);const sent=[]
  const processed=new Set()
  const options={actions:worker(f),scope,deliveryId,secrets:async()=>secret,now:()=>1000000000,transport:async r=>{sent.push(r);processed.add(JSON.parse(r.body).id);return {status:sent.length===1?503:204}}}
  assert.equal(await dispatchImportWebhook(options),'retry_or_dead')
  assert.equal(await dispatchImportWebhook(options),'not_claimed')
  f.advance(180000);assert.equal(await dispatchImportWebhook(options),'sent')
  assert.equal(sent[0].body,sent[1].body)
  assert.equal(processed.size,1)
  assert.deepEqual(Object.keys(JSON.parse(sent[0].body)),['version','id','type','row_count'])
  const request=sent[0],verify={secret,body:request.body,signature:request.headers['x-hiring-signature'],timestamp:request.headers['x-hiring-timestamp'],now:1000000000}
  assert.equal(await verifyImportWebhook(verify),true)
  assert.equal(await verifyImportWebhook({...verify,body:'forged'}),false)
  assert.equal(await verifyImportWebhook({...verify,now:1000400000}),false)
  assert.equal(await dispatchImportWebhook(options),'not_claimed')
 }finally{f.db.close()}
})
test('revocation before egress, forged scope, and non-worker claims prevent transport',async()=>{
 const f=setup();try {
  sub(f);f.call('commit_requisition_import','owner',input)
  const p={...scope,delivery_id:'sub|batch|import.committed',claim_id:'forged'}
  assert.deepEqual(f.call('claim_import_webhook','owner',p),[0])
  assert.deepEqual(f.call('claim_import_webhook','system:worker',{...p,...B}),[0])
  let sent=0
  await dispatchImportWebhook({actions:worker(f),scope,deliveryId:p.delivery_id,secrets:async()=>{f.call('revoke_import_webhooks','owner',{...scope,subscription_id:'sub'});return 's'.repeat(32)},transport:async()=>{sent++;return {status:204}}})
  assert.equal(sent,0)
 }finally{f.db.close()}
})
test('five failed deliveries stop; duplicate claims and stale completion cannot overwrite a claim',async()=>{
 const f=setup();try {
  sub(f);f.call('commit_requisition_import','owner',input)
  const options={actions:worker(f),scope,deliveryId:'sub|batch|import.committed',secrets:async()=> 's'.repeat(32),transport:async()=>{throw Error('timeout')}}
  for(let i=0;i<5;i++){assert.equal(await dispatchImportWebhook(options),'retry_or_dead');f.advance(4000000)}
  assert.equal(await dispatchImportWebhook(options),'not_claimed')
  assert.equal(f.db.prepare('SELECT state FROM hiring_webhook_deliveries').get().state,'dead')
 }finally{f.db.close()}
})
test('retry denies expired approvals and revoked owner grants; stalled claims are fenced',()=>{
 const f=setup();try {
  sub(f);f.call('commit_requisition_import','owner',input)
  const p={...scope,delivery_id:'sub|batch|import.committed',claim_id:'first'}
  assert.deepEqual(f.call('claim_import_webhook','system:worker',p),[1])
  assert.deepEqual(f.call('claim_import_webhook','system:worker',{...p,claim_id:'concurrent'}),[0])
  f.advance(300001)
  assert.deepEqual(f.call('claim_import_webhook','system:worker',{...p,claim_id:'second'}),[1])
  assert.deepEqual(f.call('finish_import_webhook','system:worker',{...p,success:1}),[0])
  const current={...p,claim_id:'second'}
  assert.equal(f.call('read_import_webhook','system:worker',current).length,1)
  f.db.exec("UPDATE hiring_integration_approvals SET expires_at=1 WHERE capability='outbound_webhooks'")
  assert.deepEqual(f.call('read_import_webhook','system:worker',current),[])
  f.db.exec("UPDATE hiring_integration_approvals SET expires_at=2000000000; DELETE FROM hiring_memberships WHERE user_id='owner' AND brand_id='a'; UPDATE hiring_grants SET status='revoked' WHERE user_id='owner'")
  assert.deepEqual(f.call('read_import_webhook','system:worker',current),[])
 }finally{f.db.close()}
})
test('operational reads and duplicate dataset revisions do not disclose another scope',()=>{
 const f=setup();try {
  sub(f);f.call('commit_requisition_import','owner',input)
  f.call('commit_requisition_import','owner',{...input,batch_id:'retry-with-new-id'})
  assert.equal(count(f),2)
  assert.equal(f.db.prepare('SELECT count(*) n FROM hiring_import_batches').get().n,1)
  assert.equal(f.call('get_requisition_import','owner',input).length,1)
  assert.equal(f.call('list_import_webhook_deliveries','owner',scope).length,1)
  for(const user of ['staff-a','worker','outsider']){
   assert.deepEqual(f.call('get_requisition_import',user,input),[])
   assert.deepEqual(f.call('list_import_webhook_deliveries',user,scope),[])
   assert.deepEqual(f.call('dry_run_requisition_import',user,input),[{row_index:-1,code:'forbidden'}])
  }
  assert.deepEqual(f.call('get_requisition_import','owner',{...input,...B}),[])
  f.db.exec("UPDATE hiring_requisitions SET operation_id=NULL WHERE id='import-batch-0'")
  f.call('rollback_requisition_import','owner',input)
  assert.equal(f.db.prepare("SELECT count(*) n FROM hiring_requisitions WHERE id LIKE 'import-batch-%'").get().n,2)
 }finally{f.db.close()}
})

test('bounded worker queue discovers due deliveries only in approved installation scope',async()=>{
 const f=setup();try {
  sub(f);f.call('commit_requisition_import','owner',input)
  assert.deepEqual(f.call('list_import_webhook_queue','owner',scope),[])
  assert.deepEqual(f.call('list_import_webhook_queue','system:worker',{...scope,...B}),[])
  const result=await dispatchImportWebhookQueue({actions:worker(f),scope,secrets:async()=> 's'.repeat(32),transport:async()=>({status:204})})
  assert.deepEqual(result,{attempted:1,outcomes:['sent']})
  assert.deepEqual(f.call('list_import_webhook_queue','system:worker',scope),[])
 }finally{f.db.close()}
})
