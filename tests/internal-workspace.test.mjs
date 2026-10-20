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
    const params = { ...values, __user_id: user, __now: Date.now(), __uuid: crypto.randomUUID() }
    const sql = tool.statements ?? [tool.sql]
    const result = []
    db.exec('BEGIN')
    try {
      for (const statement of sql) {
        const binds = Object.fromEntries([...statement.matchAll(/:([a-z_][a-z0-9_]*)/gi)].map(([, key]) => [key, params[key]]))
        assert.ok(Object.values(binds).every(v => v !== undefined), `${name}: missing param`)
        result.push(tool.operation === 'query' ? db.prepare(statement).all(binds) : db.prepare(statement).run(binds).changes)
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
