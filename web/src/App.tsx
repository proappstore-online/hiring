import { ApplicationFilters } from './ApplicationFilters'
import { AdminNav, canAccessAdmin } from './AdminNav'
import { AdminCommunications } from './AdminCommunications'
import { OperationalDiagnostics } from './OperationalDiagnostics'
import { ComplianceControls } from './ComplianceControls'
import { mutationError } from './mutation-state'
import { BrowserRouter, Link, NavLink, Navigate, Outlet, Route, Routes, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { LoadingState, ErrorState, NotFound, RouteBoundary, AccessDenied } from './route-ui'
import { useCallback, useEffect, useRef, useState } from 'react'
import { ProShell, PageHeader, SignInButton, useAuth, type NavItem } from '@proappstore/sdk'
import { app, read, write, stageLabel, type AgentActivity, type Application, type Audit, type AssignmentEvent, type Communication, type Draft, type Member, type Note, type Requisition, type Run, type StageEvent, type Workspace } from './api'
import { ApplicationDetail } from './ApplicationDetail'
import { Admin, CreateApplication, Setup } from './forms'
import { button, date, field, panel } from './ui'
import { CandidateAccountPage } from './CandidateAccount'
import { Jobs } from './Jobs'
import { VacanciesIndexPage, VacancyDetailPage } from './Vacancies'
import { VacancyManagement } from './VacancyManagement'

const NAV: NavItem[] = [{ label: 'Workspace', href: '/dashboard', title: 'Hiring' }]
type Work = { brand_id: string; requisitions: Requisition[]; members: Member[]; applications: Application[] }
type Detail = { scope_key: string; application_id: string; notes: Note[]; drafts: Draft[]; communications: Communication[]; activities: AgentActivity[]; events: StageEvent[]; assignments: AssignmentEvent[]; audit: Audit[] }
const emptyWork: Omit<Work, 'brand_id'> = { requisitions: [], members: [], applications: [] }
const emptyDetail: Omit<Detail, 'application_id' | 'scope_key'> = { notes: [], drafts: [], communications: [], activities: [], events: [], assignments: [], audit: [] }

export default function App() {
  return <BrowserRouter><AppRoutes /></BrowserRouter>
}
function RouteFocus() {
  const location = useLocation()
  useEffect(() => { document.title = 'Hiring'; document.getElementById('route-content')?.focus() }, [location.pathname])
  return null
}
function PublicShell() {
  const { user } = useAuth(app)
  return <><header className="border-b border-[var(--line)] p-4"><Link to="/" className="text-xl font-semibold">Hiring</Link><nav aria-label="Public navigation" className="flex flex-wrap gap-5"><NavLink to="/vacancies">Vacancies</NavLink><NavLink to="/jobs">Jobs</NavLink>{user && <NavLink to="/my-applications">My Applications</NavLink>}<NavLink to="/dashboard">Recruiter workspace</NavLink></nav></header><main id="route-content" tabIndex={-1} className="mx-auto max-w-7xl p-4"><Outlet /></main></>
}
function ProtectedShell() {
  const { user, loading } = useAuth(app)
  const location = useLocation()
  if (loading) return <LoadingState />
  if (!user) return <Navigate replace to={'/sign-in?returnTo=' + encodeURIComponent(location.pathname + location.search)} />
  return <ProShell app={app} appName="hiring" nav={NAV} branding="app"><nav aria-label="Recruiter navigation" className="flex flex-wrap gap-5 p-4"><NavLink to="/admin">Administration</NavLink><NavLink to="/applications">Applications</NavLink><NavLink to="/vacancies">Vacancies</NavLink><Link to="/jobs">Public jobs</Link><Link to="/my-applications">My Applications</Link></nav><main id="route-content" tabIndex={-1}><Outlet /></main></ProShell>
}
function SignIn() {
  const { user, loading } = useAuth(app)
  const [query] = useSearchParams()
  const target = query.get('returnTo') ?? '/dashboard'
  const safeTarget = /^\/(admin|dashboard|applications|my-applications|apply)(\/|\?|$)/.test(target) ? target : '/dashboard'
  if (loading) return <LoadingState />
  if (user) return <Navigate replace to={safeTarget} />
  return <section className={panel}><h1 className="text-2xl font-semibold">Sign in to Hiring</h1><p className="my-4">Continue to your application or workspace.</p><SignInButton app={app} provider="google" label="Continue with Google" /><SignInButton app={app} provider="github" label="Continue with GitHub" /></section>
}
function PublicJobs({ mode = 'list' }: { mode?: 'list' | 'detail' | 'apply' }) {
  const { user } = useAuth(app)
  const location = useLocation()
  return <Jobs key={location.pathname + location.search + (user?.id ?? '')} userId={user?.id} mode={mode} />
}
function CandidateAccount() {
  const { user, loading } = useAuth(app)
  const location = useLocation()
  if (loading) return <LoadingState />
  if (!user) return <Navigate replace to={'/sign-in?returnTo=' + encodeURIComponent(location.pathname + location.search)} />
  return <CandidateAccountPage key={user.id} userId={user.id} />
}
function StaffWorkspace() {
  const { user } = useAuth(app)
  const location = useLocation()
  return user ? <WorkspaceView key={user.id + location.pathname + new URLSearchParams(location.search).get('organization_id') + new URLSearchParams(location.search).get('brand_id')} userId={user.id} /> : null
}
export function AppRoutes() {
  const location = useLocation()
  return <><a href="#route-content" className="sr-only focus:not-sr-only">Skip to content</a><RouteFocus /><RouteBoundary key={location.pathname === '/vacancies' || location.pathname === '/applications' ? location.pathname : location.pathname + location.search}><Routes>
    <Route element={<PublicShell />}><Route index element={<PublicJobs />} /><Route path="vacancies" element={<VacanciesIndexPage />} /><Route path="vacancies/:vacancyId" element={<VacancyDetailPage />} /><Route path="jobs" element={<PublicJobs />} /><Route path="jobs/:jobId" element={<PublicJobs mode="detail" />} /><Route path="apply/:jobId" element={<PublicJobs mode="apply" />} /><Route path="my-applications" element={<CandidateAccount />} /><Route path="my-applications/:applicationId" element={<CandidateAccount />} /><Route path="sign-in" element={<SignIn />} /><Route path="*" element={<NotFound />} /></Route>
    <Route element={<ProtectedShell />}><Route path="dashboard" element={<StaffWorkspace />} /><Route path="admin" element={<StaffWorkspace />} /><Route path="admin/communications" element={<StaffWorkspace />} /><Route path="admin/operations" element={<StaffWorkspace />} /><Route path="admin/compliance" element={<StaffWorkspace />} /><Route path="admin/settings" element={<StaffWorkspace />} /><Route path="applications" element={<StaffWorkspace />} /><Route path="applications/:applicationId" element={<StaffWorkspace />} /></Route>
  </Routes></RouteBoundary></>
}

function WorkspaceView({ userId }: { userId: string }) {
  const location = useLocation()
  const adminPath = location.pathname.startsWith('/admin') ? location.pathname : ''
  const [success, setSuccess] = useState('')
  useEffect(() => { if (success) { const timer = setTimeout(() => setSuccess(''), 4000); return () => clearTimeout(timer) } }, [success])
  const [spaces, setSpaces] = useState<Workspace[] | null>(null)
  const [selected, setSelected] = useState<string>('')
  const [work, setWork] = useState<Work | null>(null)
  const { applicationId: activeId = '' } = useParams()
  const navigate = useNavigate()
  const [query] = useSearchParams()
  const requestedBrand = query.get('brand_id')
  const requestedOrg = query.get('organization_id')
  const [workLoading, setWorkLoading] = useState(true)
  const [workError, setWorkError] = useState('')
  const [fallback, setFallback] = useState<{ id: string; candidate_name: string; requisition_title: string; stage: string } | null>(null)
  const [detail, setDetail] = useState<Detail | null>(null)
  const [detailFetch, setDetailFetch] = useState({ key: '', loading: false, error: '' })
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(true)
  const workSeq = useRef(0)
  const detailSeq = useRef(0)
  const space = spaces?.find(s => s.brand_id === selected && (!requestedOrg || s.organization_id === requestedOrg))
  const scope = space ? { organization_id: space.organization_id, brand_id: space.brand_id } : null
  const detailKey = JSON.stringify([scope?.organization_id, scope?.brand_id, activeId])
  const detailLoading = detailFetch.key !== detailKey || detailFetch.loading
  const detailError = detailFetch.key === detailKey ? detailFetch.error : ''
  // Data loaded for a previous workspace or application is never shown for the current one.
  const { requisitions, members, applications } = work?.brand_id === selected ? work : emptyWork
  const { notes, drafts, communications, activities, events, assignments, audit } = detail?.scope_key === detailKey ? detail : emptyDetail
  const active = applications.find(a => a.id === activeId)
  const reloadSpaces = useCallback(async () => { const rows = await read<Workspace>('list_my_workspaces'); setSpaces(rows); setSelected(old => rows.some(s => s.brand_id === old) ? old : requestedBrand ?? rows[0]?.brand_id ?? '') }, [requestedBrand])
  const reloadWork = useCallback(async () => {
    const seq = ++workSeq.current
    if (!scope) return
    setWorkLoading(true); setWorkError(''); setFallback(null)
    try {
    const [r, m, a] = await Promise.all([read<Requisition>('list_requisitions', scope), read<Member>('list_workspace_members', scope), location.pathname === '/applications' ? Promise.resolve([]) : read<Application>('list_applications', scope)])
    if (seq === workSeq.current) {
      setWork({ brand_id: scope.brand_id, requisitions: r, members: m, applications: a })
      if (activeId && !a.some(row => row.id === activeId)) {
        const rows = await read<{ id: string; candidate_name: string; requisition_title: string; stage: string }>('gateway_get_application', { ...scope, application_id: activeId })
        if (seq === workSeq.current) setFallback(rows[0] ?? null)
      }
    }
    } catch { if (seq === workSeq.current) setWorkError('Could not load applications.') }
    finally { if (seq === workSeq.current) setWorkLoading(false) }
  }, [space?.organization_id, space?.brand_id, activeId])
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
    setBusy(true); setError(''); setSuccess('')
    try { await write(name, params); await reloadSpaces(); await reloadWork(); await reloadDetail(); setSuccess('Action saved successfully.') }
    catch (e) { setError(mutationError(e)) }
    finally { setBusy(false) }
  }
  return <div className="mx-auto max-w-7xl px-4 py-8 md:px-8">
    <Link className="mb-3 block underline" to="/jobs">Browse jobs and my applications</Link>
    <PageHeader title="Recruiter workspace" description="Private sourcing, pipeline notes and unsent communications." />
    <p className="mt-2 text-xs text-[var(--muted)]">Your PAS staff ID: <code>{userId}</code></p>
    {success && <p role="status">{success}</p>}
    {error && <p role="alert" className="mt-5 rounded-lg border border-[var(--danger)] p-3 text-sm text-[var(--danger)]">{error}</p>}
    {loading ? <p role="status" className="mt-6">Loading workspace…</p> : !spaces ? <button type="button" className={button + ' mt-6'} onClick={loadSpaces}>Retry loading workspaces</button> : !space && (requestedBrand || activeId) ? <NotFound /> : !space ? <Setup busy={busy} run={run} /> : <>
      <div className="my-6 flex flex-wrap items-center gap-3"><label htmlFor="workspace" className="text-sm font-medium">Workspace</label><select id="workspace" aria-label="Workspace" className={field + ' max-w-xs'} value={selected} onChange={e => { navigate((adminPath || '/applications') + '?' + new URLSearchParams({ brand_id: e.target.value, organization_id: spaces.find(s => s.brand_id === e.target.value)!.organization_id })) }}>{spaces.map(s => <option value={s.brand_id} key={s.brand_id}>{s.organization_name} / {s.brand_name}</option>)}</select><span className="text-xs text-[var(--muted)]">{space.role}</span></div>
      <AdminNav role={space.role} scope={scope!} />
      {adminPath && !canAccessAdmin(adminPath, space.role) ? <AccessDenied /> : adminPath === '/admin/settings' ? <Admin onChanged={reloadSpaces} scope={scope!} role={space.role} organizationName={space.organization_name} canCreateBrand={Boolean(space.can_create_brand)} canCreateRequisition={Boolean(space.can_create_requisition)} busy={busy} run={run} /> : adminPath === '/admin/operations' ? <OperationalDiagnostics key={selected} scope={scope!} /> : adminPath === '/admin/compliance' ? <ComplianceControls role={space.role} /> : workLoading ? <LoadingState>Loading applications…</LoadingState> : workError ? <ErrorState retry={() => void reloadWork()}>{workError}</ErrorState> : adminPath === '/admin/communications' ? <AdminCommunications key={selected} scope={scope!} brandName={space.brand_name} applications={applications} canManageTemplates={Boolean(space.can_manage_templates)} /> : <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(340px,1.1fr)]">
        <div className="space-y-6">{(space.role === 'owner' || space.role === 'recruiter') && <CreateApplication key={members.map(m => m.user_id).join()} scope={scope!} requisitions={requisitions} members={members} userId={userId} busy={busy} run={run} />}
          {location.pathname === '/applications' ? <ApplicationFilters key={JSON.stringify([scope, space.role])} space={space} requisitions={requisitions} members={members} /> : <section className={panel}><h2 className="text-lg font-semibold">Applications</h2><p className="mt-1 text-xs text-[var(--muted)]">{applications.length} recent records</p><div className="mt-4 space-y-2">{applications.length ? applications.map(a => <Link key={a.id} to={'/applications/' + encodeURIComponent(a.id) + '?' + new URLSearchParams(scope!)} aria-label={`Open ${a.candidate_name} application`} className={'block min-h-[44px] w-full rounded-lg border p-3 text-left text-sm hover:border-[var(--accent)] ' + (a.id === activeId ? 'border-[var(--accent)]' : 'border-[var(--line)]')}><span className="font-semibold">{a.candidate_name}</span><span className="float-right text-xs">{stageLabel(a.stage)}</span><span className="block text-xs text-[var(--muted)]">{a.requisition_title} · {date(a.updated_at)}</span></Link>) : <p className="text-sm text-[var(--muted)]">No applications yet.</p>}</div></section>}
          {(space.role === 'owner' || space.role === 'recruiter') && <VacancyManagement key={selected} scope={scope!} role={space.role} requisitions={requisitions} />}
          <Admin onChanged={async () => { await reloadSpaces(); await reloadWork(); await reloadDetail() }} scope={scope!} role={space.role} organizationName={space.organization_name} canCreateBrand={Boolean(space.can_create_brand)} canCreateRequisition={Boolean(space.can_create_requisition)} busy={busy} run={run} />
        </div>
        <div>{active ? <ApplicationDetail brandName={space.brand_name} detailLoading={detailLoading} detailError={detailError} retryDetail={() => void reloadDetail()} key={active.id} a={active} scope={scope!} members={members} notes={notes} drafts={drafts} communications={communications} activities={activities} events={events} assignments={assignments} audit={audit} busy={busy} run={run} /> : activeId ? fallback ? <section className={panel}><h2>{fallback.candidate_name}</h2><p>{fallback.requisition_title} · {stageLabel(fallback.stage)}</p><p>This record provides a restricted summary. Full contact and history are unavailable through the current detail API.</p></section> : <NotFound /> : <section className={panel}><h2 className="font-semibold">Application details</h2><p className="mt-2 text-sm text-[var(--muted)]">Select an application to see its history, communications and agent activity.</p></section>}</div>
      </div>}
    </>}
  </div>
}
