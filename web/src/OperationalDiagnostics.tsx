import { useEffect, useState } from 'react'
import { read, type Scope } from './api'
import { EmptyState, ErrorState, LoadingState } from './route-ui'
import { button, date, panel } from './ui'

export type Diagnostic = { id: string; agent_instance_id: string; action: string; occurred_at: number; outcome: 'success' | 'error' | 'unknown' }
type Health = { pending_count: number; sending_count: number; failed_count: number; unknown_count: number; oldest_pending_draft_age_ms: number | null; oldest_sending_age_ms: number | null; denied_or_missing_24h: number | null; unconfirmed_reads_24h: number | null; observed_at: number }
const age = (ms: number | null) => ms === null ? 'No recorded age' : `${Math.floor(ms / 60000)} minutes`
export function sourceDomain(source: string) {
  try { const url = new URL(source); return ['https:', 'http:'].includes(url.protocol) ? url.hostname : 'Redacted' } catch { return 'Redacted' }
}
export function OperationalDiagnostics({ scope }: { scope: Scope }) {
  const [rows, setRows] = useState<Diagnostic[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [revision, setRevision] = useState(0)
  const [health, setHealth] = useState<Health | null>(null)
  const [healthError, setHealthError] = useState(false)
  useEffect(() => {
    let active = true
    setLoading(true); setError(false); setRows([])
    setHealth(null); setHealthError(false)
    read<Diagnostic>('list_operational_diagnostics', scope).then(r => { if (active) setRows(r) }).catch(() => { if (active) setError(true) }).finally(() => { if (active) setLoading(false) })
    read<Health>('get_operational_health', scope).then(r => { if (active) setHealth(r[0] ?? null) }).catch(() => { if (active) setHealthError(true) })
    return () => { active = false }
  }, [scope.organization_id, scope.brand_id, revision])
  return <section className={panel}><h1 className="text-2xl font-semibold">Operations</h1><button type="button" className={button + ' my-3 min-h-11'} onClick={() => setRevision(r => r + 1)}>Refresh operations</button>
    {healthError ? <p role="alert">Queue health could not be loaded. Refresh operations to retry.</p> : health && <section aria-label="Queue health" className="my-4 space-y-2">
      <h2 className="text-xl font-semibold">Queue health</h2><p>Current authorized records at {date(health.observed_at)}. Failed and unknown counts exclude reconciled attempts. Provider acceptance does not prove delivery.</p>
      <dl><dt>Pending</dt><dd>{health.pending_count}</dd><dt>Sending</dt><dd>{health.sending_count}</dd><dt>Unreconciled failed</dt><dd>{health.failed_count}</dd><dt>Unreconciled unknown</dt><dd>{health.unknown_count}</dd><dt>Oldest pending draft age (since creation)</dt><dd>{age(health.oldest_pending_draft_age_ms)}</dd><dt>Oldest sending attempt</dt><dd>{age(health.oldest_sending_age_ms)}</dd><dt>Recorded denied or missing reads (24 hours)</dt><dd>{health.denied_or_missing_24h ?? 'Restricted to brand-wide owners/auditors'}</dd><dt>Recorded unconfirmed reads (24 hours)</dt><dd>{health.unconfirmed_reads_24h ?? 'Restricted to brand-wide owners/auditors'}</dd></dl>
      {(health.failed_count > 0 || health.unknown_count > 0) && <p role="status">Manual reconciliation required. Inspect provider evidence and application communication history before retrying. Unknown outcomes must never be automatically resent.</p>}
      <p>Counts cover recorded outbox and gateway/export activity only. No automatic alert delivery or retention purge is configured.</p>
    </section>}
    <p>Latest 100 authorized activity records. Candidate content and source URLs are omitted by the server. Outcomes are unknown where no result was recorded; these are not delivery metrics.</p>{loading ? <LoadingState /> : error ? <ErrorState retry={() => setRevision(r => r + 1)}>Diagnostics could not be loaded.</ErrorState> : !rows.length ? <EmptyState>No activity recorded in your scope.</EmptyState> : <><p>{rows.length} loaded activity records</p><ul className="space-y-3">{rows.map(r => <li key={r.id} className="break-words border p-3"><p>Agent: {r.agent_instance_id}</p><p>Action: {r.action}</p><p>{date(r.occurred_at)} · Outcome: {r.outcome}</p><p>Source: Redacted</p></li>)}</ul></>}</section>
}
