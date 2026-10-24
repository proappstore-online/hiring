import { useState } from 'react'
import * as api from './api'
import type { ErasureStatus, Role, Scope } from './api'
import { PrivacyOperations } from './PrivacyOperations'
import { ComplianceControls } from './ComplianceControls'
import { button, panel } from './ui'

export function ErasureRequest({ scope, role }: { scope: Scope; role: Role }) {
  const [applicationId, setApplicationId] = useState('')
  const [identity, setIdentity] = useState(false)
  const [holds, setHolds] = useState(false)
  const [operationId, setOperationId] = useState(() => crypto.randomUUID())
  const [result, setResult] = useState<ErasureStatus | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const ready = role === 'owner' && applicationId.trim() && identity && holds
  async function refresh() {
    setLoading(true); setError(''); setResult(null)
    try {
      const rows = await api.getCandidateErasureStatus(scope, applicationId.trim())
      if (!rows[0]) setError('No request is available for this application in your scope.')
      else setResult(rows[0])
    } catch { setError('Status could not be loaded. Retry before requesting another deletion.') }
    finally { setLoading(false) }
  }
  async function erase() {
    if (!ready) throw new Error('Verify the application, identity and legal holds first.')
    setLoading(true); setError('')
    try { setResult(await api.requestCandidateErasure(scope, applicationId.trim(), operationId)) }
    catch (e) { setError(e instanceof Error ? e.message : 'Erasure could not be confirmed.'); throw e }
    finally { setLoading(false) }
  }
  let stores: { store: string; remaining_records: number }[] = []
  try { stores = result ? JSON.parse(result.stores_json) : [] } catch { /* Unknown evidence never means complete. */ }
  return <div className="space-y-4">
    {role === 'owner' && <PrivacyOperations key={JSON.stringify([scope.organization_id, scope.brand_id, api.app.auth.user?.id])} scope={scope} />}
    {role === 'owner' && <section className={panel} aria-label="Erasure scope">
      <h2 className="text-xl font-semibold">Candidate erasure</h2>
      <p>Use an application ID from this brand. This redacts the candidate and all their applications in this brand. Other brands and the independent worker account require separate requests.</p>
      <p>Core redaction is irreversible. Protected records and processor copies may remain; this workflow reports partial erasure only.</p>
      <label className="block mt-3">Application ID<input className="block border rounded p-3 w-full" value={applicationId} disabled={loading} onChange={e => { setApplicationId(e.target.value); setOperationId(crypto.randomUUID()); setResult(null); setIdentity(false); setHolds(false); setError('') }} /></label>
      <label className="flex items-center gap-3 min-h-11"><input type="checkbox" checked={identity} disabled={loading} onChange={e => setIdentity(e.target.checked)} />I have verified the candidate's identity and request scope.</label>
      <label className="flex items-center gap-3 min-h-11"><input type="checkbox" checked={holds} disabled={loading} onChange={e => setHolds(e.target.checked)} />I have reviewed legal holds and confirmed that core redaction is permitted.</label>
      <button className={button} disabled={!applicationId.trim() || loading} onClick={() => void refresh()}>Check erasure status</button>
      {error && <p role="alert">{error}</p>}
      {result && <section aria-label="Erasure progress" className="mt-4 break-words"><h3 className="font-semibold">Partial erasure — completion not verified</h3>
        <p>Request: {result.request_id}</p><p>MAIL propagation: blocked; no verified provider deletion route. This does not mean processor copies were removed.</p>
        <p>Files, indexes, exports and backups require operator verification. Contact the organization owner to arrange the remaining cleanup and processor review.</p>
        <ul>{stores.filter(s => s.remaining_records > 0).map(s => <li key={s.store}>{s.store}: {s.remaining_records} records require review</li>)}</ul>
      </section>}
    </section>}
    <ComplianceControls role={role} exportGuidance onDelete={ready && !loading ? erase : undefined} />
  </div>
}
