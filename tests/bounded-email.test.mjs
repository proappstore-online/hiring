import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createEmailBudget, createBoundedMailAdapter, createBoundedWorkerReader, createWorkerEmailProcessor } from '../scripts/bounded-email.mjs'
import { Worker } from 'node:worker_threads'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { dispatchCommunication } from '../scripts/outbox.mjs'
import { seedApprovedTemplates } from './communication-fixture.mjs'
import { emailFixture, seedEmailApplication, scope } from './bounded-email-fixture.mjs'

const limits = { sends: 1, summaries: 10, body_reads: 3, body_chars: 12000 }
const budgetFor = (f, patch = {}) => createEmailBudget({ db: f.storage, budgetId: 'org.brand.instance.bridge', windowId: 'run-1', limits, ...patch })
const row = { id: 'draft', recipient_email: 'candidate@example.test', subject: 'Brand owner test', body: 'Owner test message' }
const approval = (draft, key) => ({ ...scope, ...draft, draft_id: draft.id, operation_id: key, template_id: 'template', template_version: 1, reply_to: 'admin@freeappstore.online', approved: true, suppressed: false })
const boundedSend = (f, transport, patch = {}) => createBoundedMailAdapter({ budget: budgetFor(f), authorize: async args => approval({ ...row, id: args.draft_id }, args.operation_id), transport, ...patch })
const options = idempotencyKey => ({ scope, idempotencyKey })
const mail = {
  complete: true, direction: 'inbound', mailbox_address: 'admin@freeappstore.online', provider_connection_id: 'bridge',
  from_email: 'candidate@example.test', to_email: 'admin@freeappstore.online', subject: 'Owner test', body: 'Test reply',
  provider_message_id: 'opaque-message', provider_thread_id: 'opaque-thread', provider_event_id: 'event', occurred_at: 1234,
}
const processArgs = { scope, messageId: mail.provider_message_id, operationId: 'archive-1' }
const processor = (f, patch = {}) => createWorkerEmailProcessor({ actions: f.actions, readMessage: async () => ({ ...mail }), checkpoint: async args => ({ handled: true, archive_reference: args.archive_reference }), mailboxAddress: mail.mailbox_address, connectionId: 'bridge', agentInstanceId: 'instance', ...patch })

test('exhausted durable send budget rejects later sends before provider transport', async t => {
  const f = emailFixture(); t.after(() => f.db.close()); let calls = 0
  const send = boundedSend(f, async () => { calls++; return { outcome: 'accepted' } })
  assert.equal((await send(row, options('first'))).outcome, 'accepted')
  assert.deepEqual(await send(row, options('second')), { outcome: 'not_accepted', reason: 'quota' })
  assert.equal(calls, 1)
  // A new adapter using the same durable DB cannot reset the allowance.
  assert.equal((await boundedSend(f, async () => { calls++ })(row, options('third'))).reason, 'quota')
  assert.equal(calls, 1)
})

test('same send operation is refused across retries, concurrent callers and budget windows', async t => {
  const f = emailFixture(); t.after(() => f.db.close()); let calls = 0
  const transport = async () => { calls++; return { outcome: 'accepted' } }
  const results = await Promise.all([boundedSend(f, transport)(row, options('stable')), boundedSend(f, transport)(row, options('stable'))])
  assert.equal(results.filter(r => r.outcome === 'accepted').length, 1)
  assert.equal(calls, 1)
  const nextDay = boundedSend(f, transport, { budget: budgetFor(f, { windowId: 'run-2' }) })
  assert.equal((await nextDay(row, options('stable'))).outcome, 'not_accepted')
  assert.equal((await nextDay(row, options('new-intent'))).outcome, 'accepted')
  assert.equal(calls, 2)
})

test('two simultaneous sends share atomic admission while the first provider call is pending', async t => {
  const f = emailFixture(); t.after(() => f.db.close()); let calls = 0
  let release, started
  const held = new Promise(resolve => { release = resolve })
  const entering = new Promise(resolve => { started = resolve })
  const transport = async () => { calls++; started(); await held; return { outcome: 'accepted' } }
  const first = boundedSend(f, transport)(row, options('one'))
  await entering
  const second = await boundedSend(f, transport)(row, options('two'))
  assert.equal(second.reason, 'quota'); assert.equal(calls, 1)
  release()
  assert.equal((await first).outcome, 'accepted')
  assert.equal(f.db.prepare('SELECT SUM(sends) n FROM hiring_email_reservations').get().n, 1)
})

test('separate worker/database connections racing for the final send permit only one provider call', async t => {
  const directory = mkdtempSync(join(tmpdir(), 'hiring-email-budget-'))
  const filename = join(directory, 'budget.sqlite')
  const f = emailFixture(filename)
  f.db.exec('PRAGMA journal_mode=WAL')
  t.after(() => { f.db.close(); rmSync(directory, { recursive: true, force: true }) })
  const workers = Array.from({ length: 2 }, (_, i) => new Worker(new URL('./bounded-email-worker.mjs', import.meta.url), { workerData: { filename, operationId: 'send-' + i } }))
  const exits = workers.map(worker => new Promise((resolve, reject) => {
    worker.on('error', reject)
    worker.on('exit', code => code === 0 ? resolve() : reject(new Error('budget worker failed')))
  }))
  t.after(async () => { await Promise.all(workers.map(w => w.terminate())) })
  const results = workers.map(worker => new Promise((resolve, reject) => {
    worker.on('error', reject)
    worker.on('exit', code => { if (code !== 0) reject(new Error('budget worker failed')) })
    worker.on('message', message => {
      if (message.ready) {
        ready++
        if (ready === workers.length) for (const w of workers) w.postMessage('go')
      } else resolve(message)
    })
  }))
  let ready = 0
  const outcomes = await Promise.all(results)
  await Promise.all(exits)
  assert.equal(outcomes.filter(r => r.outcome === 'accepted').length, 1)
  assert.equal(outcomes.filter(r => r.reason === 'quota').length, 1)
  assert.equal(outcomes.reduce((n, r) => n + r.providerCalls, 0), 1)
  assert.equal(f.db.prepare('SELECT SUM(sends) n FROM hiring_email_reservations').get().n, 1)
})

test('changed payload under a reserved identity is a conflict, not permission to resend', async t => {
  const f = emailFixture(); t.after(() => f.db.close())
  const budget = budgetFor(f)
  assert.equal((await budget.reserve({ operationId: 'stable', payload: ['original'], sends: 1 })).admitted, true)
  assert.equal((await budget.reserve({ operationId: 'stable', payload: ['changed'], sends: 1 })).reason, 'conflict')
  assert.equal((await budget.reserve({ operationId: 'stable', payload: ['original'], sends: 1 })).reason, 'duplicate')
})

test('unknown/failed sends retain reservations; failed authorization spends no capacity', async t => {
  for (const response of ['timeout', 'rejected']) {
    const f = emailFixture(); t.after(() => f.db.close()); let calls = 0
    const transport = async () => { calls++; if (response === 'timeout') throw Error('provider timeout'); return { outcome: 'not_accepted', reason: 'unavailable' } }
    const send = boundedSend(f, transport)
    assert.equal((await send(row, options('first'))).outcome, response === 'timeout' ? 'unknown' : 'not_accepted')
    assert.equal((await send(row, options('first'))).outcome, 'not_accepted')
    assert.equal((await send(row, options('second'))).reason, 'quota')
    assert.equal(calls, 1)
  }
  const f = emailFixture(); t.after(() => f.db.close())
  const denied = boundedSend(f, async () => assert.fail('transport called'), { authorize: async () => null })
  assert.equal((await denied(row, options('denied'))).reason, 'approval_required')
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM hiring_email_reservations').get().n, 0)
})

test('immutable budget policy cannot be enlarged or reservations refunded', async t => {
  const f = emailFixture(); t.after(() => f.db.close())
  await budgetFor(f).reserve({ operationId: 'first', payload: [], sends: 1 })
  assert.equal((await budgetFor(f, { limits: { ...limits, sends: 2 } }).reserve({ operationId: 'second', payload: [], sends: 1 })).reason, 'policy_conflict')
  for (const sql of ['DELETE FROM hiring_email_reservations', 'UPDATE hiring_email_reservations SET sends=0', 'DELETE FROM hiring_email_budget_windows', 'UPDATE hiring_email_budget_windows SET sends=100']) assert.throws(() => f.db.exec(sql), /durable|immutable/)
  assert.throws(() => budgetFor(f, { limits: { ...limits, sends: -1 } }), TypeError)
  assert.equal((await budgetFor(f).reserve({ operationId: 'bad', payload: [], sends: NaN })).reason, 'invalid_reservation')
})

test('metadata/body budget exhaustion blocks fetches, including concurrent reads', async t => {
  const f = emailFixture(); t.after(() => f.db.close()); let lists = 0, reads = 0
  const createReader = () => createBoundedWorkerReader({ budget: budgetFor(f), listMessages: async () => { lists++; return { messages: [] } }, readMessage: async () => { reads++; return { body: 'short', complete: true } } })
  await createReader().list()
  assert.equal((await createReader().list()).reason, 'quota'); assert.equal(lists, 1)
  const results = await Promise.all(Array.from({ length: 4 }, () => createReader().read({ messageId: 'm' })))
  assert.equal(results.filter(r => r.outcome === 'blocked').length, 1); assert.equal(reads, 3)
  assert.equal(f.db.prepare('SELECT SUM(body_chars) n FROM hiring_email_reservations').get().n, 12000)
})

test('failed fetches consume reserved capacity and invalid body windows never pass through', async t => {
  const f = emailFixture(); t.after(() => f.db.close()); let reads = 0
  const reader = createBoundedWorkerReader({ budget: budgetFor(f, { limits: { ...limits, body_reads: 1, body_chars: 4000 } }), listMessages: async () => ({ messages: [] }), readMessage: async () => { reads++; throw Error('offline') } })
  await assert.rejects(reader.read({ messageId: 'm' }), /offline/)
  assert.equal((await reader.read({ messageId: 'm' })).reason, 'quota'); assert.equal(reads, 1)
  assert.equal((await reader.read({ messageId: 'm', maxChars: 4001 })).reason, 'invalid_window')
  assert.equal((await reader.list({ limit: 11 })).reason, 'invalid_limit')
})

test('character capacity is reserved before reads independently of remaining read count', async t => {
  const f = emailFixture(); t.after(() => f.db.close()); let calls = 0
  const reader = createBoundedWorkerReader({ budget: budgetFor(f, { limits: { ...limits, body_chars: 4000 } }), listMessages: async () => ({ messages: [] }), readMessage: async () => { calls++; return { body: 'short' } } })
  await reader.read({ messageId: 'm' })
  assert.equal((await reader.read({ messageId: 'other', maxChars: 1 })).reason, 'quota')
  assert.equal(calls, 1)
})

test('storage failure cannot result in an unreserved provider send', async () => {
  const budget = createEmailBudget({ db: { query: async () => { throw Error('offline') }, execute: async () => { throw Error('offline') } }, budgetId: 'b', windowId: 'w', limits })
  const send = createBoundedMailAdapter({ budget, authorize: async () => approval(row, 'op'), transport: async () => assert.fail('provider called') })
  assert.equal((await send(row, options('op'))).outcome, 'unknown')
})

test('oversized provider responses and nonprogressing/misaligned continuations are refused', async t => {
  const f = emailFixture(); t.after(() => f.db.close())
  for (const result of [{ body: 'x'.repeat(4001) }, { body: 'abc', subject: 'x'.repeat(201) }, { body: 'abc', nextOffset: 0 }, { body: 'abc', nextOffset: 100 }, { body: 'abc', nextOffset: NaN }]) {
    const reader = createBoundedWorkerReader({ budget: budgetFor(f, { windowId: crypto.randomUUID() }), listMessages: async () => ({ messages: Array(11).fill({}) }), readMessage: async () => result })
    assert.equal((await reader.read({ messageId: 'm' })).reason, 'invalid_window')
    assert.equal((await reader.list()).reason, 'invalid_page')
  }
})

test('metadata listing strips bodies/raw extras and rejects repeated cursors', async t => {
  const f = emailFixture(); t.after(() => f.db.close())
  const reader = createBoundedWorkerReader({ budget: budgetFor(f), listMessages: async () => ({ messages: [{ message_id: 'm', subject: 'Subject', from_email: 'candidate@example.test', to_email: mail.mailbox_address, occurred_at: 1234, body: 'must not reach model', attachments: ['raw'] }], nextCursor: 'page-2', raw: 'must not reach model' }), readMessage: async () => ({ ...mail, raw: 'must not reach model' }) })
  const page = await reader.list({ limit: 1 })
  assert.equal(page.messages[0].message_id, 'm'); assert.equal(page.nextCursor, 'page-2')
  assert.ok(!JSON.stringify(page).includes('must not reach model'))
  assert.equal((await reader.list({ limit: 1, cursor: 'page-2' })).reason, 'invalid_page')
  assert.equal((await reader.read({ messageId: 'm' })).raw, undefined)
})

test('real Hiring archive commits before exact readback and checkpoint; replays preserve archive identity', async t => {
  const f = emailFixture(); t.after(() => f.db.close()); await seedEmailApplication(f)
  const sequence = [], marks = new Map()
  const process = processor(f, {
    actions: async (name, params) => { sequence.push(name); return f.actions(name, params) },
    checkpoint: async args => {
      sequence.push('checkpoint')
      assert.equal(f.db.prepare('SELECT COUNT(*) n FROM hiring_worker_communication_events').get().n, 1)
      assert.equal(f.db.prepare("SELECT COUNT(*) n FROM hiring_audit_events WHERE id='archive-1'").get().n, 1)
      if (marks.has(args.message_id)) assert.equal(marks.get(args.message_id), args.archive_reference)
      marks.set(args.message_id, args.archive_reference)
      return { handled: true, archive_reference: args.archive_reference }
    },
  })
  assert.equal((await process(processArgs)).outcome, 'handled')
  assert.deepEqual(sequence, ['record_worker_candidate_email', 'get_worker_candidate_email', 'checkpoint'])
  const original = f.db.prepare('SELECT * FROM hiring_worker_communication_events').get()
  assert.equal((await process(processArgs)).outcome, 'handled')
  assert.deepEqual(f.db.prepare('SELECT * FROM hiring_worker_communication_events').all(), [original])
  assert.equal(marks.size, 1)
})

test('failed archive or readback never checkpoints and an audit failure rolls back correspondence', async t => {
  for (const failure of ['archive', 'readback', 'audit']) {
    const f = emailFixture(); t.after(() => f.db.close()); await seedEmailApplication(f); let marks = 0
    if (failure === 'audit') f.db.exec("CREATE TRIGGER fail_archive BEFORE INSERT ON hiring_audit_events BEGIN SELECT RAISE(ABORT,'offline'); END")
    const process = processor(f, { actions: async (name, args) => {
      if (name === (failure === 'archive' ? 'record_worker_candidate_email' : failure === 'readback' ? 'get_worker_candidate_email' : 'none')) throw Error('offline')
      return f.actions(name, args)
    }, checkpoint: async () => { marks++ } })
    assert.equal((await process(processArgs)).outcome, 'blocked'); assert.equal(marks, 0)
    if (failure === 'audit') assert.equal(f.db.prepare('SELECT COUNT(*) n FROM hiring_worker_communication_events').get().n, 0)
  }
})

test('empty or mismatched readback cannot checkpoint even after a successful archive', async t => {
  const f = emailFixture(); t.after(() => f.db.close()); await seedEmailApplication(f)
  for (const patch of [null, { body: 'wrong' }, { provider_message_id: 'wrong' }, { mailbox_address: 'wrong' }, { provider_connection_id: 'wrong' }, { provider_event_id: 'wrong' }, { direction: 'outbound' }, { agent_instance_id: 'wrong' }, { operation_id: 'wrong' }]) {
    const process = processor(f, { actions: async (name, args) => {
      const result = await f.actions(name, args)
      return name === 'get_worker_candidate_email' ? { rows: patch === null ? [] : [{ ...result.rows[0], ...patch }] } : result
    }, checkpoint: async () => assert.fail('checkpoint called') })
    assert.equal((await process(processArgs)).reason, 'archive_mismatch')
  }
})

test('candidate mismatch and conflicting retry do not advance checkpoint', async t => {
  const f = emailFixture(); t.after(() => f.db.close()); await seedEmailApplication(f)
  const neverCheckpoint = async () => assert.fail('checkpoint called')
  assert.equal((await processor(f, { readMessage: async () => ({ ...mail, from_email: 'other@example.test' }), checkpoint: neverCheckpoint })(processArgs)).reason, 'archive_mismatch')
  await processor(f)(processArgs)
  assert.equal((await processor(f, { readMessage: async () => ({ ...mail, body: 'changed' }), checkpoint: neverCheckpoint })(processArgs)).reason, 'archive_failed')
  assert.equal(f.db.prepare('SELECT body FROM hiring_worker_communication_events').get().body, mail.body)
})

test('lost checkpoint response retries the same verified operation without duplicate archive/audit', async t => {
  const f = emailFixture(); t.after(() => f.db.close()); await seedEmailApplication(f); const references = []
  const process = processor(f, { checkpoint: async args => {
    references.push(args.archive_reference)
    if (references.length === 1) throw Error('response lost after commit')
    return { handled: true, archive_reference: args.archive_reference }
  } })
  assert.equal((await process(processArgs)).reason, 'checkpoint_failed')
  assert.equal((await process(processArgs)).outcome, 'handled')
  assert.deepEqual(references, ['archive-1', 'archive-1'])
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM hiring_worker_communication_events').get().n, 1)
  assert.equal(f.db.prepare("SELECT COUNT(*) n FROM hiring_audit_events WHERE id='archive-1'").get().n, 1)
})

test('bounded read→real archive→readback→checkpoint refuses previews and stops on exhausted read budget', async t => {
  const f = emailFixture(); t.after(() => f.db.close()); await seedEmailApplication(f); let reads = 0, marks = 0
  const reader = createBoundedWorkerReader({ budget: budgetFor(f, { limits: { ...limits, body_reads: 2 } }), listMessages: async () => ({ messages: [] }), readMessage: async () => { reads++; return reads === 1 ? { ...mail, complete: false, truncated: true, nextOffset: mail.body.length } : { ...mail } } })
  const process = processor(f, { readMessage: reader.read, checkpoint: async args => { marks++; return { handled: true, archive_reference: args.archive_reference } } })
  assert.equal((await process(processArgs)).reason, 'incomplete_message')
  assert.equal(marks, 0); assert.equal(f.db.prepare('SELECT COUNT(*) n FROM hiring_worker_communication_events').get().n, 0)
  assert.equal((await process(processArgs)).outcome, 'handled')
  assert.equal((await process(processArgs)).reason, 'quota')
  assert.equal(reads, 2); assert.equal(marks, 1)
})

test('foreign mailbox/connection and malformed checkpoint receipts fail closed', async t => {
  const f = emailFixture(); t.after(() => f.db.close()); await seedEmailApplication(f)
  for (const patch of [{ mailbox_address: 'foreign@example.test' }, { provider_connection_id: 'foreign' }, { provider_message_id: 'foreign' }, { to_email: 'foreign@example.test' }]) {
    assert.equal((await processor(f, { readMessage: async () => ({ ...mail, ...patch }), checkpoint: async () => assert.fail('checkpoint called') })(processArgs)).reason, 'scope_mismatch')
  }
  for (const response of [null, { handled: false }, { handled: true, archive_reference: 'other' }, { isError: true, handled: true, archive_reference: 'archive-1' }]) {
    assert.equal((await processor(f, { checkpoint: async () => response })(processArgs)).reason, 'checkpoint_failed')
  }
})

test('error-marked provider reads and archives never checkpoint', async t => {
  const f = emailFixture(); t.after(() => f.db.close()); await seedEmailApplication(f)
  assert.equal((await processor(f, { readMessage: async () => ({ ...mail, isError: true }), checkpoint: async () => assert.fail('checkpoint called') })(processArgs)).reason, 'read_failed')
  assert.equal((await processor(f, { actions: async () => ({ isError: true }), checkpoint: async () => assert.fail('checkpoint called') })(processArgs)).reason, 'archive_failed')
})

test('bounded mail adapter composes with durable outbox: one acceptance, one quota failure, no resend', async t => {
  const f = emailFixture(); t.after(() => f.db.close()); await seedEmailApplication(f)
  for (const id of ['one', 'two']) await f.actions('create_communication_draft', { ...scope, draft_id: id, recipient_email: row.recipient_email, subject: row.subject, body: row.body, operation_id: id })
  seedApprovedTemplates(f.db)
  for (const id of ['one', 'two']) await f.actions('queue_communication', { ...scope, draft_id: id, operation_id: 'queue-' + id })
  let calls = 0
  const send = boundedSend(f, async () => { calls++; return { outcome: 'accepted' } })
  const results = await Promise.all(['one', 'two'].map(draftId => dispatchCommunication({ actions: f.actions, send, scope, draftId })))
  assert.deepEqual(results.sort(), ['failed', 'sent']); assert.equal(calls, 1)
  const failed = f.db.prepare("SELECT delivery_reason FROM hiring_outbox WHERE delivery_state='failed'").get()
  assert.equal(failed.delivery_reason, 'quota')
  for (const draftId of ['one', 'two']) assert.equal(await dispatchCommunication({ actions: f.actions, send, scope, draftId }), 'not_claimed')
  assert.equal(calls, 1)
})
