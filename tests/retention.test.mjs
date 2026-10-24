import {test} from 'node:test'
import assert from 'node:assert/strict'
import {DatabaseSync} from 'node:sqlite'
import {readFileSync} from 'node:fs'
import {retentionTools} from '../scripts/retention-contract.mjs'
import {executeStoreDeletion,reconcileStoreDeletion,createR2DeletionAdapter,createIndexDeletionAdapter,createD1DeletionAdapter,exportRetentionLedger,replayRetentionLedger} from '../worker/retention.mjs'
const migrations=JSON.parse(readFileSync(new URL('../migrations.json',import.meta.url))).migrations
const tools=JSON.parse(readFileSync(new URL('../mcp.json',import.meta.url))).tools
const A={organization_id:'org',brand_id:'a'}, B={organization_id:'org',brand_id:'b'}, C={organization_id:'other-org',brand_id:'c'}
function fixture() {
 const db=new DatabaseSync(':memory:');db.exec('PRAGMA foreign_keys=ON')
 for(const m of migrations)db.exec(m.sql)
 function call(name,user,values={}) {
  const t=tools.find(t=>t.name===name);assert.ok(t,name)
  if(t.callers?.includes('worker') && user!=='system:worker')throw Error('worker-only')
  const p={...Object.fromEntries(Object.entries(t.params??{}).filter(([,v])=>v.optional).map(([k])=>[k,null])),...values,__user_id:user,__now:100000,__uuid:crypto.randomUUID()}
  db.exec('BEGIN')
  try {
   const results=(t.statements??[t.sql]).map(s=>{
    const binds=[];const sql=s.replace(/:([a-z_][a-z0-9_]*)/gi,(_,k)=>{assert.notEqual(p[k],undefined,`${name}: ${k}`);binds.push(p[k]);return '?'})
    return t.operation==='query'?db.prepare(sql).all(...binds).map(r=>({...r})):db.prepare(sql).run(...binds).changes
   });db.exec('COMMIT');return t.operation==='query'?{rows:results[0]}:{results:results.map(changes=>({meta:{changes}}))}
  }catch(e){db.exec('ROLLBACK');throw e}
 }
 for(const s of [A,B,C]) {
  const b=s.brand_id
  call('create_workspace','root',{...s,requisition_id:'req-'+b,organization_name:'Org',brand_name:b,requisition_title:'Role',operation_id:'boot-'+b})
  db.prepare("INSERT INTO hiring_memberships(id,organization_id,brand_id,user_id,role,created_at) VALUES (?,?,?,?,'owner',0)").run('owner-'+b,s.organization_id,b,'owner-'+b)
  call('create_linkedin_application','owner-'+b,{...s,requisition_id:'req-'+b,candidate_id:'candidate-'+b,application_id:'app-'+b,candidate_name:'PRIVATE PERSON',email:'private@example.test',phone:'123',linkedin_url:'https://linkedin.com/private',source_detail:'PRIVATE SOURCE',basis_reference:'basis',contact_context:'PRIVATE CONTEXT',assignee_user_id:'owner-'+b,operation_id:'person-'+b})
 }
 const ownerActions=(name,p)=>Promise.resolve(call(name,'owner-a',p))
 const actions=(name,p)=>Promise.resolve(call(name,'system:worker',p))
 return {db,call,actions,ownerActions}
}
function erase(f,s=A) {
 f.call('request_candidate_erasure','owner-'+s.brand_id,{...s,application_id:'app-'+s.brand_id,operation_id:'erase-'+s.brand_id,identity_verified:1,holds_reviewed:1})
 return f.db.prepare('SELECT id FROM erasure_requests WHERE brand_id=?').get(s.brand_id).id
}
function hold(f,s=A,state='active',operation_id=crypto.randomUUID()) {
 return f.call('record_store_hold','owner-'+s.brand_id,{...s,application_id:'app-'+s.brand_id,operation_id,state,reason_reference:'opaque-legal-case',review_at:1})
}
function attachment(f,s=A,n='file') {
 f.db.prepare('INSERT OR IGNORE INTO hiring_worker_profiles(user_id,display_name,created_at,updated_at) VALUES (?,?,0,0)').run('worker','Private')
 f.db.prepare("INSERT OR IGNORE INTO hiring_intake_receipts VALUES (?,?,?,?,?,?,?,?)").run('app-'+s.brand_id,s.organization_id,s.brand_id,'req-'+s.brand_id,'worker','intake-'+s.brand_id,'{}',0)

 f.db.prepare('INSERT INTO hiring_attachments(id,organization_id,brand_id,application_id,uploader_user_id,filename,storage_path,mime_type,size_bytes,checksum,operation_id,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)').run(n,s.organization_id,s.brand_id,'app-'+s.brand_id,'worker','PRIVATE FILE',s.brand_id+'/'+n,'text/plain',1,'0'.repeat(64),'op-'+n,1)
}
function adapters(f,objects=new Set(),entries=new Set()) {
 const bucket={delete:async k=>objects.delete(k),head:async k=>objects.has(k)?{size:1}:null}
 const index={deleteByScope:async s=>entries.delete(s.organization_id+'/'+s.brand_id+'/'+s.candidate_id),countByScope:async s=>Number(entries.has(s.organization_id+'/'+s.brand_id+'/'+s.candidate_id))}
 return {r2:createR2DeletionAdapter({actions:f.actions,bucket}),index:createIndexDeletionAdapter({actions:f.actions,index}),d1:createD1DeletionAdapter(f.actions)}
}
const secret='synthetic-private-ledger-key-32-bytes-minimum'
const gate=()=>({closed:false,async close(){this.closed=true},async isClosed(){return this.closed},async assertLatestDigest(){return true}})

test('registered retention contract matches deployed SQL and worker mutations are inaccessible to users',()=>{
 for(const t of retentionTools)assert.deepEqual(tools.find(x=>x.name===t.name),t)
 const f=fixture()
 for(const t of retentionTools.filter(t=>t.callers))assert.throws(()=>f.call(t.name,'owner-a',A),/worker-only/)
 assert.equal(f.db.prepare('SELECT retention_policy FROM hiring_organizations LIMIT 1').get().retention_policy,'indefinite')
 f.db.close()
})

test('current holds block D1 deletes, R2 object removal and index cleanup; dates never expire holds',async()=>{
 const f=fixture();attachment(f)
 f.db.exec("INSERT INTO hiring_rights_requests(id,organization_id,brand_id,candidate_id,request_type,actor_user_id,created_at,updated_at) VALUES ('rights','org','a','candidate-a','deletion','owner-a',0,0)")
 f.call('add_application_note','owner-a',{...A,application_id:'app-a',note_id:'note',body:'PRIVATE NOTE',operation_id:'note-op'})
 const requestId=erase(f);f.call('request_store_deletion','owner-a',{...A,request_id:requestId});hold(f)
 const objects=new Set(['a/file']),entries=new Set(['org/a/candidate-a'])
 const result=await executeStoreDeletion({actions:f.actions,scope:A,requestId,adapters:adapters(f,objects,entries)})
 assert.equal(result.state,'held');assert.equal(objects.size,1);assert.equal(entries.size,1)
 assert.throws(()=>f.db.exec("DELETE FROM hiring_notes WHERE id='note'"),/active legal hold/)
 assert.throws(()=>f.db.exec("DELETE FROM hiring_rights_requests WHERE id='rights'"),/active legal hold/)
 assert.throws(()=>f.db.exec("DELETE FROM hiring_attachments WHERE id='file'"),/active legal hold/)
 assert.throws(()=>f.db.exec("UPDATE hiring_attachments SET scan_state='deleted' WHERE id='file'"),/active legal hold/)
 assert.equal(f.db.prepare('SELECT COUNT(*) n FROM hiring_retention_evidence').get().n,0)
 hold(f,A,'released')
 const done=await executeStoreDeletion({actions:f.actions,scope:A,requestId,adapters:adapters(f,objects,entries)})
 assert.equal(done.state,'partial');assert.equal(done.steps.find(s=>s.store==='d1').reason_code,'protected_records');assert.equal(objects.size,0);assert.equal(entries.size,0)
 f.db.close()
})

test('holds and deletion requests enforce exact tenant/brand scope and require explicit verified erasure',async()=>{
 const f=fixture();hold(f,A)
 assert.throws(()=>erase(f,A),/active legal hold/)
 for(const s of [B,C]) {
  const requestId=erase(f,s)
  assert.equal(f.call('request_store_deletion','owner-a',{...s,request_id:requestId}).results.at(-1).meta.changes,0)
  f.call('request_store_deletion','owner-'+s.brand_id,{...s,request_id:requestId})
  const result=await executeStoreDeletion({actions:f.actions,scope:s,requestId,adapters:adapters(f)});assert.equal(result.state,'partial');assert.ok(result.steps.filter(x=>x.store!=='d1').every(x=>x.state==='complete'))
 }
 f.call('request_store_deletion','owner-a',{...A,request_id:'not-expired-not-requested'})
 assert.equal(f.db.prepare("SELECT COUNT(*) n FROM hiring_deletion_requests WHERE brand_id='a'").get().n,0)
 await assert.rejects(executeStoreDeletion({actions:f.actions,scope:A,requestId:'missing'}),/unavailable/)
 f.db.close()
})

test('per-store retries preserve completed work and immutable content-free evidence; protected bodies remain blocked',async()=>{
 const f=fixture();const requestId=erase(f);f.call('request_store_deletion','owner-a',{...A,request_id:requestId})
 let fail=true,indexCalls=0,r2Calls=0
 const a=adapters(f)
 a.r2={remove:async()=>{r2Calls++},verify:async()=>!fail}
 a.index={remove:async()=>{indexCalls++},verify:async()=>true}
 let result=await executeStoreDeletion({actions:f.actions,scope:A,requestId,adapters:a})
 assert.equal(result.state,'partial');assert.equal(result.steps.find(s=>s.store==='r2').state,'failed')
 fail=false;result=await executeStoreDeletion({actions:f.actions,scope:A,requestId,adapters:a})
 assert.equal(result.state,'partial');assert.equal(result.steps.find(s=>s.store==='d1').reason_code,'protected_records');assert.equal(r2Calls,2);assert.equal(indexCalls,1)
 const evidence=f.db.prepare('SELECT * FROM hiring_retention_evidence').all()
 assert.equal(evidence.filter(e=>e.outcome==='complete').length,2)
 assert.doesNotMatch(JSON.stringify(evidence),/PRIVATE|private@example|storage_path|reason_reference|body/)
 assert.throws(()=>f.db.exec('DELETE FROM hiring_retention_evidence'),/append-only/)
 assert.throws(()=>f.db.exec("UPDATE hiring_deletion_steps SET state='pending' WHERE store='r2'"),/immutable/)
 assert.deepEqual(f.db.prepare('PRAGMA foreign_key_check').all(),[])
 f.db.close()
})

test('unknown deletion is not retried; in-flight interlock rejects a racing hold until definitive reconciliation',async()=>{
 const f=fixture();const requestId=erase(f);f.call('request_store_deletion','owner-a',{...A,request_id:requestId})
 let calls=0;const a=adapters(f)
 a.r2={remove:async()=>{calls++;assert.throws(()=>hold(f),/in flight/);throw Error('PRIVATE provider timeout')},verify:async()=>true}
 await executeStoreDeletion({actions:f.actions,scope:A,requestId,adapters:a})
 await executeStoreDeletion({actions:f.actions,scope:A,requestId,adapters:a})
 assert.equal(calls,1);assert.throws(()=>hold(f),/in flight/)
 const attemptId=f.db.prepare("SELECT attempt_id FROM hiring_deletion_steps WHERE store='r2'").get().attempt_id
 assert.equal(await reconcileStoreDeletion({actions:f.actions,scope:A,requestId,store:'r2',attemptId,adapter:{reconcile:async()=> 'unknown'}}),'unknown')
 assert.throws(()=>hold(f),/in flight/)
 assert.equal(await reconcileStoreDeletion({actions:f.actions,scope:A,requestId,store:'r2',attemptId,adapter:{reconcile:async()=> 'not_deleted'}}),'failed')
 hold(f);assert.equal((await executeStoreDeletion({actions:f.actions,scope:A,requestId,adapters:a})).state,'held')
 f.db.close()
})

test('missing adapters are durable blockers; persistence failure never reports deletion as complete',async()=>{
 const f=fixture();const requestId=erase(f);f.call('request_store_deletion','owner-a',{...A,request_id:requestId})
 let result=await executeStoreDeletion({actions:f.actions,scope:A,requestId})
 assert.ok(result.steps.every(s=>s.state==='blocked'&&s.reason_code==='adapter_unavailable'))
 f.db.exec("CREATE TRIGGER synthetic_evidence_failure BEFORE INSERT ON hiring_retention_evidence BEGIN SELECT RAISE(ABORT,'unavailable'); END")
 result=await executeStoreDeletion({actions:f.actions,scope:A,requestId,adapters:adapters(f)})
 assert.equal(result.state,'partial') // failed claim rolled back with its evidence
 assert.ok(result.steps.every(s=>s.state==='blocked'))
 f.db.close()
})

test('signed private ledger restores tombstones and active holds before access; replay is idempotent and scope-safe',async()=>{
 const source=fixture();attachment(source)
 const requestId=erase(source);source.call('request_store_deletion','owner-a',{...A,request_id:requestId})
 // A different subject in the same brand is held; the erased subject can replay.
 source.call('create_linkedin_application','owner-a',{...A,requisition_id:'req-a',candidate_id:'held-person',application_id:'held-app',candidate_name:'PRIVATE HELD',email:'',phone:'',linkedin_url:'',source_detail:'source',basis_reference:'basis',contact_context:'context',assignee_user_id:'owner-a',operation_id:'held-person'})
 source.call('record_store_hold','owner-a',{...A,application_id:'held-app',operation_id:'hold-restored',state:'active',reason_reference:'opaque-case',review_at:1})
 const artifact=await exportRetentionLedger({ownerActions:source.ownerActions,scope:A,secret})
 assert.doesNotMatch(artifact.body,/PRIVATE|private@example/)
 const restored=fixture()
 // Restored attachment metadata can be missing while its object survives: signed inventory must still remove it.
 restored.db.exec("DELETE FROM hiring_attachments WHERE id='file'")
 const objects=new Set(['a/file','b/sibling']),entries=new Set(['org/a/candidate-a','org/b/candidate-b'])
 const g=gate(),a=adapters(restored,objects,entries)
 let result=await replayRetentionLedger({actions:restored.actions,adapters:a,scope:A,restoreId:'restore-1',artifact,secret,gate:g})
 assert.equal(result.state,'blocked');assert.equal(result.access,'closed');assert.equal(g.closed,true)
 assert.deepEqual([...objects],['b/sibling']);assert.deepEqual([...entries],['org/b/candidate-b'])
 assert.equal(restored.db.prepare("SELECT name FROM hiring_candidates WHERE id='candidate-a'").get().name,'[redacted]')
 assert.equal(restored.db.prepare("SELECT name FROM hiring_candidates WHERE id='candidate-b'").get().name,'PRIVATE PERSON')
 assert.throws(()=>restored.db.exec("UPDATE hiring_candidates SET name='Resurrection' WHERE id='candidate-a'"),/restore tombstone/)
 assert.equal(restored.db.prepare("SELECT state FROM hiring_restore_hold_events WHERE candidate_id='held-person'").get().state,'active')
 const evidenceCount=restored.db.prepare('SELECT COUNT(*) n FROM hiring_retention_evidence').get().n
 result=await replayRetentionLedger({actions:restored.actions,adapters:a,scope:A,restoreId:'restore-1',artifact,secret,gate:g})
 assert.equal(result.state,'blocked');assert.equal(restored.db.prepare('SELECT COUNT(*) n FROM hiring_retention_evidence').get().n,evidenceCount+2);assert.equal(restored.db.prepare("SELECT attempts FROM hiring_deletion_steps WHERE store='r2'").get().attempts,1)
 const next=await exportRetentionLedger({ownerActions:restored.ownerActions,scope:A,secret})
 assert.equal(JSON.parse(next.body).holds.length,1);assert.equal(JSON.parse(next.body).tombstones.length,1)
 await assert.rejects(replayRetentionLedger({actions:restored.actions,adapters:a,scope:B,restoreId:'bad-scope',artifact,secret,gate:g}),/scope/)
 await assert.rejects(replayRetentionLedger({actions:restored.actions,adapters:a,scope:A,restoreId:'tamper',artifact:{...artifact,body:artifact.body+' '},secret,gate:g}),/signature/)
 source.db.close();restored.db.close()
})

test('restore remains closed on holds, unavailable stores, incomplete imports, or stale independent checkpoint',async()=>{
 const f=fixture();const requestId=erase(f);f.call('request_store_deletion','owner-a',{...A,request_id:requestId});hold(f)
 const artifact=await exportRetentionLedger({ownerActions:f.ownerActions,scope:A,secret})
 const dest=fixture();const g=gate()
 let result=await replayRetentionLedger({actions:dest.actions,adapters:adapters(dest),scope:A,restoreId:'held-restore',artifact,secret,gate:g})
 assert.equal(result.state,'blocked');assert.equal(result.access,'closed')
 assert.equal(dest.db.prepare("SELECT COUNT(*) n FROM hiring_retention_evidence").get().n,0)
 const stale={...gate(),async assertLatestDigest(){return false}}
 await assert.rejects(replayRetentionLedger({actions:dest.actions,scope:A,restoreId:'stale',artifact,secret,gate:stale}),/checkpoint/)
 assert.equal(stale.closed,true)
 const release={...A,application_id:'app-a',restore_id:'held-restore',ledger:'stores',reason_reference:'reviewed-case',review_at:1,operation_id:'release-imported'}
 assert.equal(dest.call('release_restored_store_hold','owner-b',release).results.at(-1).meta.changes,0)
 assert.equal(dest.call('release_restored_store_hold','owner-a',release).results.at(-1).meta.changes,1)
 assert.equal(dest.call('check_store_hold','system:worker',{...A,request_id:'held-restore:'+requestId}).rows[0].held,0)
 result=await replayRetentionLedger({actions:dest.actions,adapters:adapters(dest),scope:A,restoreId:'held-restore',artifact,secret,gate:g})
 assert.equal(result.access,'closed')
 assert.equal(dest.db.prepare("SELECT name FROM hiring_candidates WHERE id='candidate-a'").get().name,'[redacted]')
 await assert.rejects(replayRetentionLedger({actions:dest.actions,scope:A,restoreId:'ungated',artifact,secret,gate:{close:async()=>{},isClosed:async()=>false}}),/not closed/)
 f.db.close();dest.db.close()
})

test('direct R2/index adapter calls require an exact active claim, not caller-supplied candidate IDs',async()=>{
 const f=fixture(),a=adapters(f)
 const forged={...A,request_id:'forged',candidate_id:'candidate-b',attempt_id:'forged'}
 await assert.rejects(a.r2.remove(forged),/not authorized/)
 await assert.rejects(a.index.remove(forged),/not authorized/)
 f.db.close()
})

test('R2 inventory pages beyond 100 entries and survives metadata removal without exposing keys in evidence',async()=>{
 const f=fixture();const objects=new Set()
 for(let n=0;n<103;n++){attachment(f,A,'file-'+String(n).padStart(3,'0'));objects.add('a/file-'+String(n).padStart(3,'0'))}
 const requestId=erase(f);f.call('request_store_deletion','owner-a',{...A,request_id:requestId})
 const a=adapters(f,objects)
 const result=await executeStoreDeletion({actions:f.actions,scope:A,requestId,adapters:a})
 assert.equal(result.steps.find(s=>s.store==='r2').state,'complete');assert.equal(objects.size,0)
 assert.equal(f.db.prepare('SELECT COUNT(*) n FROM hiring_deletion_objects').get().n,103)
 assert.equal(f.db.prepare('SELECT COUNT(*) n FROM hiring_attachments').get().n,0)
 assert.doesNotMatch(JSON.stringify(f.db.prepare('SELECT * FROM hiring_retention_evidence').all()),/file-/)
 const artifact=await exportRetentionLedger({ownerActions:f.ownerActions,scope:A,secret})
 assert.equal(JSON.parse(artifact.body).tombstones[0].objects.length,103)
 f.db.close()
})

test('lost responses reconcile by durable attempt identity; concurrent workers cannot claim the same step',async()=>{
 const f=fixture();const requestId=erase(f);f.call('request_store_deletion','owner-a',{...A,request_id:requestId})
 const a=adapters(f);let removes=0
 a.index={remove:async()=>{removes++;await Promise.resolve()},verify:async()=>true}
 const lost=async(name,p)=>{const value=await f.actions(name,p);if(name==='claim_store_deletion')throw Error('lost response');return value}
 await Promise.all([executeStoreDeletion({actions:lost,scope:A,requestId,adapters:a}),executeStoreDeletion({actions:f.actions,scope:A,requestId,adapters:a})])
 assert.equal(removes,1);assert.equal(f.db.prepare("SELECT attempts FROM hiring_deletion_steps WHERE store='index'").get().attempts,1)
 f.db.close()
})

test('complete-import sealing fails closed and audit failure rolls a terminal step back to running',async()=>{
 const f=fixture();const requestId=erase(f);f.call('request_store_deletion','owner-a',{...A,request_id:requestId})
 const p={...A,request_id:requestId,store:'index',attempt_id:'attempt'}
 f.call('claim_store_deletion','system:worker',p)
 f.db.exec("CREATE TRIGGER synthetic_terminal_failure BEFORE INSERT ON hiring_retention_evidence WHEN NEW.outcome='complete' BEGIN SELECT RAISE(ABORT,'audit unavailable'); END")
 assert.throws(()=>f.call('finish_store_deletion','system:worker',{...p,outcome:'complete',reason_code:'verified_absent'}),/audit unavailable/)
 assert.equal(f.db.prepare("SELECT state FROM hiring_deletion_steps WHERE store='index'").get().state,'running')
 assert.throws(()=>hold(f),/in flight/)
 const r={...A,restore_id:'incomplete',digest:'digest',tombstone_count:1,hold_count:1}
 // A restore cannot start while original work remains in flight.
 f.call('begin_retention_restore','system:worker',r)
 assert.equal(f.call('get_retention_restore','system:worker',r).rows.length,0)
 f.call('finish_store_deletion','system:worker',{...p,outcome:'failed',reason_code:'retryable'})
 f.call('begin_retention_restore','system:worker',r);f.call('seal_retention_restore','system:worker',r)
 assert.equal(f.call('get_retention_restore','system:worker',r).rows[0].state,'importing')
 const attempt={...A,request_id:requestId,store:'r2',attempt_id:'during-import'}
 f.call('claim_store_deletion','system:worker',attempt)
 assert.equal(f.call('get_store_deletion_attempt','system:worker',attempt).rows.length,0)
 f.db.close()
})

test('restored released hold supersedes an older active backup hold; restored active holds require explicit owner release',async()=>{
 const source=fixture()
 const legacy={...A,application_id:'app-a',state:'active',review_at:1,reason_reference:'case',operation_id:'legacy-active'}
 source.call('record_candidate_erasure_hold','owner-a',legacy)
 source.call('record_candidate_erasure_hold','owner-a',{...legacy,state:'released',operation_id:'legacy-release'})
 erase(source)
 const artifact=await exportRetentionLedger({ownerActions:source.ownerActions,scope:A,secret})
 const dest=fixture();dest.call('record_candidate_erasure_hold','owner-a',legacy)
 const result=await replayRetentionLedger({actions:dest.actions,adapters:adapters(dest),scope:A,restoreId:'released-restore',artifact,secret,gate:gate()})
 assert.equal(result.state,'blocked') // remaining immutable history, not a resurrected hold
 const req='released-restore:'+JSON.parse(artifact.body).tombstones[0].request_id
 assert.equal(dest.call('check_store_hold','system:worker',{...A,request_id:req}).rows[0].held,0)
 assert.equal(dest.db.prepare("SELECT name FROM hiring_candidates WHERE id='candidate-a'").get().name,'[redacted]')
 const artifact2=await exportRetentionLedger({ownerActions:dest.ownerActions,scope:A,secret})
 assert.equal(JSON.parse(artifact2.body).holds.length,2)
 source.db.close();dest.db.close()
})

test('empty signed snapshot becomes ready with access still closed; export denial and concurrent ledger changes fail closed',async()=>{
 const f=fixture();const artifact=await exportRetentionLedger({ownerActions:f.ownerActions,scope:A,secret})
 const dest=fixture(),g=gate()
 const result=await replayRetentionLedger({actions:dest.actions,adapters:adapters(dest),scope:A,restoreId:'empty',artifact,secret,gate:g})
 assert.equal(result.state,'ready');assert.equal(g.closed,true)
 await assert.rejects(exportRetentionLedger({ownerActions:f.ownerActions,scope:B,secret}),/unavailable/)
 let reads=0
 const changing=async(name,p)=>{const value=await f.ownerActions(name,p);if(name==='retention_ledger_watermark'&&++reads===2)value.rows[0].legacy_count++;return value}
 await assert.rejects(exportRetentionLedger({ownerActions:changing,scope:A,secret}),/changed during export/)
 f.db.close();dest.db.close()
})

test('a delayed explicit continuation exports exactly one tombstone identity',async()=>{
 const f=fixture();const requestId=erase(f)
 // Represent a continuation made later than core redaction, without editing its immutable evidence.
 const actions=(name,p)=>f.call(name,'owner-a',p)
 const delayed=tools.find(t=>t.name==='request_store_deletion')
 // Fixture's fixed server clock can be overridden only at the trusted action binding.
 const original=delayed.statements
 delayed.statements=original.map(s=>s.replaceAll(':__now','200000'))
 try {actions('request_store_deletion',{...A,request_id:requestId})} finally {delayed.statements=original}
 const artifact=await exportRetentionLedger({ownerActions:f.ownerActions,scope:A,secret})
 assert.equal(JSON.parse(artifact.body).tombstones.length,1)
 f.db.close()
})
