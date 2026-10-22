import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'

const migrations = JSON.parse(readFileSync(new URL('../migrations.json', import.meta.url))).migrations
const tools = JSON.parse(readFileSync(new URL('../mcp.json', import.meta.url))).tools
function fixture() {
  const db = new DatabaseSync(':memory:')
  db.exec('PRAGMA foreign_keys=ON')
  for (const m of migrations) db.exec(m.sql)
  const call = (name, user, values = {}) => {
    const t = tools.find(t => t.name === name)
    assert.equal(t.requires_auth, true)
    const params = { ...values, __user_id: user, __now: 123 }
    db.exec('BEGIN')
    try {
      const results = (t.statements ?? [t.sql]).map(statement => {
        const bindings = []
        const sql = statement.replace(/:([a-z_][a-z0-9_]*)/gi, (_, key) => {
          assert.notEqual(params[key], undefined, key)
          bindings.push(params[key]); return '?'
        })
        const stmt = db.prepare(sql)
        return /^\s*(SELECT|WITH)\b/i.test(sql) ? stmt.all(...bindings).map(r => ({ ...r })) : stmt.run(...bindings).changes
      })
      db.exec('COMMIT')
      return t.operation === 'query' ? results[0] : results
    } catch (e) { db.exec('ROLLBACK'); throw e }
  }
  for (const id of ['a', 'b']) call('create_workspace', 'owner-' + id, {
    organization_id: id, brand_id: 'brand-' + id, requisition_id: 'req-' + id,
    organization_name: id, brand_name: id, requisition_title: 'Engineer', operation_id: 'boot-' + id,
  })
  for (const [user, role, req] of [['recruiter','recruiter',null],['agent','recruiter',null],['reviewer','reviewer',null],['auditor','auditor',null],['scoped','recruiter','req-a']]) {
    db.prepare("INSERT INTO hiring_grants(id,organization_id,user_id,role,brand_id,requisition_id,granted_by,created_at) VALUES (?,'a',?,?,?,?,'owner-a',0)")
      .run(user,user,role,req ? 'brand-a' : null,req)
  }
  const get = (user = 'owner-a', org = 'a') => call('get_org_recruiting_playbook',user,{ organization_id:org })
  const save = (version = 0, user = 'owner-a', payload = '{}', operation = 'save-' + version) =>
    call('save_org_recruiting_playbook', user, { organization_id:'a', expected_version:version, payload, operation_id:operation })
  return { db, call, get, save }
}

test('playbook tenant, role, scoped grant, revocation and suspended-org boundaries', () => {
  const { db, get, save } = fixture()
  try {
    for (const user of ['owner-b','outsider','reviewer','auditor','scoped','recruiter','agent']) {
      assert.deepEqual(save(0,user),[0,[]])
    }
    save()
    for (const user of ['owner-b','outsider','reviewer','auditor','scoped',null]) assert.deepEqual(get(user),[])
    for (const user of ['owner-a','recruiter','agent']) assert.equal(get(user)[0].version,1)
    assert.deepEqual(get('owner-a','b'),[])
    db.exec("UPDATE hiring_grants SET status='revoked' WHERE user_id='agent'")
    assert.deepEqual(get('agent'),[])
    db.exec("UPDATE hiring_organizations SET status='suspended' WHERE id='a'")
    assert.deepEqual(get(),[])
    assert.deepEqual(save(1),[0,[]])
  } finally { db.close() }
})

test('authorised absent playbook has a safe fallback; outsiders cannot probe existence', () => {
  const { db,get } = fixture()
  try {
    assert.deepEqual(get('agent'),[{ version:0,payload:null,updated_at:null,actor_user_id:null,message:'No playbook configured' }])
    assert.deepEqual(get('outsider'),[])
    assert.deepEqual(get('owner-a','missing'),[])
  } finally { db.close() }
})

test('versions and audit are immutable, concurrent writes abort, and audit failures roll back', () => {
  const { db,save,get } = fixture()
  try {
    assert.deepEqual(save(),[1,[{version:1,updated_at:123}]])
    assert.deepEqual(save(1,'owner-a','{"intake_channels":["linkedin"]}'),[1,[{version:2,updated_at:123}]])
    assert.throws(() => save(1,'owner-a','{}','stale'),/version conflict/)
    assert.throws(() => save(2,'owner-a','{}','save-0'),/UNIQUE/)
    assert.equal(get()[0].version,2)
    const audit = db.prepare('SELECT * FROM hiring_org_playbook_audit ORDER BY version').all()
    assert.deepEqual(audit.map(r=>[r.version,r.operation_id,r.actor_user_id]),[[1,'save-0','owner-a'],[2,'save-1','owner-a']])
    for (const table of ['hiring_org_playbooks','hiring_org_playbook_audit']) {
      assert.throws(()=>db.exec('DELETE FROM '+table),/immutable/)
      assert.throws(()=>db.exec('UPDATE '+table+" SET actor_user_id='forged'"),/immutable/)
    }
    db.exec("CREATE TRIGGER fail_playbook_audit BEFORE INSERT ON hiring_org_playbook_audit BEGIN SELECT RAISE(ABORT,'audit failed'); END")
    assert.throws(()=>save(2),/audit failed/)
    assert.equal(get()[0].version,2)
    assert.equal(db.prepare('SELECT count(*) AS n FROM hiring_org_playbook_audit').get().n,2)
  } finally { db.close() }
})

test('invalid payload and version inputs cannot create a version or audit event', () => {
  const { db,save } = fixture()
  try {
    for (const payload of ['invalid','null','[]','42','"text"']) assert.throws(()=>save(0,'owner-a',payload))
    for (const version of [-1,0.5,'0']) assert.deepEqual(save(version),[0,[]])
    assert.deepEqual(save(0,'owner-a','{}',' '),[0,[]])
    assert.equal(db.prepare('SELECT count(*) AS n FROM hiring_org_playbooks').get().n,0)
    assert.equal(db.prepare('SELECT count(*) AS n FROM hiring_org_playbook_audit').get().n,0)
  } finally { db.close() }
})

test('all readers receive recursive redaction while stored policy and history remain intact', () => {
  const { db,save,get } = fixture()
  try {
    const payload = { intake_channels:['linkedin'],secret_meeting_link:'sensitive',meeting_password:'password',
      meeting:{ timezone:'Australia/Melbourne',secret_notes:{token:'hidden'},meeting_password:'hidden' },
      steps:[{name:'Observe stand-up',secret_reference:'hidden'},{name:'1:1',nested:{Secret_token:'hidden'}}],
      'secret_quoted"key':'hidden', secrets_are_not_prefixed:'keep' }
    save(0,'owner-a',JSON.stringify(payload))
    for (const user of ['owner-a','recruiter','agent']) {
      const result = JSON.parse(get(user)[0].payload)
      assert.deepEqual(result,{ intake_channels:['linkedin'],meeting:{timezone:'Australia/Melbourne'},
        steps:[{name:'Observe stand-up'},{name:'1:1',nested:{}}],secrets_are_not_prefixed:'keep' })
    }
    assert.deepEqual(JSON.parse(db.prepare('SELECT payload FROM hiring_org_playbooks').get().payload),payload)
    assert.ok(!JSON.stringify(db.prepare('SELECT * FROM hiring_org_playbook_audit').all()).includes('sensitive'))
  } finally { db.close() }
})
