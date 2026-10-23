/** Authenticated registered actions enforce current brand-wide owner access.
 * No client role claim grants authority. Never infer deletion from a tombstone.
 * Keep the operation ID across timeouts and reconcile using durable readback.
 */
export async function requestErasure({ actions, scope, applicationId, operationId, identityVerified, holdsReviewed }) {
  if (!scope?.organization_id || !scope?.brand_id || !applicationId?.trim() || !operationId?.trim() || operationId.length > 128) {
    throw new Error('An exact workspace, application and operation ID are required.')
  }
  if (identityVerified !== true || holdsReviewed !== true) throw new Error('Verify identity and review legal holds before requesting erasure.')
  const base = { organization_id: scope.organization_id, brand_id: scope.brand_id, application_id: applicationId }
  const readback = async () => {
    const { rows } = await actions('get_candidate_erasure_status', base)
    if (!rows?.length) return null
    if (rows.length !== 1 || rows[0].status !== 'partial' || rows[0].processor_status !== 'blocked') throw new Error('Erasure status could not be verified.')
    return rows[0]
  }
  const previous = await readback()
  if (previous) return previous
  // A successful preflight is not authority: the mutation rechecks identity/scope
  // and the latest hold in the same transaction as redaction and its audit event.
  const { rows: holds } = await actions('get_candidate_erasure_hold', base)
  if (holds?.[0]?.state === 'active') throw new Error('An active legal hold blocks erasure. Ask the hold owner to review it.')
  try {
    await actions('request_candidate_erasure', { ...base, operation_id: operationId, identity_verified: 1, holds_reviewed: 1 })
  } catch {
    // A response can be lost after commit. Read the request before suggesting retry.
    const committed = await readback()
    if (committed) return committed
    throw new Error('Erasure could not be confirmed. Check access and legal holds, then retry with the same request.')
  }
  const committed = await readback()
  if (!committed) throw new Error('Erasure could not be confirmed. Check access and legal holds, then retry with the same request.')
  return committed
}
