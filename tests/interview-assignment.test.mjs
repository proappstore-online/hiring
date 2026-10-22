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
test('create, packet allowlist, reassignment, replay, revocation and immutable evidence',()=>{
 const f=setup();const {db,call}=f
 try{
 assert.equal(call('create_interview','staff-a',create).at(-1),1)
 assert.ok(call('create_interview','staff-a',create).every(n=>n===0))
 const row=JSON.parse(packet(f,'reviewer')[0].packet_json)
 assert.deepEqual(Object.keys(row).sort(),['candidate_name','requisition_title','stage','scheduled_at','duration_minutes','location','format','status'].sort())
 assert.equal(row.candidate_name,'A Person');assert.equal(row.scheduled_at,create.scheduled_at)
 assert.equal(JSON.parse(packet(f,'staff-a')[0].packet_json).email,'a@example.com')
 assert.deepEqual(packet(f,'unassigned'),[])
 assert.deepEqual(packet(f,'reviewer',{tenant_id:'forged'}),[])
 assert.deepEqual(packet(f,'reviewer',{brand_id:'forged'}),[])
 assert.equal(call('assign_interviewer','staff-a',assign).at(-1),1)
 assert.ok(db.prepare("SELECT revoked_at FROM interview_assignments WHERE id='assignment-a'").get().revoked_at)
 assert.equal(db.prepare("SELECT count(*) n FROM hiring_audit_events WHERE operation_id IN ('reassign-interview','reassign-interview-revoked')").get().n,2)
 assert.deepEqual(packet(f,'reviewer'),[]);assert.equal(packet(f,'next').length,1)
 assert.ok(call('assign_interviewer','staff-a',assign).every(n=>n===0))
 assert.equal(db.prepare('SELECT count(*) n FROM interview_assignments').get().n,2)
 assert.equal(db.prepare('SELECT count(*) n FROM interview_assignment_history').get().n,3)
 assert.throws(()=>db.exec('DELETE FROM interview_assignment_history'),/append-only/)
 assert.throws(()=>db.exec("UPDATE interview_assignment_history SET reviewer_id='forged'"),/append-only/)
 assert.equal(call('revoke_interviewer','staff-a',{...base,expected_version:2,reason:'Removed',operation_id:'revoke-interview'}).at(-1),1)
 assert.deepEqual(packet(f,'next'),[])
 assert.equal(call('assign_interviewer','staff-a',{...assign,expected_version:3,operation_id:'restore',assignment_id:'restore'}).at(-1),1)
 assert.equal(packet(f,'next').length,1)
 call('revoke_workspace_grant','staff-a',{...scope,grant_id:'next',operation_id:'revoke-grant'})
 assert.deepEqual(packet(f,'next'),[])
 }finally{db.close()}
})
test('schedule version, role, scope, target, validation and audit rollback',()=>{
 const f=setup();const{db,call}=f
 try{
 call('create_interview','staff-a',create)
 const update={...base,expected_version:1,operation_id:'schedule',scheduled_at:null,duration_minutes:45,location:'New room',format:'panel'}
 for(const patch of [{expected_version:0},{tenant_id:'wrong'},{brand_id:'wrong'},{application_id:'wrong'},{interview_id:'wrong'},{duration_minutes:-1},{format:'invalid'}])assert.ok(call('update_interview_schedule','staff-a',{...update,...patch}).every(n=>n===0))
 for(const user of ['reviewer','outsider']){
 assert.ok(call('update_interview_schedule',user,update).every(n=>n===0))
 assert.ok(call('assign_interviewer',user,assign).every(n=>n===0))
 }
 assert.ok(call('assign_interviewer','staff-a',{...assign,reviewer_id:'outsider'}).every(n=>n===0))
 assert.equal(call('update_interview_schedule','staff-a',update).at(-1),1)
 assert.ok(call('update_interview_schedule','staff-a',update).every(n=>n===0))
 db.exec("CREATE TRIGGER fail_interview_audit BEFORE INSERT ON hiring_audit_events WHEN NEW.action='interview.assigned' BEGIN SELECT RAISE(ABORT,'audit unavailable'); END")
 assert.throws(()=>call('assign_interviewer','staff-a',{...assign,expected_version:2}),/audit unavailable/)
 assert.equal(db.prepare('SELECT version FROM interviews').get().version,2)
 assert.equal(packet(f,'reviewer').length,1)
 }finally{db.close()}
})

test('real sibling-brand reviewers and forged direct IDs cannot access interview records',()=>{
 const f=setup();const {db,call}=f
 try {
  call('create_interview','staff-a',create)
  const B={organization_id:'org-a',brand_id:'brand-b'}
  db.exec("INSERT INTO hiring_brands(id,organization_id,name,created_at) VALUES ('brand-b','org-a','Brand B',0); INSERT INTO hiring_requisitions(id,organization_id,brand_id,title,status,created_at) VALUES ('req-b','org-a','brand-b','Other role','draft',0)")
  call('grant_workspace_access','staff-a',{...scope,grant_id:'brand-b-reviewer',member_user_id:'brand-b-reviewer',role:'reviewer',requisition_id:'req-a',operation_id:'grant-temp'})
  // Revoke A authority, then grant the same identity only in B.
  call('revoke_workspace_grant','staff-a',{...scope,grant_id:'brand-b-reviewer',operation_id:'revoke-temp'})
  db.exec("INSERT INTO hiring_grants(id,organization_id,brand_id,requisition_id,user_id,role,status,granted_by,created_at) VALUES ('b-reviewer','org-a','brand-b','req-b','brand-b-reviewer','reviewer','active','staff-a',0)")
  assert.deepEqual(packet(f,'brand-b-reviewer'),[])
  assert.deepEqual(packet(f,'reviewer',{brand_id:B.brand_id}),[])
  assert.ok(call('assign_interviewer','staff-a',{...assign,reviewer_id:'brand-b-reviewer'}).every(n=>n===0))
  // A stale request with a new ID changes neither assignment nor audit.
  const count=db.prepare('SELECT count(*) n FROM hiring_audit_events').get().n
  assert.ok(call('assign_interviewer','staff-a',{...assign,expected_version:99}).every(n=>n===0))
  assert.equal(db.prepare('SELECT count(*) n FROM hiring_audit_events').get().n,count)
  assert.equal(packet(f,'reviewer').length,1)
  db.exec("UPDATE hiring_organizations SET status='suspended' WHERE id='org-a'")
  assert.deepEqual(packet(f,'reviewer'),[])
  assert.deepEqual(packet(f,'staff-a'),[])
 }finally{db.close()}
})

test('audit outages roll back create, schedule and revocation; forged retries cannot reuse success',()=>{
 const f=setup();const{db,call}=f
 try{
  db.exec("CREATE TRIGGER fail_create_audit BEFORE INSERT ON hiring_audit_events WHEN NEW.action='interview.created' BEGIN SELECT RAISE(ABORT,'audit unavailable'); END")
  assert.throws(()=>call('create_interview','staff-a',create),/audit unavailable/)
  assert.equal(db.prepare('SELECT count(*) n FROM interviews').get().n,0)
  assert.equal(db.prepare('SELECT count(*) n FROM interview_assignments').get().n,0)
  db.exec('DROP TRIGGER fail_create_audit')
  call('create_interview','staff-a',create)
  assert.equal(call('assign_interviewer','staff-a',assign).at(-1),1)
  const snapshot=()=>JSON.stringify(['interviews','interview_assignments','interview_assignment_history','hiring_audit_events'].map(table=>db.prepare('SELECT * FROM '+table).all()))
  const before=snapshot()
  assert.ok(call('assign_interviewer','outsider',{...assign,expected_version:2,assignment_id:'forged',reviewer_id:'reviewer'}).every(n=>n===0))
  assert.equal(snapshot(),before)
  db.exec("CREATE TRIGGER fail_metadata_audit BEFORE INSERT ON hiring_audit_events WHEN NEW.action IN ('interview.assignment_revoked','interview.schedule_updated') BEGIN SELECT RAISE(ABORT,'audit unavailable'); END")
  assert.throws(()=>call('revoke_interviewer','staff-a',{...base,expected_version:2,reason:'Remove',operation_id:'failed-revoke'}),/audit unavailable/)
  assert.equal(snapshot(),before)
  assert.throws(()=>call('update_interview_schedule','staff-a',{...base,expected_version:2,format:'phone',operation_id:'failed-schedule'}),/audit unavailable/)
  assert.equal(snapshot(),before)
 }finally{db.close()}
})
