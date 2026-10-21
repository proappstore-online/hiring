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
const A = { organization_id: 'org', brand_id: 'a' }
const B = { organization_id: 'org', brand_id: 'b' }
const boot = (scope, operation_id = `boot-${scope.brand_id}`) => ({ ...scope, organization_name: 'Organization', brand_name: scope.brand_id, requisition_id: `req-${scope.brand_id}`, requisition_title: 'Engineer', operation_id })
const person = s => ({ ...s, requisition_id: `req-${s.brand_id}`, candidate_id: `candidate-${s.brand_id}`, application_id: `app-${s.brand_id}`, operation_id: `person-${s.brand_id}`, candidate_name: 'Person', email: 'person@example.com', phone: '', linkedin_url: '', source_detail: 'Sourcing', basis_reference: 'Policy', contact_context: 'Direct', assignee_user_id: `staff-${s.brand_id}` })
const snapshot = db => db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all().map(({ name }) => [name, db.prepare(`SELECT * FROM ${name} ORDER BY rowid`).all()])
function seeded() {
  const f = fixture()
  assert.equal(f.call('create_workspace', 'owner', boot(A)).at(-1), 1)
  assert.equal(f.call('create_workspace', 'owner', boot(B)).at(-1), 1)
  for (const s of [A, B]) {
    assert.equal(f.call('add_workspace_member', 'owner', { ...s, member_user_id: `staff-${s.brand_id}`, role: 'recruiter', operation_id: `grant-${s.brand_id}` }).at(-1), 1)
    assert.equal(f.call('create_linkedin_application', `staff-${s.brand_id}`, person(s)).at(-1), 1)
  }
  return f
}
const writes = s => [
  ['create_requisition', { ...s, requisition_id: 'new-req', title: 'New role', operation_id: 'new-req-op' }, 'requisition.created'],
  ['create_linkedin_application', { ...person(s), candidate_id: 'new-candidate', application_id: 'new-app', operation_id: 'new-app-op' }, 'application.created'],
  ['change_application_stage', { ...s, application_id: `app-${s.brand_id}`, expected_version: 1, from_stage: 'submitted', to_stage: 'in_review', reason: 'Reviewed', operation_id: 'stage-op' }, 'application.stage_changed'],
  ['reassign_application', { ...s, application_id: `app-${s.brand_id}`, expected_version: 1, from_user_id: `staff-${s.brand_id}`, to_user_id: 'owner', reason: 'Review', operation_id: 'assign-op' }, 'application.reassigned'],
  ['add_application_note', { ...s, application_id: `app-${s.brand_id}`, note_id: 'new-note', body: 'Private note', operation_id: 'note-op' }, 'application.note_added'],
  ['create_communication_draft', { ...s, application_id: `app-${s.brand_id}`, draft_id: 'new-draft', recipient_email: 'person@example.com', subject: 'Hello', body: 'Draft', operation_id: 'draft-op' }, 'communication.draft_created'],
  ['record_candidate_email', { ...s, application_id: `app-${s.brand_id}`, communication_id: 'new-email', direction: 'inbound', from_email: 'person@example.com', to_email: 'staff@example.com', subject: 'Hello', body: 'Message', provider_message_id: 'provider-message', provider_thread_id: '', occurred_at: 10, agent_instance_id: 'agent', operation_id: 'email-op' }, 'communication.email_received'],
  ['record_worker_candidate_email', { ...s, application_id: `app-${s.brand_id}`, communication_id: 'worker-email', direction: 'inbound', mailbox_address: 'staff@example.com', from_email: 'person@example.com', to_email: 'staff@example.com', subject: 'Hello', body: 'Worker message', provider_message_id: 'worker-provider-message', occurred_at: 11, agent_instance_id: 'agent', operation_id: 'worker-email-op' }, 'communication.email_received'],
  ['record_agent_activity', { ...s, application_id: `app-${s.brand_id}`, activity_id: 'new-activity', activity_type: 'candidate_profile_crawled', source_url: 'https://example.com/profile', summary: 'Reviewed', occurred_at: 10, agent_instance_id: 'agent', operation_id: 'activity-op' }, 'agent.candidate_profile_crawled'],
]

test('two sibling brands are configured through actions with exact memberships and configuration audit', () => {
  const { db, call } = seeded()
  assert.equal(db.prepare('SELECT count(*) n FROM hiring_organizations').get().n, 1)
  assert.equal(db.prepare('SELECT count(*) n FROM hiring_brands').get().n, 2)
  for (const s of [A, B]) {
    const spaces = call('list_my_workspaces', `staff-${s.brand_id}`)
    assert.deepEqual(spaces.map(x => x.brand_id), [s.brand_id])
    assert.equal(spaces[0].can_create_brand, 0)
    assert.deepEqual(call('list_applications', `staff-${s.brand_id}`, s).map(x => x.id), [`app-${s.brand_id}`])
    const audit = db.prepare('SELECT organization_id,brand_id,actor_user_id,action,operation_id FROM hiring_audit_events WHERE operation_id=?').get(`boot-${s.brand_id}`)
    assert.deepEqual({ ...audit }, { ...s, actor_user_id: 'owner', action: 'workspace.created', operation_id: `boot-${s.brand_id}` })
  }
  assert.equal(call('list_my_workspaces', 'owner').every(x => x.can_create_brand === 1), true)
  db.close()
})

test('every major sibling-brand write denies other-brand staff, mixed record IDs and outsiders without any changes', () => {
  for (const [name, input] of writes(B)) {
    const { db, call } = seeded()
    for (const user of ['staff-a', 'outsider']) {
      const before = snapshot(db)
      assert.equal(call(name, user, input).every(n => n === 0), true, name)
      assert.deepEqual(snapshot(db), before, name)
    }
    // A user with access to both brands still cannot mix record IDs and scope.
    if (input.application_id && name !== 'create_linkedin_application') {
      const before = snapshot(db)
      assert.equal(call(name, 'owner', { ...input, brand_id: 'a' }).every(n => n === 0), true, name)
      assert.deepEqual(snapshot(db), before, name)
    }
    db.close()
  }
})

test('authorized sibling-brand writes have correct audit attribution and replay or colliding operation IDs change nothing', () => {
  for (const [name, input, action] of writes(B)) {
    const { db, call } = seeded()
    assert.equal(call(name, 'staff-b', input).at(-1), 1, name)
    const audit = db.prepare('SELECT organization_id,brand_id,actor_user_id,action,operation_id FROM hiring_audit_events WHERE operation_id=?').get(input.operation_id)
    assert.deepEqual({ ...audit }, { ...B, actor_user_id: 'staff-b', action, operation_id: input.operation_id }, name)
    const before = snapshot(db)
    assert.equal(call(name, 'staff-b', input).every(n => n === 0), true, name)
    assert.deepEqual(snapshot(db), before, name)
    assert.equal(call(name, 'staff-b', { ...input, operation_id: 'boot-a' }).every(n => n === 0), true, name)
    assert.deepEqual(snapshot(db), before, name)
    db.close()
  }
})

test('all scoped reads isolate sibling brands including populated histories, drafts, messages, activity and audit', () => {
  const { db, call } = seeded()
  for (const [name, input] of writes(B).filter(([name]) => !['change_application_stage', 'create_linkedin_application'].includes(name))) call(name, 'staff-b', input)
  const reads = ['list_workspace_members', 'list_requisitions', 'list_applications', 'list_assignment_events', 'list_stage_events', 'list_application_notes', 'list_communication_drafts', 'list_application_communications', 'list_application_agent_activity', 'list_application_audit', 'gateway_list_applications', 'gateway_get_application', 'gateway_list_requisitions', 'gateway_get_requisition', 'get_worker_candidate_email']
  for (const name of reads) {
    const input = { ...B, application_id: 'app-b', requisition_id: 'req-b', operation_id: 'worker-email-op' }
    assert.ok(call(name, 'staff-b', input).length > 0, name)
    assert.deepEqual(call(name, 'staff-a', input), [], name)
    assert.deepEqual(call(name, 'outsider', input), [], name)
    if (['gateway_get_application', 'get_worker_candidate_email'].includes(name) || name.startsWith('list_') && !['list_workspace_members', 'list_requisitions', 'list_applications'].includes(name)) {
      assert.deepEqual(call(name, 'owner', { ...input, brand_id: 'a' }), [], name)
    }
  }
  db.close()
})

test('configuration rejects outsiders, brand recruiters, existing object IDs and operation collisions without partial writes', () => {
  const { db, call } = seeded()
  const C = { organization_id: 'org', brand_id: 'c' }
  const cases = [
    ['outsider', boot(C)], ['staff-a', boot(C)],
    ['outsider', { ...boot(C), brand_id: 'a' }],
    ['owner', { ...boot(C), brand_id: 'a' }],
    ['owner', { ...boot(C), requisition_id: 'req-a' }],
    ['owner', boot(C, 'boot-a')],
    ['owner', { ...boot(C), organization_id: 'new-org', brand_id: 'a' }],
    ['owner', { ...boot(C), organization_id: 'new-org', requisition_id: 'req-a' }],
    ['owner', boot(A)], ['owner', { ...boot(A), operation_id: 'new-replay' }],
    ['owner', { ...boot(C), brand_id: ' ' }],
  ]
  for (const [user, input] of cases) {
    const before = snapshot(db)
    assert.equal(call('create_workspace', user, input).every(n => n === 0), true)
    assert.deepEqual(snapshot(db), before)
  }
  const grant = { ...A, member_user_id: 'staff-a', role: 'recruiter', operation_id: 'grant-a' }
  for (const [user, input] of [
    ['owner', grant], ['owner', { ...grant, operation_id: 'duplicate-member' }],
    ['owner', { ...grant, member_user_id: 'new-user' }],
    ['owner', { ...grant, member_user_id: 'new-user', operation_id: 'boot-b' }],
    ['owner', { ...grant, member_user_id: 'new-user', role: 'owner', operation_id: 'escalate' }],
    ['staff-a', { ...grant, member_user_id: 'new-user', operation_id: 'recruiter-grant' }],
    ['outsider', { ...grant, member_user_id: 'outsider', operation_id: 'claim-owner', role: 'owner' }],
  ]) {
    const before = snapshot(db)
    assert.equal(call('add_workspace_member', user, input).every(n => n === 0), true)
    assert.deepEqual(snapshot(db), before)
  }
  db.close()
})

test('sibling-brand relational references reject mismatches and audit is append-only', () => {
  const { db, call } = seeded()
  const before = snapshot(db)
  for (const field of ['candidate_id', 'requisition_id']) {
    const value = field === 'candidate_id' ? 'candidate-b' : 'req-b'
    assert.throws(() => db.prepare(`UPDATE hiring_applications SET ${field}=? WHERE id='app-a'`).run(value), /FOREIGN KEY/)
    assert.equal(call('create_linkedin_application', 'owner', { ...person(A), application_id: 'mixed', operation_id: 'mixed-op', [field]: value }).every(n => n === 0), true)
  }
  assert.throws(() => db.exec("INSERT INTO hiring_grants(id,organization_id,brand_id,requisition_id,user_id,role,granted_by,created_at) VALUES ('bad','org','a','req-b','staff-a','reviewer','owner',0)"), /FOREIGN KEY/)
  assert.throws(() => db.exec("INSERT INTO hiring_consent_records VALUES ('bad','org','a','app-b','recruitment','contract','v1','evidence','owner',0,NULL)"), /FOREIGN KEY/)
  assert.throws(() => db.exec("INSERT INTO hiring_rights_requests(id,organization_id,brand_id,candidate_id,request_type,actor_user_id,created_at,updated_at) VALUES ('bad','org','a','candidate-b','access','owner',0,0)"), /FOREIGN KEY/)
  assert.throws(() => db.exec("UPDATE hiring_audit_events SET action='forged'"), /append-only/)
  assert.throws(() => db.exec('DELETE FROM hiring_audit_events'), /append-only/)
  assert.deepEqual(snapshot(db), before)
  db.close()
})

test('audit failure rolls back complete configuration and business batches', () => {
  for (const name of ['create_workspace', 'add_workspace_member', 'create_linkedin_application', 'change_application_stage']) {
    const { db, call } = seeded()
    db.exec("CREATE TRIGGER test_audit_failure BEFORE INSERT ON hiring_audit_events BEGIN SELECT RAISE(ABORT, 'audit unavailable'); END")
    const input = name === 'create_workspace' ? boot({ ...A, brand_id: 'c' }) : name === 'add_workspace_member' ? { ...A, member_user_id: 'new-user', role: 'recruiter', operation_id: 'new-member' } : writes(A).find(([n]) => n === name)[1]
    const before = snapshot(db)
    assert.throws(() => call(name, name === 'create_workspace' || name === 'add_workspace_member' ? 'owner' : 'staff-a', input), /audit unavailable/)
    assert.deepEqual(snapshot(db), before, name)
    db.close()
  }
})

test('legacy audit ID collisions cannot suppress audit after an otherwise authorized write', () => {
  for (const [name, input] of writes(B)) {
    const { db, call } = seeded()
    db.exec("INSERT INTO hiring_audit_events(id,organization_id,brand_id,action,actor_user_id,operation_id,created_at) VALUES ('legacy-id','org','a','legacy.event','owner','different-operation',0)")
    const before = snapshot(db)
    assert.equal(call(name, 'staff-b', { ...input, operation_id: 'legacy-id' }).every(n => n === 0), true, name)
    assert.deepEqual(snapshot(db), before, name)
    db.close()
  }
})

test('every application child rejects sibling-brand scope mismatches at the database boundary', () => {
  const { db, call } = seeded()
  for (const [name, input] of writes(B).filter(([n]) => !['change_application_stage', 'create_linkedin_application'].includes(n))) call(name, 'staff-b', input)
  const before = snapshot(db)
  for (const table of ['hiring_stage_events', 'hiring_notes', 'hiring_outbox', 'hiring_assignment_events', 'hiring_communication_events', 'hiring_agent_activity', 'hiring_audit_events', 'hiring_worker_communication_events']) {
    const row = db.prepare(`SELECT * FROM ${table} WHERE application_id='app-b' LIMIT 1`).get()
    assert.ok(row, table)
    const forged = { ...row, id: `forged-${table}`, brand_id: 'a' }
    if ('operation_id' in forged) forged.operation_id = `forged-${table}`
    if ('provider_message_id' in forged) forged.provider_message_id = `forged-${table}`
    const keys = Object.keys(forged)
    assert.throws(() => db.prepare(`INSERT INTO ${table} (${keys.join(',')}) VALUES (${keys.map(() => '?').join(',')})`).run(...Object.values(forged)), /scope mismatch|FOREIGN KEY/, table)
    assert.throws(() => db.prepare(`UPDATE ${table} SET brand_id='a' WHERE id=?`).run(row.id), /scope mismatch|append-only/, table)
  }
  assert.deepEqual(snapshot(db), before)
  db.close()
})
