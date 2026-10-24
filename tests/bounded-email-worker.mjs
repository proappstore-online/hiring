import { parentPort, workerData } from 'node:worker_threads'
import { DatabaseSync } from 'node:sqlite'
import { createEmailBudget, createBoundedMailAdapter } from '../scripts/bounded-email.mjs'

const db = new DatabaseSync(workerData.filename)
db.exec('PRAGMA busy_timeout=5000')
const budget = createEmailBudget({
  db: {
    query: async (sql, params) => ({ rows: db.prepare(sql).all(...params) }),
    execute: async (sql, params) => ({ meta: { changes: db.prepare(sql).run(...params).changes } }),
  },
  budgetId: 'shared', windowId: 'day', limits: { sends: 1, summaries: 0, body_reads: 0, body_chars: 0 },
})
const scope = { organization_id: 'org', brand_id: 'brand', application_id: 'app' }
const row = { id: 'draft', recipient_email: 'candidate@example.test', subject: 'Owner test', body: 'Synthetic' }
let providerCalls = 0
const send = createBoundedMailAdapter({ budget,
  authorize: async () => ({ ...scope, ...row, draft_id: row.id, operation_id: workerData.operationId, approved: true, suppressed: false, template_id: 'template', template_version: 1, reply_to: 'admin@freeappstore.online' }),
  transport: async () => { providerCalls++; return { outcome: 'accepted' } },
})
parentPort.once('message', async () => {
  try { parentPort.postMessage({ ...await send(row, { scope, idempotencyKey: workerData.operationId }), providerCalls }) }
  finally { db.close(); parentPort.close() }
})
parentPort.postMessage({ ready: true })
