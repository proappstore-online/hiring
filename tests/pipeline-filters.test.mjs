import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { createRequire } from 'node:module'
const require = createRequire(new URL('../web/package.json', import.meta.url))
const ts = require('typescript')
const source = readFileSync(new URL('../web/src/filter-params.ts', import.meta.url), 'utf8')
const filters = await import('data:text/javascript;base64,' + Buffer.from(ts.transpile(source, {module:ts.ModuleKind.ESNext})).toString('base64'))
const tools = JSON.parse(readFileSync(new URL('../mcp.json', import.meta.url))).tools
function fixture() {
  const db = new DatabaseSync(':memory:')
  db.exec('PRAGMA foreign_keys=ON')
  for (const m of JSON.parse(readFileSync(new URL('../migrations.json', import.meta.url))).migrations) db.exec(m.sql)
  function call(name, user, values={}, explain=false) {
    const tool=tools.find(t=>t.name===name)
    const params={...Object.fromEntries(Object.entries(tool.params).filter(([,v])=>v.optional).map(([k])=>[k,null])), ...values,__user_id:user,__now:Date.parse('2026-10-20'),__uuid:crypto.randomUUID()}
    let result
    for(const statement of tool.statements??[tool.sql]) {
      const binds=[];const sql=statement.replace(/:([a-z_][a-z0-9_]*)/gi,(_,k)=>{assert.notEqual(params[k],undefined,k);binds.push(params[k]);return '?'})
      result=explain?db.prepare('EXPLAIN QUERY PLAN '+sql).all(...binds):tool.operation==='query'?db.prepare(sql).all(...binds):db.prepare(sql).run(...binds)
    }
    return result
  }
  for(const tenant of ['a','b']) {
    const scope={organization_id:'org-'+tenant,brand_id:'brand-'+tenant,requisition_id:'req-'+tenant}
    call('create_workspace','staff-'+tenant,{...scope,organization_name:'Org',brand_name:'Brand',requisition_title:'Engineer',operation_id:'bootstrap-'+tenant})
    call('create_linkedin_application','staff-'+tenant,{...scope,candidate_id:'candidate-'+tenant,application_id:'app-'+tenant,operation_id:'create-'+tenant,candidate_name:'Candidate '+tenant,email:tenant+'@example.com',phone:'',linkedin_url:'https://linkedin.com/in/'+tenant,source_detail:'Recruiter referral',basis_reference:'policy',contact_context:'provided',assignee_user_id:'staff-'+tenant})
  }
  return {db,call}
}
const scope={organization_id:'org-a',brand_id:'brand-a'}
test('server combinations, date boundaries, tenant scope and reviewer assignment remain enforced',()=>{
 const {db,call}=fixture()
 try {
 for(const name of ['list_applications','gateway_list_applications']) {
  assert.deepEqual(call(name,'staff-a',{...scope,stage:'submitted',requisition_id:'req-a'}).map(r=>r.id),['app-a'])
  assert.equal(call(name,'staff-a',{...scope,stage:'hired',requisition_id:'req-a'}).length,0)
  const dates=filters.filterQuery({...filters.parseFilters(new URLSearchParams()),source:'linkedin',date_from:'2026-10-20',date_to:'2026-10-20'})
  const [row]=call(name,'staff-a',{...scope,...dates});assert.equal(row.requisition_id,'req-a');assert.equal(row.created_at,Date.parse('2026-10-20'));assert.equal(row.source,'linkedin')
  assert.equal(call(name,'staff-a',{...scope,...dates,date_to:Date.parse('2026-10-20')}).length,0)
  assert.equal(call(name,'staff-a',{...scope,source:'referral'}).length,0)
  assert.equal(call(name,'staff-a',{...scope,assignee:'staff-b'}).length,0)
  assert.equal(call(name,'staff-b',scope).length,0)
  assert.equal(call(name,'staff-a',{organization_id:'org-b',brand_id:'brand-b'}).length,0)
 }
 db.prepare("INSERT INTO hiring_grants(id,organization_id,brand_id,user_id,role,status,granted_by,created_at) VALUES('review','org-a','brand-a','reviewer','reviewer','active','staff-a',1)").run()
 assert.equal(call('gateway_list_applications','reviewer',scope).length,0)
 db.prepare("UPDATE hiring_applications SET assignee_user_id='reviewer' WHERE id='app-a'").run()
 assert.equal(call('gateway_list_applications','reviewer',{...scope,stage:'submitted',assignee:'reviewer'}).length,1)
 assert.equal(call('list_applications','reviewer',scope).length,0)
 assert.equal(call('gateway_list_applications','reviewer',scope)[0].source_detail,undefined)
 }finally{db.close()}
})
test('filtering happens before row limits and uses canonical source overrides',()=>{
 const {db,call}=fixture()
 try {
 const insert=db.prepare("INSERT INTO hiring_applications(id,organization_id,brand_id,requisition_id,candidate_id,source,source_detail,basis_reference,contact_context,assignee_user_id,stage,version,created_by,created_at,updated_at) SELECT ?,organization_id,brand_id,requisition_id,candidate_id,source,source_detail,basis_reference,contact_context,assignee_user_id,'submitted',version,created_by,created_at,updated_at+1 FROM hiring_applications WHERE id='app-a'")
 for(let i=0;i<105;i++)insert.run('new-'+i)
 db.prepare("UPDATE hiring_applications SET stage='offered' WHERE id='app-a'").run()
 db.prepare("INSERT INTO hiring_application_sources(application_id,source) VALUES('app-a','referral')").run()
 for(const name of ['list_applications','gateway_list_applications']) {
 assert.deepEqual(call(name,'staff-a',{...scope,stage:'offered',source:'referral'}).map(r=>r.id),['app-a'])
 assert.equal(call(name,'staff-a',{...scope,stage:'offered',source:'linkedin'}).length,0)
 assert.equal(call(name,'staff-a',scope).length,name==='list_applications'?100:25)
 }
 }finally{db.close()}
})
test('URL round-trip preserves workspace, rejects malformed values, excludes text and matches local search',()=>{
 const initial=new URLSearchParams('brand_id=brand-a&organization_id=org-a')
 const state=filters.parseFilters(new URLSearchParams('stage=offered&requisition=req-a&source=linkedin&assignee=staff-a&date_from=2026-10-01&date_to=2026-10-20'))
 const serialized=filters.serializeFilters(initial,state)
 assert.deepEqual(filters.parseFilters(serialized),state);assert.equal(serialized.get('brand_id'),'brand-a')
 assert.equal(filters.parseFilters(new URLSearchParams('stage=bogus&date_from=2026-02-30&date_to=wat')).date_from,'')
 assert.equal(filters.parseFilters(new URLSearchParams('stage=bogus')).stage,'')
 assert.equal(filters.serializeFilters(new URLSearchParams('q=Alice&search=Alice&text=Alice'),state).has('q'),false)
 assert.equal(filters.matchesSearch({candidate_name:'Alice',source_detail:'Recruiter referral'},'REFERRAL'),true)
 assert.equal(filters.matchesSearch({candidate_name:'Alice'},'nobody'),false)
})
test('query plan uses existing tenant index without new migrations',()=>{
 const {db,call}=fixture()
 try {for(const name of ['list_applications','gateway_list_applications']) {
 const plan=call(name,'staff-a',{...scope,stage:'submitted',requisition_id:'req-a',source:'linkedin',date_from:Date.parse('2026-10-01')},true)
 assert.ok(plan.some(r=>r.detail.includes('SEARCH a USING INDEX idx_hiring_applications_brand')))
 if(process.env.PRINT_FILTER_PLAN)console.log(name+'\n'+plan.map(r=>r.detail).join('\n'))
 }}finally{db.close()}
})
