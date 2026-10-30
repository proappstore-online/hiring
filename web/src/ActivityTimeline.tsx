import { useEffect, useRef, useState } from 'react'
import { read, type Scope } from './api'
import { date, panel } from './ui'

type TimelineEntry = {
  id: string
  ts: number
  source: 'mcp' | 'external' | 'audit' | 'journal'
  kind: string
  actor: string | null
  summary: string | null
  operation_id: string | null
  recorded_at: number | null
  entry_type: string | null
  claimed_performer: string | null
  application_id: string | null
  outcome: string | null
  uncertainty: string | null
  next_step: string | null
  receipt_ref: string | null
  approval_ref: string | null
  correction_of: string | null
}

const pageSize = 50

export function ActivityTimeline({ scope, candidateId }: { scope: Scope; candidateId?: string }) {
  const [rows, setRows] = useState<TimelineEntry[]>([])
  const [cursor, setCursor] = useState<TimelineEntry | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [hasMore, setHasMore] = useState(false)
  const inFlight = useRef(false)
  const generation = useRef(0)

  const load = async (after: TimelineEntry | null, currentGeneration: number) => {
    if (inFlight.current) return
    inFlight.current = true
    setLoading(true)
    setError(false)
    try {
      const page = await read<TimelineEntry>('get_activity_timeline', {
        ...scope, ...(candidateId ? { candidate_id: candidateId } : { org_id: scope.organization_id }), limit: pageSize,
        ...(after ? { before_ts: after.ts, before_id: after.id, before_source: after.source } : {}),
      })
      if (generation.current !== currentGeneration) return
      setRows(previous => after
        ? [...previous, ...page.filter(row => !previous.some(existing => existing.source === row.source && existing.id === row.id))]
        : page)
      setCursor(page.at(-1) ?? after)
      setHasMore(page.length === pageSize)
    } catch {
      if (generation.current === currentGeneration) setError(true)
    } finally {
      if (generation.current === currentGeneration) {
        inFlight.current = false
        setLoading(false)
      }
    }
  }

  useEffect(() => {
    const currentGeneration = ++generation.current
    inFlight.current = false
    setRows([])
    setCursor(null)
    setHasMore(false)
    void load(null, currentGeneration)
    return () => { generation.current++ }
    // A different candidate or scope starts a fresh timeline; the component is also keyed by these values.
  }, [scope.organization_id, scope.brand_id, candidateId])

  return <section className={panel} aria-label={candidateId ? 'Candidate activity timeline' : 'Organization activity timeline'}>
    <h3 className="font-semibold">{candidateId ? 'Activity timeline' : 'Organization activity timeline'}</h3>
    <p className="mt-1 text-xs text-[var(--muted)]">{candidateId ? 'Candidate-linked actions and audit records, newest first.' : 'Recorded actions and audit records for this organization and brand, newest first.'}</p>
    <ol className="mt-4 space-y-3">{rows.map(row => <li key={`${row.source}:${row.id}`} className="border-b border-[var(--line)] pb-3 text-sm last:border-0">
      <p className="text-xs text-[var(--muted)]">{date(row.ts)} · {row.source === 'journal' ? `Manual journal · ${row.entry_type ?? 'entry'}` : `${row.source} · ${row.kind.replaceAll('_', ' ')}`}{row.actor ? ` · Recorded by ${row.actor}` : ''}</p>
      {row.summary && <p className="mt-1 whitespace-pre-wrap break-words">{row.summary}</p>}
      {row.source === 'journal' && <dl className="mt-2 space-y-1 text-xs text-[var(--muted)]">
        {row.recorded_at != null && <div><dt className="inline font-medium">Recorded at: </dt><dd className="inline">{date(row.recorded_at)}</dd></div>}
        {row.claimed_performer && <div><dt className="inline font-medium">Claimed performer: </dt><dd className="inline break-words">{row.claimed_performer}</dd></div>}
        {row.application_id && <div><dt className="inline font-medium">Application: </dt><dd className="inline break-all">{row.application_id}</dd></div>}
        {row.outcome && <div><dt className="inline font-medium">Outcome: </dt><dd className="inline whitespace-pre-wrap break-words">{row.outcome}</dd></div>}
        {row.uncertainty && <div><dt className="inline font-medium">Uncertainty: </dt><dd className="inline whitespace-pre-wrap break-words">{row.uncertainty}</dd></div>}
        {row.next_step && <div><dt className="inline font-medium">Next step: </dt><dd className="inline whitespace-pre-wrap break-words">{row.next_step}</dd></div>}
        {row.receipt_ref && <div><dt className="inline font-medium">Receipt reference: </dt><dd className="inline break-all">{row.receipt_ref}</dd></div>}
        {row.approval_ref && <div><dt className="inline font-medium">Approval reference: </dt><dd className="inline break-all">{row.approval_ref}</dd></div>}
        {row.correction_of && <div><dt className="inline font-medium">Correction of: </dt><dd className="inline break-all">{row.correction_of}</dd></div>}
      </dl>}
    </li>)}</ol>
    {!loading && !error && rows.length === 0 && <p className="mt-3 text-sm text-[var(--muted)]">{candidateId ? 'No candidate-linked timeline records yet.' : 'No timeline records for this organization and brand yet.'}</p>}
    {error && <p role="alert" className="mt-3 text-sm">Timeline could not be loaded. <button type="button" className="min-h-[44px] underline" onClick={() => void load(cursor, generation.current)}>Retry timeline</button></p>}
    {loading && <p role="status" className="mt-3 text-sm">Loading timeline…</p>}
    {!loading && !error && hasMore && <button type="button" className="mt-3 min-h-[44px] underline" onClick={() => void load(cursor, generation.current)}>Load older activity</button>}
  </section>
}
