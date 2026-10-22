import { PrimaryNav, primarySections } from './PrimaryNav'
import { mutationError } from './mutation-state'
import { BrowserRouter, Link, NavLink, Navigate, Outlet, Route, Routes, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { LoadingState, ErrorState, NotFound, RouteBoundary } from './route-ui'
import { useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
import { ProShell, PageHeader, SignInButton, useAuth } from '@proappstore/sdk'
import { app, read, write, type Role, type Run, type Workspace } from './api'
import { Setup } from './forms'
import { field, panel } from './ui'
import { CandidateAccountPage } from './CandidateAccount'
import { Jobs } from './Jobs'
import { VacanciesIndexPage, VacancyDetailPage } from './Vacancies'
import { OverviewScreen, VacanciesScreen, ApplicationsScreen, ApplicationScreen, CommunicationsScreen, PlaybookScreen, OperationsScreen, ComplianceScreen, SettingsScreen, RecruiterContext } from './RecruiterScreens'

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
  return <><header className="border-b border-[var(--line)] p-4"><Link to="/" className="text-xl font-semibold">Hiring</Link><nav aria-label="Public navigation" className="flex flex-wrap gap-5"><NavLink to="/vacancies">Vacancies</NavLink><NavLink to="/jobs">Jobs</NavLink>{user && <NavLink to="/my-applications">My Applications</NavLink>}<NavLink to="/recruiter/overview">Switch to Recruiter Workspace</NavLink></nav></header><main id="route-content" tabIndex={-1} className="mx-auto max-w-7xl p-4"><Outlet /></main></>
}
function ProtectedShell() {
  const { user, loading } = useAuth(app)
  const location = useLocation()
  const navigate = useNavigate()
  const [spaces, setSpaces] = useState<Workspace[] | null>(null)
  const [spaceError, setSpaceError] = useState(false)
  const reloadSpaces = useCallback(async () => { try { setSpaces(await read<Workspace>('list_my_workspaces')); setSpaceError(false) } catch { setSpaceError(true) } }, [])
  useEffect(() => {
    if (!user) { setSpaces(null); return }
    void reloadSpaces()
  }, [user?.id, reloadSpaces])
  if (loading) return <LoadingState />
  if (!user) return <Navigate replace to={'/sign-in?returnTo=' + encodeURIComponent(location.pathname + location.search)} />
  const query = new URLSearchParams(location.search)
  const requestedOrg = query.get('organization_id')
  const requestedBrand = query.get('brand_id')
  const space = requestedOrg || requestedBrand
    ? spaces?.find(row => row.organization_id === requestedOrg && row.brand_id === requestedBrand)
    : spaces?.[0]
  const scope = space && { organization_id: space.organization_id, brand_id: space.brand_id }
  const switchSpace = (brandId: string) => {
    const next = spaces?.find(row => row.brand_id === brandId)
    if (!next) return
    const path = location.pathname.replace(/\/(applications|vacancies)\/[^/]+$/, '/$1')
    navigate(path + '?' + new URLSearchParams({ organization_id: next.organization_id, brand_id: next.brand_id }))
  }
  return <ProShell app={app} appName="hiring" branding="app" nav={space && scope ? primarySections(space.role).map(section => ({ label: section.label, href: section.path + '?' + new URLSearchParams(scope) })) : [{ label: 'Switch to Public Jobs', href: '/jobs' }]} onNavigate={navigate} renderNav={() => space && scope ? <PrimaryNav role={space.role} scope={scope} /> : <nav aria-label="Primary navigation"><Link className="inline-flex min-h-11 items-center px-3 text-sm underline" to="/jobs">Switch to Public Jobs</Link></nav>}><main id="route-content" tabIndex={-1}><div className="mx-auto max-w-7xl px-4 py-8 md:px-8">{space && spaces && <div className="mb-6 flex flex-wrap items-center gap-3"><label htmlFor="workspace" className="text-sm font-medium">Workspace</label><select id="workspace" aria-label="Workspace" className={field + ' max-w-xs'} value={space.brand_id} onChange={e => switchSpace(e.target.value)}>{spaces.map(row => <option key={row.organization_id + row.brand_id} value={row.brand_id}>{row.organization_name} / {row.brand_name}</option>)}</select><span className="text-xs text-[var(--muted)]">{space.role}</span></div>}{spaceError ? <ErrorState retry={() => void reloadSpaces()}>Could not load workspaces.</ErrorState> : !spaces ? <LoadingState>Loading workspace…</LoadingState> : !space && (requestedBrand || requestedOrg) ? <NotFound /> : !space ? <SetupScreen reloadSpaces={reloadSpaces} /> : <RecruiterContext.Provider value={{ space, userId: user.id, reloadSpaces }}><Outlet /></RecruiterContext.Provider>}</div></main></ProShell>
}
function SetupScreen({ reloadSpaces }: { reloadSpaces: () => Promise<void> }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const run: Run = async (name, params) => { setBusy(true); setError(''); try { await write(name, params); await reloadSpaces() } catch (e) { setError(mutationError(e)) } finally { setBusy(false) } }
  return <><PageHeader title="Recruiter workspace" />{error && <p role="alert">{error}</p>}<Setup busy={busy} run={run} /></>
}
function SignIn() {
  const { user, loading } = useAuth(app)
  const [query] = useSearchParams()
  const target = query.get('returnTo') ?? '/recruiter/overview'
  const safeTarget = /^\/(recruiter|admin|playbook|dashboard|applications|my-applications|apply)(\/|\?|$)/.test(target) ? target : '/recruiter/overview'
  if (loading) return <LoadingState />
  if (user) return <Navigate replace to={safeTarget} />
  return <section className={panel}><h1 className="text-2xl font-semibold">Sign in to Hiring</h1><p className="my-4">Continue to your application or workspace.</p><div className="flex flex-col items-start gap-3"><SignInButton app={app} provider="google" label="Continue with Google" /><SignInButton app={app} provider="github" label="Continue with GitHub" /></div></section>
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
function Allowed({ roles, children }: { roles: Role[]; children: ReactNode }) {
  const context = useContext(RecruiterContext)
  return context && roles.includes(context.space.role) ? <>{children}</> : <NotFound />
}
function LegacyRedirect({ to, detail = false }: { to: string; detail?: boolean }) {
  const location = useLocation()
  const { applicationId = '' } = useParams()
  return <Navigate replace to={to + (detail ? '/' + encodeURIComponent(applicationId) : '') + location.search} />
}
export function AppRoutes() {
  const location = useLocation()
  return <><a href="#route-content" className="sr-only focus:not-sr-only">Skip to content</a><RouteFocus /><RouteBoundary key={location.pathname === '/vacancies' || location.pathname === '/recruiter/applications' ? location.pathname : location.pathname + location.search}><Routes>
    <Route element={<PublicShell />}><Route index element={<PublicJobs />} /><Route path="vacancies" element={<VacanciesIndexPage />} /><Route path="vacancies/:vacancyId" element={<VacancyDetailPage />} /><Route path="jobs" element={<PublicJobs />} /><Route path="jobs/:jobId" element={<PublicJobs mode="detail" />} /><Route path="apply/:jobId" element={<PublicJobs mode="apply" />} /><Route path="my-applications" element={<CandidateAccount />} /><Route path="my-applications/:applicationId" element={<CandidateAccount />} /><Route path="sign-in" element={<SignIn />} /><Route path="*" element={<NotFound />} /></Route>
    <Route element={<ProtectedShell />}>
      <Route path="recruiter/overview" element={<OverviewScreen />} />
      <Route path="recruiter/vacancies" element={<Allowed roles={['owner','recruiter']}><VacanciesScreen /></Allowed>} />
      <Route path="recruiter/vacancies/:requisitionId" element={<Allowed roles={['owner','recruiter']}><VacanciesScreen /></Allowed>} />
      <Route path="recruiter/applications" element={<Allowed roles={['owner','recruiter','reviewer']}><ApplicationsScreen /></Allowed>} />
      <Route path="recruiter/applications/:applicationId" element={<Allowed roles={['owner','recruiter','reviewer']}><ApplicationScreen /></Allowed>} />
      <Route path="recruiter/communications" element={<Allowed roles={['owner','recruiter']}><CommunicationsScreen /></Allowed>} />
      <Route path="recruiter/playbook" element={<Allowed roles={['owner','recruiter']}><PlaybookScreen /></Allowed>} />
      <Route path="recruiter/operations" element={<Allowed roles={['owner','recruiter']}><OperationsScreen /></Allowed>} />
      <Route path="recruiter/compliance" element={<Allowed roles={['owner','recruiter','auditor']}><ComplianceScreen /></Allowed>} />
      <Route path="recruiter/settings" element={<Allowed roles={['owner']}><SettingsScreen /></Allowed>} />
      <Route path="dashboard" element={<LegacyRedirect to="/recruiter/overview" />} />
      <Route path="admin" element={<LegacyRedirect to="/recruiter/overview" />} />
      <Route path="applications" element={<LegacyRedirect to="/recruiter/applications" />} />
      <Route path="applications/:applicationId" element={<LegacyRedirect to="/recruiter/applications" detail />} />
      <Route path="playbook" element={<LegacyRedirect to="/recruiter/playbook" />} />
      <Route path="admin/communications" element={<LegacyRedirect to="/recruiter/communications" />} />
      <Route path="admin/operations" element={<LegacyRedirect to="/recruiter/operations" />} />
      <Route path="admin/compliance" element={<LegacyRedirect to="/recruiter/compliance" />} />
      <Route path="admin/settings" element={<LegacyRedirect to="/recruiter/settings" />} />
    </Route>
  </Routes></RouteBoundary></>
}
