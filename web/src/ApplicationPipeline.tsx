import { useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { STAGES, stageLabel, type Workspace } from './api'
import { useRecruiterData, workspaceQuery } from './recruiter-data'
import { EmptyState, ErrorState, LoadingState } from './route-ui'
import { date, field, panel } from './ui'

export function ApplicationPipeline({ space }: { space: Workspace }) {
  const { applications, requisitions, loading, error, reload } = useRecruiterData(space)
  const [query, setQuery] = useSearchParams()
  const [search, setSearch] = useState('')
  const stage = query.get('stage') ?? ''
  const assignee = query.get('assignee') ?? ''
  const requisition = query.get('requisition') ?? ''
  const grouping = query.get('group') === 'assignee' ? 'assignee' : 'stage'
  const attention = query.get('attention') ?? ''
  const change = (name: string, value: string) => { const next = new URLSearchParams(query); next.delete('attention'); if (value) next.set(name, value); else next.delete(name); setQuery(next) }
  if (loading) return <LoadingState><span className="animate-pulse">Loading applications…</span></LoadingState>
  if (error) return <ErrorState retry={() => void reload()}>{error}</ErrorState>
  if (space.role === 'auditor') return <EmptyState>Application pipeline is unavailable for the auditor role. Use an authorized application link to review its audit trail.</EmptyState>
  const filtered = applications.filter(a => a.candidate_name.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()) && (!stage || a.stage === stage) && (!assignee || (assignee === 'unassigned' ? !a.assignee_user_id : a.assignee_user_id === assignee)) && (!requisition || a.requisition_id === requisition) && (!attention || (attention === 'early' ? ['submitted', 'in_review'].includes(a.stage) : !a.assignee_user_id || ['submitted', 'in_review'].includes(a.stage)))).sort((a,b) => b.updated_at - a.updated_at || a.id.localeCompare(b.id))
  const assignees = [...new Set(applications.map(a => a.assignee_user_id).filter(Boolean))].sort()
  const reqs = [...new Map([...requisitions.map(r => [r.id, r.title] as const), ...applications.map(a => [a.requisition_id, a.requisition_title] as const)]).entries()]
  const groups = [...new Set(filtered.map(a => grouping === 'stage' ? a.stage : a.assignee_user_id))]
  return <section className="space-y-5"><h2 className="text-2xl font-semibold">Application pipeline</h2><p>{space.role === 'reviewer' ? 'Showing most recent 25 assigned applications. Filters apply to loaded records.' : 'Filters apply to the most recent 100 authorized applications.'}</p>{applications.length === 100 && <p>Showing most recent 100 applications</p>}
    <div className={panel + ' grid gap-4 sm:grid-cols-2 lg:grid-cols-4'}><label>Search candidates<input className={field} type="search" value={search} onChange={e => setSearch(e.target.value)} /></label><label>Stage<select className={field} value={stage} onChange={e => change('stage', e.target.value)}><option value="">All stages</option>{STAGES.map(s => <option key={s} value={s}>{stageLabel(s)}</option>)}</select></label><label>Assignee<select className={field} value={assignee} onChange={e => change('assignee', e.target.value)}><option value="">All assignees</option><option value="unassigned">Unassigned</option>{assignees.map(id => <option key={id} value={id}>{id}</option>)}</select></label><label>Requisition<select className={field} value={requisition} onChange={e => change('requisition', e.target.value)}><option value="">All requisitions</option>{reqs.map(([id,title]) => <option key={id} value={id}>{title}</option>)}</select></label><fieldset className="flex flex-wrap gap-4"><legend>Group by</legend>{['stage','assignee'].map(value => <label key={value}><input type="radio" name="group" checked={grouping === value} onChange={() => change('group', value)} /> {value}</label>)}</fieldset><button className="min-h-[44px] underline" onClick={() => { setSearch(''); setQuery(workspaceQuery(space)) }}>Clear filters</button></div>
    <p role="status" aria-live="polite">{filtered.length} matching applications</p>
    {!applications.length ? <EmptyState>No applications yet.</EmptyState> : !filtered.length ? <EmptyState>No applications match these filters.</EmptyState> : groups.map(group => <section className={panel + ' min-w-0'} key={group}><h3 className="mb-3 font-semibold capitalize">{grouping === 'stage' ? stageLabel(group) : group || 'Unassigned'}</h3><table className="w-full text-left text-sm"><caption className="sr-only">Applications grouped by {grouping}: {group || 'Unassigned'}</caption><thead className="hidden md:table-header-group"><tr>{['Candidate','Stage','Requisition','Assignee','Updated'].map(label => <th className="p-2" scope="col" key={label}>{label}</th>)}</tr></thead><tbody className="block md:table-row-group">{filtered.filter(a => (grouping === 'stage' ? a.stage : a.assignee_user_id) === group).map(a => <tr className="mb-3 block border-b border-[var(--line)] md:table-row" key={a.id}><td className="block break-words p-2 md:table-cell"><Link className="inline-flex min-h-[44px] items-center underline" aria-label={`Open ${a.candidate_name} application`} to={'/applications/' + encodeURIComponent(a.id) + '?' + workspaceQuery(space)}>{a.candidate_name}</Link></td><td className="block p-2 md:table-cell"><span className="rounded border border-[var(--line-strong)] px-2 py-1">{stageLabel(a.stage)}</span></td><td className="block break-words p-2 md:table-cell">{a.requisition_title}</td><td className="block break-all p-2 md:table-cell"><span className="md:hidden">Assignee: </span>{a.assignee_user_id || 'Unassigned'}</td><td className="block p-2 md:table-cell"><span className="md:hidden">Updated: </span>{date(a.updated_at)}</td></tr>)}</tbody></table></section>)}
  </section>
}
