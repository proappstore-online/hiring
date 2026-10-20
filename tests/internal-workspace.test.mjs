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

test('internal LinkedIn workflow is scoped, audited, and never sends', () => {
  const { db, call } = fixture()
  assert.equal(call('create_workspace', 'staff-a', bootstrap).at(-1), 1)
  assert.equal(call('list_my_workspaces', 'staff-a').length, 1)
  assert.equal(call('list_my_workspaces', 'outsider').length, 0)
  assert.equal(call('create_linkedin_application', 'outsider', { ...candidate, candidate_id: 'evil', application_id: 'evil-app', operation_id: 'evil-op' }).at(-1), 0)
  assert.equal(db.prepare('SELECT count(*) AS n FROM hiring_candidates').get().n, 0)
  assert.equal(call('create_linkedin_application', 'staff-a', candidate).at(-1), 1)
  assert.equal(call('list_applications', 'staff-a', scope).length, 1)
  assert.equal(call('list_applications', 'outsider', scope).length, 0)
  const stage = { ...scope, application_id: 'app-a', expected_version: 1, from_stage: 'submitted', to_stage: 'in_review', reason: 'Human screening', operation_id: 'stage-a' }
  assert.equal(call('change_application_stage', 'outsider', stage).at(-1), 0)
  assert.equal(call('change_application_stage', 'staff-a', stage).at(-1), 1)
  assert.equal(call('change_application_stage', 'staff-a', { ...stage, operation_id: 'stale' }).at(-1), 0)
  assert.equal(call('list_stage_events', 'staff-a', { ...scope, application_id: 'app-a' }).length, 2)
  assert.equal(call('list_stage_events', 'outsider', { ...scope, application_id: 'app-a' }).length, 0)
  const note = { ...scope, application_id: 'app-a', note_id: 'note-a', body: 'Called on Tuesday', operation_id: 'note-op' }
  assert.equal(call('add_application_note', 'outsider', note).at(-1), 0)
  assert.equal(call('add_application_note', 'staff-a', note).at(-1), 1)
  assert.equal(call('list_application_notes', 'staff-a', note).length, 1)
  assert.equal(call('list_application_notes', 'outsider', note).length, 0)
  const draft = { ...scope, application_id: 'app-a', draft_id: 'draft-a', recipient_email: 'a@example.com', subject: 'Hello', body: 'Draft only', operation_id: 'draft-op' }
  assert.equal(call('create_communication_draft', 'outsider', draft).at(-1), 0)
  assert.equal(call('create_communication_draft', 'staff-a', { ...draft, recipient_email: 'wrong@example.com', draft_id: 'wrong', operation_id: 'wrong-op' }).at(-1), 0)
  assert.equal(call('create_communication_draft', 'staff-a', draft).at(-1), 1)
  assert.equal(call('list_communication_drafts', 'staff-a', draft)[0].status, 'draft')
  assert.equal(call('list_communication_drafts', 'outsider', draft).length, 0)
  assert.equal(call('list_application_audit', 'staff-a', draft).length, 4)
  assert.equal(call('list_application_audit', 'outsider', draft).length, 0)
  assert.equal(tools.some(t => /send|dispatch/i.test(t.name)), false)
})

test('authorized LinkedIn create accepts the bare host and makes an application visible', () => {
  const { call } = fixture()
  call('create_workspace', 'staff-a', bootstrap)
  const input = { ...candidate, linkedin_url: 'https://linkedin.com/in/synthetic-fixture' }
  const changes = call('create_linkedin_application', 'staff-a', input)
  assert.deepEqual(changes, [1, 1, 1, 1])
  const rows = call('list_applications', 'staff-a', scope)
  assert.equal(rows.length, 1)
  assert.equal(rows[0].id, input.application_id)
  const lookalike = { ...candidate, candidate_id: 'lookalike', application_id: 'lookalike-app', operation_id: 'lookalike-op', linkedin_url: 'https://linkedin.com.example.org/in/not-linkedin' }
  assert.deepEqual(call('create_linkedin_application', 'staff-a', lookalike), [0, 0, 0, 0])
  assert.equal(call('list_applications', 'staff-a', scope).length, 1)
})

test('authorized LinkedIn create stores a missing profile URL as NULL and preserves audit and scope', () => {
  for (const url of ['', '   ', null, undefined]) {
    const { db, call } = fixture()
    call('create_workspace', 'staff-a', bootstrap)
    const input = { ...candidate, linkedin_url: url, source_detail: 'LinkedIn sourcing event recorded by recruiter', contact_context: 'No profile URL or contact details available' }
    if (url === undefined) delete input.linkedin_url
    assert.deepEqual(call('create_linkedin_application', 'staff-a', input), [1, 1, 1, 1])
    assert.equal(db.prepare('SELECT linkedin_profile_url FROM hiring_candidates WHERE id=?').get(input.candidate_id).linkedin_profile_url, null)
    const rows = call('list_applications', 'staff-a', scope)
    assert.equal(rows.length, 1)
    assert.equal(rows[0].linkedin_url, null)
    assert.equal(rows[0].source_detail, input.source_detail)
    assert.equal(rows[0].contact_context, input.contact_context)
    assert.equal(call('list_applications', 'outsider', scope).length, 0)
    assert.deepEqual(call('create_linkedin_application', 'staff-a', input), [0, 0, 0, 0])
    assert.equal(db.prepare("SELECT count(*) AS n FROM hiring_audit_events WHERE action='application.created'").get().n, 1)
  }
})

test('failed assignment cannot strand a candidate, and owner grants exact PAS ID', () => {
  const { db, call } = fixture()
  call('create_workspace', 'staff-a', bootstrap)
  assert.equal(call('create_linkedin_application', 'staff-a', { ...candidate, assignee_user_id: 'outsider' }).at(-1), 0)
  assert.equal(db.prepare('SELECT count(*) AS n FROM hiring_candidates').get().n, 0)
  const grant = { ...scope, member_user_id: 'staff-b', role: 'recruiter', operation_id: 'grant-b' }
  assert.equal(call('add_workspace_member', 'outsider', grant).at(-1), 0)
  assert.equal(call('add_workspace_member', 'staff-a', grant).at(-1), 1)
  assert.equal(call('list_workspace_members', 'staff-b', scope).length, 2)
  assert.equal(call('create_linkedin_application', 'staff-b', { ...candidate, assignee_user_id: 'staff-b' }).at(-1), 1)
  assert.equal(call('list_applications', 'staff-b', scope).length, 1)
  assert.equal(call('add_workspace_member', 'staff-b', { ...grant, member_user_id: 'staff-c', operation_id: 'grant-c' }).at(-1), 0)
})

test('brand membership never crosses another brand and repeated operations do not duplicate rows', () => {
  const { db, call } = fixture()
  call('create_workspace', 'staff-a', bootstrap)
  call('create_workspace', 'staff-b', { organization_id: 'org-b', brand_id: 'brand-b', requisition_id: 'req-b', organization_name: 'Org B', brand_name: 'Brand B', requisition_title: 'Designer', operation_id: 'bootstrap-b' })
  assert.equal(call('list_requisitions', 'staff-b', scope).length, 0)
  assert.equal(call('create_requisition', 'staff-b', { ...scope, requisition_id: 'forged', title: 'Forged', operation_id: 'forged-op' }).at(-1), 0)
  assert.equal(call('create_linkedin_application', 'staff-a', candidate).at(-1), 1)
  assert.equal(call('create_linkedin_application', 'staff-a', candidate).at(-1), 0)
  const stage = { ...scope, application_id: 'app-a', expected_version: 1, from_stage: 'submitted', to_stage: 'in_review', reason: 'Reviewed', operation_id: 'stage-1' }
  assert.equal(call('change_application_stage', 'staff-a', stage).at(-1), 1)
  assert.equal(call('change_application_stage', 'staff-a', stage).at(-1), 0)
  assert.equal(call('list_stage_events', 'staff-b', { ...scope, application_id: 'app-a' }).length, 0)
  assert.equal(db.prepare('SELECT count(*) AS n FROM hiring_stage_events WHERE application_id=?').get('app-a').n, 2)
  const note = { ...scope, application_id: 'app-a', note_id: 'note-1', body: 'A note', operation_id: 'note-1-op' }
  assert.equal(call('add_application_note', 'staff-a', note).at(-1), 1)
  assert.equal(call('add_application_note', 'staff-a', note).at(-1), 0)
  assert.equal(call('list_application_notes', 'staff-b', note).length, 0)
})

test('reassignment requires a current version and in-brand staff, and preserves history', () => {
  const { db, call } = fixture()
  call('create_workspace', 'staff-a', bootstrap)
  call('add_workspace_member', 'staff-a', { ...scope, member_user_id: 'staff-b', role: 'recruiter', operation_id: 'grant-b' })
  call('create_linkedin_application', 'staff-a', candidate)
  const move = { ...scope, application_id: 'app-a', expected_version: 1, from_user_id: 'staff-a', to_user_id: 'staff-b', reason: 'Load balancing', operation_id: 'move-a' }
  assert.equal(call('reassign_application', 'outsider', move).at(-1), 0)
  assert.equal(call('reassign_application', 'staff-a', { ...move, to_user_id: 'outsider', operation_id: 'move-outsider' }).at(-1), 0)
  assert.equal(call('reassign_application', 'staff-a', move).at(-1), 1)
  assert.equal(call('reassign_application', 'staff-a', { ...move, operation_id: 'stale-move' }).at(-1), 0)
  assert.equal(call('list_assignment_events', 'staff-b', { ...scope, application_id: 'app-a' }).length, 1)
  assert.equal(call('list_assignment_events', 'outsider', { ...scope, application_id: 'app-a' }).length, 0)
  assert.equal(db.prepare('SELECT assignee_user_id,version FROM hiring_applications WHERE id=?').get('app-a').assignee_user_id, 'staff-b')
  assert.equal(db.prepare("SELECT count(*) AS n FROM hiring_audit_events WHERE action='application.reassigned'").get().n, 1)
  assert.equal(call('change_application_stage', 'staff-b', { ...scope, application_id: 'app-a', expected_version: 1, from_stage: 'submitted', to_stage: 'in_review', reason: 'Reviewed', operation_id: 'stale-stage' }).at(-1), 0)
  assert.equal(call('change_application_stage', 'staff-b', { ...scope, application_id: 'app-a', expected_version: 2, from_stage: 'submitted', to_stage: 'in_review', reason: 'Reviewed', operation_id: 'move-a' }).at(-1), 0)
  assert.equal(db.prepare('SELECT stage,version FROM hiring_applications WHERE id=?').get('app-a').stage, 'submitted')
  assert.equal(call('change_application_stage', 'staff-b', { ...scope, application_id: 'app-a', expected_version: 2, from_stage: 'submitted', to_stage: 'in_review', reason: 'Reviewed', operation_id: 'stage-after-move' }).at(-1), 1)
})

test('reusing an existing candidate cannot bypass application governance fields', () => {
  const { db, call } = fixture()
  call('create_workspace', 'staff-a', bootstrap)
  assert.equal(call('create_linkedin_application', 'staff-a', candidate).at(-1), 1)
  for (const field of ['source_detail', 'basis_reference', 'contact_context']) {
    const reuse = { ...candidate, application_id: `app-${field}`, operation_id: `op-${field}`, [field]: '  ' }
    assert.equal(call('create_linkedin_application', 'staff-a', reuse).at(-1), 0, field)
  }
  assert.equal(call('create_linkedin_application', 'staff-a', { ...candidate, application_id: 'app-bad-req', operation_id: 'op-bad-req', requisition_id: 'missing' }).at(-1), 0)
  assert.equal(db.prepare('SELECT count(*) AS n FROM hiring_applications').get().n, 1)
})

test('replaying an existing application ID does not write a second creation audit', () => {
  const { db, call } = fixture()
  call('create_workspace', 'staff-a', bootstrap)
  assert.equal(call('create_linkedin_application', 'staff-a', candidate).at(-1), 1)
  assert.equal(call('create_linkedin_application', 'staff-a', { ...candidate, candidate_id: 'cand-b', operation_id: 'replay-op' }).at(-1), 0)
  assert.equal(db.prepare("SELECT count(*) AS n FROM hiring_audit_events WHERE action='application.created'").get().n, 1)
})

test('replaying an existing note, draft or requisition ID with a new operation does not write a second audit', () => {
  const { db, call } = fixture()
  call('create_workspace', 'staff-a', bootstrap)
  call('create_linkedin_application', 'staff-a', candidate)
  const auditCount = action => db.prepare('SELECT count(*) AS n FROM hiring_audit_events WHERE action=?').get(action).n
  const cases = [
    ['create_requisition', { ...scope, requisition_id: 'req-replay', title: 'Designer' }, 'requisition.created'],
    ['add_application_note', { ...scope, application_id: 'app-a', note_id: 'note-replay', body: 'First note' }, 'application.note_added'],
    ['create_communication_draft', { ...scope, application_id: 'app-a', draft_id: 'draft-replay', recipient_email: 'a@example.com', subject: 'Hello', body: 'First draft' }, 'communication.draft_created'],
  ]
  for (const [name, values, audit] of cases) {
    assert.equal(call(name, 'staff-a', { ...values, operation_id: `${name}-first` }).at(-1), 1, name)
    assert.equal(auditCount(audit), 1, name)
    assert.equal(call(name, 'staff-a', { ...values, operation_id: `${name}-replay` }).at(-1), 0, name)
    assert.equal(auditCount(audit), 1, name)
  }
})

test('blank workspace, requisition and member values are rejected server-side', () => {
  const { db, call } = fixture()
  for (const field of ['organization_name', 'brand_name', 'requisition_title']) {
    assert.equal(call('create_workspace', 'staff-a', { ...bootstrap, [field]: ' ' }).at(-1), 0, field)
  }
  assert.equal(db.prepare('SELECT count(*) AS n FROM hiring_organizations').get().n, 0)
  call('create_workspace', 'staff-a', bootstrap)
  assert.equal(call('create_requisition', 'staff-a', { ...scope, requisition_id: 'blank', title: '   ', operation_id: 'blank-op' }).at(-1), 0)
  assert.equal(call('add_workspace_member', 'staff-a', { ...scope, member_user_id: ' ', role: 'recruiter', operation_id: 'blank-grant' }).at(-1), 0)
  assert.equal(db.prepare('SELECT count(*) AS n FROM hiring_requisitions').get().n, 1)
  assert.equal(db.prepare('SELECT count(*) AS n FROM hiring_memberships').get().n, 1)
})

test('versioned actions declare expected_version as an integer', () => {
  for (const name of ['change_application_stage', 'reassign_application']) assert.equal(action(name).params.expected_version.type, 'integer', name)
})
