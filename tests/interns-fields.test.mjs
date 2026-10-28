import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'

const migrations = JSON.parse(readFileSync(new URL('../migrations.json', import.meta.url))).migrations
const tools = JSON.parse(readFileSync(new URL('../mcp.json', import.meta.url))).tools
const scope = { organization_id: 'org', brand_id: 'brand', requisition_id: 'req', application_id: 'app' }

function fixture() {
  const db = new DatabaseSync(':memory:')
  db.exec('PRAGMA foreign_keys=ON')
  for (const migration of migrations) db.exec(migration.sql)
  const call = (name, user, values = {}) => {
    const tool = tools.find(t => t.name === name)
    assert.ok(tool, name)
    const params = { ...Object.fromEntries(Object.entries(tool.params ?? {}).filter(([, spec]) => spec.optional).map(([key]) => [key, null])), ...values, __user_id: user, __now: Date.now(), __uuid: crypto.randomUUID() }
    db.exec('BEGIN')
    try {
      const result = (tool.statements ?? [tool.sql]).map(statement => {
        const binds = []
        const sql = statement.replace(/:([a-z_][a-z0-9_]*)/gi, (_, key) => { assert.notEqual(params[key], undefined, `${name}: ${key}`); binds.push(params[key]); return '?' })
        return tool.operation === 'query' ? db.prepare(sql).all(...binds) : db.prepare(sql).run(...binds).changes
      })
      db.exec('COMMIT')
      return tool.operation === 'query' ? result[0] : result
    } catch (error) { db.exec('ROLLBACK'); throw error }
  }
  call('create_workspace', 'owner', { ...scope, organization_name: 'Org', brand_name: 'Brand', requisition_title: 'Intern', operation_id: 'bootstrap' })
  call('create_linkedin_application', 'owner', { ...scope, candidate_id: 'candidate', operation_id: 'candidate', candidate_name: 'Person', email: 'person@example.com', phone: '', linkedin_url: '', source_detail: 'Applicant', basis_reference: 'Applicant initiated', contact_context: 'Applicant supplied', assignee_user_id: 'owner' })
  return { db, call }
}

test('0055 adds nullable Discord and Interns reference columns', () => {
  assert.equal(migrations.at(-1).name, '0055_discord_interns_fields')
  const f = fixture()
  try {
    const columns = f.db.prepare('PRAGMA table_info(hiring_applications)').all().map(row => row.name)
    assert.ok(columns.includes('discord_handle'))
    assert.ok(columns.includes('interns_app_id'))
    assert.ok(columns.includes('interns_invite_status'))
    assert.equal(f.db.prepare("SELECT discord_handle,interns_app_id FROM hiring_applications WHERE id='app'").get().interns_app_id, null)
  } finally { f.db.close() }
})

test('scoped read and versioned update expose both fields, reject outsiders and stale writes', () => {
  const f = fixture()
  try {
    const update = { organization_id: 'org', brand_id: 'brand', application_id: 'app', expected_version: 1, operation_id: 'fields-1', discord_handle: 'person', interns_app_id: 'invite-123' }
    assert.deepEqual(f.call('update_application_interns_fields', 'outsider', update), [0, 0])
    assert.deepEqual(f.call('update_application_interns_fields', 'owner', update), [1, 1])
    const row = f.call('get_application', 'owner', update)[0]
    assert.equal(row.discord_handle, 'person')
    assert.equal(row.interns_app_id, 'invite-123')
    assert.equal(row.interns_invite_status, 'invited')
    assert.equal(row.version, 2)
    assert.equal(f.call('list_applications', 'owner', { organization_id: 'org', brand_id: 'brand' })[0].interns_app_id, 'invite-123')
    assert.deepEqual(f.call('get_application', 'outsider', update), [])
    assert.deepEqual(f.call('update_application_interns_fields', 'owner', { ...update, operation_id: 'stale' }), [0, 0])
    assert.deepEqual(f.call('update_application_interns_fields', 'owner', update), [0, 0])
    assert.equal(f.db.prepare("SELECT count(*) AS n FROM hiring_audit_events WHERE action='application.interns_fields_updated'").get().n, 1)
  } finally { f.db.close() }
})

test('cross reference returns only authorized onboarding applications', () => {
  const f = fixture()
  try {
    const offer = { tenant_id: 'org', brand_id: 'brand', application_id: 'app', requisition_id: 'req', terms_json: JSON.stringify({ compensation_type: 'unpaid', subject: 'Intern offer', body: 'Unpaid intern terms' }), expected_version: 0, operation_id: 'offer-draft' }
    f.call('save_offer_draft', 'owner', offer)
    const offerId = f.db.prepare('SELECT id FROM hiring_offers').get().id
    f.call('submit_offer_for_approval', 'owner', { tenant_id: 'org', brand_id: 'brand', offer_id: offerId, expected_version: 1, operation_id: 'offer-submit' })
    f.call('approve_offer', 'owner', { tenant_id: 'org', brand_id: 'brand', offer_id: offerId, expected_version: 2, operation_id: 'offer-approve' })
    f.db.exec("UPDATE hiring_applications SET stage='offered'")
    f.call('record_acceptance', 'owner', { tenant_id: 'org', brand_id: 'brand', application_id: 'app', expected_version: 1, operation_id: 'accept', acceptance_evidence: 'Candidate accepted' })
    f.call('record_lifecycle_transition', 'owner', { ...scope, expected_version: 2, from_stage: 'accepted', to_stage: 'onboarding', operation_id: 'start', evidence: 'Start setup', registration_evidence: '', requirements_evidence: '', handoff_evidence: '' })
    const rows = f.call('list_onboarding_crossref', 'owner', { organization_id: 'org', brand_id: 'brand' })
    assert.equal(rows.length, 1)
    assert.deepEqual([rows[0].applicant_name, rows[0].applicant_email, rows[0].current_status, rows[0].interns_app_id, rows[0].interns_invite_status, rows[0].discord_handle], ['Person', 'person@example.com', 'onboarding', null, 'email_pending', null])
    assert.equal(rows[0].onboarding_operation_id, 'start')
    assert.equal(f.call('get_application', 'owner', scope)[0].interns_invite_status, 'email_pending')
    const notes = f.call('list_application_notes', 'owner', { organization_id: 'org', brand_id: 'brand', application_id: 'app' })
    assert.ok(notes.some(note => note.body.includes('Serge: Interns invitation email pending')))
    assert.deepEqual(f.call('list_onboarding_crossref', 'outsider', { organization_id: 'org', brand_id: 'brand' }), [])
    assert.deepEqual(f.call('list_onboarding_crossref', 'owner', { organization_id: 'other', brand_id: 'brand' }), [])
  } finally { f.db.close() }
})
