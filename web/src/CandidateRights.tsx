import { useEffect, useRef, useState } from 'react'
import { app, id, read, type CandidateApplication } from './api'
import { button, field } from './ui'

type Receipt = { request_id: string; request_type: string; status: string; deadline_at: number | null }
export function CandidateRights({ application }: { application: CandidateApplication }) {
  const scope = { organization_id: application.organization_id, brand_id: application.brand_id, application_id: application.application_id }
  const [kind, setKind] = useState('access')
  const [rows, setRows] = useState<Receipt[]>([])
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const pending = useRef<{ kind: string; request: string } | null>(null)
  async function refresh() {
    const result = await read<Receipt>('list_my_rights_requests', scope)
    setRows(result)
    return result
  }
  useEffect(() => {
    let active = true
    read<Receipt>('list_my_rights_requests', scope).then(result => { if (active) setRows(result) }).catch(() => { if (active) setMessage('Requests could not be loaded. Refresh to retry.') })
    return () => { active = false }
  }, [application.application_id])
  async function submit() {
    setBusy(true); setMessage('')
    pending.current ??= { kind, request: id() }
    const request = pending.current
    try {
      try { await app.actions.call('submit_my_rights_request', { ...scope, request_type: request.kind, request_id: request.request }) } catch { /* Confirm durable receipt after an uncertain response. */ }
      const result = await refresh()
      if (!result.some(row => row.request_id === request.request)) throw Error('Request could not be confirmed. Retry to check the same receipt.')
      pending.current = null
      setMessage('Request received for this application. The brand will review identity and set the response deadline. Submission does not change or delete your records.')
    } catch (e) { setMessage(e instanceof Error ? e.message : 'Request could not be confirmed.') }
    finally { setBusy(false) }
  }
  return <section className="space-y-3" aria-label="Your privacy requests">
    <h3 className="font-semibold">Your privacy requests</h3>
    <p>Request access, correction, withdrawal or erasure for this application. For an application held outside this account, contact the organization shown in its privacy notice. Do not upload identity documents here.</p>
    <label className="block">Privacy request type<select className={field} value={kind} disabled={busy || !!pending.current} onChange={e => setKind(e.target.value)}>
      <option value="access">Access</option><option value="correction">Correction</option><option value="withdrawal">Withdrawal</option><option value="deletion">Erasure</option>
    </select></label>
    <button className={button} disabled={busy} onClick={() => void submit()}>Submit privacy request</button>
    <button className={button} disabled={busy} onClick={() => void refresh().catch(() => setMessage('Requests could not be loaded.'))}>Refresh privacy requests</button>
    <p role="status">{message}</p>
    <ul>{rows.map(row => <li className="break-words" key={row.request_id}>{row.request_type}: {row.status} · reference {row.request_id} · {row.deadline_at ? `response due ${new Date(row.deadline_at).toLocaleString()}` : 'deadline awaiting owner review'}</li>)}</ul>
  </section>
}
