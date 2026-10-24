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

function setup() {
 const f=fixture();f.call('create_workspace','staff-a',bootstrap)
 for (const n of ['a','b','c']) f.call('create_application','staff-a',{...candidate,candidate_id:'cand-'+n,application_id:'app-'+n,operation_id:'create-'+n,source:'manual',candidate_name:'Person '+n,email:n==='b'?' A@EXAMPLE.COM ':'a@example.com'})
 return f
}
const merge={...scope,source_id:'cand-b',target_id:'cand-a',reason:'Human reviewed same person',operation_id:'merge',name_source:'cand-b',email_source:'cand-a',phone_source:'cand-b',linkedin_url_source:'cand-a'}
test('suggestions are read-only, normalized and confidential across brands and roles',()=>{
 const {db,call}=setup()
 call('create_workspace','staff-a',{...bootstrap,organization_id:'org-b',brand_id:'brand-b',requisition_id:'req-b',operation_id:'boot-b'})
 call('create_application','staff-a',{...candidate,organization_id:'org-b',brand_id:'brand-b',requisition_id:'req-b',candidate_id:'secret',application_id:'secret',operation_id:'secret',source:'manual'})
 const p={...scope,candidate_id:'cand-a'}
 assert.deepEqual(call('suggest_candidate_duplicates','outsider',p),[])
 assert.deepEqual(call('suggest_candidate_duplicates','staff-a',p).map(r=>r.id),['cand-b','cand-c'])
 assert.equal(db.prepare('SELECT count(*) n FROM hiring_candidate_merges').get().n,0)
 assert.equal(db.prepare('SELECT count(*) n FROM hiring_candidates WHERE merged_into IS NOT NULL').get().n,0)
 db.exec("UPDATE hiring_candidates SET email='' WHERE id='cand-a'")
 assert.deepEqual(call('suggest_candidate_duplicates','staff-a',p),[])
 db.close()
})
test('explicit owner merge records canonical field provenance, preserves applications and audits atomically',()=>{
 const {db,call}=setup()
 assert.equal(action('merge_candidates').step_up,true)
 const before=db.prepare('SELECT * FROM hiring_applications ORDER BY id').all()
 assert.deepEqual(call('merge_candidates','staff-a',merge),[1])
 assert.equal(db.prepare("SELECT merged_into FROM hiring_candidates WHERE id='cand-b'").get().merged_into,'cand-a')
 assert.deepEqual(db.prepare('SELECT * FROM hiring_applications ORDER BY id').all(),before)
 const rows=call('list_candidate_merges','staff-a',{...scope,candidate_id:'cand-a'})
 assert.equal(rows[0].name,'Person b');assert.equal(rows[0].email,'a@example.com')
 assert.equal(JSON.parse(rows[0].field_sources_json).name,'cand-b')
 assert.equal(rows[0].actor_user_id,'staff-a')
 assert.deepEqual(call('suggest_candidate_duplicates','staff-a',{...scope,candidate_id:'cand-a'}),[])
 assert.deepEqual(call('suggest_candidate_duplicates','staff-a',{...scope,candidate_id:'cand-c'}),[])
 assert.equal(db.prepare("SELECT count(*) n FROM hiring_audit_events WHERE action='candidate.merged'").get().n,1)
 assert.deepEqual(call('list_candidate_merges','outsider',{...scope,candidate_id:'cand-a'}),[])
 assert.deepEqual(call('merge_candidates','staff-a',merge),[0])
 for(const patch of [{source_id:'cand-a',target_id:'cand-b'},{source_id:'cand-c',target_id:'cand-b'},{source_id:'cand-c',target_id:'cand-a'},{source_id:'cand-a',target_id:'cand-c'}]) assert.deepEqual(call('merge_candidates','staff-a',{...merge,...patch,operation_id:crypto.randomUUID()}),[0])
 assert.throws(()=>db.exec("UPDATE hiring_candidate_merges SET reason='changed'"),/immutable/)
 assert.throws(()=>db.exec('DELETE FROM hiring_candidate_merges'),/immutable/)
 assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[])
 db.close()
})
test('invalid, forged, unauthorised and erasure-held merges leave no changes',()=>{
 const {db,call}=setup()
 for(const patch of [{source_id:'cand-a'},{target_id:'missing'},{brand_id:'other'},{organization_id:'other'},{name_source:'secret'},{email_source:''},{phone_source:'secret'},{linkedin_url_source:'secret'},{reason:' '},{reason:'x'.repeat(2001)},{operation_id:' '},{operation_id:'create-a'}]) assert.deepEqual(call('merge_candidates','staff-a',{...merge,...patch}),[0])
 assert.deepEqual(call('merge_candidates','outsider',merge),[0])
 db.exec("UPDATE hiring_memberships SET role='recruiter' WHERE user_id='staff-a'")
 assert.deepEqual(call('merge_candidates','staff-a',merge),[0])
 assert.equal(db.prepare('SELECT count(*) n FROM hiring_candidate_merges').get().n,0)
 db.close()
})
test('audit failures roll back canonical link and provenance',()=>{
 const {db,call}=setup()
 db.exec("CREATE TRIGGER fail_merge_audit BEFORE INSERT ON hiring_audit_events WHEN NEW.action='candidate.merged' BEGIN SELECT RAISE(ABORT,'audit failure'); END")
 assert.throws(()=>call('merge_candidates','staff-a',merge),/audit failure/)
 assert.equal(db.prepare('SELECT count(*) n FROM hiring_candidate_merges').get().n,0)
 assert.equal(db.prepare('SELECT count(*) n FROM hiring_candidates WHERE merged_into IS NOT NULL').get().n,0)
 db.close()
})
test('requisition grants authorize both sides separately and revocation takes effect',()=>{
 const {db,call}=setup()
 call('create_requisition','staff-a',{...scope,requisition_id:'req-other',title:'Other',operation_id:'other-req'})
 call('create_application','staff-a',{...candidate,requisition_id:'req-other',candidate_id:'hidden',application_id:'hidden',operation_id:'hidden',source:'manual'})
 call('grant_workspace_access','staff-a',{...scope,member_user_id:'limited',role:'recruiter',requisition_id:'req-a',grant_id:'limited-grant',operation_id:'limited-grant'})
 const p={...scope,candidate_id:'cand-a'}
 assert.deepEqual(call('suggest_candidate_duplicates','limited',p).map(r=>r.id),['cand-b','cand-c'])
 assert.deepEqual(call('suggest_candidate_duplicates','limited',{...p,candidate_id:'hidden'}),[])
 assert.deepEqual(call('merge_candidates','limited',merge),[0])
 assert.deepEqual(call('list_candidate_merges','limited',p),[])
 call('revoke_workspace_grant','staff-a',{...scope,grant_id:'limited-grant',operation_id:'revoke-limited'})
 assert.deepEqual(call('suggest_candidate_duplicates','limited',p),[])
 assert.equal(call('get_application','staff-a',{...scope,application_id:'app-a'})[0].candidate_id,'cand-a')
 db.close()
})
test('erasure fencing prevents suggestions and merges; erasure after merge redacts resolved fields',()=>{
 const {db,call}=setup()
 assert.deepEqual(call('merge_candidates','staff-a',merge),[1])
 call('request_candidate_erasure','staff-a',{...scope,application_id:'app-b',operation_id:'erase-b',identity_verified:1,holds_reviewed:1})
 const row=call('list_candidate_merges','staff-a',{...scope,candidate_id:'cand-a'})[0]
 assert.equal(row.name,'[redacted]')
 assert.equal(row.phone,'[redacted]')
 assert.equal(JSON.stringify(row).includes('Person b'),false)
 db.close()
 const f=setup()
 f.call('request_candidate_erasure','staff-a',{...scope,application_id:'app-b',operation_id:'erase-b',identity_verified:1,holds_reviewed:1})
 assert.deepEqual(f.call('merge_candidates','staff-a',merge),[0])
 assert.deepEqual(f.call('suggest_candidate_duplicates','staff-a',{...scope,candidate_id:'cand-b'}),[])
 f.db.close()
})
