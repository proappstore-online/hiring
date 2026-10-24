/** Trusted server integration only. authorize must load current approval,
 * suppression, sender and template evidence, never trust caller-supplied claims.
 * transport binds the approved connector and returns definitive outcomes only.
 */
export function createMailAdapter({ authorize, transport }) {
  if (typeof authorize !== 'function' || typeof transport !== 'function') throw new TypeError('MAIL dependencies required')
  return async (row, { idempotencyKey, scope }) => {
    const reject = reason => ({ outcome: 'not_accepted', reason })
    let approved
    try { approved = await authorize({ ...scope, draft_id: row.id, operation_id: idempotencyKey }) }
    catch { return reject('approval_unavailable') }
    if (!approved || approved.approved !== true || approved.suppressed !== false) return reject('approval_required')
    for (const key of ['organization_id', 'brand_id', 'application_id']) {
      if (typeof scope?.[key] !== 'string' || !scope[key].trim() || scope[key].length > 128 || approved[key] !== scope[key]) return reject('scope_mismatch')
    }
    if (typeof idempotencyKey !== 'string' || !idempotencyKey.trim() || idempotencyKey.length > 128 || approved.operation_id !== idempotencyKey || approved.draft_id !== row.id) return reject('scope_mismatch')
    if (typeof approved.template_id !== 'string' || !approved.template_id.trim() || approved.template_id.length > 128 || !Number.isSafeInteger(approved.template_version) || approved.template_version < 1) return reject('approval_required')
    // Approval must refer to the exact immutable rendered payload, not just a template name.
    for (const key of ['recipient_email', 'subject', 'body']) if (approved[key] !== row[key]) return reject('approval_required')
    const address = value => typeof value === 'string' && value.length <= 254 && /^[^\s<>@,;]+@[^\s<>@,;]+\.[^\s<>@,;]+$/.test(value)
    if (!address(row.recipient_email) || !address(approved.reply_to) || typeof row.subject !== 'string' || !row.subject.trim() || row.subject.length > 200 || /[\r\n]/.test(row.subject) || typeof row.body !== 'string' || !row.body.trim() || row.body.length > 50000) return reject('invalid_payload')
    const escape = value => value.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])
    const html = '<p>' + escape(row.body).replace(/\r?\n/g, '<br>') + '</p>'
    if (new TextEncoder().encode(html).length > 50000) return reject('invalid_payload')
    // No row spread: private claim data and unrelated ATS fields never leave Hiring.
    try {
      const result = await transport({ operation_id: idempotencyKey, organization_id: scope.organization_id, brand_id: scope.brand_id, application_id: scope.application_id, template_id: approved.template_id, template_version: approved.template_version, to: row.recipient_email, reply_to: approved.reply_to, subject: row.subject, html })
      if (result?.outcome === 'accepted') return { outcome: 'accepted', reason: 'accepted' }
      if (result?.outcome === 'not_accepted') return reject(['quota', 'unavailable', 'forbidden'].includes(result.reason) ? result.reason : 'provider_rejected')
    } catch { /* A thrown HTTP error is not proof of non-acceptance. */ }
    return { outcome: 'unknown', reason: 'reconcile_required' }
  }
}
