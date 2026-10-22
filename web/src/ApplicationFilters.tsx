import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { read, stageLabel, type Application, type Member, type Requisition, type Workspace } from './api'
import { FILTER_STAGES, filterQuery, matchesSearch, type FilterKey } from './filter-params'
import { useFilterParams } from './useFilterParams'
import { ErrorState, AccessDenied } from './route-ui'
import { button, field, panel } from './ui'

type Row = Pick<Application, 'id' | 'candidate_name' | 'stage' | 'requisition_title' | 'assignee_user_id' | 'source' | 'requisition_id'> & { source_detail?: string; created_at?: number | string }
export function ApplicationFilters({ space, requisitions, members }: { space: Workspace; requisitions: Requisition[]; members: Member[] }) {
  const { filters, change, clear, query } = useFilterParams()
  const [search, setSearch] = useState('')
  const [expanded, setExpanded] = useState(false)
  const [result, setResult] = useState<{ key: string; rows: (Omit<Row, 'created_at'> & { created_at?: string })[] } | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [retry, setRetry] = useState(0)
  const sequence = useRef(0)
  const staff = space.role === 'owner' || space.role === 'recruiter'
  const key = JSON.stringify([space.organization_id, space.brand_id, space.role, filters])
  useEffect(() => {
    const current = ++sequence.current
    setLoading(true); setError('')
    if (space.role === 'auditor') { setLoading(false); return }
    read<Row>(staff ? 'list_applications' : 'gateway_list_applications', { organization_id: space.organization_id, brand_id: space.brand_id, ...filterQuery(filters) })
      .then(rows => { if (sequence.current === current) setResult({ key, rows: rows.map(row => ({ ...row, created_at: row.created_at == null ? undefined : new Date(row.created_at).toISOString() })) }) })
      .catch(() => { if (sequence.current === current) setError('Could not load applications.') })
      .finally(() => { if (sequence.current === current) setLoading(false) })
    return () => { sequence.current++ }
  }, [key, retry])
  if (space.role === 'auditor') return <AccessDenied />
  const rows = result?.key === key ? result.rows : []
  const visible = rows.filter(row => matchesSearch(row, search))
  const pending = loading || (!error && result?.key !== key)
  const reset = () => { setSearch(''); clear() }
  const select = (name: FilterKey, label: string, options: [string, string][]) => <label className="block min-w-0">{label}<select aria-label={label} className={field} value={filters[name]} onChange={event => change(name, event.target.value)}><option value="">All</option>{filters[name] && !options.some(([value]) => value === filters[name]) && <option value={filters[name]}>{filters[name]}</option>}{options.map(([value, text]) => <option key={value} value={value}>{text}</option>)}</select>{filters[name] && <button type="button" className="min-h-[44px] underline" onClick={() => change(name, '')}>Clear {label}</button>}</label>
  return <section className={panel} aria-labelledby="applications-title">
    <h2 id="applications-title" className="text-lg font-semibold">Applications</h2>
    <button type="button" className={button + ' my-3 md:hidden'} aria-expanded={expanded} aria-controls="application-filter-panel" onClick={() => setExpanded(value => !value)}>Filters</button>
    <div id="application-filter-panel" className={(expanded ? 'grid' : 'hidden') + ' gap-4 md:grid md:grid-cols-2'}>
      {select('requisition', 'Position / requisition', [...new Map([...requisitions.map(row => [row.id, row.title] as [string, string]), ...rows.filter(row => row.requisition_id).map(row => [row.requisition_id!, row.requisition_title] as [string, string])]).entries()])}
      {select('stage', 'Stage', FILTER_STAGES.map(value => [value, stageLabel(value)]))}
      <label>Source<input aria-label="Source" className={field} list="application-sources" value={filters.source} maxLength={100} onChange={event => change('source', event.target.value)} /><datalist id="application-sources">{['linkedin', 'direct', 'manual', 'referral', 'email', 'job_board', 'recruiter_import'].map(value => <option key={value} value={value} />)}</datalist>{filters.source && <button type="button" className="min-h-[44px] underline" onClick={() => change('source', '')}>Clear Source</button>}</label>
      {select('assignee', 'Assigned recruiter', [...new Map([...members.map(row => [row.user_id, row.user_id] as [string, string]), ...rows.map(row => [row.assignee_user_id, row.assignee_user_id] as [string, string])]).entries()])}
      {(['date_from', 'date_to'] as const).map(name => <label key={name}>{name === 'date_from' ? 'Submitted from (UTC)' : 'Submitted through (UTC)'}<input aria-label={name === 'date_from' ? 'Submitted from (UTC)' : 'Submitted through (UTC)'} type="date" className={field} value={filters[name]} onChange={event => change(name, event.target.value)} />{filters[name] && <button type="button" className="min-h-[44px] underline" onClick={() => change(name, '')}>Clear {name === 'date_from' ? 'start date' : 'end date'}</button>}</label>)}
      <label>Search candidate name{staff ? ' or source detail' : ''}<input aria-label={staff ? 'Search candidate name or source detail' : 'Search candidate name'} type="search" className={field} value={search} onChange={event => setSearch(event.target.value)} />{search && <button type="button" className="min-h-[44px] underline" onClick={() => setSearch('')}>Clear search</button>}</label>
      {['LinkedIn campaign', 'Onboarding status', 'Invited date range'].map(label => <label key={label}>{label}<select aria-label={label} disabled className={field}><option>Unavailable — {label === 'LinkedIn campaign' ? 'campaign metadata not recorded' : 'onboarding tracking coming soon'}</option></select></label>)}
    </div>
    <button type="button" className={button + ' my-3'} onClick={reset}>Clear filters</button>
    <p className="text-sm">Showing up to {staff ? 100 : 25} recent authorized matches. Text search applies to these loaded results and stays on this page only.{!staff && ' Source detail is unavailable for reviewers.'}</p>
    {pending ? <div role="status" className="animate-pulse p-4">Loading applications…</div> : error ? <ErrorState retry={() => setRetry(value => value + 1)}>{error}</ErrorState> : <>
      <p role="status" aria-live="polite">{visible.length} matching applications{rows.length === (staff ? 100 : 25) ? ' (limit reached; narrow filters)' : ''}</p>
      {!visible.length ? <div><p>{!search && !Object.values(filters).some(Boolean) ? 'No applications yet.' : 'No applications match these filters.'}</p><button type="button" className={button} onClick={reset}>Clear filters</button></div> : <ul className="mt-4 space-y-2">{visible.map(row => <li key={row.id}><Link className="block min-h-[44px] rounded border border-[var(--line)] p-3" to={'/recruiter/applications/' + encodeURIComponent(row.id) + '?' + query}><strong>{row.candidate_name}</strong><span className="block">{row.requisition_title} · {stageLabel(row.stage)} · {row.source}</span></Link></li>)}</ul>}
    </>}
  </section>
}
