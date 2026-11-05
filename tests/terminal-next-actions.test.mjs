import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { nextActionTools } from '../scripts/terminal-next-actions.mjs'

const migrations = JSON.parse(readFileSync(new URL('../migrations.json', import.meta.url))).migrations
const tools = JSON.parse(readFileSync(new URL('../mcp.json', import.meta.url))).tools
const scope = { organization_id: 'org', brand_id: 'brand' }
const app = { ...scope, requisition_id: 'req', application_id: 'app' }
const legacy = migrations.find(row => row.name === '0074_terminal_next_actions')

function fixture({ beforeTerminalMigration = false } = {}) {
  const db = new DatabaseSync(':memory:')
  db.exec('PRAGMA foreign_keys=ON')
  for (const migration of migrations) if (!beforeTerminalMigration || migration.name !== legacy.name) db.exec(migration.sql)
  const call = (name, user, values = {}) => {
    const tool = tools.find(row => row.name === name)
    assert.ok(tool, name)
    const params = { ...Object.fromEntries(Object.entries(tool.params ?? {}).filter(([, schema]) => schema.optional).map(([key]) => [key, null])), ...values, __user_id: user, __now: 1_800_000_000_000, __uuid: crypto.randomUUID() }
    db.exec('BEGIN')
    try {
      const result = (tool.statements ?? [tool.sql]).map(statement => {
        const binds = []
        const sql = statement.replace(/:([a-z_][a-z0-9_]*)/gi, (_, key) => { assert.notEqual(params[key], undefined, `${name}:${key}`); binds.push(params[key]); return '?' })
        return tool.operation === 'query' ? db.prepare(sql).all(...binds) : db.prepare(sql).run(...binds).changes
      })
      db.exec('COMMIT')
      return tool.operation === 'query' ? result[0] : result
    } catch (error) { db.exec('ROLLBACK'); throw error }
  }
  call('create_workspace', 'owner', { ...app, organization_name: 'Org', brand_name: 'Brand', requisition_title: 'Role', operation_id: 'workspace' })
  call('create_linkedin_application', 'owner', { ...app, candidate_id: 'candidate', candidate_name: 'Person', email: 'person@example.com', phone: '', linkedin_url: 'https://www.linkedin.com/in/person', source_detail: 'Applicant', basis_reference: 'Applicant initiated', contact_context: 'Applicant supplied', assignee_user_id: 'owner', operation_id: 'candidate' })
  return { db, call }
}

test('registered plan tools match source and new applications have a real undated team task', () => {
  for (const tool of nextActionTools) assert.deepEqual(tools.find(row => row.name === tool.name), tool)
  const f = fixture()
  try {
    const row = f.call('list_application_next_actions', 'owner', app)[0]
    assert.deepEqual([row.owner, row.state, row.version, row.review_at, row.closed_at], ['bot', 'actionable', 1, null, null])
    assert.match(row.action, /Review this application/)
    assert.deepEqual(f.call('get_next_action_gaps', 'owner', scope), [])
    assert.deepEqual(f.call('list_application_next_actions', 'outsider', app), [])
  } finally { f.db.close() }
})

test('next-action writes are scoped, versioned, exact-retry safe and validate blocked/deferred states', () => {
  const f = fixture()
  try {
    const values = { ...app, expected_action_version: 1, owner: 'Serge', state: 'blocked', action: 'Check candidate reply', blocker_reason: 'Waiting for reply', review_at: null, operation_id: 'plan-1' }
    assert.deepEqual(f.call('record_application_next_action', 'outsider', values), [0])
    assert.deepEqual(f.call('record_application_next_action', 'owner', { ...values, brand_id: 'other' }), [0])
    assert.deepEqual(f.call('record_application_next_action', 'owner', values), [1])
    assert.deepEqual(f.call('record_application_next_action', 'owner', values), [0])
    assert.equal(f.call('get_application_next_action_result', 'owner', values).length, 1)
    assert.deepEqual(f.call('get_application_next_action_result', 'owner', { ...values, action: 'Changed' }), [])
    assert.equal(f.call('list_application_next_actions', 'owner', app)[0].version, 2)
    assert.throws(() => f.call('record_application_next_action', 'owner', { ...values, operation_id: 'stale' }), /version conflict/)
    for (const patch of [{ owner: 'candidate' }, { blocker_reason: '' }, { state: 'deferred', blocker_reason: null, review_at: null }, { state: 'actionable', blocker_reason: 'forged' }])
      assert.throws(() => f.call('record_application_next_action', 'owner', { ...values, ...patch, expected_action_version: 2, operation_id: crypto.randomUUID() }), undefined, JSON.stringify(patch))
    const deferred = { ...values, expected_action_version: 2, state: 'deferred', blocker_reason: null, review_at: 1_900_000_000_000, operation_id: 'plan-2' }
    assert.deepEqual(f.call('record_application_next_action', 'owner', deferred), [1])
    assert.equal(f.call('list_application_next_actions', 'owner', app)[0].review_at, deferred.review_at)
    assert.equal(f.call('list_application_next_action_history', 'owner', app).length, 2)
    assert.throws(() => f.db.exec("UPDATE hiring_application_next_action_events SET action='forged'"), /immutable/)
  } finally { f.db.close() }
})

test('missing plans are reported and cannot advance; terminal transitions close current and legacy chase actions atomically', () => {
  const f = fixture()
  try {
    const stage = (from_stage, to_stage, expected_version, operation_id) => f.call('change_application_stage', 'owner', { ...scope, application_id: 'app', from_stage, to_stage, expected_version, reason: 'Human review', operation_id })
    f.db.exec("DELETE FROM hiring_application_next_action_current WHERE application_id='app'")
    assert.equal(f.call('get_next_action_gaps', 'owner', scope)[0].gap_reason, 'missing')
    assert.throws(() => stage('submitted', 'in_review', 1, 'without-plan'), /candidate-linked hiring next action required/)
    assert.equal(f.call('get_application', 'owner', app)[0].stage, 'submitted')
    const plan = { ...app, expected_action_version: 0, owner: 'bot', state: 'actionable', action: 'Review the application', blocker_reason: null, review_at: null, operation_id: 'restore-plan' }
    assert.deepEqual(f.call('record_application_next_action', 'owner', plan), [1])
    assert.deepEqual(f.call('get_next_action_gaps', 'owner', scope), [])
    stage('submitted', 'in_review', 1, 'review')
    f.call('create_next_action', 'owner', { ...scope, candidate_id: 'candidate', action: 'Chase reply', due_at: 1_800_100_000_000, owner: 'bot', operation_id: 'legacy-chase' })
    stage('in_review', 'rejected', 2, 'reject')
    assert.equal(f.call('get_application', 'owner', app)[0].stage, 'rejected')
    assert.equal(f.call('list_application_next_actions', 'owner', app)[0].closed_at, 1_800_000_000_000)
    assert.equal(f.db.prepare("SELECT status FROM next_actions WHERE id='legacy-chase'").get().status, 'done')
    assert.equal(f.call('list_applications', 'owner', scope).length, 0)
    assert.equal(f.call('list_applications', 'owner', { ...scope, stage: 'rejected' }).length, 1)
    assert.equal(f.call('get_current_pipeline', 'owner', scope).length, 0)
    assert.deepEqual(f.call('get_next_action_gaps', 'owner', scope), [])
    assert.equal(f.call('list_application_next_action_history', 'owner', app).length, 1)
    assert.ok(stage('in_review', 'rejected', 2, 'reject').every(changes => changes === 0))
  } finally { f.db.close() }
})

test('legacy active records are reclassified without rewriting lifecycle evidence, and migration replay is idempotent', () => {
  const f = fixture({ beforeTerminalMigration: true })
  try {
    const offerScope = { tenant_id: 'org', brand_id: 'brand', application_id: 'app', requisition_id: 'req' }
    f.call('save_offer_draft', 'owner', { ...offerScope, terms_json: JSON.stringify({ compensation_type: 'paid', subject: 'Offer', body: 'Terms' }), expected_version: 0, operation_id: 'offer' })
    const offer = f.call('get_offer', 'owner', offerScope)[0]
    f.call('submit_offer_for_approval', 'owner', { ...offerScope, offer_id: offer.id, expected_version: 1, operation_id: 'submit' })
    f.call('approve_offer', 'owner', { ...offerScope, offer_id: offer.id, expected_version: 2, operation_id: 'approve' })
    f.db.exec("UPDATE hiring_applications SET stage='offered'")
    f.call('record_acceptance', 'owner', { ...offerScope, expected_version: 1, acceptance_evidence: 'Candidate accepted', operation_id: 'accept' })
    for (const [from_stage, to_stage, expected_version, operation_id] of [['accepted', 'onboarding', 2, 'start'], ['onboarding', 'onboarded', 3, 'done'], ['onboarded', 'active', 4, 'active']])
      f.call('record_lifecycle_transition', 'owner', { ...app, from_stage, to_stage, expected_version, operation_id, evidence: 'Recorded', registration_evidence: 'Registration', requirements_evidence: 'Requirements', handoff_evidence: 'Team handoff' })
    const before = f.db.prepare('SELECT * FROM hiring_lifecycle_events_v2').all()
    assert.equal(f.db.prepare("SELECT workflow_stage FROM hiring_applications WHERE id='app'").get().workflow_stage, 'active')
    f.db.exec(legacy.sql)
    f.db.exec(legacy.sql)
    assert.equal(f.call('get_application', 'owner', app)[0].stage, 'onboarded')
    assert.equal(f.db.prepare('SELECT onboarding_evidence_missing FROM hiring_legacy_active_reclassification').get().onboarding_evidence_missing, 0)
    assert.equal(f.db.prepare("SELECT count(*) AS n FROM hiring_audit_events WHERE action='application.active_reclassified'").get().n, 1)
    assert.deepEqual(f.db.prepare('SELECT * FROM hiring_lifecycle_events_v2').all(), before)
    assert.equal(f.call('list_applications', 'owner', scope).length, 0)
    assert.equal(f.call('list_applications', 'owner', { ...scope, stage: 'onboarded' }).length, 1)
    assert.throws(() => f.call('record_lifecycle_transition', 'owner', { ...app, from_stage: 'onboarded', to_stage: 'active', expected_version: 5, operation_id: 'again', evidence: 'No', registration_evidence: '', requirements_evidence: '', handoff_evidence: '' }), /active is no longer/)
  } finally { f.db.close() }
})
