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

test('agent emails and crawl activity are append-only, visible to the granted workspace, and auditable', () => {
  const { db, call } = fixture()
  call('create_workspace', 'staff-a', bootstrap)
  call('create_linkedin_application', 'staff-a', candidate)
  const sent = {
    ...scope,
    application_id: 'app-a',
    communication_id: 'email-out-1',
    direction: 'outbound',
    from_email: 'admin@freeappstore.online',
    to_email: 'a@example.com',
    subject: 'Interview availability',
    body: 'Could you share your availability next week?',
    provider_message_id: 'gmail-message-out-1',
    provider_thread_id: 'gmail-thread-1',
    occurred_at: 100,
    agent_instance_id: 'pags-hiring-comms',
    operation_id: 'record-email-out-1',
  }
  assert.deepEqual(call('record_candidate_email', 'outsider', sent), [0, 0])
  assert.deepEqual(call('record_candidate_email', 'staff-a', { ...sent, to_email: 'wrong@example.com', communication_id: 'wrong-email', provider_message_id: 'wrong-provider', operation_id: 'wrong-email-op' }), [0, 0])
  assert.deepEqual(call('record_candidate_email', 'staff-a', sent), [1, 1])
  assert.deepEqual(call('record_candidate_email', 'staff-a', { ...sent, communication_id: 'email-out-retry', operation_id: 'record-email-out-retry' }), [0, 0])
  const received = { ...sent, communication_id: 'email-in-1', direction: 'inbound', from_email: 'a@example.com', to_email: 'admin@freeappstore.online', subject: 'Re: Interview availability', body: 'Tuesday afternoon works for me.', provider_message_id: 'gmail-message-in-1', operation_id: 'record-email-in-1', occurred_at: 200 }
  assert.deepEqual(call('record_candidate_email', 'staff-a', received), [1, 1])
  const communications = call('list_application_communications', 'staff-a', { ...scope, application_id: 'app-a' })
  assert.equal(communications.length, 2)
  assert.equal(communications[0].direction, 'inbound')
  assert.equal(communications[0].body, received.body)
  assert.equal(call('list_application_communications', 'outsider', { ...scope, application_id: 'app-a' }).length, 0)
  assert.equal(db.prepare("SELECT count(*) AS n FROM hiring_audit_events WHERE action IN ('communication.email_sent','communication.email_received')").get().n, 2)

  const crawl = { ...scope, application_id: 'app-a', activity_id: 'crawl-1', activity_type: 'candidate_profile_crawled', source_url: 'https://www.linkedin.com/in/a-person', summary: 'Reviewed public profile for role-relevant experience.', occurred_at: 300, agent_instance_id: 'pags-hiring-comms', operation_id: 'record-crawl-1' }
  assert.deepEqual(call('record_agent_activity', 'staff-a', { ...crawl, source_url: 'http://invalid.example', activity_id: 'invalid-crawl', operation_id: 'invalid-crawl-op' }), [0, 0])
  assert.deepEqual(call('record_agent_activity', 'staff-a', crawl), [1, 1])
  assert.deepEqual(call('record_agent_activity', 'staff-a', crawl), [0, 0])
  assert.equal(call('list_application_agent_activity', 'staff-a', { ...scope, application_id: 'app-a' }).length, 1)
  assert.equal(call('list_application_agent_activity', 'outsider', { ...scope, application_id: 'app-a' }).length, 0)
  assert.equal(db.prepare("SELECT count(*) AS n FROM hiring_audit_events WHERE action='agent.candidate_profile_crawled'").get().n, 1)
})

const workerMail = {
  ...scope, application_id: 'app-a', communication_id: 'worker-out-1', direction: 'outbound',
  mailbox_address: 'admin@freeappstore.online', provider_connection_id: 'fas-hiring-bridge',
  from_email: 'admin@freeappstore.online', to_email: 'a@example.com', subject: 'Interview availability',
  body: 'Could you share your availability?', provider_message_id: 'out_opaque:bridge-message',
  provider_thread_id: '<opaque-thread@bridge>', provider_receipt_id: 'cloudflare-accepted-id',
  occurred_at: 400, agent_instance_id: 'pags-hiring-comms', operation_id: 'worker-record-op',
}
function workerFixture() {
  const fixtureData = fixture()
  fixtureData.call('create_workspace', 'staff-a', bootstrap)
  fixtureData.call('create_linkedin_application', 'staff-a', candidate)
  return fixtureData
}

test('Cloudflare mail retains separate opaque IDs, exact mailbox, content and authenticated actor', () => {
  const { db, call } = workerFixture()
  assert.deepEqual(call('record_worker_candidate_email', 'staff-a', workerMail), [1, 1])
  const [row] = call('get_worker_candidate_email', 'staff-a', workerMail)
  assert.equal(row.channel, 'email-worker')
  assert.equal(row.provider, 'cloudflare')
  for (const key of ['mailbox_address','provider_connection_id','provider_message_id','provider_thread_id','provider_receipt_id','body','operation_id']) assert.equal(row[key], workerMail[key], key)
  assert.equal(row.provider_event_id, null)
  assert.equal(row.actor_user_id, 'staff-a')
  const received = { ...workerMail, communication_id: 'worker-in-1', direction: 'inbound', from_email: 'a@example.com', to_email: 'admin@freeappstore.online', provider_message_id: '<original-message@example.com>', provider_event_id: 'in:<original-message@example.com>', provider_receipt_id: null, operation_id: 'worker-in-op' }
  assert.deepEqual(call('record_worker_candidate_email', 'staff-a', received), [1, 1])
  assert.equal(call('get_worker_candidate_email', 'staff-a', received)[0].provider_event_id, received.provider_event_id)
  assert.equal(db.prepare("SELECT count(*) AS n FROM hiring_audit_events WHERE action='communication.email_sent'").get().n, 1)
  assert.equal(db.prepare("SELECT count(*) AS n FROM hiring_communication_events").get().n, 0)
  assert.throws(() => db.exec("UPDATE hiring_worker_communication_events SET body='rewritten'"), /append-only/)
  assert.throws(() => db.exec('DELETE FROM hiring_worker_communication_events'), /append-only/)
  db.close()
})

test('Cloudflare archives preserve owner, brand, application, candidate and mailbox gates', () => {
  const { db, call } = workerFixture()
  call('create_workspace', 'staff-b', { ...bootstrap, organization_id: 'org-b', brand_id: 'brand-b', requisition_id: 'req-b', operation_id: 'bootstrap-b' })
  call('create_linkedin_application', 'staff-b', { ...candidate, organization_id: 'org-b', brand_id: 'brand-b', requisition_id: 'req-b', candidate_id: 'cand-b', application_id: 'app-b', assignee_user_id: 'staff-b', operation_id: 'create-b' })
  for (const [user, patch] of [
    ['outsider', {}],
    ['staff-a', { brand_id: 'brand-b' }],
    ['staff-a', { organization_id: 'org-b', brand_id: 'brand-b', application_id: 'app-b' }],
    ['staff-a', { application_id: 'app-b' }],
    ['staff-a', { to_email: 'another-candidate@example.com' }],
    ['staff-a', { from_email: 'wrong-mailbox@example.com' }],
    ['staff-a', { direction: 'inbound', from_email: 'a@example.com', to_email: 'wrong-mailbox@example.com' }],
  ]) assert.deepEqual(call('record_worker_candidate_email', user, { ...workerMail, ...patch }), [0, 0])
  assert.equal(db.prepare('SELECT count(*) AS n FROM hiring_worker_communication_events').get().n, 0)
  assert.deepEqual(call('record_worker_candidate_email', 'staff-a', workerMail), [1, 1])
  assert.equal(call('get_worker_candidate_email', 'outsider', workerMail).length, 0)
  assert.equal(call('get_worker_candidate_email', 'staff-b', workerMail).length, 0)
  assert.equal(call('list_application_communications', 'staff-b', workerMail).length, 0)
  // An orphaned archive cannot be used to recreate an audit after the actor loses membership.
  db.prepare('DELETE FROM hiring_audit_events WHERE operation_id=?').run(workerMail.operation_id)
  db.exec("DELETE FROM hiring_memberships WHERE user_id='staff-a'")
  assert.deepEqual(call('record_worker_candidate_email', 'staff-a', workerMail), [0, 0])
  assert.equal(db.prepare('SELECT count(*) AS n FROM hiring_audit_events WHERE operation_id=?').get(workerMail.operation_id).n, 0)
  db.close()
})

test('Cloudflare replay and conflicting IDs never claim a newly archived record', () => {
  const { db, call } = workerFixture()
  assert.deepEqual(call('record_worker_candidate_email', 'staff-a', workerMail), [1, 1])
  assert.deepEqual(call('record_worker_candidate_email', 'staff-a', workerMail), [0, 0])
  assert.deepEqual(call('record_worker_candidate_email', 'staff-a', { ...workerMail, body: 'Conflicting body' }), [0, 0])
  assert.equal(call('get_worker_candidate_email', 'staff-a', workerMail)[0].body, workerMail.body)
  const retry = { ...workerMail, communication_id: 'worker-new-id', operation_id: 'worker-new-op' }
  assert.deepEqual(call('record_worker_candidate_email', 'staff-a', retry), [0, 0])
  assert.deepEqual(call('get_worker_candidate_email', 'staff-a', retry), [])
  assert.deepEqual(call('record_worker_candidate_email', 'staff-a', { ...retry, provider_message_id: 'different-bridge-id-same-receipt' }), [0, 0])
  assert.equal(db.prepare('SELECT count(*) AS n FROM hiring_worker_communication_events').get().n, 1)
  assert.equal(db.prepare("SELECT count(*) AS n FROM hiring_audit_events WHERE action='communication.email_sent'").get().n, 1)
  db.close()
})

test('Gmail and worker history coexist without rewriting or relabeling old messages', () => {
  const { db, call } = workerFixture()
  const gmail = { ...workerMail, communication_id: 'gmail-one', provider_message_id: workerMail.provider_message_id, operation_id: 'gmail-op', occurred_at: 100 }
  assert.deepEqual(call('record_candidate_email', 'staff-a', gmail), [1, 1])
  assert.deepEqual(call('record_worker_candidate_email', 'staff-a', { ...workerMail, operation_id: gmail.operation_id }), [0, 0])
  assert.deepEqual(call('record_worker_candidate_email', 'staff-a', workerMail), [1, 1])
  const rows = call('list_application_communications', 'staff-a', workerMail)
  assert.equal(rows.length, 2)
  assert.equal(rows[0].channel, 'email-worker')
  assert.equal(rows[0].provider, 'cloudflare')
  assert.equal(rows[0].provider_receipt_id, workerMail.provider_receipt_id)
  assert.equal(rows[1].channel, 'gmail')
  assert.equal(rows[1].provider, 'gmail')
  assert.equal(rows[1].provider_receipt_id, null)
  assert.equal(rows[1].body, gmail.body)
  assert.equal(call('list_application_communications', 'outsider', workerMail).length, 0)
  db.close()
})

test('worker provider dedupe respects separate mailbox and bridge namespaces', () => {
  const { db, call } = workerFixture()
  assert.deepEqual(call('record_worker_candidate_email', 'staff-a', workerMail), [1, 1])
  assert.deepEqual(call('record_worker_candidate_email', 'staff-a', { ...workerMail, communication_id: 'another-bridge', provider_connection_id: 'second-bridge', operation_id: 'another-bridge-op' }), [1, 1])
  assert.deepEqual(call('record_worker_candidate_email', 'staff-a', { ...workerMail, communication_id: 'another-mailbox', mailbox_address: 'hiring@freeappstore.online', from_email: 'hiring@freeappstore.online', operation_id: 'another-mailbox-op' }), [1, 1])
  assert.equal(call('list_application_communications', 'staff-a', workerMail).length, 3)
  db.close()
})
