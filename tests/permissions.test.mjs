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

const grant = (call, user, role = 'recruiter', requisition_id = 'req-a', scope = A) => {
  const id = `grant-${user}-${role}-${requisition_id ?? 'brand'}`
  assert.equal(call('grant_workspace_access', 'owner', { ...scope, member_user_id: user, role, requisition_id, grant_id: id, operation_id: id }).at(-1), 1)
  return id
}
const appRead = (call, user, scope = A, application_id = 'app-a') => call('gateway_get_application', user, { ...scope, application_id })
const note = { ...A, application_id: 'app-a', note_id: 'scoped-note', body: 'Reviewed', operation_id: 'scoped-note-op' }

test('requisition grants filter lists and reject forged sibling IDs on every business mutation', () => {
  const { db, call } = seeded()
  grant(call, 'limited')
  assert.equal(appRead(call, 'limited').length, 1)
  assert.equal(call('list_applications', 'limited', A).length, 1)
  assert.equal(call('list_requisitions', 'limited', A).length, 1)
  assert.equal(call('create_requisition', 'owner', { ...A, requisition_id: 'req-other', title: 'Other', operation_id: 'other-req' }).at(-1), 1)
  const other = { ...person(A), requisition_id: 'req-other', candidate_id: 'other-person', application_id: 'other-app', operation_id: 'other-person-op' }
  assert.equal(call('create_linkedin_application', 'owner', other).at(-1), 1)
  assert.deepEqual(call('list_requisitions', 'limited', A).map(r => r.id), ['req-a'])
  assert.deepEqual(call('list_applications', 'limited', A).map(r => r.id), ['app-a'])
  assert.equal(appRead(call, 'limited', A, 'other-app').length, 0)
  assert.equal(call('gateway_get_requisition', 'limited', { ...A, requisition_id: 'req-other' }).length, 0)
  for (const [name, input] of writes(B)) {
    const before = snapshot(db)
    assert.ok(call(name, 'limited', { ...input, role: 'owner', user_id: 'owner' }).every(n => n === 0), name)
    assert.deepEqual(snapshot(db), before, name)
  }
  for (const [name, input] of writes(A)) {
    if (!input.application_id || name === 'create_linkedin_application') continue
    const before = snapshot(db)
    assert.ok(call(name, 'limited', { ...input, application_id: 'other-app' }).every(n => n === 0), name)
    assert.deepEqual(snapshot(db), before, name)
  }
  assert.equal(call('add_application_note', 'limited', note).at(-1), 1)
  db.close()
})

test('reviewer access follows current assignment and never authorizes full reads or writes', () => {
  const { db, call } = seeded()
  grant(call, 'reviewer', 'reviewer')
  assert.equal(appRead(call, 'reviewer').length, 0)
  const assign = { ...A, application_id: 'app-a', from_user_id: 'staff-a', to_user_id: 'reviewer', expected_version: 1, reason: 'Review', operation_id: 'assign-reviewer' }
  assert.equal(call('reassign_application', 'owner', assign).at(-1), 1)
  const row = appRead(call, 'reviewer')[0]
  assert.equal(row.id, 'app-a')
  for (const key of ['email','phone','linkedin_url','source_detail','basis_reference','contact_context']) assert.equal(key in row, false)
  assert.equal(call('gateway_list_applications', 'reviewer', A).length, 1)
  for (const name of ['list_applications','list_application_notes','list_stage_events','list_assignment_events','list_application_audit','list_application_communications','list_application_agent_activity','list_communication_drafts','list_workspace_members']) {
    assert.deepEqual(call(name, 'reviewer', { ...A, application_id: 'app-a' }), [], name)
  }
  for (const [name, input] of writes(A)) {
    const before = snapshot(db)
    assert.ok(call(name, 'reviewer', input).every(n => n === 0), name)
    assert.deepEqual(snapshot(db), before, name)
  }
  assert.equal(call('reassign_application', 'owner', { ...assign, from_user_id: 'reviewer', to_user_id: 'staff-a', expected_version: 2, operation_id: 'assign-back' }).at(-1), 1)
  assert.equal(appRead(call, 'reviewer').length, 0)
  assert.equal(call('gateway_list_applications', 'reviewer', A).length, 0)
  // Assignment without a current matching grant cannot retain access.
  db.exec("UPDATE hiring_applications SET assignee_user_id='reviewer' WHERE id='app-b'")
  assert.equal(appRead(call, 'reviewer', B, 'app-b').length, 0)
  db.close()
})

test('revocation immediately removes legacy and scoped access without cached or assignment authority', () => {
  const { db, call } = seeded()
  const id = grant(call, 'limited')
  assert.equal(appRead(call, 'limited').length, 1)
  const revoke = { ...A, grant_id: id, operation_id: 'revoke-limited' }
  assert.equal(call('revoke_workspace_grant', 'owner', revoke).at(-1), 1)
  assert.equal(appRead(call, 'limited').length, 0)
  assert.deepEqual(call('list_my_workspaces', 'limited'), [])
  assert.ok(call('add_application_note', 'limited', note).every(n => n === 0))
  assert.ok(call('revoke_workspace_grant', 'owner', revoke).every(n => n === 0))
  assert.equal(call('revoke_workspace_membership', 'owner', { ...A, grant_id: 'grant-a', operation_id: 'revoke-staff' }).at(-1), 1)
  assert.deepEqual(call('list_my_workspaces', 'staff-a'), [])
  assert.equal(appRead(call, 'staff-a').length, 0)
  assert.ok(call('add_application_note', 'staff-a', note).every(n => n === 0))
  for (const [name, input] of writes(A)) assert.ok(call(name, 'staff-a', input).every(n => n === 0), name)
  assert.deepEqual(call('list_workspace_members', 'owner', A).map(m => m.user_id), ['owner'])
  assert.equal(db.prepare("SELECT count(*) n FROM hiring_audit_events WHERE action IN ('grant.revoked','membership.revoked')").get().n, 2)
  db.close()
})

test('grant administration rejects forged scope, escalation, replay and audit failure atomically', () => {
  const { db, call } = seeded()
  const input = { ...A, member_user_id: 'new-user', role: 'recruiter', requisition_id: 'req-a', grant_id: 'new-grant', operation_id: 'new-grant-op' }
  for (const [user, values] of [ ['outsider', input], ['staff-a', input], ['owner', { ...input, role: 'owner' }], ['owner', { ...input, requisition_id: 'req-b' }], ['owner', { ...input, organization_id: 'forged-org' }], ['owner', { ...input, member_user_id: 'owner' }], ['owner', { ...input, operation_id: 'boot-a' }] ]) {
    const before = snapshot(db)
    assert.ok(call('grant_workspace_access', user, values).every(n => n === 0))
    assert.deepEqual(snapshot(db), before)
  }
  assert.equal(call('grant_workspace_access', 'owner', input).at(-1), 1)
  assert.ok(call('grant_workspace_access', 'owner', input).every(n => n === 0))
  for (const name of ['revoke_workspace_grant','revoke_workspace_membership']) {
    const before = snapshot(db)
    assert.ok(call(name, 'staff-b', { ...A, grant_id: name.endsWith('membership') ? 'grant-a' : 'new-grant', operation_id: 'forged-revoke' }).every(n => n === 0))
    assert.deepEqual(snapshot(db), before)
  }
  assert.deepEqual(call('list_workspace_grants', 'outsider', A), [])
  db.exec("CREATE TRIGGER fail_grant_audit BEFORE INSERT ON hiring_audit_events BEGIN SELECT RAISE(ABORT,'audit unavailable'); END")
  for (const [name, values] of [['grant_workspace_access', { ...input, grant_id: 'another', operation_id: 'another' }], ['revoke_workspace_grant', { ...A, grant_id: 'new-grant', operation_id: 'revoke-fail' }], ['revoke_workspace_membership', { ...A, grant_id: 'grant-a', operation_id: 'member-revoke-fail' }]]) {
    const before = snapshot(db)
    assert.throws(() => call(name, 'owner', values), /audit unavailable/)
    assert.deepEqual(snapshot(db), before)
  }
  db.close()
})

test('organization, brand, auditor and overlapping grants preserve least privilege and row uniqueness', () => {
  const { db, call } = seeded()
  // Only the organization creator can delegate access across its brands.
  assert.equal(call('grant_organization_access', 'owner', { ...A, grant_id: 'org-grant', member_user_id: 'org-recruiter', role: 'recruiter', operation_id: 'org-grant' }).at(-1), 1)
  assert.equal(appRead(call, 'org-recruiter').length, 1)
  assert.equal(appRead(call, 'org-recruiter', B, 'app-b').length, 1)
  grant(call, 'org-recruiter')
  assert.equal(call('list_applications', 'org-recruiter', A).length, 1)
  grant(call, 'brand-recruiter', 'recruiter', null)
  assert.equal(appRead(call, 'brand-recruiter').length, 1)
  assert.equal(appRead(call, 'brand-recruiter', B, 'app-b').length, 0)
  grant(call, 'auditor', 'auditor')
  assert.ok(call('list_application_audit', 'auditor', { ...A, application_id: 'app-a' }).length > 0)
  assert.deepEqual(call('list_application_audit', 'auditor', { ...B, application_id: 'app-b' }), [])
  assert.equal(appRead(call, 'auditor').length, 0)
  assert.ok(call('add_application_note', 'auditor', note).every(n => n === 0))
  db.exec("UPDATE hiring_organizations SET status='suspended' WHERE id='org'")
  assert.equal(appRead(call, 'owner').length, 0)
  assert.equal(appRead(call, 'org-recruiter').length, 0)
  assert.deepEqual(call('list_my_workspaces', 'owner'), [])
  db.close()
})

test('organization delegation cannot be acquired through brand ownership or forged scope', () => {
  const { db, call } = seeded()
  const input = { ...A, grant_id: 'org-wide', member_user_id: 'delegate', role: 'recruiter', operation_id: 'org-wide' }
  db.exec("INSERT INTO hiring_memberships(id,organization_id,brand_id,user_id,role,created_at) VALUES ('brand-owner-member','org','a','brand-owner','owner',0)")
  for (const user of ['staff-a','outsider','brand-owner']) assert.ok(call('grant_organization_access', user, input).every(n => n === 0))
  assert.equal(call('grant_organization_access', 'owner', input).at(-1), 1)
  assert.equal(appRead(call, 'delegate', B, 'app-b').length, 1)
  assert.ok(call('revoke_workspace_grant', 'brand-owner', { ...A, grant_id: 'org-wide', operation_id: 'forged-org-revoke' }).every(n => n === 0))
  assert.equal(call('revoke_workspace_grant', 'owner', { ...B, grant_id: 'org-wide', operation_id: 'revoke-org-wide' }).at(-1), 1)
  assert.equal(appRead(call, 'delegate').length, 0)
  assert.equal(appRead(call, 'delegate', B, 'app-b').length, 0)
  const badAssignee = { ...person(A), candidate_id: 'bad-person', application_id: 'bad-app', operation_id: 'bad-assignee', assignee_user_id: 'staff-b' }
  const before = snapshot(db)
  assert.ok(call('create_linkedin_application', 'owner', badAssignee).every(n => n === 0))
  assert.deepEqual(snapshot(db), before)
  grant(call, 'other-reviewer', 'reviewer', 'req-b', B)
  assert.ok(call('reassign_application', 'owner', { ...A, application_id: 'app-a', from_user_id: 'staff-a', to_user_id: 'other-reviewer', expected_version: 1, reason: 'Forged target', operation_id: 'wrong-assignee' }).every(n => n === 0))
  db.close()
})
