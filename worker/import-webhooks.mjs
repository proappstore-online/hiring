/** Server-only adapter. Bind actions to system:worker and secrets to the installation's
 * secret store. transport must enforce approved public HTTPS egress, DNS/IP checks,
 * no redirects, a response size limit and a timeout; never use this in the browser.
 */
const rows = r => r?.rows ?? r?.results?.[0]?.rows ?? []
const encoder = new TextEncoder()
async function mac(secret, text) {
  if (typeof secret !== 'string' || secret.length < 32) throw Error('Signing secret unavailable')
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  return Array.from(new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(text))), b => b.toString(16).padStart(2, '0')).join('')
}
export async function verifyImportWebhook({secret, body, signature, timestamp, now = Date.now()}) {
  if (!/^\d+$/.test(String(timestamp)) || Math.abs(now - Number(timestamp)) > 300000 || !/^[a-f0-9]{64}$/.test(signature ?? '')) return false
  const expected = await mac(secret, `${timestamp}.${body}`)
  let difference = 0
  for (let i = 0; i < 64; i++) difference |= expected.charCodeAt(i) ^ signature.charCodeAt(i)
  return difference === 0
}
export async function dispatchImportWebhook({actions, secrets, transport, scope, deliveryId, newId = () => crypto.randomUUID(), now = Date.now}) {
  const p = {organization_id:scope.organization_id, brand_id:scope.brand_id, installation_id:scope.installation_id, delivery_id:deliveryId, claim_id:newId()}
  await actions('claim_import_webhook', p)
  let records = rows(await actions('read_import_webhook', p))
  if (records.length !== 1) return 'not_claimed'
  let success = 0
  try {
    const record = records[0]
    const endpoint = new URL(record.endpoint)
    if (endpoint.protocol !== 'https:' || endpoint.username || endpoint.password || endpoint.hash) throw Error('Invalid endpoint')
    const secret = await secrets({ ...scope, secret_ref:record.secret_ref })
    const body = JSON.stringify({version:1, id:record.id, type:record.event_type, row_count:record.row_count})
    const timestamp = String(now())
    const signature = await mac(secret, `${timestamp}.${body}`)
    // Recheck approval, current grants and revocation immediately before egress.
    records = rows(await actions('read_import_webhook', p))
    if (records.length !== 1 || records[0].endpoint !== record.endpoint || records[0].secret_ref !== record.secret_ref) throw Error('Authority revoked')
    const result = await transport({url:endpoint.href, method:'POST', redirect:'error', body, headers:{'content-type':'application/json','x-hiring-id':record.id,'x-hiring-timestamp':timestamp,'x-hiring-signature':signature}, timeoutMs:10000})
    success = Number(Number.isInteger(result?.status) && result.status >= 200 && result.status < 300)
  } catch { /* At-least-once delivery: receiver MUST deduplicate stable event id. No payload/error logging. */ }
  await actions('finish_import_webhook', {...p,success})
  return success ? 'sent' : 'retry_or_dead'
}

/** One bounded queue tick. Scheduling and installation configuration are trusted
 * deployment responsibilities; every delivery rechecks authority independently.
 */
export async function dispatchImportWebhookQueue(options) {
  const scope = {organization_id:options.scope.organization_id, brand_id:options.scope.brand_id, installation_id:options.scope.installation_id}
  const queue = rows(await options.actions('list_import_webhook_queue', scope))
  const outcomes = []
  for (const job of queue) outcomes.push(await dispatchImportWebhook({...options,scope,deliveryId:job.id}))
  return {attempted:queue.length,outcomes}
}
