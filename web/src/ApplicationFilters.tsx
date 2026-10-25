import { useEffect, useRef, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { read, stageLabel, type Application, type Member, type Requisition, type Workspace } from './api'
import { FILTER_STAGES, ONBOARDING_STATUSES, filterQuery, matchesSearch, type FilterKey } from './filter-params'
import { useFilterParams } from './useFilterParams'
import { ErrorState, AccessDenied } from './route-ui'
import { button, field } from './ui'
import { recruiterApplicationUrl, staffBack, withBack } from './routes'

type Row = Pick<Application, 'id' | 'candidate_name' | 'stage' | 'requisition_title' | 'assignee_user_id' | 'source' | 'requisition_id'> & { source_detail?: string; created_at?: number | string }
export function ApplicationFilters({ space, requisitions, members }: { space: Workspace; requisitions: Requisition[]; members: Member[] }) {
  const location = useLocation()
  const createdApplicationId = location.state?.createdApplicationId as string | undefined
  const { filters, change, clear, query } = useFilterParams()
  const [search, setSearch] = useState('')
  const [expanded, setExpanded] = useState(false)
  const [result, setResult] = useState<{ key: string; rows: (Omit<Row, 'created_at'> & { created_at?: string })[] } | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [retry, setRetry] = useState(0)
  const sequence = useRef(0)
  const staff = space.role === 'owner' || space.role === 'recruiter'
  const key = JSON.stringify([space.organization_id, space.brand_id, space.role, filters, createdApplicationId])
  useEffect(() => {
    const current = ++sequence.current
    setLoading(true); setError('')
    if (space.role === 'auditor') { setLoading(false); return }
    const scope = { organization_id: space.organization_id, brand_id: space.brand_id }
    Promise.all([read<Row>(staff ? 'list_applications' : 'gateway_list_applications', { ...scope, ...filterQuery(filters) }), staff && createdApplicationId && !Object.values(filters).some(Boolean) ? read<Row>('get_application', { ...scope, application_id: createdApplicationId }) : Promise.resolve([])])
      .then(([rows, saved]) => [...saved, ...rows.filter(row => !saved.some(record => record.id === row.id))])
      .then(rows => { if (sequence.current === current) setResult({ key, rows: rows.map(row => ({ ...row, created_at: row.created_at == null ? undefined : Number.isNaN(new Date(row.created_at).getTime()) ? undefined : new Date(row.created_at).toISOString() })) }) })
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
  const scopeQuery = new URLSearchParams({ organization_id: space.organization_id, brand_id: space.brand_id })
  return <section aria-labelledby="applications-title">
    {createdApplicationId && staff && <p role="status">Candidate saved successfully. No outreach was sent.</p>}
    <header className="flex flex-wrap items-center justify-between gap-3">
      <div><h1 id="applications-title" className="text-2xl font-semibold">Applications</h1><p role="status" aria-live="polite" className="text-sm">{pending ? 'Loading count…' : error ? 'Count unavailable' : `${visible.length} visible / ${rows.length} loaded${rows.length === (staff ? 100 : 25) ? ' · limit reached; narrow filters' : ''}`}</p></div>
      <Link className={button + ' inline-flex min-h-11 items-center'} to={(staff ? '/recruiter/applications/new?' : '/recruiter/search?') + scopeQuery}>{staff ? 'Add candidate' : 'Search records'}</Link>
    </header>
    <button type="button" className={button + ' my-3 md:hidden'} aria-expanded={expanded} aria-controls="application-filter-panel" onClick={() => setExpanded(value => !value)}>Filters</button>
    <div id="application-filter-panel" className={(expanded ? 'grid' : 'hidden') + ' gap-3 rounded-lg border border-[var(--line)] p-3 text-sm md:grid md:grid-cols-3 xl:grid-cols-4'}>
      {select('requisition', 'Position / requisition', [...new Map([...requisitions.map(row => [row.id, row.title] as [string, string]), ...rows.filter(row => row.requisition_id).map(row => [row.requisition_id!, row.requisition_title] as [string, string])]).entries()])}
      {select('stage', 'Stage', FILTER_STAGES.map(value => [value, stageLabel(value)]))}
      <label>Source<input aria-label="Source" className={field} list="application-sources" value={filters.source} maxLength={100} onChange={event => change('source', event.target.value)} /><datalist id="application-sources">{['linkedin', 'direct', 'manual', 'referral', 'email', 'job_board', 'recruiter_import'].map(value => <option key={value} value={value} />)}</datalist>{filters.source && <button type="button" className="min-h-[44px] underline" onClick={() => change('source', '')}>Clear Source</button>}</label>
      {select('assignee', 'Assigned recruiter', [...new Map([...members.map(row => [row.user_id, row.user_id] as [string, string]), ...rows.map(row => [row.assignee_user_id, row.assignee_user_id] as [string, string])]).entries()])}
      {select('onboarding', 'Onboarding status', ONBOARDING_STATUSES.map(value => [value, stageLabel(value)]))}
      {(['invited_from', 'invited_to'] as const).map(name => <label key={name}>{name === 'invited_from' ? 'Invited from (UTC)' : 'Invited through (UTC)'}<input aria-label={name === 'invited_from' ? 'Invited from (UTC)' : 'Invited through (UTC)'} type="date" className={field} value={filters[name]} onChange={event => change(name, event.target.value)} />{filters[name] && <button type="button" className="min-h-[44px] underline" onClick={() => change(name, '')}>Clear {name === 'invited_from' ? 'invitation start date' : 'invitation end date'}</button>}</label>)}
      <p className="text-sm">Onboarding and invitation dates use recorded internship evidence. Applications without that evidence do not match these filters.</p>
      {(['date_from', 'date_to'] as const).map(name => <label key={name}>{name === 'date_from' ? 'Submitted from (UTC)' : 'Submitted through (UTC)'}<input aria-label={name === 'date_from' ? 'Submitted from (UTC)' : 'Submitted through (UTC)'} type="date" className={field} value={filters[name]} onChange={event => change(name, event.target.value)} />{filters[name] && <button type="button" className="min-h-[44px] underline" onClick={() => change(name, '')}>Clear {name === 'date_from' ? 'start date' : 'end date'}</button>}</label>)}
      <label>Search candidate name{staff ? ' or source detail' : ''}<input aria-label={staff ? 'Search candidate name or source detail' : 'Search candidate name'} type="search" className={field} value={search} onChange={event => setSearch(event.target.value)} />{search && <button type="button" className="min-h-[44px] underline" onClick={() => setSearch('')}>Clear search</button>}</label>
      {['LinkedIn campaign'].map(label => <label key={label}>{label}<select aria-label={label} disabled className={field}><option>Unavailable — {label === 'LinkedIn campaign' ? 'campaign metadata not recorded' : 'onboarding tracking coming soon'}</option></select></label>)}
    </div>
    <button type="button" className={button + ' my-3'} onClick={reset}>Clear filters</button>
    <details className="mb-3 text-sm"><summary className="cursor-pointer">About these results</summary><p>Showing up to {staff ? 100 : 25} recent authorized matches. Text search applies to these loaded results and stays on this page only.{!staff && ' Source detail is unavailable for reviewers.'}</p></details>
    {pending ? <div role="status" className="animate-pulse p-4">Loading applications… You can adjust filters while you wait.</div> : error ? <ErrorState retry={() => setRetry(value => value + 1)}>{error}</ErrorState> : <>
      {!visible.length ? <div className="rounded-lg border border-[var(--line)] p-5"><p>{!search && !Object.values(filters).some(Boolean) ? 'No applications yet.' : 'No applications match these filters.'}</p>{search || Object.values(filters).some(Boolean) ? <><p>Clear filters or broaden your search to find applicants.</p><button type="button" className={button + ' mt-3'} onClick={reset}>Clear filters</button></> : <p>{staff ? 'Use Add candidate to start your pipeline.' : 'Ask your recruiter to assign an application to you, or use Search records.'}</p>}</div> : <ul aria-label="Applicants" className="divide-y divide-[var(--line)] rounded-lg border border-[var(--line)]">{visible.map(row => {
        const profileUrl = withBack(recruiterApplicationUrl(row.id, space), staffBack('/recruiter/applications?' + query, space, 'applications'))
        return <li key={row.id}><Link className="grid min-h-11 grid-cols-2 items-center gap-x-4 gap-y-1 px-3 py-2 text-sm hover:bg-[var(--panel)] md:grid-cols-6" to={profileUrl} aria-label={`Open ${row.candidate_name}'s profile`}>
          <span className="min-w-0 break-words font-semibold underline">{row.candidate_name}</span>
          <span className="min-w-0 break-words"><span className="sr-only">Role: </span>{row.requisition_title}</span>
          <span><span className="sr-only">Stage: </span>{stageLabel(row.stage)}</span>
          <span className="min-w-0 break-words"><span className="sr-only">Source: </span>{row.source || 'Unknown source'}</span>
          <span className="min-w-0 break-words"><span className="md:sr-only">Assignee: </span>{row.assignee_user_id || 'Unassigned'}</span>
          <span><span className="md:sr-only">Submitted: </span>{row.created_at ? <time dateTime={row.created_at}>{row.created_at.slice(0, 10)}</time> : 'Date unavailable'}</span>
        </Link></li>
      })}</ul>}

    </>}
  </section>
}
