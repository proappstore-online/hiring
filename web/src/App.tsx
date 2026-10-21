import { useCallback, useEffect, useRef, useState } from 'react'
import { ProShell, PageHeader, SignInButton, useAuth, type NavItem } from '@proappstore/sdk'
import { app, read, write, stageLabel, type AgentActivity, type Application, type Audit, type AssignmentEvent, type Communication, type Draft, type Member, type Note, type Requisition, type Run, type StageEvent, type Workspace } from './api'
import { ApplicationDetail } from './ApplicationDetail'
import { Admin, CreateApplication, Setup } from './forms'
import { button, date, field, panel } from './ui'
import { Jobs, PublishJob } from './Jobs'

const NAV: NavItem[] = [{ label: 'Workspace', href: '/', title: 'Hiring' }]
type Work = { brand_id: string; requisitions: Requisition[]; members: Member[]; applications: Application[] }
type Detail = { scope_key: string; application_id: string; notes: Note[]; drafts: Draft[]; communications: Communication[]; activities: AgentActivity[]; events: StageEvent[]; assignments: AssignmentEvent[]; audit: Audit[] }
const emptyWork: Omit<Work, 'brand_id'> = { requisitions: [], members: [], applications: [] }
const emptyDetail: Omit<Detail, 'application_id' | 'scope_key'> = { notes: [], drafts: [], communications: [], activities: [], events: [], assignments: [], audit: [] }

export default function App() {
  const { user, loading } = useAuth(app)
  if (loading) return <main className="flex min-h-dvh items-center justify-center"><p role="status">Loading…</p></main>
  if (new URLSearchParams(window.location.search).get('view') === 'jobs') return <Jobs userId={user?.id} />
  if (!user) return <main className="flex min-h-dvh items-center justify-center px-6"><section className={panel + ' w-full max-w-sm text-center'}><h1 className="text-2xl font-semibold">Hiring</h1><p className="my-4 text-sm text-[var(--muted)]">Sign in to your private recruiting workspace.</p><a className="my-3 block underline" href="/?view=jobs">Browse jobs and apply</a><div className="flex flex-col items-center gap-3"><SignInButton app={app} provider="google" label="Continue with Google" /><SignInButton app={app} provider="github" label="Continue with GitHub" /></div></section></main>
  return <ProShell app={app} appName="hiring" nav={NAV} branding="app"><WorkspaceView userId={user.id} /></ProShell>
}

function WorkspaceView({ userId }: { userId: string }) {
  const [spaces, setSpaces] = useState<Workspace[] | null>(null)
  const [selected, setSelected] = useState<string>('')
  const [work, setWork] = useState<Work | null>(null)
  const [activeId, setActiveId] = useState('')
  const [detail, setDetail] = useState<Detail | null>(null)
  const [detailFetch, setDetailFetch] = useState({ key: '', loading: false, error: '' })
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(true)
  const workSeq = useRef(0)
  const detailSeq = useRef(0)
  const space = spaces?.find(s => s.brand_id === selected)
  const scope = space ? { organization_id: space.organization_id, brand_id: space.brand_id } : null
  const detailKey = JSON.stringify([scope?.organization_id, scope?.brand_id, activeId])
  const detailLoading = detailFetch.key !== detailKey || detailFetch.loading
  const detailError = detailFetch.key === detailKey ? detailFetch.error : ''
  // Data loaded for a previous workspace or application is never shown for the current one.
  const { requisitions, members, applications } = work?.brand_id === selected ? work : emptyWork
  const { notes, drafts, communications, activities, events, assignments, audit } = detail?.scope_key === detailKey ? detail : emptyDetail
  const active = applications.find(a => a.id === activeId)
  const reloadSpaces = useCallback(async () => { const rows = await read<Workspace>('list_my_workspaces'); setSpaces(rows); setSelected(old => rows.some(s => s.brand_id === old) ? old : rows[0]?.brand_id ?? '') }, [])
  const reloadWork = useCallback(async () => {
    const seq = ++workSeq.current
    if (!scope) return
    const [r, m, a] = await Promise.all([read<Requisition>('list_requisitions', scope), read<Member>('list_workspace_members', scope), read<Application>('list_applications', scope)])
    if (seq === workSeq.current) setWork({ brand_id: scope.brand_id, requisitions: r, members: m, applications: a })
  }, [space?.organization_id, space?.brand_id])
  const reloadDetail = useCallback(async () => {
    const seq = ++detailSeq.current
    if (!scope || !activeId) return
    const key = JSON.stringify([scope.organization_id, scope.brand_id, activeId])
    setDetailFetch({ key, loading: true, error: '' })
    const p = { ...scope, application_id: activeId }
    try {
      const [n, d, c, x, e, h, a] = await Promise.all([read<Note>('list_application_notes', p), read<Draft>('list_communication_drafts', p), read<Communication>('list_application_communications', p), read<AgentActivity>('list_application_agent_activity', p), read<StageEvent>('list_stage_events', p), read<AssignmentEvent>('list_assignment_events', p), read<Audit>('list_application_audit', p)])
      if (seq === detailSeq.current) setDetail({ scope_key: key, application_id: activeId, notes: n, drafts: d, communications: c, activities: x, events: e, assignments: h, audit: a })
    } catch {
      if (seq === detailSeq.current) setDetailFetch({ key, loading: false, error: 'Could not load communications.' })
    } finally {
      if (seq === detailSeq.current) setDetailFetch(old => ({ ...old, loading: false }))
    }
  }, [space?.organization_id, space?.brand_id, activeId])
  const loadSpaces = useCallback(() => { setLoading(true); setError(''); reloadSpaces().catch(e => setError(String(e))).finally(() => setLoading(false)) }, [reloadSpaces])
  useEffect(loadSpaces, [loadSpaces])
  useEffect(() => { reloadWork().catch(e => setError(String(e))) }, [reloadWork])
  useEffect(() => { reloadDetail().catch(e => setError(String(e))) }, [reloadDetail])
  const run: Run = async (name, params) => {
    setBusy(true); setError('')
    try { await write(name, params); await reloadSpaces(); await reloadWork(); await reloadDetail() }
    catch (e) { setError(e instanceof Error ? e.message : String(e)) }
    finally { setBusy(false) }
  }
  return <div className="mx-auto max-w-7xl px-4 py-8 md:px-8">
    <a className="mb-3 block underline" href="/?view=jobs">Browse jobs and my applications</a>
    <PageHeader title="Recruiter workspace" description="Private sourcing, pipeline notes and unsent communications." />
    <p className="mt-2 text-xs text-[var(--muted)]">Your PAS staff ID: <code>{userId}</code></p>
    {error && <p role="alert" className="mt-5 rounded-lg border border-[var(--danger)] p-3 text-sm text-[var(--danger)]">{error}</p>}
    {loading ? <p role="status" className="mt-6">Loading workspace…</p> : !spaces ? <button type="button" className={button + ' mt-6'} onClick={loadSpaces}>Retry loading workspaces</button> : !space ? <Setup busy={busy} run={run} /> : <>
      <div className="my-6 flex flex-wrap items-center gap-3"><label htmlFor="workspace" className="text-sm font-medium">Workspace</label><select id="workspace" aria-label="Workspace" className={field + ' max-w-xs'} value={selected} onChange={e => { setSelected(e.target.value); setActiveId('') }}>{spaces.map(s => <option value={s.brand_id} key={s.brand_id}>{s.organization_name} / {s.brand_name}</option>)}</select><span className="text-xs text-[var(--muted)]">{space.role}</span></div>
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(340px,1.1fr)]">
        <div className="space-y-6"><CreateApplication key={members.map(m => m.user_id).join()} scope={scope!} requisitions={requisitions} members={members} userId={userId} busy={busy} run={run} />
          <section className={panel}><h2 className="text-lg font-semibold">Applications</h2><p className="mt-1 text-xs text-[var(--muted)]">{applications.length} recent records</p><div className="mt-4 space-y-2">{applications.length ? applications.map(a => <button key={a.id} type="button" onClick={() => setActiveId(a.id)} aria-label={`Open ${a.candidate_name} application`} className={'w-full rounded-lg border p-3 text-left text-sm hover:border-[var(--accent)] ' + (a.id === activeId ? 'border-[var(--accent)]' : 'border-[var(--line)]')}><span className="font-semibold">{a.candidate_name}</span><span className="float-right text-xs">{stageLabel(a.stage)}</span><span className="block text-xs text-[var(--muted)]">{a.requisition_title} · {date(a.updated_at)}</span></button>) : <p className="text-sm text-[var(--muted)]">No applications yet.</p>}</div></section>
          {space.role === 'owner' && <PublishJob key={selected} scope={scope!} requisitions={requisitions} />}
          <Admin onChanged={async () => { await reloadSpaces(); await reloadWork(); await reloadDetail() }} scope={scope!} role={space.role} organizationName={space.organization_name} canCreateBrand={Boolean(space.can_create_brand)} busy={busy} run={run} />
        </div>
        <div>{active ? <ApplicationDetail detailLoading={detailLoading} detailError={detailError} retryDetail={() => void reloadDetail()} key={active.id} a={active} scope={scope!} members={members} notes={notes} drafts={drafts} communications={communications} activities={activities} events={events} assignments={assignments} audit={audit} busy={busy} run={run} /> : <section className={panel}><h2 className="font-semibold">Application details</h2><p className="mt-2 text-sm text-[var(--muted)]">Select an application to see its history, communications and agent activity.</p></section>}</div>
      </div>
    </>}
  </div>
}
