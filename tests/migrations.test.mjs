import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
const migrations = JSON.parse(read('migrations.json')).migrations
const historical = JSON.parse(read('tests/fixtures/migrations-0001-0007.json')).migrations
function apply(db, entries) {
  db.exec('CREATE TABLE IF NOT EXISTS applied_migrations(name TEXT PRIMARY KEY)')
  for (const m of entries) {
    if (db.prepare('SELECT 1 FROM applied_migrations WHERE name=?').get(m.name)) continue
    db.exec('BEGIN')
    try {
      db.exec(m.sql)
      db.prepare('INSERT INTO applied_migrations VALUES (?)').run(m.name)
      db.exec('COMMIT')
    } catch (error) { db.exec('ROLLBACK'); throw error }
  }
}
function database() {
  const db = new DatabaseSync(':memory:')
  db.exec('PRAGMA foreign_keys=ON')
  return db
}
function seed(db) {
  for (const x of ['a', 'b']) {
    db.exec(`INSERT INTO hiring_organizations VALUES ('org-${x}','Org','staff',0);
      INSERT INTO hiring_brands VALUES ('brand-${x}','org-${x}','Brand',0);
      INSERT INTO hiring_requisitions(id,organization_id,brand_id,title,created_at) VALUES ('req-${x}','org-${x}','brand-${x}','Engineer',0);
      INSERT INTO hiring_candidates(id,organization_id,brand_id,name,linkedin_url,created_by,created_at) VALUES ('candidate-${x}','org-${x}','brand-${x}','Person','','staff',0);
      INSERT INTO hiring_applications VALUES ('app-${x}','org-${x}','brand-${x}','req-${x}','candidate-${x}','linkedin','manual','basis','context','staff','submitted',1,'staff',0,0)`)
  }
}

test('historical migrations are immutable; populated upgrade and tracked replay preserve data', () => {
  assert.deepEqual(migrations.slice(0, historical.length), historical)
  const db = database()
  apply(db, historical)
  db.exec("INSERT INTO items VALUES ('legacy','user','Title','active',0)")
  seed(db)
  apply(db, migrations)
  const snapshot = db.prepare('SELECT * FROM hiring_applications ORDER BY id').all()
  apply(db, migrations)
  assert.deepEqual(db.prepare('SELECT * FROM hiring_applications ORDER BY id').all(), snapshot)
  assert.equal(db.prepare('SELECT title FROM items').get().title, 'Title')
  assert.equal(db.prepare('SELECT retention_policy FROM hiring_organizations LIMIT 1').get().retention_policy, 'indefinite')
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), [])
  const fresh = database()
  apply(fresh, migrations)
  assert.deepEqual(fresh.prepare('PRAGMA foreign_key_check').all(), [])
  db.close(); fresh.close()
})

test('provider-aware mail migration preserves populated historical Gmail archives byte-for-byte', () => {
  const db = database(); apply(db, historical); seed(db)
  db.prepare('INSERT INTO hiring_communication_events VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run('gmail-before','org-a','brand-a','app-a','inbound','gmail','person@example.com','admin@freeappstore.online','Original subject','Original full body','opaque-gmail-id','opaque-thread',1,'staff','agent','original-op',1)
  const before = db.prepare('SELECT * FROM hiring_communication_events').all()
  apply(db, migrations); apply(db, migrations)
  assert.deepEqual(db.prepare('SELECT * FROM hiring_communication_events').all(), before.map(row => Object.assign(Object.create(null), row, { logical_email_id: null })))
  assert.equal(db.prepare('SELECT count(*) AS n FROM hiring_worker_communication_events').get().n, 0)
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), [])
  assert.throws(() => db.prepare('INSERT INTO hiring_worker_communication_events(id,organization_id,brand_id,application_id,direction,mailbox_address,from_email,to_email,subject,body,provider_message_id,occurred_at,actor_user_id,agent_instance_id,operation_id,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run('bad','org-a','brand-a','app-b','inbound','admin@freeappstore.online','person@example.com','admin@freeappstore.online','Subject','Body','worker-id',1,'staff','agent','worker-op',1), /FOREIGN KEY/)
  db.close()
})

test('new grants and governance reject cross-tenant references; workers remain independent', () => {
  const db = database(); apply(db, historical); seed(db); apply(db, migrations)
  db.exec("INSERT INTO hiring_worker_profiles(user_id,display_name,created_at,updated_at) VALUES ('worker','Worker',0,0)")
  db.exec("UPDATE hiring_candidates SET worker_user_id='worker' WHERE id='candidate-a'")
  assert.throws(() => db.exec("UPDATE hiring_candidates SET worker_user_id='missing'"), /FOREIGN KEY/)
  const grant = db.prepare('INSERT INTO hiring_grants(id,organization_id,brand_id,requisition_id,user_id,role,granted_by,created_at) VALUES (?,?,?,?,?,?,?,?)')
  grant.run('ok','org-a','brand-a','req-a','staff','reviewer','owner',0)
  assert.throws(() => grant.run('bad','org-a','brand-b',null,'staff','reviewer','owner',0), /FOREIGN KEY/)
  assert.throws(() => grant.run('bad','org-a','brand-a','req-b','staff','reviewer','owner',0), /FOREIGN KEY/)
  const consent = db.prepare("INSERT INTO hiring_consent_records VALUES (?, 'org-a','brand-a',?,'recruitment','contract','v1','evidence','worker',0,NULL)")
  consent.run('ok','app-a')
  assert.throws(() => consent.run('bad','app-b'), /FOREIGN KEY/)
  const rights = db.prepare("INSERT INTO hiring_rights_requests(id,organization_id,brand_id,candidate_id,request_type,actor_user_id,created_at,updated_at) VALUES (?,'org-a','brand-a',?,'deletion','worker',0,0)")
  rights.run('ok','candidate-a')
  assert.throws(() => rights.run('bad','candidate-b'), /FOREIGN KEY/)
  assert.throws(() => db.exec("UPDATE hiring_applications SET brand_id='brand-b' WHERE id='app-a'"), /scope is immutable/)
  db.close()
})

test('every legacy application child rejects mismatched scope on insert and update', () => {
  const db = database(); apply(db, historical); seed(db)
  // Generate minimal values from SQLite metadata to exercise every child constraint.
  apply(db, migrations)
  db.exec("INSERT INTO hiring_brands(id,organization_id,name,created_at) VALUES ('brand-other','org-a','Other',0)")
  for (const table of ['hiring_stage_events','hiring_notes','hiring_outbox','hiring_assignment_events','hiring_communication_events','hiring_agent_activity','hiring_audit_events']) {
    const values = { id: table, organization_id: 'org-a', brand_id: 'brand-a', application_id: 'app-a', direction: 'inbound', channel: 'gmail', activity_type: 'email_thread_scanned', delivery_reason: 'quota' }
    const columns = db.prepare(`PRAGMA table_info(${table})`).all().filter(c => c.dflt_value === null && !['logical_email_id','receipt_application_id'].includes(c.name))
    const params = columns.map(c => values[c.name] ?? (c.type === 'INTEGER' ? 1 : 'value'))
    const sql = `INSERT INTO ${table} (${columns.map(c => c.name).join(',')}) VALUES (${columns.map(() => '?').join(',')})`
    db.prepare(sql).run(...params)
    assert.throws(() => db.prepare(`UPDATE ${table} SET application_id='app-b' WHERE id=?`).run(table), /scope mismatch|audit is append-only|email archives are append-only|stage history is append-only/, table)
    assert.throws(() => db.prepare(`UPDATE ${table} SET brand_id='brand-other' WHERE id=?`).run(table), /scope mismatch|audit is append-only|email archives are append-only|stage history is append-only/, table)
    const bad = [...params]; bad[columns.findIndex(c => c.name === 'id')] += '-bad'; bad[columns.findIndex(c => c.name === 'application_id')] = 'app-b'
    assert.throws(() => db.prepare(sql).run(...bad), /scope mismatch|audit is append-only|email archives are append-only|stage history is append-only/, table)
  }
  db.close()
})

test('deploy stops on migration failure before worker, actions and frontend', () => {
  const workflow = read('.github/workflows/deploy.yml')
  const start = workflow.indexOf('- name: Apply D1 migrations')
  const end = workflow.indexOf('\n      - name:', start + 1)
  assert.ok(start > 0)
  assert.match(workflow.slice(start, end), /exit 1/)
  assert.doesNotMatch(workflow.slice(start, end), /continue-on-error/)
  for (const step of ['Deploy app worker', 'Register app tools', 'Upload to R2']) assert.ok(workflow.indexOf('- name: ' + step) > start, step)
})


test('0010 upgrades populated 0009, preserves audit and memberships, replays and enforces immutable audit', () => {
  const db = database()
  const baseline = JSON.parse(read('tests/fixtures/migrations-0001-0009.json')).migrations
  assert.deepEqual(migrations.slice(0, baseline.length), baseline)
  apply(db, historical); seed(db); apply(db, baseline)
  db.exec("INSERT INTO hiring_memberships VALUES ('member','org-a','brand-a','staff','owner',0)")
  db.exec("INSERT INTO hiring_audit_events(id,organization_id,brand_id,action,actor_user_id,operation_id,created_at) VALUES ('audit','org-a','brand-a','workspace.created','staff','op',0)")
  const audits = db.prepare('SELECT * FROM hiring_audit_events').all()
  const members = db.prepare('SELECT * FROM hiring_memberships').all()
  apply(db, migrations); apply(db, migrations)
  assert.deepEqual(db.prepare('SELECT * FROM hiring_audit_events').all(), audits)
  assert.deepEqual(db.prepare('SELECT * FROM hiring_memberships').all(), members)
  assert.equal(db.prepare('SELECT operation_id FROM hiring_brands LIMIT 1').get().operation_id, null)
  assert.throws(() => db.exec("UPDATE hiring_audit_events SET actor_user_id='forged'"), /append-only/)
  assert.throws(() => db.exec('DELETE FROM hiring_audit_events'), /append-only/)
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), [])
  db.close()
})

test('0011 expands populated legacy applications without changing source constraints or opening intake', () => {
  const db = database()
  apply(db, historical); seed(db)
  apply(db, migrations); apply(db, migrations)
  assert.equal(db.prepare("SELECT source FROM hiring_applications WHERE id='app-a'").get().source,'linkedin')
  assert.equal(db.prepare('SELECT intake_status FROM hiring_runtime_gate').get().intake_status,'closed')
  assert.throws(() => db.exec("UPDATE hiring_applications SET source='direct'"),/CHECK/)
  assert.throws(() => db.exec("UPDATE hiring_requisitions SET status='published'"),/CHECK/)
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[])
  db.close()
})

test('untracked 0011 retries safely after partial DDL, including the unused legacy expansion column', () => {
  const db = database()
  apply(db,migrations.slice(0,10))
  // D1 can commit individual DDL statements before the migration tracking insert.
  db.exec("ALTER TABLE hiring_applications ADD COLUMN intake_source TEXT NOT NULL DEFAULT 'linkedin' CHECK(intake_source IN ('linkedin','direct'))")
  db.exec(migrations[10].sql)
  apply(db,migrations)
  db.exec(migrations[10].sql)
  assert.equal(db.prepare("SELECT count(*) AS n FROM applied_migrations WHERE name=?").get(migrations[10].name).n,1)
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[])
  db.close()
})

test('0012 retries after partial DDL and resolves existing memberships without rewriting them', () => {
  const db = database()
  apply(db, migrations.slice(0, 11))
  db.exec("INSERT INTO hiring_organizations(id,name,created_by,created_at) VALUES ('scope-org','Org','owner',0)")
  db.exec("INSERT INTO hiring_brands(id,organization_id,name,created_at) VALUES ('scope-brand','scope-org','Brand',0)")
  db.exec("INSERT INTO hiring_memberships(id,organization_id,brand_id,user_id,role,created_at) VALUES ('scope-member','scope-org','scope-brand','owner','owner',0)")
  db.exec("CREATE TABLE hiring_membership_revocations (membership_id TEXT PRIMARY KEY REFERENCES hiring_memberships(id), actor_user_id TEXT NOT NULL, operation_id TEXT NOT NULL UNIQUE, created_at INTEGER NOT NULL)")
  apply(db, migrations)
  db.exec(migrations[11].sql)
  assert.equal(db.prepare("SELECT role FROM hiring_effective_access WHERE user_id='owner'").get().role, 'owner')
  db.exec("INSERT INTO hiring_membership_revocations VALUES ('scope-member','admin','revoke',1)")
  assert.equal(db.prepare("SELECT count(*) n FROM hiring_effective_access WHERE user_id='owner'").get().n, 0)
  assert.equal(db.prepare("SELECT count(*) n FROM hiring_memberships WHERE user_id='owner'").get().n, 1)
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), [])
  db.close()
})

test('generic sources upgrade populated applications without relabelling history and retry after partial DDL', () => {
  const db = database()
  apply(db, historical); seed(db)
  apply(db, migrations.slice(0, migrations.findIndex(m => m.name === '0016_generic_application_sources')))
  const before = db.prepare('SELECT * FROM hiring_applications ORDER BY id').all()
  db.exec('CREATE TABLE hiring_application_sources (application_id TEXT PRIMARY KEY REFERENCES hiring_applications(id), source TEXT NOT NULL CHECK(length(trim(source)) BETWEEN 1 AND 100), profile_url TEXT CHECK(profile_url IS NULL OR (length(profile_url)<=2000 AND (profile_url LIKE \'https://%\' OR profile_url LIKE \'http://%\'))))')
  apply(db, migrations); db.exec(migrations.find(m => m.name === '0016_generic_application_sources').sql); apply(db, migrations)
  assert.deepEqual(db.prepare('SELECT * FROM hiring_applications ORDER BY id').all(), before.map(row => Object.assign(row, {stage_extension:null,accepted_stage:null,acceptance_evidence:null,lifecycle_stage:null,workflow_stage:null,workflow_acceptance_evidence:null,discord_handle:null,interns_app_id:null,interns_invite_status:'not_started',interns_registration_status:null,links_json:'[]'})))
  assert.equal(db.prepare('SELECT count(*) n FROM hiring_application_sources').get().n, 0)
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), [])
  db.close()
})
