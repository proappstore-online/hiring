import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { buildSearchTools } from '../scripts/search-tools.mjs'
import { searchRecords } from '../scripts/search.mjs'
const tools=JSON.parse(readFileSync(new URL('../mcp.json',import.meta.url))).tools
const scope={organization_id:'org',brand_id:'a'}
function fixture() {
 const db=new DatabaseSync(':memory:');db.exec('PRAGMA foreign_keys=ON')
 for(const m of JSON.parse(readFileSync(new URL('../migrations.json',import.meta.url))).migrations)db.exec(m.sql)
 let now=120000
 const call=(name,user,values={})=>{
  const tool=tools.find(t=>t.name===name);assert.ok(tool,name)
  const p={...Object.fromEntries(Object.entries(tool.params).filter(([,v])=>v.optional).map(([k,v])=>[k,v.default??null])),...values,__user_id:user,__now:now,__uuid:crypto.randomUUID()}
  db.exec('BEGIN')
  try {
   const results=(tool.statements??[tool.sql]).map(statement=>{
    const binds=[];const sql=statement.replace(/:([a-z_][a-z0-9_]*)/gi,(_,k)=>{assert.notEqual(p[k],undefined,k);binds.push(p[k]);return '?'})
    const prepared=db.prepare(sql)
    return prepared.columns().length?{rows:prepared.all(...binds).map(r=>({...r}))}:{meta:{changes:prepared.run(...binds).changes}}
   })
   db.exec('COMMIT');return tool.operation==='query'?{rows:results[0].rows}:{results}
  }catch(e){db.exec('ROLLBACK');throw e}
 }
 for(const brand of ['a','b']) {
  const s={organization_id:'org',brand_id:brand,requisition_id:'req-'+brand}
  call('create_workspace','root',{...s,organization_name:'Org',brand_name:brand,requisition_title:'Role',operation_id:'boot-'+brand})
  for(let i=0;i<4;i++)call('create_linkedin_application','root',{...s,candidate_id:`c-${brand}-${i}`,application_id:`app-${brand}-${i}`,candidate_name:'Person '+i,email:'same'+i+'@example.test',phone:'secret',linkedin_url:'',source_detail:'PRIVATE',basis_reference:'basis',contact_context:'PRIVATE',assignee_user_id:'root',operation_id:`create-${brand}-${i}`})
 }
 const grant=(user,role='recruiter',req=null)=>call('grant_workspace_access','root',{...scope,grant_id:user,member_user_id:user,role,requisition_id:req,operation_id:'grant-'+user})
 grant('recruiter');grant('interviewer','reviewer');grant('auditor','auditor');grant('limited','recruiter','req-a')
 const search=(name='search_applications',user='recruiter',patch={})=>searchRecords((n,p)=>Promise.resolve(call(n,user,p)),name,{...scope,q:'Person',...patch})
 return {db,call,search,grant,advance:ms=>{now+=ms}}
}
test('registered search definitions match generator and enforce current brand/requisition grants, no contact or snippets',async()=>{
 for(const tool of buildSearchTools())assert.deepEqual(tools.find(t=>t.name===tool.name),tool)
 const f=fixture();try{
 for(const name of ['search_candidates','search_applications']) {
  const {rows}=await f.search(name);assert.equal(rows.length,4)
  assert.ok(rows.every(r=>r.id.includes('-a-')))
  for(const user of ['outsider','auditor','interviewer'])assert.equal((await f.search(name,user)).rows.length,0)
  for(const patch of [{brand_id:'b'},{brand_id:'missing'},{organization_id:'forged'},{requisition_id:'req-b'}])assert.equal((await f.search(name,'recruiter',patch)).rows.length,0)
  assert.equal((await f.search(name,'limited')).rows.length,4)
  assert.equal((await f.search(name,'limited',{requisition_id:'req-b'})).rows.length,0)
  const serialized=JSON.stringify(rows);assert.ok(!serialized.includes('@example'));assert.ok(!serialized.includes('PRIVATE'));assert.ok(!serialized.includes('secret'))
 }
 assert.deepEqual(Object.keys((await f.search('search_candidates')).rows[0]).sort(),['id','full_name','email','created_at','next_cursor'].sort())
 assert.equal((await f.search('search_candidates')).rows[0].email,null)
 assert.equal((await f.search('search_applications','recruiter',{stage:'hired'})).rows.length,0)
 }finally{f.db.close()}
})
test('interview assignment, scheduled state, grant revocation and direct fetch all recheck current authority',async()=>{
 const f=fixture();try {
 const params={tenant_id:'org',brand_id:'a',application_id:'app-a-0',interview_id:'interview',operation_id:'interview-create',assignment_id:'assignment',reviewer_id:'interviewer',format:'video',scheduled_at:200000,duration_minutes:30,location:'Room'}
 f.call('create_interview','root',params)
 for(const name of ['search_candidates','search_applications'])assert.equal((await f.search(name,'interviewer')).rows.length,1)
 for(const [name,id]of [['get_search_candidate','c-a-0'],['get_search_application','app-a-0']]) {
  assert.equal((await f.search(name,'interviewer',{id})).rows.length,1)
  assert.equal((await f.search(name,'interviewer',{id:id.replace('-0','-1')})).rows.length,0)
  assert.equal((await f.search(name,'recruiter',{id:id.replace('-a-','-b-')})).rows.length,0)
 }
 f.call('revoke_interviewer','root',{...params,operation_id:'revoke',expected_version:1,reason:'Removed'})
 assert.equal((await f.search('search_applications','interviewer')).rows.length,0)
 f.call('revoke_workspace_grant','root',{...scope,grant_id:'recruiter',operation_id:'revoke-grant'})
 assert.equal((await f.search()).rows.length,0)
 assert.equal((await f.search('get_search_application','recruiter',{id:'app-a-0'})).rows.length,0)
 f.db.exec("UPDATE hiring_organizations SET status='suspended' WHERE id='org'")
 assert.equal((await f.search('search_candidates','limited')).rows.length,0)
 }finally{f.db.close()}
})
test('opaque scope-bound keyset pages: no duplicates, foreign/user/filter/forged cursors fail closed',async()=>{
 const f=fixture();try{
 for(const name of ['search_candidates','search_applications']) {
  const first=await f.search(name,'recruiter',{limit:2});assert.equal(first.rows.length,2);assert.ok(first.next_cursor)
  const second=await f.search(name,'recruiter',{limit:2,cursor:first.next_cursor});assert.equal(second.rows.length,2);assert.equal(second.next_cursor,null)
  assert.equal(new Set([...first.rows,...second.rows].map(r=>r.id)).size,4)
  assert.equal((await f.search(name,'root',{limit:2,cursor:first.next_cursor})).rows.length,0)
  assert.equal((await f.search(name,'root',{brand_id:'b',cursor:first.next_cursor})).rows.length,0)
  assert.equal((await f.search(name,'recruiter',{cursor:'forged'})).rows.length,0)
  assert.equal((await f.search(name,'recruiter',{cursor:first.next_cursor,requisition_id:'req-a'})).rows.length,0)
 }
 }finally{f.db.close()}
})
test('shared persistent budget denies request 31 with status 429, including direct fetch and scope switching; next window resets',async()=>{
 const f=fixture();try {
 for(let i=0;i<30;i++)await f.search(i%2?'search_candidates':'search_applications','recruiter',{brand_id:i%3?'a':'forged'})
 const response=f.call('search_applications','recruiter',{...scope,q:'Person'})
 assert.equal(response.results[0].rows[0].status,429);assert.deepEqual(JSON.parse(response.results[0].rows[0].rows_json),[])
 await assert.rejects(f.search('get_search_application','recruiter',{id:'app-a-0'}),e=>e.status===429)
 assert.equal((await f.search('search_applications','limited')).rows.length,4)
 f.advance(60000);assert.equal((await f.search()).rows.length,4)
 assert.equal(f.db.prepare("SELECT requests FROM hiring_search_budget WHERE user_id='recruiter'").get().requests,1)
 }finally{f.db.close()}
})
test('no stale index authority: canonical removals and tombstones suppress search and exact reads',async()=>{
 const f=fixture();try{
 f.db.exec("CREATE TABLE stale_index(id TEXT,body TEXT); INSERT INTO stale_index VALUES('gone','Removed Person')")
 assert.equal((await f.search('search_candidates','recruiter',{q:'Removed Person'})).rows.length,0)
 f.db.exec("INSERT INTO hiring_deletion_tombstones(request_id,organization_id,brand_id,candidate_id,application_id,created_at) VALUES('deleted','org','a','c-a-1','app-a-1',1)")
 assert.equal((await f.search('search_candidates','recruiter',{q:'Person 1'})).rows.length,0)
 assert.equal((await f.search('get_search_application','recruiter',{id:'app-a-1'})).rows.length,0)
 }finally{f.db.close()}
})
test('SQL independently bounds size and query; literal wildcard, parameter binding and safe errors',async()=>{
 const f=fixture();try{
 for(const limit of [0,-1,51,1.5,'2'])assert.equal(JSON.parse(f.call('search_candidates','recruiter',{...scope,q:'Person',limit}).results[0].rows[0].rows_json).length,0)
 assert.equal(JSON.parse(f.call('search_candidates','recruiter',{...scope,q:'x'.repeat(201)}).results[0].rows[0].rows_json).length,0)
 for(const q of ['%','_',"' OR 1=1 --",'same0@example.test'])assert.equal((await f.search('search_candidates','recruiter',{q})).rows.length,0)
 await assert.rejects(searchRecords(async()=>{throw Error('PRIVATE')},'search_candidates',{...scope,q:'Person'}),e=>e.status===503&&!e.message.includes('PRIVATE'))
 await assert.rejects(searchRecords(async()=>({}),'search_candidates',{...scope,q:'Person'}),e=>e.status===503)
 }finally{f.db.close()}
})
test('search reaches older records beyond recent queue limits; default and maximum page sizes hold',async()=>{
 const f=fixture();try{
 const candidate=f.db.prepare("INSERT INTO hiring_candidates(id,organization_id,brand_id,name,email,phone,linkedin_url,created_by,created_at) SELECT ?,organization_id,brand_id,?,email,phone,linkedin_url,created_by,created_at FROM hiring_candidates WHERE id='c-a-0'")
 const application=f.db.prepare("INSERT INTO hiring_applications(id,organization_id,brand_id,requisition_id,candidate_id,source,source_detail,basis_reference,contact_context,assignee_user_id,stage,version,created_by,created_at,updated_at) SELECT ?,organization_id,brand_id,requisition_id,?,source,source_detail,basis_reference,contact_context,assignee_user_id,stage,version,created_by,created_at+1,updated_at+1 FROM hiring_applications WHERE id='app-a-0'")
 for(let i=0;i<105;i++){candidate.run('extra-c-'+i,'Other Person '+i);application.run('extra-a-'+i,'extra-c-'+i)}
 for(const name of ['search_candidates','search_applications']) {
  assert.equal((await f.search(name)).rows.length,20)
  assert.equal((await f.search(name,'recruiter',{limit:50})).rows.length,50)
  assert.equal((await f.search(name,'recruiter',{q:'Person 0'})).rows.length,2)
  const principal=name==='search_candidates'?'limited':'limited-again'
  const page=await f.search(name,principal,{limit:1});assert.ok(page.next_cursor)
  f.call('revoke_workspace_grant','root',{...scope,grant_id:principal,operation_id:'revoked-'+name})
  assert.equal((await f.search(name,principal,{limit:1,cursor:page.next_cursor})).rows.length,0)
  if(name==='search_candidates')f.grant('limited-again','recruiter','req-a')
 }
 }finally{f.db.close()}
})
