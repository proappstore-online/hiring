import { PrimaryNav, primarySections } from './PrimaryNav'
import { mutationError } from './mutation-state'
import { BrowserRouter, Link, NavLink, Navigate, Outlet, Route, Routes, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { LoadingState, ErrorState, NotFound, RouteBoundary } from './route-ui'
import { useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { ProShell, PageHeader, SignInButton, useAuth } from '@proappstore/sdk'
import { app, read, readPublic, write, type Role, type Run, type Workspace } from './api'
import { Setup } from './forms'
import { field, panel } from './ui'
import { CandidateAccountPage } from './CandidateAccount'
import { Jobs } from './Jobs'
import { VacanciesIndexPage, VacancyDetailPage } from './Vacancies'
import { CreateCandidateScreen, CreateVacancyScreen, SearchScreen, TalentPoolScreen, OverviewScreen, VacanciesScreen, ApplicationsScreen, ApplicationScreen, CommunicationsScreen, PlaybookScreen, OperationsScreen, ComplianceScreen, SettingsScreen, RecruiterContext } from './RecruiterScreens'
import { brandSettingsUrl, safeBack, vacancyUrl, applyUrl, withBack, recruiterVacancyUrl, staffBack } from './routes'

const decodePathId = (value: string | undefined) => { try { return value ? decodeURIComponent(value) : null } catch { return null } }

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
  return <><header className="border-b border-[var(--line)] p-4"><Link to="/" className="text-xl font-semibold">Hiring</Link><nav aria-label="Public navigation" className="flex flex-wrap gap-5"><NavLink to="/vacancies">Vacancies</NavLink>{user && <NavLink to="/my-applications">My Applications</NavLink>}<NavLink to="/recruiter/overview">Switch to Recruiter Workspace</NavLink></nav></header><main id="route-content" tabIndex={-1} className="mx-auto max-w-7xl p-4"><Outlet /></main></>
}
function ProtectedShell() {
  const { user, loading } = useAuth(app)
  const location = useLocation()
  const navigate = useNavigate()
  const [spaces, setSpaces] = useState<Workspace[] | null>(null)
  const [spaceError, setSpaceError] = useState(false)
  const switchRevision = useRef(0)
  const query = new URLSearchParams(location.search)
  const requestedOrg = query.get('organization_id')
  const requestedBrand = query.get('brand_id')
  const brandSettings = location.pathname.match(/^\/recruiter\/organizations\/([^/]+)\/brands\/([^/]+)\/settings$/)
  const orgSettings = location.pathname.match(/^\/recruiter\/organizations\/([^/]+)\/settings$/)
  const pathOrg = brandSettings?.[1] ?? orgSettings?.[1]
  const pathBrand = brandSettings?.[2]
  const decodedOrg = decodePathId(pathOrg)
  const decodedBrand = decodePathId(pathBrand)
  const exactKey = JSON.stringify([user?.id, decodedOrg ?? requestedOrg, pathOrg ? decodedBrand : requestedBrand, Boolean(pathOrg)])
  const [exact, setExact] = useState<{ key: string; space: Workspace | null; error: boolean } | null>(null)
  const [exactRevision, setExactRevision] = useState(0)
  const reloadSpaces = useCallback(async () => { try { setSpaces(await read<Workspace>('list_my_workspaces')); setSpaceError(false) } catch { setSpaceError(true) } }, [])
  useEffect(() => {
    if (!user) { setSpaces(null); return }
    void reloadSpaces()
  }, [user?.id, reloadSpaces])
  useEffect(() => {
    if (!user || !(pathOrg || requestedOrg || requestedBrand)) return
    if (!decodedOrg && pathOrg || !pathOrg && (!requestedOrg || !requestedBrand)) { setExact({ key: exactKey, space: null, error: false }); return }
    let live = true
    const params = pathOrg ? { organization_id: decodedOrg!, ...(pathBrand ? { brand_id: decodedBrand ?? '' } : {}), owner_only: 1 } : { organization_id: requestedOrg!, brand_id: requestedBrand! }
    read<Workspace>('get_my_workspace', params).then(rows => { if (live) setExact({ key: exactKey, space: rows[0] ?? null, error: false }) }).catch(() => { if (live) setExact({ key: exactKey, space: null, error: true }) })
    return () => { live = false }
  }, [exactKey, exactRevision])
  if (loading) return <LoadingState />
  if (!user) return <Navigate replace to={'/sign-in?returnTo=' + encodeURIComponent(location.pathname + location.search)} />
  const hasExact = Boolean(pathOrg || requestedOrg || requestedBrand)
  const exactLoading = hasExact && exact?.key !== exactKey
  const exactSpace = exact?.key === exactKey && !exact.error ? exact.space : null
  const matchesPath = !pathOrg || Boolean(exactSpace && exactSpace.organization_id === decodedOrg && (!pathBrand || exactSpace.brand_id === decodedBrand) && (!requestedOrg || requestedOrg === decodedOrg) && (!requestedBrand || requestedBrand === exactSpace.brand_id))
  const space = hasExact ? matchesPath ? exactSpace : null : spaces?.[0]
  const selectorSpaces = space && spaces && !spaces.some(row => row.organization_id === space.organization_id && row.brand_id === space.brand_id) ? [space, ...spaces] : spaces
  const scope = space && { organization_id: space.organization_id, brand_id: space.brand_id }
  const switchSpace = async (brandId: string) => {
    const next = selectorSpaces?.find(row => row.brand_id === brandId)
    if (!next || !space || !user) return
    const revision = ++switchRevision.current
    const rememberedKey = (organizationId: string, selectedBrandId: string) => `hiring:vacancy:${user.id}:${organizationId}:${selectedBrandId}`
    const vacancyMatch = location.pathname.match(/^\/recruiter\/vacancies\/([^/]+)$/)
    if (vacancyMatch) {
      try {
        const requisitionId = decodeURIComponent(vacancyMatch[1])
        const back = new URLSearchParams(location.search).get('back')
        sessionStorage.setItem(rememberedKey(space.organization_id, space.brand_id), JSON.stringify({ requisitionId, back: back ? staffBack(back, space, 'vacancies') : null }))
      } catch { /* Storage is optional; switching still works. */ }
    }
    const nextScope = { organization_id: next.organization_id, brand_id: next.brand_id }
    if (pathOrg) { navigate(next.role === 'owner' ? brandSettingsUrl(next) : '/recruiter/overview?' + new URLSearchParams({ organization_id: next.organization_id, brand_id: next.brand_id })); return }
    if (location.pathname.startsWith('/recruiter/vacancies')) {
      if (next.role !== 'owner' && next.role !== 'recruiter') { navigate('/recruiter/overview?' + new URLSearchParams(nextScope)); return }
      let remembered: { requisitionId?: string; back?: string | null } | null = null
      try { remembered = JSON.parse(sessionStorage.getItem(rememberedKey(next.organization_id, next.brand_id)) ?? 'null') } catch { /* Invalid saved state falls back to the list. */ }
      if (remembered?.requisitionId && remembered.requisitionId.length <= 200) {
        try {
          const rows = await read<{ id: string }>('get_vacancy_management', { ...nextScope, requisition_id: remembered.requisitionId })
          if (revision !== switchRevision.current) return
          if (rows[0]?.id === remembered.requisitionId) {
            const back = remembered.back ? staffBack(remembered.back, nextScope, 'vacancies') : null
            navigate(back ? withBack(recruiterVacancyUrl(remembered.requisitionId, nextScope), back) : recruiterVacancyUrl(remembered.requisitionId, nextScope))
            return
          }
          sessionStorage.removeItem(rememberedKey(next.organization_id, next.brand_id))
        } catch { /* A failed lookup must not restore an unverified record. */ }
      }
      if (revision === switchRevision.current) navigate('/recruiter/vacancies?' + new URLSearchParams(nextScope))
      return
    }
    const path = location.pathname.replace(/\/applications\/[^/]+$/, '/applications')
    navigate(path + '?' + new URLSearchParams(nextScope))
  }
  return <ProShell app={app} appName="hiring" branding="app" nav={space && scope ? primarySections(space.role).map(section => ({ label: section.label, href: section.path === '/recruiter/settings' ? brandSettingsUrl(scope) : section.path + '?' + new URLSearchParams(scope) })) : [{ label: 'Switch to Public Vacancies', href: '/vacancies' }]} onNavigate={navigate} renderNav={() => space && scope ? <PrimaryNav role={space.role} scope={scope} /> : <nav aria-label="Primary navigation"><Link className="inline-flex min-h-11 items-center px-3 text-sm underline" to="/vacancies">Switch to Public Vacancies</Link></nav>}><main id="route-content" tabIndex={-1}><div className="mx-auto max-w-7xl px-4 py-8 md:px-8">{space && spaces && <div className="mb-6 flex flex-wrap items-center gap-3"><label htmlFor="workspace" className="text-sm font-medium">Workspace</label><select id="workspace" aria-label="Workspace" className={field + ' max-w-xs'} value={space.brand_id} onChange={e => void switchSpace(e.target.value)}>{selectorSpaces?.map(row => <option key={row.organization_id + row.brand_id} value={row.brand_id}>{row.organization_name} / {row.brand_name}</option>)}</select><span className="text-xs text-[var(--muted)]">{space.role}</span></div>}{spaceError ? <ErrorState retry={() => void reloadSpaces()}>Could not load workspaces.</ErrorState> : !spaces || exactLoading ? <LoadingState>Loading workspace…</LoadingState> : exact?.key === exactKey && exact.error ? <ErrorState retry={() => setExactRevision(value => value + 1)}>Could not load workspace.</ErrorState> : !space && hasExact ? <NotFound /> : !space ? <SetupScreen reloadSpaces={reloadSpaces} /> : <RecruiterContext.Provider value={{ space, userId: user.id, reloadSpaces }}><Outlet /></RecruiterContext.Provider>}</div></main></ProShell>
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
  const safeTarget = /^\/(recruiter|admin|playbook|dashboard|applications|my-applications|apply|vacancies)(\/|\?|$)/.test(target) ? target : '/recruiter/overview'
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
  const source = new URLSearchParams(location.search)
  const query = new URLSearchParams()
  const allowed = ['organization_id', 'brand_id', 'requisition', 'stage', 'source', 'assignee', 'date_from', 'date_to', 'back', ...(to === '/recruiter/communications' ? ['application_id'] : [])]
  for (const key of allowed) { const value = source.get(key); if (value && value.length <= 1500 && !/[\x00-\x1f]/.test(value)) query.set(key, value) }
  return <Navigate replace to={to + (detail ? '/' + encodeURIComponent(applicationId) : '') + (query.size ? '?' + query : '')} />
}
function LegacyJobsIndex() {
  const location = useLocation()
  return <Navigate replace to={safeBack('/vacancies' + location.search, 'vacancies')} />
}
function LegacyPublicRedirect({ apply = false }: { apply?: boolean }) {
  const { jobId = '' } = useParams()
  const location = useLocation()
  const [result, setResult] = useState<'loading' | 'found' | 'missing' | 'error'>('loading')
  const query = new URLSearchParams(location.search)
  const organizationId = query.get('organization_id')
  const brandId = query.get('brand_id')
  useEffect(() => {
    let live = true
    if (!jobId || ((query.has('organization_id') || query.has('brand_id')) && (!organizationId || !brandId))) { setResult('missing'); return }
    const params = { requisition_id: jobId, ...(organizationId && brandId ? { organization_id: organizationId, brand_id: brandId } : {}) }
    readPublic('get_public_job', params).then(rows => { if (live) setResult(rows.length ? 'found' : 'missing') }).catch(() => { if (live) setResult('error') })
    return () => { live = false }
  }, [jobId, organizationId, brandId])
  if (result === 'loading') return <LoadingState />
  if (result === 'error') return <ErrorState retry={() => window.location.reload()}>Could not open this vacancy.</ErrorState>
  if (result === 'missing') return <NotFound />
  return <Navigate replace to={withBack(apply ? applyUrl(jobId) : vacancyUrl(jobId), safeBack(query.get('back'), 'vacancies'))} />
}
function LegacySettingsRedirect() {
  const context = useContext(RecruiterContext)
  return context?.space.role === 'owner' ? <Navigate replace to={brandSettingsUrl(context.space)} /> : <NotFound />
}
function CommunicationsRoute() {
  const location = useLocation()
  const query = new URLSearchParams(location.search)
  const applicationId = query.get('application_id')
  if (!applicationId) return <CommunicationsScreen />
  query.delete('application_id')
  return <Navigate replace to={`/recruiter/communications/${encodeURIComponent(applicationId)}?${query}`} />
}
export function AppRoutes() {
  const location = useLocation()
  return <><a href="#route-content" className="sr-only focus:not-sr-only">Skip to content</a><RouteFocus /><RouteBoundary key={location.pathname === '/vacancies' || location.pathname === '/recruiter/applications' ? location.pathname : location.pathname + location.search}><Routes>
    <Route element={<PublicShell />}><Route index element={<Navigate replace to="/vacancies" />} /><Route path="vacancies" element={<VacanciesIndexPage />} /><Route path="vacancies/:vacancyId" element={<VacancyDetailPage />} /><Route path="vacancies/:vacancyId/apply" element={<PublicJobs mode="apply" />} /><Route path="jobs" element={<LegacyJobsIndex />} /><Route path="jobs/:jobId" element={<LegacyPublicRedirect />} /><Route path="apply/:jobId" element={<LegacyPublicRedirect apply />} /><Route path="my-applications" element={<CandidateAccount />} /><Route path="my-applications/:applicationId" element={<CandidateAccount />} /><Route path="sign-in" element={<SignIn />} /><Route path="*" element={<NotFound />} /></Route>
    <Route element={<ProtectedShell />}>
      <Route path="recruiter/overview" element={<OverviewScreen />} />
      <Route path="recruiter/vacancies" element={<Allowed roles={['owner','recruiter']}><VacanciesScreen /></Allowed>} />
      <Route path="recruiter/vacancies/:requisitionId" element={<Allowed roles={['owner','recruiter']}><VacanciesScreen /></Allowed>} />
      <Route path="recruiter/applications" element={<Allowed roles={['owner','recruiter','reviewer']}><ApplicationsScreen /></Allowed>} />
      <Route path="recruiter/applications/new" element={<Allowed roles={['owner','recruiter']}><CreateCandidateScreen /></Allowed>} />
      <Route path="recruiter/vacancies/new" element={<Allowed roles={['owner','recruiter']}><CreateVacancyScreen /></Allowed>} />
      <Route path="recruiter/search" element={<Allowed roles={['owner','recruiter','reviewer']}><SearchScreen /></Allowed>} />
      <Route path="recruiter/talent-pool" element={<Allowed roles={['owner','recruiter']}><TalentPoolScreen /></Allowed>} />
      <Route path="recruiter/applications/:applicationId" element={<Allowed roles={['owner','recruiter','reviewer']}><ApplicationScreen /></Allowed>} />
      <Route path="recruiter/communications" element={<Allowed roles={['owner','recruiter']}><CommunicationsRoute /></Allowed>} />
      <Route path="recruiter/communications/:applicationId" element={<Allowed roles={['owner','recruiter']}><CommunicationsScreen /></Allowed>} />
      <Route path="recruiter/playbook" element={<Allowed roles={['owner','recruiter']}><PlaybookScreen /></Allowed>} />
      <Route path="recruiter/operations" element={<Allowed roles={['owner','recruiter']}><OperationsScreen /></Allowed>} />
      <Route path="recruiter/compliance" element={<Allowed roles={['owner','recruiter','auditor']}><ComplianceScreen /></Allowed>} />
      <Route path="recruiter/settings" element={<LegacySettingsRedirect />} />
      <Route path="recruiter/organizations/:organizationId/settings" element={<Allowed roles={['owner']}><SettingsScreen /></Allowed>} />
      <Route path="recruiter/organizations/:organizationId/brands/:brandId/settings" element={<Allowed roles={['owner']}><SettingsScreen /></Allowed>} />
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
