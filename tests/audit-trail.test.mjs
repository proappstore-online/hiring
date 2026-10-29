import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { buildAuditTools } from '../scripts/audit-tools.mjs'
import { createAuditedDispatch, redactAuditInputs } from '../scripts/mcp-audit-middleware.mjs'

const migrations = JSON.parse(readFileSync(new URL('../migrations.json', import.meta.url))).migrations
const tools = JSON.parse(readFileSync(new URL('../mcp.json', import.meta.url))).tools
const scope = { organization_id: 'org', brand_id: 'brand' }

function fixture() {
  const db = new DatabaseSync(':memory:')
  db.exec('PRAGMA foreign_keys=ON')
  for (const migration of migrations) db.exec(migration.sql)
  const call = (name, user, values = {}) => {
    const tool = tools.find(t => t.name === name)
    assert.ok(tool, name)
    const params = { ...Object.fromEntries(Object.entries(tool.params ?? {}).filter(([, spec]) => spec.optional).map(([key]) => [key, null])), ...values, __user_id: user, __now: 2_000_000, __uuid: crypto.randomUUID() }
    db.exec('BEGIN')
    try {
      const results = (tool.statements ?? [tool.sql]).map(statement => {
        const binds = []
        const sql = statement.replace(/:([a-z_][a-z0-9_]*)/gi, (_, key) => { assert.notEqual(params[key], undefined, `${name}: ${key}`); binds.push(params[key]); return '?' })
        return tool.operation === 'query' ? db.prepare(sql).all(...binds) : db.prepare(sql).run(...binds).changes
      })
      db.exec('COMMIT')
      return tool.operation === 'query' ? results[0] : results
    } catch (error) { db.exec('ROLLBACK'); throw error }
  }
  call('create_workspace', 'owner', { ...scope, organization_name: 'Org', brand_name: 'Brand', requisition_id: 'req', requisition_title: 'Role', operation_id: 'bootstrap' })
  call('create_linkedin_application', 'owner', { ...scope, requisition_id: 'req', application_id: 'app', candidate_id: 'candidate', candidate_name: 'Person', email: 'person@example.com', phone: '', linkedin_url: '', source_detail: 'Applicant', basis_reference: 'Applicant initiated', contact_context: 'Applicant supplied', assignee_user_id: 'owner', operation_id: 'candidate' })
  return { db, call }
}

test('new tool definitions are generated from source and migrations are append-only', () => {
  for (const generated of buildAuditTools()) assert.deepEqual(tools.find(t => t.name === generated.name), generated)
  assert.deepEqual(migrations.slice(-11).map(m => m.name), ['0056_mcp_audit_trail', '0057_external_actions', '0058_next_actions', '0059_job_lifecycle', '0060_requisition_linkedin_state', '0061_expire_freegamestore_intern', '0062_mcp_refusals', '0063_mcp_refusal_codes', '0064_interns_registration_status', '0065_attachment_manual_review', '0066_application_links'])
  const f = fixture()
  try {
    f.db.prepare("INSERT INTO mcp_audit_log(id,organization_id,brand_id,timestamp,tool_name,input_json,result_status) VALUES ('one','org','brand',1,'test','{}','ok')").run()
    assert.throws(() => f.db.exec("UPDATE mcp_audit_log SET result_status='forged'"), /append-only/)
    assert.throws(() => f.db.exec('DELETE FROM mcp_audit_log'), /append-only/)
  } finally { f.db.close() }
})

test('dispatch adapter covers every registered write and optionally reads, redacting nested secrets', async () => {
  const rows = []
  const dispatch = createAuditedDispatch({ tools, dispatch: async name => ({ name }), appendAudit: row => rows.push(row), now: () => 10, id: () => 'audit-id' })
  for (const tool of tools.filter(tool => tool.operation !== 'query')) {
    const input = { operation_id: 'op', api_key: 'top secret', nested: { access_token: 'hidden', safe: 'visible' } }
    await dispatch(tool.name, input, { caller_agent_id: 'bot', caller_session_id: 'session' })
  }
  assert.equal(rows.length, tools.filter(tool => tool.operation !== 'query').length)
  assert.ok(rows.every(row => row.caller_agent_id === 'bot' && row.caller_session_id === 'session'))
  assert.ok(rows.every(row => JSON.parse(row.input_json).api_key === '[REDACTED]'))
  assert.deepEqual(redactAuditInputs({ nested: [{ password: 'p', safe: 'yes' }] }), { nested: [{ password: '[REDACTED]', safe: 'yes' }] })
  await dispatch('list_next_actions', {})
  assert.equal(rows.length, tools.filter(tool => tool.operation !== 'query').length)
  const readRows = []
  const reads = createAuditedDispatch({ tools, dispatch: async () => [], appendAudit: row => readRows.push(row), logReads: true })
  await reads('list_next_actions', {})
  assert.equal(readRows[0].tool_name, 'list_next_actions')
})

test('external actions preserve provider details and redact audit inputs', () => {
  const f = fixture()
  try {
    const values = { ...scope, kind: 'email', target_candidate_id: 'candidate', target_org_id: 'org', performed_by: 'owner', performed_at: 100, params_json: JSON.stringify({ subject: 'Hello', api_key: 'sensitive' }), gmail_message_id: 'gmail-1', operation_id: 'external-1' }
    assert.throws(()=>f.call('log_external_action', 'outsider', values), /APP:not_found/)
    assert.deepEqual(f.call('log_external_action', 'owner', values), [0, 1, 1, 1])
    const stored = f.db.prepare("SELECT * FROM external_actions WHERE id='external-1'").get()
    assert.equal(stored.gmail_message_id, 'gmail-1')
    assert.deepEqual(JSON.parse(stored.params_json), { subject: 'Hello', api_key: 'sensitive' })
    const audit = f.call('query_audit_log', 'owner', { ...scope, candidate_id: 'candidate' })[0]
    assert.equal(audit.tool_name, 'log_external_action')
    assert.equal(JSON.parse(audit.input_json).params_json, '[REDACTED]')
    assert.equal(f.call('query_audit_log', 'outsider', scope).length, 0)
    const timeline = f.call('get_activity_timeline', 'owner', { ...scope, candidate_id: 'candidate' })
    assert.deepEqual(timeline.map(row => row.source).sort(), ['external', 'mcp'])
    assert.equal(timeline.find(row => row.source === 'external').kind, 'email')
  } finally { f.db.close() }
})

test('next action lifecycle and session summary stay scoped', () => {
  const f = fixture()
  try {
    const create = { ...scope, candidate_id: 'candidate', action: 'Follow up', due_at: 100, owner: 'Serge', operation_id: 'todo-1' }
    assert.deepEqual(f.call('create_next_action', 'owner', create), [1, 1])
    assert.equal(f.call('list_next_actions', 'outsider', scope).length, 0)
    assert.equal(f.call('list_next_actions', 'owner', { ...scope, status: 'open' }).length, 1)
    assert.deepEqual(f.call('update_next_action', 'owner', { ...scope, id: 'todo-1', owner: 'bot', operation_id: 'todo-owner' }), [1, 1])
    assert.equal(f.call('list_next_actions', 'owner', { ...scope, owner: 'bot' }).length, 1)
    let session = f.call('session_start', 'owner', scope)[0]
    assert.equal(JSON.parse(session.open_actions).length, 1)
    assert.equal(JSON.parse(session.overdue_actions).length, 1)
    assert.ok(JSON.parse(session.recent_activity).length >= 1)
    assert.deepEqual(f.call('update_next_action', 'owner', { ...scope, id: 'todo-1', status: 'blocked', blocker_reason: 'Waiting for reply', operation_id: 'todo-2' }), [1, 1])
    assert.equal(f.call('list_next_actions', 'owner', { ...scope, status: 'blocked' })[0].blocker_reason, 'Waiting for reply')
    assert.deepEqual(f.call('complete_next_action', 'owner', { ...scope, id: 'todo-1', operation_id: 'todo-3' }), [1, 1])
    assert.equal(f.call('list_next_actions', 'owner', { ...scope, status: 'done' }).length, 1)
    session = f.call('session_start', 'owner', scope)[0]
    assert.equal(JSON.parse(session.open_actions).length, 0)
  } finally { f.db.close() }
})
