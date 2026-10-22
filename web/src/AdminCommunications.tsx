import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { id, read, write, type Application, type Communication, type Draft, type Scope } from './api'
import { Communications } from './Communications'
import { CommunicationTemplates } from './CommunicationTemplates'
import { ErrorState, LoadingState } from './route-ui'
import { Form, MultilineField, TextField, button, field, panel, val } from './ui'
import { mutationError } from './mutation-state'
import { recruiterApplicationUrl } from './routes'

export function AdminCommunications({ scope, brandName, applications, canManageTemplates }: { scope: Scope; brandName: string; applications: Application[]; canManageTemplates: boolean }) {
  const navigate = useNavigate()
  const { applicationId = '' } = useParams()
  const application = applications.find(a => a.id === applicationId)
  return <div className="space-y-5"><section className={panel}><h1 className="text-2xl font-semibold">Communications — {brandName}</h1><p>Drafts and history are limited to authorized applications. Sending remains in the approved connector workflow. Showing the currently loaded application list.</p>{applicationId && <p className="my-2"><Link className="underline" to={recruiterApplicationUrl(applicationId, scope)}>Back to application</Link></p>}<label>Application<select className={field} value={applicationId} onChange={e => navigate('/recruiter/communications' + (e.target.value ? '/' + encodeURIComponent(e.target.value) : '') + '?' + new URLSearchParams(scope))}><option value="">Select an application</option>{applications.map(a => <option key={a.id} value={a.id}>{a.requisition_title} · {a.candidate_name}</option>)}</select></label>{application ? <ApplicationCommunications key={JSON.stringify([scope,applicationId])} scope={scope} brandName={brandName} application={application} /> : <p>{applicationId ? 'Application unavailable in your current scope.' : 'Select an application to view its drafts and history.'}</p>}</section><CommunicationTemplates scope={scope} canManage={canManageTemplates} /></div>
}
function ApplicationCommunications({ scope, brandName, application }: { scope: Scope; brandName: string; application: Application }) {
  const [data, setData] = useState<{ drafts: Draft[]; communications: Communication[] } | null>(null)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [revision, setRevision] = useState(0)
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    let active = true
    setData(null); setError('')
    const params = { ...scope, application_id: application.id }
    Promise.all([read<Draft>('list_communication_drafts', params), read<Communication>('list_application_communications', params)]).then(([drafts, communications]) => { if (active) setData({ drafts, communications }) }).catch(() => { if (active) setError('Communication records could not be loaded.') })
    return () => { active = false }
  }, [scope.organization_id, scope.brand_id, application.id, revision])
  useEffect(() => { if (message) { const timer = setTimeout(() => setMessage(''), 4000); return () => clearTimeout(timer) } }, [message])
  async function save(f: FormData) {
    setBusy(true); setError(''); setMessage('')
    try { await write('create_communication_draft', { ...scope, application_id: application.id, draft_id: id(), recipient_email: application.email, subject: val(f,'subject'), body: val(f,'body'), operation_id: id() }); setMessage('Draft saved. No email was sent.'); setRevision(r => r + 1) }
    catch (e) { setError(mutationError(e)) }
    finally { setBusy(false) }
  }
  return <><button className={button + ' my-3'} onClick={() => setRevision(r => r + 1)}>Refresh communication records</button>{error ? <ErrorState retry={() => setRevision(r => r + 1)}>{error}</ErrorState> : !data ? <LoadingState /> : <Communications scope={scope} applicationId={application.id} brandName={brandName} {...data} />}{application.email && <Form busy={busy} onSubmit={save} submitLabel="Save unsent draft"><p>To: {application.email}</p><TextField name="subject" label="Subject" /><MultilineField name="body" label="Draft body" /></Form>}<p role="status">{message}</p></>
}
