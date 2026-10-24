/** One exclusive attempt. `actions` must bind the authenticated server identity.
 * Provider adapter returns 'accepted' or 'not_accepted' only with definitive evidence.
 * Exceptions, timeouts and unrecognized responses have an unknown outcome.
 * No payload, provider error, or result is passed to the diagnostic sink.
 */
export async function dispatchCommunication({ actions, send, scope, draftId, newId = () => crypto.randomUUID(), log = () => {} }) {
  const claimId = newId()
  const base = { ...scope, draft_id: draftId }
  const claim = await actions('claim_communication', { ...base, operation_id: claimId })
  if (claim.results?.at(-1)?.meta?.changes !== 1) return 'not_claimed'
  const completeId = newId()
  let outcome = 'unknown'
  let reason = 'reconcile_required'
  try {
    const { rows } = await actions('get_claimed_communication', { ...base, claim_id: claimId })
    if (rows.length !== 1) throw new Error('Claim unavailable')
    const result = await send(rows[0], { idempotencyKey: rows[0].idempotency_key, scope: { ...scope } })
    const status = typeof result === 'string' ? result : result?.outcome
    if (status === 'accepted') { outcome = 'sent'; reason = 'accepted' }
    if (status === 'not_accepted') {
      outcome = 'failed'
      reason = ['quota', 'unavailable', 'forbidden', 'provider_rejected', 'approval_unavailable', 'approval_required', 'scope_mismatch', 'invalid_payload'].includes(result?.reason) ? result.reason : 'provider_rejected'
    }
  } catch { /* Ambiguous outcomes must never be automatically retried. */ }
  // A lost completion response leaves sending/terminal, both non-claimable.
  await actions('complete_communication', { ...base, claim_id: claimId, outcome, delivery_reason: reason, operation_id: completeId })
  log({ event: 'outbox.attempt_completed', outcome, reason })
  return outcome
}
