import { test } from 'node:test'
import assert from 'node:assert/strict'
import { correctionFixture, correctionVerified, correctionEvent, A, B } from './correction-fixture.mjs'
import { propagateCandidateCorrection } from '../scripts/rectification.mjs'
const scope={...A,request_id:'rights-a'}
const input={...scope,operation_id:'fix-a',field:'email',new_value:'corrected@example.test',reason_reference:'private-case-45',expected_version:3,expected_application_version:1}
const apply=f=>f.call('apply_candidate_correction','owner-a',input)
const setup=()=>{const f=correctionFixture();correctionVerified(f);return f}
const snapshot=db=>['hiring_stage_events','hiring_communication_events','hiring_applications'].map(t=>db.prepare(`SELECT * FROM ${t} ORDER BY id`).all())

test('corrections require verified latest request, exact brand owner, field allowlist and application version',()=>{
 const f=correctionFixture()
 assert.equal(apply(f),0);correctionVerified(f)
 for(const [actor,p] of [['owner-b',input],['outsider',input],['owner-a',{...input,...B}],['owner-a',{...input,expected_version:2}],['owner-a',{...input,expected_application_version:0}],['owner-a',{...input,field:'submitted_snapshot_json'}],['owner-a',{...input,field:'stage'}],['owner-a',{...input,reason_reference:''}]])assert.equal(f.call('apply_candidate_correction',actor,p),0)
 f.db.exec(`UPDATE hiring_applications SET submitted_snapshot_json='{"statement":"Original submitted evidence","email":"a@example.test"}' WHERE id='app-a'`)
 const before=snapshot(f.db)
 assert.equal(apply(f),1);assert.equal(apply(f),0)
 assert.equal(f.db.prepare("SELECT email FROM hiring_candidates WHERE id='c-a'").get().email,input.new_value)
 assert.equal(f.db.prepare("SELECT email FROM hiring_candidates WHERE id='c-b'").get().email,'b@example.test')
 const after=snapshot(f.db);assert.deepEqual(after.slice(0,2),before.slice(0,2))
 assert.equal(after[2][0].submitted_snapshot_json,before[2][0].submitted_snapshot_json)
 assert.equal(after[2][0].stage,before[2][0].stage);assert.equal(after[2][0].version,2)
 const row=f.db.prepare('SELECT * FROM hiring_corrections').get();assert.equal(row.previous_value,'a@example.test');assert.equal(row.actor_user_id,'owner-a');assert.equal(row.reason_reference,input.reason_reference)
 assert.throws(()=>f.db.exec("UPDATE hiring_corrections SET new_value='forged'"),/append-only/)
 assert.deepEqual(f.db.prepare('PRAGMA foreign_key_check').all(),[]);f.db.close()
})

test('audit failure rolls back local changes and processor queue; shared candidates and erased subjects are fenced',()=>{
 const f=setup()
 f.db.exec("CREATE TRIGGER correction_fail BEFORE INSERT ON hiring_audit_events WHEN NEW.action='privacy.correction.applied' BEGIN SELECT RAISE(ABORT,'audit unavailable'); END")
 assert.throws(()=>apply(f),/audit unavailable/)
 assert.equal(f.db.prepare("SELECT email FROM hiring_candidates WHERE id='c-a'").get().email,'a@example.test')
 assert.equal(f.db.prepare('SELECT count(*) n FROM hiring_rectification_targets').get().n,0)
 f.db.exec('DROP TRIGGER correction_fail')
 f.db.exec("INSERT INTO hiring_applications(id,organization_id,brand_id,requisition_id,candidate_id,source,source_detail,basis_reference,contact_context,assignee_user_id,stage,version,created_by,created_at,updated_at) SELECT 'other-app',organization_id,brand_id,requisition_id,candidate_id,source,source_detail,basis_reference,contact_context,assignee_user_id,stage,version,created_by,created_at,updated_at FROM hiring_applications WHERE id='app-a'")
 assert.equal(apply(f),0)
 assert.equal(f.call('apply_candidate_correction','owner-a',{...input,field:'contact_context',new_value:'Corrected current context'}),1)
 assert.equal(f.db.prepare("SELECT contact_context FROM hiring_applications WHERE id='other-app'").get().contact_context,'CONFIDENTIAL CONTEXT')
 f.db.close()
 const erased=setup();erased.call('request_candidate_erasure','owner-a',{...A,operation_id:'erase',identity_verified:1,holds_reviewed:1});assert.equal(apply(erased),0);erased.db.close()
})

test('installed processor partial failures stay pending, block fulfillment and retry with stable provider keys',async()=>{
 const f=setup()
 assert.equal(f.call('register_rectification_processor','owner-b',{...A,processor_id:'search'}),0)
 assert.equal(f.call('register_rectification_processor','owner-a',{...A,processor_id:'search'}),1)
 assert.equal(apply(f),1)
 assert.deepEqual(f.call('list_candidate_rectifications','owner-b',scope),[])
 const complete={...correctionEvent(A,3,'fulfilled',{proof_reference:'identity',decision_reference:'execution-reviewed'}),request_type:'correction'}
 assert.equal(f.call('attest_candidate_rights_completion','owner-a',complete),0)
 const calls=[], adapters={MAIL:{rectify:async p=>calls.push(p.idempotency_key),verify:async()=>({confirmed:true,reference:'mail-proof'})},search:{rectify:async p=>{calls.push(p.idempotency_key);throw Error('private provider error')},verify:async()=>false}}
 const actions=async(n,p)=>{const r=f.call(n,'owner-a',p);return {rows:Array.isArray(r)?r:[]}}
 let result=await propagateCandidateCorrection({actions,scope,adapters});assert.equal(result.state,'partial')
 assert.deepEqual(result.steps.map(x=>x.state),['complete','unknown'])
 assert.equal(f.call('attest_candidate_rights_completion','owner-a',complete),0)
 adapters.search={rectify:async p=>calls.push(p.idempotency_key),verify:async()=>({confirmed:true,reference:'search-proof'})}
 result=await propagateCandidateCorrection({actions,scope,adapters});assert.equal(result.state,'complete')
 assert.deepEqual(calls,['["fix-a","MAIL"]','["fix-a","search"]','["fix-a","search"]'])
 assert.equal(f.call('record_candidate_rectification','owner-a',{...scope,processor_id:'MAIL',operation_id:'late',expected_version:1,state:'failed',evidence_reference:'late'}),0)
 assert.equal(f.call('attest_candidate_rights_completion','owner-a',complete),1)
 assert.doesNotMatch(JSON.stringify(f.db.prepare("SELECT * FROM hiring_audit_events WHERE action LIKE 'privacy.rectification.%'").all()),/private provider|corrected@/)
 f.db.close()
})

test('processor outcome audits are atomic and payload reads recheck revoked grants',async()=>{
 const f=setup();apply(f)
 const p={...scope,processor_id:'MAIL',operation_id:'attempt',expected_version:0,state:'failed',evidence_reference:'provider-failed'}
 f.db.exec("CREATE TRIGGER rect_fail BEFORE INSERT ON hiring_audit_events WHEN NEW.action LIKE 'privacy.rectification.%' BEGIN SELECT RAISE(ABORT,'audit unavailable'); END")
 assert.throws(()=>f.call('record_candidate_rectification','owner-a',p),/audit unavailable/)
 assert.equal(f.db.prepare('SELECT count(*) n FROM hiring_rectification_attempts').get().n,0)
 f.db.exec('DROP TRIGGER rect_fail')
 assert.equal(f.call('record_candidate_rectification','owner-a',{...p,expected_version:1}),0)
 assert.equal(f.call('get_candidate_rectification_payload','owner-b',p).length,0)
 assert.equal(f.call('get_candidate_rectification_payload','owner-a',p).length,1)
 f.db.exec("DELETE FROM hiring_memberships WHERE user_id='owner-a'")
 assert.equal(f.call('get_candidate_rectification_payload','owner-a',p).length,0)
 assert.equal(f.call('record_candidate_rectification','owner-a',p),0);f.db.close()
})

test('denial preserves deadline and private decision evidence; a pending same-field correction cannot be overtaken',()=>{
 const f=setup();apply(f)
 const second={...scope,request_id:'second-rights'}
 for(const [version,status] of ['received','identity_verification','processing'].entries()) {
   assert.equal(f.call('record_candidate_rights_event','owner-a',{...correctionEvent(A,version,status,{proof_reference:version===2?'private-case':null}),request_id:second.request_id}),1)
 }
 assert.equal(f.call('apply_candidate_correction','owner-a',{...input,...second,operation_id:'newer-fix',expected_application_version:2,new_value:'newer@example.test'}),0)
 const denial={...correctionEvent(A,3,'denied_with_reason',{decision_reference:'private-reason-45'}),request_id:second.request_id}
 assert.equal(f.call('record_candidate_rights_event','owner-b',denial),0)
 assert.equal(f.call('record_candidate_rights_event','owner-a',denial),1)
 const row=f.call('list_candidate_rights_events','owner-a',second).find(x=>x.id===denial.operation_id)
 assert.equal(row.deadline_at,denial.deadline_at);assert.equal(row.actor_user_id,'owner-a');assert.equal(row.decision_reference,'private-reason-45')
 assert.deepEqual(f.call('get_candidate_rectification_payload','owner-a',{...second,processor_id:'MAIL'}),[])
 assert.equal(f.call('record_candidate_rights_event','owner-a',{...denial,request_id:scope.request_id,operation_id:'deny-applied'}),0)
 f.db.close()
})

test('missing processor adapter remains failed and never supplies completion evidence',async()=>{
 const f=setup();apply(f)
 const actions=async(n,p)=>{const r=f.call(n,'owner-a',p);return {rows:Array.isArray(r)?r:[]}}
 const result=await propagateCandidateCorrection({actions,scope})
 assert.equal(result.state,'partial');assert.equal(result.steps[0].state,'failed')
 assert.equal(result.steps[0].evidence_reference,'adapter-unavailable');f.db.close()
})
