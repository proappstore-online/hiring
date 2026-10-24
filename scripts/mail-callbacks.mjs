/** Trusted server integration only. No browser/MCP entrypoint.
 * resolve must use the approved connector's stored operation/message mapping,
 * never tenant IDs, sender-verification claims or application IDs from the body.
 * db provides query(sql, params) and atomic batch([{sql, params}]).
 */
export function createMailCallbackHandler({ secret, connectorId, resolve, db, now = Date.now }) {
  if (typeof secret !== 'string' || secret.length < 32 || typeof connectorId !== 'string' || !connectorId || typeof resolve !== 'function' || !db?.batch) throw new TypeError('Trusted MAIL callback dependencies required')
  const id = value => typeof value === 'string' && /^[A-Za-z0-9_.:@/-]{1,128}$/.test(value)
  return async ({ body, timestamp, signature }) => {
    const reject = () => ({ outcome: 'rejected' })
    if (typeof body !== 'string' || new TextEncoder().encode(body).length > 100000 || !Number.isSafeInteger(timestamp) || Math.abs(now() - timestamp) > 300000 || !/^[a-f0-9]{64}$/.test(signature ?? '')) return reject()
    const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify'])
    const bytes = Uint8Array.from(signature.match(/../g), v => parseInt(v, 16))
    if (!await crypto.subtle.verify('HMAC', key, bytes, new TextEncoder().encode(`${timestamp}.${body}`))) return reject()
    let event
    try { event = JSON.parse(body) } catch { return reject() }
    if (!event || !id(event.event_id) || !id(event.operation_id) || !id(event.message_id) || !['accepted','sent','delivered','bounced','complained','failed','replied'].includes(event.type) || !Number.isSafeInteger(event.occurred_at) || event.occurred_at < 0 || event.occurred_at > now() + 300000) return reject()
    // The resolver authenticates mailbox, provider message and sender evidence.
    const mapping = await resolve({ connector_id: connectorId, operation_id: event.operation_id, message_id: event.message_id, reply_to_message_id: event.reply_to_message_id ?? null })
    if (!mapping || !['organization_id','brand_id','application_id','draft_id'].every(k => id(mapping[k])) || mapping.operation_id !== event.operation_id || mapping.message_id !== event.message_id) return reject()
    const reply = event.type === 'replied'
    if (reply && (typeof event.text !== 'string' || event.text.length > 50000 || (event.attachments !== undefined && (!Array.isArray(event.attachments) || event.attachments.length > 20 || !event.attachments.every(id))))) return reject()
    // Even safely correlated replies are informational: no disposition writes.
    const triage = reply && (mapping.sender_verified !== true || mapping.unambiguous !== true || event.attachments?.length > 0)
    const rank = ({ accepted:1, sent:2, delivered:3 })[event.type] ?? 0
    const params = [connectorId, event.event_id, mapping.organization_id, mapping.brand_id, mapping.application_id, mapping.draft_id, event.operation_id, event.message_id, event.type, event.occurred_at, rank, triage ? 'quarantined' : reply ? 'correlated' : 'delivery', reply ? event.text : null, reply ? JSON.stringify(event.attachments ?? []) : null, now()]
    // UNIQUE(connector,event) makes simultaneous redelivery a single durable write.
    // Projection and receipt are committed by the same database statement/trigger.
    const result = await db.batch([{ sql: `INSERT INTO hiring_mail_receipts (connector_id,event_id,organization_id,brand_id,application_id,draft_id,operation_id,message_id,event_type,occurred_at,delivery_rank,classification,reply_text,quarantined_attachments_json,received_at) SELECT ?,?,?,?,?,?,?,?,?,?,?,?,?,?,? WHERE EXISTS (SELECT 1 FROM hiring_outbox WHERE id=? AND organization_id=? AND brand_id=? AND application_id=? AND idempotency_key=?) ON CONFLICT(connector_id,event_id) DO NOTHING`, params: [...params, mapping.draft_id, mapping.organization_id, mapping.brand_id, mapping.application_id, event.operation_id] }])
    return { outcome: result[0]?.meta?.changes === 1 ? (triage ? 'quarantined' : 'recorded') : 'ignored' }
  }
}
