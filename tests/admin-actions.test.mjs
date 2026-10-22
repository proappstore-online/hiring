import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
const migrations=JSON.parse(readFileSync(new URL('../migrations.json',import.meta.url))).migrations
const tools=JSON.parse(readFileSync(new URL('../mcp.json',import.meta.url))).tools
const scope={organization_id:'org',brand_id:'brand'}
function fixture(){
 const db=new DatabaseSync(':memory:');db.exec('PRAGMA foreign_keys=ON');for(const m of migrations)db.exec(m.sql)
 function call(name,user='owner',values={}){
 const t=tools.find(t=>t.name===name);assert.ok(t)
 const params={...Object.fromEntries(Object.entries(t.params).filter(([,p])=>p.optional).map(([k])=>[k,null])),...values,__user_id:user,__now:1000,__uuid:crypto.randomUUID()}
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
