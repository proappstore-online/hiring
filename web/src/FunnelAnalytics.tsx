import { useEffect, useState } from 'react'
import { read, type Scope } from './api'
import { button, panel } from './ui'

type Metric = { milestone: string; count: number | null; suppressed: number }
export function FunnelAnalytics({ scope }: { scope: Scope }) {
  const [rows, setRows] = useState<Metric[]>([])
  const [status, setStatus] = useState('loading')
  const [revision, setRevision] = useState(0)
  const key = JSON.stringify(scope)
  useEffect(() => {
    let live = true
    setRows([]); setStatus('loading')
    read<Metric>('get_funnel_analytics', scope).then(data => { if (live) { setRows(data); setStatus('ready') } }).catch(() => { if (live) setStatus('error') })
    return () => { live = false }
  }, [key, revision])
  return <section className={panel} aria-label="Funnel analytics">
    <h2 className="text-xl font-semibold">Funnel analytics</h2>
    <p>Lifetime applications in this brand that reached each milestone. Historical stage evidence is included; interviews may be skipped. Counts describe applications, not unique people.</p>
    {status === 'loading' && <p role="status">Loading analytics…</p>}
    {status === 'error' && <p role="alert">Analytics could not be loaded.</p>}
    {status === 'ready' && !rows.length && <p>Full brand access is required.</p>}
    {rows.some(row => row.suppressed) ? <p>Counts suppressed to protect groups of fewer than five candidates.</p> : <dl>{rows.map(row => <div key={row.milestone}><dt>{row.milestone}</dt><dd>{row.count}</dd></div>)}</dl>}
    <button className={button} disabled={status === 'loading'} onClick={() => setRevision(n => n + 1)}>Refresh analytics</button>
  </section>
}
