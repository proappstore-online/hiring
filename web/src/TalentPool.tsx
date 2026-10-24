import { useEffect, useState } from 'react'
import { id, read, write, type Scope } from './api'
import { button, date, panel } from './ui'

type Entry = { id: string; name: string; email: string; expires_at: number }
export function TalentPool({ scope, applicationId }: { scope: Scope; applicationId?: string }) {
  const [rows, setRows] = useState<Entry[]>([])
  const [error, setError] = useState(false)
  const [busy, setBusy] = useState(false)
  const [revision, setRevision] = useState(0)
  const [after, setAfter] = useState('')
  const key = JSON.stringify(scope)
  useEffect(() => {
    let live = true
    setRows([]); setError(false); setBusy(true)
    read<Entry>(applicationId ? 'get_my_talent_pool' : 'list_talent_pool', { ...scope, ...(applicationId ? { application_id: applicationId } : { after_id: after }) })
      .then(data => { if (live) setRows(data) }).catch(() => { if (live) setError(true) }).finally(() => { if (live) setBusy(false) })
    return () => { live = false }
  }, [key, applicationId, revision, after])
  async function withdraw() {
    setBusy(true); setError(false)
    try {
      try { await write('withdraw_my_talent_pool', { ...scope, application_id: applicationId, operation_id: id() }) } catch { /* Reconcile uncertain writes against current participation. */ }
      const current = await read<Entry>('get_my_talent_pool', { ...scope, application_id: applicationId })
      setRows(current)
      if (current.length) setError(true)
    } catch { setError(true) } finally { setBusy(false) }
  }
  return <section className={panel} aria-label="Talent pool">
    <h3 className="font-semibold">Talent pool</h3>
    <p>Optional future contact within this brand only. Participation expires 180 days after consent. Application processing and optional communications are separate.</p>
    {busy && <p role="status">Checking participation…</p>}
    {error && <p role="alert">Participation could not be confirmed. Refresh to check again.</p>}
    {!busy && !error && !rows.length && <p>No active participation.</p>}
    {rows.map((row, index) => <p key={row.id ?? index}>{!applicationId && `${row.name} · ${row.email} · `}Expires {date(row.expires_at)}</p>)}
    {applicationId && rows.length > 0 && <button className={button} disabled={busy} onClick={() => void withdraw()}>Withdraw talent-pool consent for this brand</button>}
    <button className={button} disabled={busy} onClick={() => setRevision(n => n + 1)}>Refresh talent pool</button>
    {!applicationId && after && <button className={button} disabled={busy} onClick={() => setAfter('')}>First page</button>}
    {!applicationId && rows.length === 50 && <button className={button} disabled={busy} onClick={() => setAfter(rows.at(-1)!.id)}>Next page</button>}
  </section>
}
