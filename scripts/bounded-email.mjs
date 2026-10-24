import { createMailAdapter } from './mail.mjs'

const dimensions = ['sends', 'summaries', 'body_reads', 'body_chars']
const validId = value => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/.test(value)
const blocked = reason => ({ outcome: 'blocked', reason })
const hash = async value => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(value)))), b => b.toString(16).padStart(2, '0')).join('')

/** Trusted server dependencies only: db.query/execute use positional parameters
 * and return PAS-style {rows}/{meta:{changes}}. budgetId identifies the fixed
 * tenant/instance/connection; windowId is chosen by the server (run or UTC day),
 * never by the agent. All workers must share this durable database and policy.
 * Reservations are never refunded, including after failed/unknown provider calls.
 */
export function createEmailBudget({ db, budgetId, windowId, limits }) {
  if (typeof db?.query !== 'function' || typeof db?.execute !== 'function' || !validId(budgetId) || !validId(windowId) || !dimensions.every(k => Number.isSafeInteger(limits?.[k]) && limits[k] >= 0 && limits[k] <= 1_000_000)) throw new TypeError('Trusted email budget configuration required')
  const caps = dimensions.map(k => limits[k])
  return {
    async reserve({ operationId, payload, ...units }) {
      if (!validId(operationId) || !dimensions.every(k => Number.isSafeInteger(units[k] ?? 0) && (units[k] ?? 0) >= 0 && (units[k] ?? 0) <= 1_000_000) || !dimensions.some(k => units[k] > 0)) return { admitted: false, reason: 'invalid_reservation' }
      const amounts = dimensions.map(k => units[k] ?? 0)
      const fingerprint = await hash([payload, amounts])
      await db.execute('INSERT INTO hiring_email_budget_windows (budget_id,window_id,sends,summaries,body_reads,body_chars) VALUES (?,?,?,?,?,?) ON CONFLICT DO NOTHING', [budgetId, windowId, ...caps])
      const { rows: policies } = await db.query('SELECT sends,summaries,body_reads,body_chars FROM hiring_email_budget_windows WHERE budget_id=? AND window_id=?', [budgetId, windowId])
      if (policies.length !== 1 || !dimensions.every((k, i) => policies[0][k] === caps[i])) return { admitted: false, reason: 'policy_conflict' }
      // One conditional INSERT owns both quota admission and operation dedupe.
      // There is no read-then-increment race, even across worker processes.
      const result = await db.execute(`INSERT INTO hiring_email_reservations (budget_id,operation_id,window_id,payload_hash,sends,summaries,body_reads,body_chars)
        SELECT ?,?,?,?,?,?,?,? FROM hiring_email_budget_windows p WHERE p.budget_id=? AND p.window_id=?
        AND NOT EXISTS (SELECT 1 FROM hiring_email_reservations WHERE budget_id=? AND operation_id=?)
        AND ${dimensions.map(k => `COALESCE((SELECT SUM(r.${k}) FROM hiring_email_reservations r WHERE r.budget_id=p.budget_id AND r.window_id=p.window_id),0)+?<=p.${k}`).join(' AND ')}
        ON CONFLICT DO NOTHING`, [budgetId, operationId, windowId, fingerprint, ...amounts, budgetId, windowId, budgetId, operationId, ...amounts])
      if (result.meta?.changes === 1) return { admitted: true }
      const { rows } = await db.query('SELECT payload_hash FROM hiring_email_reservations WHERE budget_id=? AND operation_id=?', [budgetId, operationId])
      return { admitted: false, reason: rows.length ? (rows[0].payload_hash === fingerprint ? 'duplicate' : 'conflict') : 'quota' }
    },
  }
}

/** Used as dispatchCommunication's send dependency. Approval and payload checks
 * still run in createMailAdapter before any durable budget reservation.
 * Replays (including uncertain sends) are refused rather than sent again.
 */
export function createBoundedMailAdapter({ authorize, transport, budget }) {
  if (typeof budget?.reserve !== 'function' || typeof transport !== 'function') throw new TypeError('Bounded mail dependencies required')
  return createMailAdapter({ authorize, transport: async payload => {
    const admission = await budget.reserve({ operationId: payload.operation_id, payload, sends: 1 })
    if (admission?.admitted !== true) return { outcome: 'not_accepted', reason: admission?.reason === 'quota' ? 'quota' : 'forbidden' }
    return transport(payload)
  } })
}

/** Metadata/body adapters must enforce the pinned recipient policy at the provider.
 * These wrappers additionally enforce the tighter Hiring run budget before fetch.
 * Provider response shapes are normalized by trusted adapters, not native MCP tools.
 */
export function createBoundedWorkerReader({ budget, listMessages, readMessage, newId = () => crypto.randomUUID() }) {
  if (typeof budget?.reserve !== 'function' || typeof listMessages !== 'function' || typeof readMessage !== 'function') throw new TypeError('Bounded reader dependencies required')
  return {
    async list({ limit = 10, cursor = null } = {}) {
      if (!Number.isSafeInteger(limit) || limit < 1 || limit > 10) return blocked('invalid_limit')
      const admission = await budget.reserve({ operationId: newId(), payload: ['list', cursor, limit], summaries: limit })
      if (!admission.admitted) return blocked(admission.reason)
      const result = await listMessages({ limit, cursor })
      if (result?.isError || !Array.isArray(result?.messages) || result.messages.length > limit || (result.nextCursor != null && (typeof result.nextCursor !== 'string' || !result.nextCursor || result.nextCursor.length > 4096 || result.nextCursor === cursor))) return blocked('invalid_page')
      // Metadata only: never forward provider bodies, attachments or raw extras.
      const fields = { message_id: 2000, subject: 200, from_email: 254, to_email: 254 }
      const messages = []
      for (const item of result.messages) {
        if (!item || typeof item.message_id !== 'string' || !item.message_id || !Object.entries(fields).every(([key, max]) => item[key] == null || (typeof item[key] === 'string' && item[key].length <= max)) || !Number.isSafeInteger(item.occurred_at) || item.occurred_at <= 0) return blocked('invalid_page')
        messages.push(Object.fromEntries([...Object.keys(fields).map(key => [key, item[key] ?? null]), ['occurred_at', item.occurred_at]]))
      }
      return { messages, nextCursor: result.nextCursor ?? null }
    },
    async read({ messageId, offset = 0, maxChars = 4000 }) {
      if (typeof messageId !== 'string' || !messageId || !Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(maxChars) || maxChars < 1 || maxChars > 4000) return blocked('invalid_window')
      const admission = await budget.reserve({ operationId: newId(), payload: ['read', messageId, offset, maxChars], body_reads: 1, body_chars: maxChars })
      if (!admission.admitted) return blocked(admission.reason)
      const result = await readMessage({ messageId, offset, maxChars })
      if (result?.isError || typeof result?.body !== 'string' || result.body.length > maxChars || (result.nextOffset != null && (!Number.isSafeInteger(result.nextOffset) || result.nextOffset !== offset + result.body.length || result.nextOffset <= offset))) return blocked('invalid_window')
      const textLimits = { direction: 8, mailbox_address: 254, provider_connection_id: 2000, from_email: 254, to_email: 254, subject: 200, provider_message_id: 2000, provider_thread_id: 2000, provider_receipt_id: 2000, provider_event_id: 2000 }
      if (!Object.entries(textLimits).every(([k, max]) => result[k] == null || (typeof result[k] === 'string' && result[k].length <= max))) return blocked('invalid_window')
      const fields = ['body', 'complete', 'truncated', 'nextOffset', 'direction', 'mailbox_address', 'provider_connection_id', 'from_email', 'to_email', 'subject', 'provider_message_id', 'provider_thread_id', 'provider_receipt_id', 'provider_event_id', 'occurred_at']
      return Object.fromEntries(fields.filter(k => Object.hasOwn(result, k)).map(k => [k, result[k]]))
    },
  }
}

/** Archive a normalized, complete scoped read, then verify the real PAS record,
 * then invoke the pinned PAGS checkpoint. No send/reply is performed here.
 * actions is actor-bound; readMessage/checkpoint are trusted connector adapters.
 */
export function createWorkerEmailProcessor({ actions, readMessage, checkpoint, mailboxAddress, connectionId, agentInstanceId }) {
  if (![actions, readMessage, checkpoint].every(fn => typeof fn === 'function') || !mailboxAddress || !connectionId || !agentInstanceId) throw new TypeError('Worker archive dependencies required')
  return async ({ scope, messageId, operationId }) => {
    if (!validId(operationId)) return blocked('invalid_operation')
    const message = await readMessage({ messageId, maxChars: 4000 })
    if (message?.outcome === 'blocked') return message
    if (message?.isError) return blocked('read_failed')
    if (message?.complete !== true || message.nextOffset != null || message.truncated === true || typeof message.body !== 'string' || message.body.length > 4000) return blocked('incomplete_message')
    if (message.provider_message_id !== messageId || message.mailbox_address !== mailboxAddress || message.provider_connection_id !== connectionId || !['inbound', 'outbound'].includes(message.direction) || message[message.direction === 'inbound' ? 'to_email' : 'from_email'] !== mailboxAddress) return blocked('scope_mismatch')
    const record = { ...scope, communication_id: operationId, operation_id: operationId, mailbox_address: mailboxAddress, provider_connection_id: connectionId, agent_instance_id: agentInstanceId }
    for (const k of ['direction', 'from_email', 'to_email', 'subject', 'body', 'provider_message_id', 'occurred_at']) record[k] = message[k]
    for (const k of ['provider_thread_id', 'provider_receipt_id', 'provider_event_id']) record[k] = message[k] || null
    // No caller-supplied provider or tenant claims can replace the bound values.
    try {
      const archived = await actions('record_worker_candidate_email', record)
      if (archived?.isError) return blocked('archive_failed')
    } catch { return blocked('archive_failed') }
    let result
    try { result = await actions('get_worker_candidate_email', { ...scope, operation_id: operationId }) }
    catch { return blocked('readback_failed') }
    const row = result?.rows?.length === 1 && result.rows[0]
    const expected = { ...record, id: operationId, channel: 'email-worker', provider: 'cloudflare' }
    delete expected.communication_id
    // The read action scopes organization/brand/application in SQL; they are not
    // projected in its result. Compare every other archival field exactly.
    for (const k of ['organization_id', 'brand_id', 'application_id']) delete expected[k]
    if (result?.isError || !row || !Object.entries(expected).every(([k, v]) => row[k] === v)) return blocked('archive_mismatch')
    let marked
    try { marked = await checkpoint({ message_id: messageId, archive_reference: operationId }) }
    catch { return blocked('checkpoint_failed') }
    if (marked?.isError || marked?.handled !== true || marked.archive_reference !== operationId) return blocked('checkpoint_failed')
    return { outcome: 'handled', archive_reference: operationId }
  }
}
