import { useState } from 'react'
import { Link } from 'react-router-dom'
import { read, type Audit, STAGES, stageLabel, type Workspace } from './api'
import { useRecruiterData, workspaceQuery } from './recruiter-data'
import { EmptyState, ErrorState, LoadingState } from './route-ui'
import { date, field, panel } from './ui'
import { PublishJob } from './Jobs'

export function RecruiterDashboard({ space }: { space: Workspace }) {
  const { applications, requisitions, loading, error, reload } = useRecruiterData(space)
  if (loading) return <LoadingState>Loading dashboard…</LoadingState>
  if (error) return <ErrorState retry={() => void reload()}>{error}</ErrorState>
  if (space.role === 'auditor') return <AuditWorkspace key={workspaceQuery(space)} space={space} />
  const unassigned = applications.filter(a => !a.assignee_user_id).length
  const early = applications.filter(a => ['submitted', 'in_review'].includes(a.stage)).length
  const needingAction = applications.filter(a => !a.assignee_user_id || ['submitted', 'in_review'].includes(a.stage)).length
  const link = (extra: Record<string, string> = {}) => '/applications?' + workspaceQuery(space, extra)
  return <div className="space-y-6"><h2 className="text-2xl font-semibold">Recruiter dashboard</h2><p>{space.role === 'reviewer' ? 'Assigned applications only. Showing counts for the most recent 25 assigned applications.' : 'Showing counts for recent 100 applications. Counts and requisition summaries reflect loaded records only.'}</p>
    {!applications.length && <EmptyState>No applications yet.</EmptyState>}
    <section aria-label="Application statistics" className="grid grid-cols-2 gap-3 md:grid-cols-4">
      {[{ label: 'Total applications', count: applications.length, href: link() }, { label: 'Needs action', count: needingAction, href: link({ attention: 'needed' }) }, ...STAGES.map(stage => ({ label: stageLabel(stage), count: applications.filter(a => a.stage === stage).length, href: link({ stage }) }))].map(stat => <Link key={stat.label} className={panel + ' min-h-[88px]'} to={stat.href}><span className="block text-sm capitalize">{stat.label}</span><strong className="text-2xl">{stat.count}</strong></Link>)}
    </section>
    <section className={panel}><h3 className="font-semibold">Next steps</h3><ul className="space-y-3"><li><Link className="inline-flex min-h-[44px] items-center underline" to={link({ assignee: 'unassigned' })}>Review {unassigned} unassigned applications</Link></li><li><Link className="underline" to={link({ attention: 'early' })}>Review {early} early-stage applications</Link></li><li><Link className="inline-flex min-h-[44px] items-center underline" to={link({ stage: 'offered' })}>{applications.filter(a => a.stage === 'offered').length} in offer stage</Link></li></ul></section>
    {space.role !== 'reviewer' && <section className={panel}><h3 className="font-semibold">Open requisitions</h3>{requisitions.filter(r => !['closed', 'archived'].includes(r.status)).map(r => <p key={r.id} className="my-3"><Link className="underline" to={link({ requisition: r.id })}>{r.title}</Link> · {r.status} · {applications.filter(a => a.requisition_id === r.id).length} recent applications</p>)}{!requisitions.some(r => !['closed', 'archived'].includes(r.status)) && <EmptyState>No open requisitions.</EmptyState>}</section>}
    {space.role === 'owner' && <><a className="inline-flex min-h-[44px] items-center underline" href="#publication-controls">Manage publication controls</a><div id="publication-controls"><PublishJob scope={space} requisitions={requisitions} /></div></>}
  </div>
}

function AuditWorkspace({ space }: { space: Workspace }) {
  const [rows, setRows] = useState<Audit[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  return <section className={panel}><h2 className="text-xl font-semibold">Audit workspace</h2><p>Audit access is limited to granted requisitions. Candidate records and recruiting controls are unavailable for this role.</p><form className="my-4 space-y-3" onSubmit={async e => { e.preventDefault(); const application_id = String(new FormData(e.currentTarget).get('application_id')); setBusy(true); setRows(null); setError(''); try { setRows(await read<Audit>('list_application_audit', { organization_id: space.organization_id, brand_id: space.brand_id, application_id })) } catch { setError('Could not load audit history. Please try again.') } finally { setBusy(false) } }}><label>Application reference<input className={field} name="application_id" required /></label><button className="min-h-[44px] underline" disabled={busy}>Load authorized audit history</button></form>{busy && <LoadingState>Loading audit history…</LoadingState>}{error && <ErrorState>{error}</ErrorState>}{rows && (rows.length ? <ul>{rows.map((row,i) => <li key={i}>{row.action} · {row.actor_user_id} · {date(row.created_at)}</li>)}</ul> : <EmptyState>No audit history available to your account for this reference.</EmptyState>)}</section>
}
