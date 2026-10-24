/** Run in the private operator service with owner-bound actions and passkey.
 * Each installed adapter must support idempotent rectify + authoritative verify.
 * The stable key must deduplicate retries AND concurrent calls at the processor.
 * No credentials, subject values or provider errors are written to audit evidence.
 */
export async function propagateCandidateCorrection({ actions, scope, adapters = {} }) {
  const rows = result => result?.rows ?? result?.results?.[0]?.rows ?? []
  const steps = rows(await actions('list_candidate_rectifications', scope))
  for (const step of steps) {
    if (step.state === 'complete') continue
    const params = { ...scope, processor_id: step.processor_id }
    const [payload] = rows(await actions('get_candidate_rectification_payload', params))
    if (!payload || payload.correction_id !== step.correction_id) continue
    const adapter = adapters[step.processor_id]
    let state = 'failed', evidence_reference = 'adapter-unavailable'
    if (adapter?.rectify && adapter?.verify) {
      const target = Object.freeze({ ...payload, idempotency_key: JSON.stringify([payload.correction_id, step.processor_id]) })
      try {
        await adapter.rectify(target)
        const proof = await adapter.verify(target)
        if (proof?.confirmed === true && typeof proof.reference === 'string' && /^[A-Za-z0-9_.:/-]{1,128}$/.test(proof.reference)) {
          state = 'complete'; evidence_reference = proof.reference
        } else { state = 'failed'; evidence_reference = 'verification-failed' }
      } catch { state = 'unknown'; evidence_reference = 'provider-unconfirmed' }
    }
    // Persist uncertainty as well as success. A lost persistence response must be
    // reconciled from SQL before retry; provider calls use the same key regardless.
    await actions('record_candidate_rectification', { ...params, expected_version: step.version, operation_id: crypto.randomUUID(), state, evidence_reference })
  }
  const current = rows(await actions('list_candidate_rectifications', scope))
  return { state: current.length > 0 && current.every(s => s.state === 'complete') ? 'complete' : 'partial', steps: current }
}
