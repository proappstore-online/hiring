/** Authorization and retrieval are separate transactions so denial/uncertainty
 * evidence survives a failed read. The server derives all authority and outcomes.
 * Receipts are private, principal-bound and time-limited, never bearer links.
 */
export async function auditedGatewayRead(actions, name, params, requestId = crypto.randomUUID()) {
  if (!['gateway_get_application','gateway_list_applications','gateway_get_requisition','gateway_list_requisitions'].includes(name)) throw new Error('Unsupported gateway read.')
  const values = { ...params, request_id: requestId }
  await actions('authorize_' + name, values)
  try {
    return await actions('audited_' + name, values)
  } catch (error) {
    try { await actions('record_privacy_read_failure', { request_id: requestId }) } catch { /* Receipt still records the attempted access; audit service may be unavailable. */ }
    throw error
  }
}

export async function retrieveCandidateExport(actions, params) {
  // Same handle is safe after a lost response; server expiry is never extended.
  try { await actions('request_candidate_export', params) } catch { /* Reconcile the existing authorization after an uncertain mutation response. */ }
  try {
    const result = await actions('get_candidate_export', params)
    if (!result.rows?.[0]) throw new Error('Export unavailable. Check identity review, current owner access and expiry.')
    return result.rows[0]
  } catch (error) {
    try { await actions('record_privacy_read_failure', { request_id: params.request_id }) } catch { /* Do not claim error logging succeeded. */ }
    throw error
  }
}
