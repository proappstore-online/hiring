import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { Link, useLocation, useParams, useSearchParams } from 'react-router-dom'
import { PageHeader } from '@proappstore/sdk'
import { read, write, stageLabel, type AgentActivity, type Application, type Audit, type AssignmentEvent, type Member, type Note, type Requisition, type Run, type StageEvent, type Workspace } from './api'
import { ApplicationFilters } from './ApplicationFilters'
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
import { button, panel } from './ui'
import { brandSettingsUrl, organizationSettingsUrl, recruiterApplicationUrl, staffBack } from './routes'

type Context = { space: Workspace; userId: string; reloadSpaces: () => Promise<void> }
export const RecruiterContext = createContext<Context | null>(null)
function useWorkspace() { const value = useContext(RecruiterContext); if (!value) throw Error('Workspace context missing'); return value }
function scopeOf(space: Workspace) { return { organization_id: space.organization_id, brand_id: space.brand_id } }
function Screen({ title, children }: { title: string; children: ReactNode }) { return <><PageHeader title={title} /><div className="mt-5">{children}</div></> }
function useRows<T>(name: string | null, params: Record<string, string>) {
  const [state, setState] = useState<{ rows: T[]; loading: boolean; error: boolean }>({ rows: [], loading: true, error: false })
  const [revision, setRevision] = useState(0)
  const key = JSON.stringify([name, params])
  useEffect(() => { let live = true; if (!name) { setState({ rows: [], loading: false, error: false }); return () => { live = false } } setState({ rows: [], loading: true, error: false }); read<T>(name, params).then(rows => { if (live) setState({ rows, loading: false, error: false }) }).catch(() => { if (live) setState({ rows: [], loading: false, error: true }) }); return () => { live = false } }, [key, revision])
  return { ...state, retry: () => setRevision(value => value + 1) }
}
function RowsState({ loading, error, retry, children }: { loading: boolean; error: boolean; retry: () => void; children: ReactNode }) { return loading ? <LoadingState /> : error ? <ErrorState retry={retry} /> : <>{children}</> }
export function OverviewScreen() { const { space } = useWorkspace(); return <Screen title="Overview"><section className={panel}><h2 className="text-xl font-semibold">Overview</h2><p className="mt-2">{space.organization_name} / {space.brand_name}</p><p className="mt-2">Your role: {space.role}</p></section></Screen> }
export function VacanciesScreen() {
  const { space } = useWorkspace(); const { requisitionId = '' } = useParams(); const scope = scopeOf(space)
  const detail = useRows<ManagedVacancy>(requisitionId ? 'get_vacancy_management' : null, { ...scope, requisition_id: requisitionId })
  if (requisitionId && !detail.loading && !detail.error && !detail.rows.length) return <NotFound />
  return <Screen title="Vacancies"><RowsState {...detail}><VacancyManagement key={space.brand_id + requisitionId} scope={scope} role={space.role as 'owner' | 'recruiter'} requisitions={detail.rows.map(({ id, title, status }) => ({ id, title, status }))} selectedRequisitionId={requisitionId} selectedVacancy={detail.rows[0]} /></RowsState></Screen>
}
export function ApplicationsScreen() {
  const { space, userId } = useWorkspace(); const scope = scopeOf(space)
  const staff = space.role === 'owner' || space.role === 'recruiter'
  const requisitions = useRows<Requisition>(staff ? 'list_requisitions' : null, scope); const members = useRows<Member>(staff ? 'list_workspace_members' : null, scope)
  const [busy, setBusy] = useState(false); const [error, setError] = useState(''); const [success, setSuccess] = useState(''); const [showCreate, setShowCreate] = useState(false)
  const run: Run = async (name, params) => { setBusy(true); setError(''); setSuccess(''); try { await write(name, params); setSuccess('Action saved successfully.'); if (name === 'create_application') setShowCreate(false) } catch (e) { setError(mutationError(e)) } finally { setBusy(false) } }
  return <Screen title="Applications"><RowsState loading={requisitions.loading || members.loading} error={requisitions.error || members.error} retry={() => { requisitions.retry(); members.retry() }}><div className="space-y-6">{error && <p role="alert">{error}</p>}{success && <p role="status">{success}</p>}<div className="flex flex-wrap items-center justify-between gap-3"><p className="text-sm text-[var(--muted)]">Review candidates, narrow the pipeline, then open a profile for the full record.</p>{staff && <button type="button" className={button} aria-expanded={showCreate} aria-controls="create-candidate" onClick={() => setShowCreate(value => !value)}>{showCreate ? 'Close' : 'Add candidate'}</button>}</div><ApplicationFilters key={space.brand_id + space.role} space={space} requisitions={requisitions.rows} members={members.rows} />{staff && showCreate && <div id="create-candidate"><CreateApplication key={members.rows.map(row => row.user_id).join()} scope={scope} requisitions={requisitions.rows} members={members.rows} userId={userId} busy={busy} run={run} /></div>}</div></RowsState></Screen>
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
  const activities = useRows<AgentActivity>('list_application_agent_activity', params); const events = useRows<StageEvent>('list_stage_events', params); const assignments = useRows<AssignmentEvent>('list_assignment_events', params); const audit = useRows<Audit>('list_application_audit', params)
  const [busy, setBusy] = useState(false); const [error, setError] = useState(''); const [success, setSuccess] = useState('')
  const run: Run = async (name, values) => { setBusy(true); setError(''); setSuccess(''); try { await write(name, values); retryApplication(); setSuccess('Action saved successfully.') } catch (e) { setError(mutationError(e)) } finally { setBusy(false) } }
  const history = [notes, activities, events, assignments, audit]
  const retryDetail = () => { notes.retry(); activities.retry(); events.retry(); assignments.retry(); audit.retry() }
  if (members.loading) return <LoadingState>Loading application…</LoadingState>
  if (members.error) return <ErrorState retry={members.retry}>Could not load application.</ErrorState>
  return <Screen title="Application details"><Link className="underline" to={staffBack(query.get('back'), scope, 'applications')}>All applications</Link><button className="ml-3 underline" onClick={() => void navigator.clipboard.writeText(new URL(recruiterApplicationUrl(applicationId, scope), window.location.origin).href).then(() => setCopyMessage('Internal link copied.')).catch(() => setCopyMessage('Could not copy the link.'))}>Copy internal link</button><p role="status">{copyMessage}</p>{error && <p role="alert">{error}</p>}{success && <p role="status">{success}</p>}{history.some(row => row.loading) ? <LoadingState>Loading application history…</LoadingState> : history.some(row => row.error) ? <ErrorState retry={retryDetail}>Could not load application history.</ErrorState> : <ApplicationDetail key={applicationId} role={space.role} retryDetail={retryDetail} a={application} scope={scope} members={members.rows} notes={notes.rows} activities={activities.rows} events={events.rows} assignments={assignments.rows} audit={audit.rows} busy={busy} run={run} />}</Screen>
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
export function OperationsScreen() { const { space } = useWorkspace(); return <OperationalDiagnostics scope={scopeOf(space)} /> }
export function ComplianceScreen() { const { space } = useWorkspace(); return <ErasureRequest key={space.organization_id + ':' + space.brand_id} scope={scopeOf(space)} role={space.role} /> }
export function SettingsScreen() {
  const { space, reloadSpaces } = useWorkspace(); const [busy, setBusy] = useState(false); const [error, setError] = useState(''); const [success, setSuccess] = useState('')
  const location = useLocation()
  const run: Run = async (name, params) => { setBusy(true); setError(''); setSuccess(''); try { await write(name, params); await reloadSpaces(); setSuccess('Action saved successfully.') } catch (e) { setError(mutationError(e)) } finally { setBusy(false) } }
  const brandPath = brandSettingsUrl(space), organizationPath = organizationSettingsUrl(space.organization_id)
  if (location.pathname === organizationPath && !space.can_create_brand) return <NotFound />
  return <Screen title="Settings"><nav aria-label="Management scope" className="mb-4 flex gap-4"><Link className="underline" aria-current={location.pathname === brandPath ? 'page' : undefined} to={brandPath}>Brand management</Link>{Boolean(space.can_create_brand) && <Link className="underline" aria-current={location.pathname === organizationPath ? 'page' : undefined} to={organizationPath}>Organisation management</Link>}</nav>{error && <p role="alert">{error}</p>}{success && <p role="status">{success}</p>}<Admin onChanged={reloadSpaces} scope={scopeOf(space)} role={space.role} organizationName={space.organization_name} canCreateBrand={Boolean(space.can_create_brand)} canCreateRequisition={Boolean(space.can_create_requisition)} busy={busy} run={run} managementScope={location.pathname === organizationPath ? 'organization' : 'brand'} /></Screen>
}
