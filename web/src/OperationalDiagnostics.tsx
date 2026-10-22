import { useEffect, useState } from 'react'
import { read, type Scope } from './api'
import { EmptyState, ErrorState, LoadingState } from './route-ui'
import { date, panel } from './ui'

export type Diagnostic = { id: string; agent_instance_id: string; action: string; occurred_at: number; outcome: 'success' | 'error' | 'unknown' }
export function sourceDomain(source: string) {
  try { const url = new URL(source); return ['https:', 'http:'].includes(url.protocol) ? url.hostname : 'Redacted' } catch { return 'Redacted' }
}
export function OperationalDiagnostics({ scope }: { scope: Scope }) {
  const [rows, setRows] = useState<Diagnostic[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [revision, setRevision] = useState(0)
  useEffect(() => {
    let active = true
    setLoading(true); setError(false); setRows([])
    read<Diagnostic>('list_operational_diagnostics', scope).then(r => { if (active) setRows(r) }).catch(() => { if (active) setError(true) }).finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [scope.organization_id, scope.brand_id, revision])
  return <section className={panel}><h1 className="text-2xl font-semibold">Operations</h1><p>Latest 100 authorized activity records. Candidate content and source URLs are omitted by the server. Outcomes are unknown where no result was recorded; these are not delivery metrics.</p>{loading ? <LoadingState /> : error ? <ErrorState retry={() => setRevision(r => r + 1)}>Diagnostics could not be loaded.</ErrorState> : !rows.length ? <EmptyState>No activity recorded in your scope.</EmptyState> : <><p>{rows.length} loaded activity records</p><ul className="space-y-3">{rows.map(r => <li key={r.id} className="break-words border p-3"><p>Agent: {r.agent_instance_id}</p><p>Action: {r.action}</p><p>{date(r.occurred_at)} · Outcome: {r.outcome}</p><p>Source: Redacted</p></li>)}</ul></>}</section>
}
