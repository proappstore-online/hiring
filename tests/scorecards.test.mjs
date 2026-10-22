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

const base={tenant_id:'org-a',brand_id:'brand-a',application_id:'app-a',interview_id:'interview-a'}
const create={...base,operation_id:'interview-create',assignment_id:'assignment-a',reviewer_id:'reviewer',format:'video',scheduled_at:1800000000000,duration_minutes:30,location:'Room'}
function setup(){const f=seeded();for(const user of ['reviewer','next','unassigned'])f.call('grant_workspace_access','staff-a',{...scope,grant_id:user,member_user_id:user,role:'reviewer',requisition_id:'req-a',operation_id:'grant-'+user});return f}
const packet=(f,user,patch={})=>f.call('read_interview_packet',user,{...base,...patch})
const assign={...base,expected_version:1,reviewer_id:'next',assignment_id:'assignment-b',reason:'New reviewer',operation_id:'reassign-interview'}
const criteria = JSON.stringify([{criterion:'Problem solving',rating:4,evidence:'Explained tradeoffs with a concrete example'}])
const card = {...base,assignment_id:'assignment-a'}
const save = {...card,expected_version:0,status:'draft',criteria_json:criteria,operation_id:'card-1'}
const versions = (f,user='reviewer',patch={})=>f.call('read_own_scorecard',user,{...card,...patch})
function ready(){const f=setup();f.call('create_interview','staff-a',create);return f}

test('scorecard drafts, immutable submission, timestamps, projections and version pagination',()=>{
 const f=ready();try{
 assert.equal(f.call('save_own_scorecard','reviewer',save).at(-1),1)
 assert.equal(f.call('save_own_scorecard','reviewer',{...save,expected_version:1,operation_id:'card-2',criteria_json:criteria.replace('4','5')}).at(-1),1)
 assert.equal(f.call('save_own_scorecard','reviewer',{...save,expected_version:2,status:'submitted',operation_id:'card-submit'}).at(-1),1)
 const rows=versions(f);assert.deepEqual(rows.map(r=>r.version),[3,2,1])
 assert.equal(rows[0].submitted_at,rows[0].created_at);assert.equal(rows[1].submitted_at,null)
 assert.deepEqual(Object.keys(rows[0]).sort(),['assignment_id','version','status','criteria_json','created_at','submitted_at'].sort())
 assert.deepEqual(versions(f,'reviewer',{before_version:2}).map(r=>r.version),[1])
 assert.ok(f.call('save_own_scorecard','reviewer',{...save,expected_version:3,operation_id:'post-submit'}).every(n=>n===0))
 assert.throws(()=>f.db.exec('DELETE FROM hiring_scorecard_versions'),/append-only/)
 assert.throws(()=>f.db.exec("UPDATE hiring_scorecard_versions SET submitted_at=0"),/append-only/)
 const events=f.db.prepare("SELECT action,actor_user_id,redacted_summary FROM hiring_audit_events WHERE object_type='scorecard'").all()
 assert.deepEqual(events.map(r=>r.action),['scorecard.draft_saved','scorecard.draft_saved','scorecard.submitted'])
 assert.ok(events.every(e=>e.actor_user_id==='reviewer'&&!e.redacted_summary.includes('Problem')))
 }finally{f.db.close()}
})
test('scorecards enforce current ownership, assignment identity, grants and every scope',()=>{
 const f=ready();try{
 f.call('save_own_scorecard','reviewer',save)
 for(const user of ['staff-a','next','unassigned','outsider']){
 assert.deepEqual(versions(f,user),[])
 assert.ok(f.call('save_own_scorecard',user,{...save,expected_version:1,operation_id:'forged-'+user}).every(n=>n===0))
 }
 for(const patch of [{tenant_id:'other'},{brand_id:'other'},{application_id:'other'},{interview_id:'other'},{assignment_id:'other'}]){
 assert.deepEqual(versions(f,'reviewer',patch),[])
 assert.ok(f.call('save_own_scorecard','reviewer',{...save,...patch,operation_id:'forged'}).every(n=>n===0))
 }
 f.call('assign_interviewer','staff-a',assign)
 assert.deepEqual(versions(f),[]);assert.deepEqual(versions(f,'next'),[])
 assert.ok(f.call('save_own_scorecard','reviewer',{...save,expected_version:1,operation_id:'revoked'}).every(n=>n===0))
 const next={...save,assignment_id:'assignment-b',operation_id:'next-card'}
 assert.equal(f.call('save_own_scorecard','next',next).at(-1),1)
 assert.equal(versions(f,'next',{assignment_id:'assignment-b'}).length,1)
 f.call('assign_interviewer','staff-a',{...assign,expected_version:2,reviewer_id:'reviewer',assignment_id:'assignment-c',operation_id:'return-reviewer'})
 assert.deepEqual(versions(f),[])
 assert.equal(f.call('save_own_scorecard','reviewer',{...save,assignment_id:'assignment-c',operation_id:'return-card'}).at(-1),1)
 f.call('revoke_workspace_grant','staff-a',{...scope,grant_id:'reviewer',operation_id:'revoke-reviewer'})
 assert.deepEqual(versions(f,'reviewer',{assignment_id:'assignment-c'}),[])
 assert.equal(f.db.prepare('SELECT count(*) n FROM hiring_scorecard_versions').get().n,3)
 }finally{f.db.close()}
})
test('scorecard stale requests, global duplicate IDs and audit failure are atomic',()=>{
 const f=ready();try{
 f.call('save_own_scorecard','reviewer',save)
 const count=()=>f.db.prepare('SELECT count(*) n FROM hiring_audit_events').get().n
 const n=count()
 for(const patch of [{},{expected_version:1},{operation_id:'stale'},{operation_id:'bootstrap-a',expected_version:1}])assert.ok(f.call('save_own_scorecard','reviewer',{...save,...patch}).every(n=>n===0))
 assert.equal(count(),n)
 f.db.exec("CREATE TRIGGER fail_scorecard_audit BEFORE INSERT ON hiring_audit_events WHEN NEW.object_type='scorecard' BEGIN SELECT RAISE(ABORT,'audit unavailable'); END")
 assert.throws(()=>f.call('save_own_scorecard','reviewer',{...save,expected_version:1,operation_id:'failed'}),/audit unavailable/)
 assert.equal(versions(f).length,1);assert.equal(count(),n)
 }finally{f.db.close()}
})
test('scorecard criterion validation rejects malformed and unstructured capture',()=>{
 const f=ready();try{
 for(const invalid of ['bad','{}','[]','[null]',JSON.stringify([{criterion:'',rating:3,evidence:''}]),JSON.stringify([{criterion:'A',rating:1.5,evidence:''}]),JSON.stringify([{criterion:'A',rating:6,evidence:''}]),JSON.stringify([{criterion:'A',rating:3,evidence:'',email:'secret'}]),JSON.stringify([{criterion:'A',rating:3,evidence:''},{criterion:' a ',rating:4,evidence:''}])]){
 assert.throws(()=>f.call('save_own_scorecard','reviewer',{...save,criteria_json:invalid}))
 }
 assert.throws(()=>f.call('save_own_scorecard','reviewer',{...save,status:'submitted',criteria_json:JSON.stringify([{criterion:'A',rating:3,evidence:' '}])}))
 assert.equal(versions(f).length,0)
 }finally{f.db.close()}
})
test('sibling brand reviewer, suspended tenant and forged storage ownership are denied',()=>{
 const f=ready();try{
 f.call('save_own_scorecard','reviewer',save)
 f.db.exec("INSERT INTO hiring_brands(id,organization_id,name,created_at) VALUES ('brand-b','org-a','B',0); INSERT INTO hiring_requisitions(id,organization_id,brand_id,title,status,created_at) VALUES ('req-b','org-a','brand-b','Other','draft',0); INSERT INTO hiring_grants(id,organization_id,brand_id,requisition_id,user_id,role,status,granted_by,created_at) VALUES ('b','org-a','brand-b','req-b','other-reviewer','reviewer','active','staff-a',0)")
 assert.deepEqual(versions(f,'other-reviewer'),[])
 assert.ok(f.call('save_own_scorecard','other-reviewer',{...save,operation_id:'sibling'}).every(n=>n===0))
 assert.throws(()=>f.db.exec("INSERT INTO hiring_scorecard_versions SELECT 'forged',assignment_id,interview_id,application_id,tenant_id,brand_id,requisition_id,'other-reviewer',2,status,criteria_json,created_at,submitted_at,'forged' FROM hiring_scorecard_versions"),/assignment mismatch/)
 f.db.exec("UPDATE hiring_organizations SET status='suspended' WHERE id='org-a'")
 assert.deepEqual(versions(f),[])
 assert.ok(f.call('save_own_scorecard','reviewer',{...save,expected_version:1,operation_id:'suspended'}).every(n=>n===0))
 }finally{f.db.close()}
})
