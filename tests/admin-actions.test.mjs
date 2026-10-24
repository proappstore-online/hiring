import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
const migrations=JSON.parse(readFileSync(new URL('../migrations.json',import.meta.url))).migrations
const tools=JSON.parse(readFileSync(new URL('../mcp.json',import.meta.url))).tools
const scope={organization_id:'org',brand_id:'brand'}
function fixture(){
 const db=new DatabaseSync(':memory:');db.exec('PRAGMA foreign_keys=ON');for(const m of migrations)db.exec(m.sql)
 function call(name,user='owner',values={},now=1000){
 const t=tools.find(t=>t.name===name);assert.ok(t)
 const params={...Object.fromEntries(Object.entries(t.params).filter(([,p])=>p.optional).map(([k])=>[k,null])),...values,__user_id:user,__now:now,__uuid:crypto.randomUUID()}
 db.exec('BEGIN');try{const results=(t.statements??[t.sql]).map(sql=>{const args=[];sql=sql.replace(/:([a-z_][a-z0-9_]*)/gi,(_,k)=>{assert.notEqual(params[k],undefined,k);args.push(params[k]);return'?'});return t.operation==='query'?db.prepare(sql).all(...args).map(r=>({...r})):db.prepare(sql).run(...args).changes});db.exec('COMMIT');return t.operation==='query'?results[0]:results}catch(e){db.exec('ROLLBACK');throw e}
 }
 for(const brand of ['brand','other'])call('create_workspace','owner',{organization_id:'org',brand_id:brand,requisition_id:'req-'+brand,organization_name:'Org',brand_name:brand,requisition_title:'Engineer',operation_id:'workspace-'+brand})
 for(const [user,role,req]of [['recruiter','recruiter',null],['narrow','recruiter','req-brand'],['auditor','auditor','req-brand'],['reviewer','reviewer',null]])call('grant_workspace_access','owner',{...scope,member_user_id:user,role,requisition_id:req,grant_id:'grant-'+user,operation_id:'grant-'+user})
 return{db,call}
}
const template=(patch={})=>({...scope,template_id:'template',name:'Greeting',subject:'Hello',body:'Thank you',expected_version:0,operation_id:crypto.randomUUID(),...patch})
test('templates enforce brand-wide roles, scope, optimistic concurrency and replay',()=>{
 const{db,call}=fixture()
 for(const user of ['outsider','narrow','reviewer','auditor']){assert.deepEqual(call('save_communication_template',user,template()),[0,0,0]);assert.deepEqual(call('list_communication_templates',user,scope),[])}
 assert.deepEqual(call('save_communication_template','recruiter',template()),[1,0,1])
 const edit=template({expected_version:1,body:'Edited'});assert.deepEqual(call('save_communication_template','owner',edit),[0,1,1]);assert.deepEqual(call('save_communication_template','owner',edit),[0,0,0]);assert.deepEqual(call('save_communication_template','owner',template({expected_version:1})),[0,0,0])
 assert.equal(call('list_communication_templates','owner',scope)[0].body,'Edited');assert.deepEqual(call('list_communication_templates','owner',{...scope,brand_id:'other'}),[])
 assert.deepEqual(call('save_communication_template','owner',template({brand_id:'other',expected_version:2})),[0,0,0])
 assert.equal(db.prepare("SELECT count(*) n FROM hiring_audit_events WHERE action='communication.template_saved'").get().n,2)
 db.close()
})
test('template audit failure rolls back content and version',()=>{
 const{db,call}=fixture();call('save_communication_template','owner',template());db.exec("CREATE TRIGGER fail_template_audit BEFORE INSERT ON hiring_audit_events WHEN NEW.action='communication.template_saved' BEGIN SELECT RAISE(ABORT,'synthetic'); END")
 assert.throws(()=>call('save_communication_template','owner',template({expected_version:1,body:'Changed'})),/synthetic/)
 assert.equal(call('list_communication_templates','owner',scope)[0].version,1);db.close()
})
test('diagnostics return only authorized metadata, never source URLs or candidate content',()=>{
 const{db,call}=fixture()
 for(const brand of ['brand','other']){
 const s={organization_id:'org',brand_id:brand};call('create_application','owner',{...s,requisition_id:'req-'+brand,candidate_id:'candidate-'+brand,application_id:'app-'+brand,operation_id:'application-'+brand,candidate_name:'SECRET NAME',email:'private@example.test',phone:'',source:'manual',profile_url:'',source_detail:'Synthetic',basis_reference:'Policy',contact_context:'Synthetic',assignee_user_id:'owner'})
 call('record_agent_activity','owner',{...s,application_id:'app-'+brand,activity_id:'activity-'+brand,activity_type:'email_thread_scanned',source_url:'https://example.test/SECRET?email=PRIVATE',summary:'CANDIDATE CONTENT',occurred_at:1000,agent_instance_id:'agent-1',operation_id:'activity-'+brand})
 }
 for(const user of ['owner','recruiter','narrow','auditor']){
 const rows=call('list_operational_diagnostics',user,scope);assert.equal(rows.length,1);assert.deepEqual(Object.keys(rows[0]).sort(),['action','agent_instance_id','id','occurred_at','outcome']);assert.equal(rows[0].outcome,'unknown');assert.doesNotMatch(JSON.stringify(rows),/SECRET|PRIVATE|CANDIDATE|source_url|summary/)
 }
 for(const user of ['outsider','reviewer'])assert.deepEqual(call('list_operational_diagnostics',user,scope),[])
 assert.deepEqual(call('list_operational_diagnostics','auditor',{...scope,brand_id:'other'}),[]);db.close()
})
test('workspace capabilities distinguish requisition grants from brand-wide authority',()=>{
 const{db,call}=fixture();const narrow=call('list_my_workspaces','narrow')[0];assert.equal(narrow.can_manage_templates,0);assert.equal(narrow.can_create_requisition,0);assert.equal(call('list_my_workspaces','recruiter')[0].can_manage_templates,1);db.close()
})

test('operational health aggregates exact permitted requisitions and never returns candidate content',()=>{
 const {db,call}=fixture()
 call('create_requisition','owner',{...scope,requisition_id:'restricted',title:'Restricted',operation_id:'restricted'})
 function attempt(brand,req,id,state) {
   const s={organization_id:'org',brand_id:brand,application_id:'app-'+id}
   call('create_application','owner',{...s,requisition_id:req,candidate_id:'candidate-'+id,operation_id:'application-'+id,candidate_name:'SECRET NAME',email:'private@example.test',phone:'',source:'manual',profile_url:'',source_detail:'PRIVATE',basis_reference:'Policy',contact_context:'PRIVATE',assignee_user_id:'owner'})
   const p={...s,draft_id:id}
   call('create_communication_draft','owner',{...p,recipient_email:'private@example.test',subject:'SECRET SUBJECT',body:'SECRET BODY',operation_id:'draft-'+id})
   assert.equal(call('queue_communication','owner',{...p,operation_id:'queue-'+id}).at(-1),1)
   if(state!=='pending') {
     assert.equal(call('claim_communication','owner',{...p,operation_id:'claim-'+id},2000).at(-1),1)
     if(state!=='sending')call('complete_communication','owner',{...p,claim_id:'claim-'+id,outcome:state,operation_id:'complete-'+id},3000)
   }
   return p
 }
 for(const state of ['pending','sending','failed','unknown'])attempt('brand','req-brand',state,state)
 attempt('other','req-other','other','unknown');attempt('brand','restricted','restricted','unknown')
 const reconciled=attempt('brand','req-brand','reconciled','unknown')
 call('reconcile_communication','owner',{...reconciled,operation_id:'reconcile',outcome:'accepted',evidence:'Provider test receipt'},4000)
 const [row]=call('get_operational_health','narrow',scope,62000)
 assert.deepEqual(row,{pending_count:1,sending_count:1,failed_count:1,unknown_count:1,oldest_pending_draft_age_ms:61000,oldest_sending_age_ms:60000,denied_or_missing_24h:null,unconfirmed_reads_24h:null,observed_at:62000})
 assert.equal(call('get_operational_health','owner',scope)[0].unknown_count,2)
 assert.equal(call('get_operational_health','auditor',scope)[0].unknown_count,1)
 assert.doesNotMatch(JSON.stringify(row),/SECRET|private|candidate|recipient|application_id|subject|body/)
 for(const user of ['outsider','reviewer'])assert.deepEqual(call('get_operational_health',user,scope),[])
 assert.deepEqual(call('get_operational_health','narrow',{...scope,brand_id:'other'}),[])
 const empty=call('get_operational_health','owner',{...scope,brand_id:'other'})[0]
 assert.equal(empty.pending_count,0);assert.equal(empty.oldest_pending_draft_age_ms,null)
 db.close()
})

test('operational health restricts privacy counters to brand-wide owners/auditors and uses a 24-hour window',()=>{
 const {db,call}=fixture()
 call('grant_workspace_access','owner',{...scope,member_user_id:'wide-auditor',role:'auditor',requisition_id:null,grant_id:'wide-auditor',operation_id:'wide-auditor'})
 const request={...scope,application_id:'missing',request_id:'denial'}
 call('authorize_gateway_get_application','outsider',request,10000)
 call('record_privacy_read_failure','outsider',{request_id:'denial'},10000)
 call('authorize_gateway_get_application','outsider',{...request,brand_id:'other',request_id:'other-denial'},10000)
 for(const user of ['owner','wide-auditor']) {
   const [row]=call('get_operational_health',user,scope,20000)
   assert.equal(row.denied_or_missing_24h,1);assert.equal(row.unconfirmed_reads_24h,1)
   assert.equal(call('get_operational_health',user,scope,86420001)[0].denied_or_missing_24h,0)
   assert.equal(call('get_operational_health',user,scope,5000)[0].denied_or_missing_24h,0)
 }
 for(const user of ['recruiter','narrow','auditor'])assert.equal(call('get_operational_health',user,scope)[0].denied_or_missing_24h,null)
 call('revoke_workspace_grant','owner',{...scope,grant_id:'grant-narrow',operation_id:'revoke-narrow'})
 assert.deepEqual(call('get_operational_health','narrow',scope),[])
 db.close()
})
