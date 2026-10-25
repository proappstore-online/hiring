import { CurrentPipeline } from './CurrentPipeline'
import { FunnelAnalytics } from './FunnelAnalytics'
import { TalentPool } from './TalentPool'
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { Link, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { Page, Section, Toolbar } from './design-system'
import { id, read, write, stageLabel, type AgentActivity, type Application, type Audit, type AssignmentEvent, type Communication, type Draft, type Member, type Note, type Requisition, type Run, type StageEvent, type Workspace } from './api'
import { ApplicationFilters } from './ApplicationFilters'
import { WorkspaceSearch } from './WorkspaceSearch'
import { ApplicationDetail } from './ApplicationDetail'
import { AdminCommunications } from './AdminCommunications'
import { PlaybookEditor } from './PlaybookEditor'
import { OperationalDiagnostics } from './OperationalDiagnostics'
import { ErasureRequest } from './ErasureRequest'
import { VacancyManagement, type ManagedVacancy } from './VacancyManagement'
import { Interviews } from './Interviews'
import { Admin, CreateApplication } from './forms'
import { mutationError } from './mutation-state'
import { LoadingState, ErrorState, NotFound } from './route-ui'
import { Form, TextField, val, button, panel } from './ui'
import { diagnosticsSettingsUrl, brandSettingsUrl, organizationSettingsUrl, recruiterApplicationUrl, staffBack } from './routes'

type Context = { space: Workspace; userId: string; reloadSpaces: () => Promise<void> }
export const RecruiterContext = createContext<Context | null>(null)
function useWorkspace() { const value = useContext(RecruiterContext); if (!value) throw Error('Workspace context missing'); return value }
function scopeOf(space: Workspace) { return { organization_id: space.organization_id, brand_id: space.brand_id } }
function Screen({ title, children, action }: { title: string; children: ReactNode; action?: ReactNode }) { return <Page title={title} action={action}>{children}</Page> }
function useRows<T>(name: string | null, params: Record<string, string>) {
  const [state, setState] = useState<{ rows: T[]; loading: boolean; error: boolean }>({ rows: [], loading: true, error: false })
  const [revision, setRevision] = useState(0)
  const key = JSON.stringify([name, params])
  useEffect(() => { let live = true; if (!name) { setState({ rows: [], loading: false, error: false }); return () => { live = false } } setState({ rows: [], loading: true, error: false }); read<T>(name, params).then(rows => { if (live) setState({ rows, loading: false, error: false }) }).catch(() => { if (live) setState({ rows: [], loading: false, error: true }) }); return () => { live = false } }, [key, revision])
  return { ...state, retry: () => setRevision(value => value + 1) }
}
function RowsState({ loading, error, retry, children }: { loading: boolean; error: boolean; retry: () => void; children: ReactNode }) { return loading ? <LoadingState /> : error ? <ErrorState retry={retry} /> : <>{children}</> }
export function OverviewScreen() { const { space } = useWorkspace(); return <Screen title="Overview"><Section title="Workspace"><p className="mt-2">{space.organization_name} / {space.brand_name}</p><p className="mt-2">Your role: {space.role}</p></Section><CurrentPipeline key={"pipeline:" + JSON.stringify(space)} scope={scopeOf(space)} role={space.role} /><FunnelAnalytics key={JSON.stringify(space)} scope={scopeOf(space)} /></Screen> }
export function VacanciesScreen() {
  const { space } = useWorkspace(); const { requisitionId = '' } = useParams(); const scope = scopeOf(space)
  const detail = useRows<ManagedVacancy>(requisitionId ? 'get_vacancy_management' : null, { ...scope, requisition_id: requisitionId })
  if (requisitionId && !detail.loading && !detail.error && !detail.rows.length) return <NotFound />
  return <Screen title="Vacancies" action={!requisitionId && Boolean(space.can_create_requisition) && <Link className={button} to={'/recruiter/vacancies/new?' + new URLSearchParams(scope)}>Add requisition</Link>}><RowsState {...detail}><VacancyManagement key={space.brand_id + requisitionId} scope={scope} role={space.role as 'owner' | 'recruiter'} requisitions={detail.rows.map(({ id, title, status }) => ({ id, title, status }))} selectedRequisitionId={requisitionId} selectedVacancy={detail.rows[0]} /></RowsState></Screen>
}
export function ApplicationsScreen() {
  const { space } = useWorkspace(); const scope = scopeOf(space)
  const staff = space.role === 'owner' || space.role === 'recruiter'
  const requisitions = useRows<Requisition>(staff ? 'list_requisitions' : null, scope); const members = useRows<Member>(staff ? 'list_workspace_members' : null, scope)
  return <RowsState key={JSON.stringify(scope)} loading={requisitions.loading || members.loading} error={requisitions.error || members.error} retry={() => { requisitions.retry(); members.retry() }}><ApplicationFilters key={space.brand_id + space.role} space={space} requisitions={requisitions.rows} members={members.rows} /></RowsState>
}
export function CreateCandidateScreen() {
  const { space, userId } = useWorkspace(); const scope = scopeOf(space); const navigate = useNavigate()
  const requisitions = useRows<Requisition>('list_requisitions', scope); const members = useRows<Member>('list_workspace_members', scope)
  const [busy, setBusy] = useState(false); const [error, setError] = useState('')
  const run: Run = async (name, params) => { setBusy(true); setError(''); try { await write(name, params); navigate('/recruiter/applications?' + new URLSearchParams(scope), { replace: true, state: { createdApplicationId: String(params.application_id) } }) } catch (e) { setError(mutationError(e)) } finally { setBusy(false) } }
  const back = '/recruiter/applications?' + new URLSearchParams(scope)
  useEffect(() => { const cancel = (event: KeyboardEvent) => { if (event.key === 'Escape' && !busy) navigate(back) }; document.addEventListener('keydown', cancel); return () => document.removeEventListener('keydown', cancel) }, [back, busy, navigate])
  return <Screen title="Add candidate"><Link className="underline" to={'/recruiter/applications?' + new URLSearchParams(scope)}>All applications</Link>{error && <p role="alert">{error}</p>}<RowsState key={JSON.stringify(scope)} loading={requisitions.loading || members.loading} error={requisitions.error || members.error} retry={() => { requisitions.retry(); members.retry() }}><CreateApplication key={members.rows.map(row => row.user_id).join()} scope={scope} requisitions={requisitions.rows} members={members.rows} userId={userId} busy={busy} run={run} /></RowsState></Screen>
}
export function SearchScreen() { const { space, userId } = useWorkspace(); return <Screen title="Search records"><WorkspaceSearch key={JSON.stringify([userId, space])} scope={scopeOf(space)} reviewer={space.role === 'reviewer'} /></Screen> }
export function TalentPoolScreen() { const { space } = useWorkspace(); return <Screen title="Talent pool"><TalentPool key={JSON.stringify(space)} scope={scopeOf(space)} /></Screen> }
export function CreateVacancyScreen() {
  const { space } = useWorkspace(); const scope = scopeOf(space); const navigate = useNavigate()
  const [busy, setBusy] = useState(false); const [error, setError] = useState('')
  if (!space.can_create_requisition) return <NotFound />
  return <Screen title="Add requisition"><Link className="underline" to={'/recruiter/vacancies?' + new URLSearchParams(scope)}>All managed vacancies</Link>{error && <p role="alert">{error}</p>}<Form busy={busy} submitLabel="Create requisition" onSubmit={async f => { setBusy(true); setError(''); const requisitionId = id(); try { await write('create_requisition', { ...scope, requisition_id: requisitionId, title: val(f, 'title'), operation_id: id() }); navigate('/recruiter/vacancies/' + encodeURIComponent(requisitionId) + '?' + new URLSearchParams(scope)) } catch (e) { setError(mutationError(e)) } finally { setBusy(false) } }}><TextField name="title" label="Role title" /></Form></Screen>
}
export function ApplicationScreen() {
  const { space } = useWorkspace(); const { applicationId = '' } = useParams(); const scope = scopeOf(space); const params = { ...scope, application_id: applicationId }
  const [query] = useSearchParams()
  const back = staffBack(query.get('back'), scope, 'applications')
  const staff = space.role === 'owner' || space.role === 'recruiter'
  const full = useRows<Application>(staff ? 'get_application' : null, params)
  const fallback = useRows<Pick<Application, 'id' | 'candidate_name' | 'requisition_title' | 'stage'>>(staff ? null : 'gateway_get_application', params)
  if (full.loading || fallback.loading) return <LoadingState>Loading application…</LoadingState>
  if (full.error || fallback.error) return <ErrorState retry={() => { full.retry(); fallback.retry() }}>Could not load application.</ErrorState>
  if (full.rows[0]) return <FullApplicationScreen application={full.rows[0]} applicationId={applicationId} retryApplication={full.retry} />
  if (!fallback.rows[0]) return <NotFound />
  return <Screen title="Application details"><Link className="underline" to={back}>All applications</Link><Interviews key={applicationId} scope={scope} applicationId={applicationId} /><section className={panel}><h2 className="text-xl font-semibold">{fallback.rows[0].candidate_name}</h2><p>{fallback.rows[0].requisition_title} · {stageLabel(fallback.rows[0].stage)}</p><p>This record provides a restricted summary. Your role does not permit full contact or history access.</p></section></Screen>
}
function FullApplicationScreen({ application, applicationId, retryApplication }: { application: Application; applicationId: string; retryApplication: () => void }) {
  const { space } = useWorkspace(); const scope = scopeOf(space); const params = { ...scope, application_id: applicationId }
  const [query] = useSearchParams()
  const [copyMessage, setCopyMessage] = useState('')
  const members = useRows<Member>('list_workspace_members', scope)
  const notes = useRows<Note>('list_application_notes', params)
  const activities = useRows<AgentActivity>('list_application_agent_activity', params); const events = useRows<StageEvent>('list_stage_events', params); const assignments = useRows<AssignmentEvent>('list_assignment_events', params); const audit = useRows<Audit>('list_application_audit', params); const drafts = useRows<Draft>('list_communication_drafts', params); const communications = useRows<Communication>('list_application_communications', params)
  const [busy, setBusy] = useState(false); const [error, setError] = useState(''); const [success, setSuccess] = useState('')
  const run: Run = async (name, values) => { setBusy(true); setError(''); setSuccess(''); try { await write(name, values); retryApplication(); retryDetail(); setSuccess('Action saved successfully.') } catch (e) { setError(mutationError(e)) } finally { setBusy(false) } }
  const history = [notes, activities, events, assignments, audit, drafts, communications]
  const retryDetail = () => { notes.retry(); activities.retry(); events.retry(); assignments.retry(); audit.retry(); drafts.retry(); communications.retry() }
  if (members.loading) return <LoadingState>Loading application…</LoadingState>
  if (members.error) return <ErrorState retry={members.retry}>Could not load application.</ErrorState>
  return <Screen title="Application details"><Toolbar label="Application navigation"><Link className="underline" to={staffBack(query.get('back'), scope, 'applications')}>All applications</Link><button className="ml-3 underline" onClick={() => void navigator.clipboard.writeText(new URL(recruiterApplicationUrl(applicationId, scope) + (query.get('view') ? '&view=' + encodeURIComponent(query.get('view')!) : ''), window.location.origin).href).then(() => setCopyMessage('Internal link copied.')).catch(() => setCopyMessage('Could not copy the link.'))}>Copy internal link</button></Toolbar>{copyMessage && <p role="status">{copyMessage}</p>}{error && <p role="alert">{error}</p>}{success && <p role="status">{success}</p>}{history.some(row => row.loading) ? <LoadingState>Loading application history…</LoadingState> : history.some(row => row.error) ? <ErrorState retry={retryDetail}>Could not load application history.</ErrorState> : <ApplicationDetail key={applicationId} role={space.role} retryDetail={retryDetail} a={application} scope={scope} members={members.rows} notes={notes.rows} activities={activities.rows} events={events.rows} assignments={assignments.rows} audit={audit.rows} drafts={drafts.rows} communications={communications.rows} busy={busy} run={run} />}</Screen>
}
export function CommunicationsScreen() {
  const { space } = useWorkspace(); const scope = scopeOf(space); const { applicationId = '' } = useParams()
  const data = useRows<Application>('list_applications', scope)
  const exact = useRows<Application>(applicationId ? 'get_application' : null, { ...scope, application_id: applicationId })
  const applications = exact.rows[0] ? [exact.rows[0], ...data.rows.filter(row => row.id !== applicationId)] : data.rows
  if (applicationId && !exact.loading && !exact.error && !exact.rows.length) return <NotFound />
  return <RowsState loading={data.loading || exact.loading} error={data.error || exact.error} retry={() => { data.retry(); exact.retry() }}><AdminCommunications scope={scope} brandName={space.brand_name} applications={applications} canManageTemplates={Boolean(space.can_manage_templates)} /></RowsState>
}
export function PlaybookScreen() { const { space } = useWorkspace(); return <Screen title="Playbook"><PlaybookEditor organizationId={space.organization_id} role={space.role} isCreator={Boolean(space.can_create_brand)} /></Screen> }
export function OperationsScreen() { const { space } = useWorkspace(); return <Page title="Settings"><SettingsNavigation /><OperationalDiagnostics scope={scopeOf(space)} /></Page> }
export function ComplianceScreen() { const { space } = useWorkspace(); return <ErasureRequest key={space.organization_id + ':' + space.brand_id} scope={scopeOf(space)} role={space.role} /> }
export function SettingsScreen() {
  const { space, reloadSpaces } = useWorkspace(); const [busy, setBusy] = useState(false); const [error, setError] = useState(''); const [success, setSuccess] = useState('')
  const location = useLocation()
  const run: Run = async (name, params) => { setBusy(true); setError(''); setSuccess(''); try { await write(name, params); await reloadSpaces(); setSuccess('Action saved successfully.') } catch (e) { setError(mutationError(e)) } finally { setBusy(false) } }
  const organizationPath = organizationSettingsUrl(space.organization_id)
  if (location.pathname === organizationPath && !space.can_create_brand) return <NotFound />
  return <Screen title="Settings"><SettingsNavigation />{error && <p role="alert">{error}</p>}{success && <p role="status">{success}</p>}<Admin onChanged={reloadSpaces} scope={scopeOf(space)} role={space.role} organizationName={space.organization_name} canCreateBrand={Boolean(space.can_create_brand)} busy={busy} run={run} managementScope={location.pathname === organizationPath ? 'organization' : 'brand'} /></Screen>
}

function SettingsNavigation() {
  const { space } = useWorkspace(); const location = useLocation()
  const links = [
    ...(space.role === 'owner' ? [{ to: brandSettingsUrl(space), label: 'Brand management' }] : []),
    ...(space.role === 'owner' && space.can_create_brand ? [{ to: organizationSettingsUrl(space.organization_id), label: 'Organisation management' }] : []),
    { to: diagnosticsSettingsUrl(scopeOf(space)), label: 'Operations' },
  ]
  return <nav aria-label="Management scope" className="my-4 flex flex-wrap gap-4">{links.map(link => <Link key={link.to} className="underline" aria-current={location.pathname === link.to.split('?')[0] ? 'page' : undefined} to={link.to}>{link.label}</Link>)}</nav>
}
