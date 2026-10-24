import { useEffect, useState } from 'react'
import { id, read, write, type Scope } from './api'
import { ErrorState, LoadingState } from './route-ui'
import { Form, MultilineField, TextField, button, panel, val } from './ui'
import { verifyPublicationPasskey } from './passkey'
import { mutationError } from './mutation-state'

type Template = { id: string; name: string; subject: string; body: string; version: number; approved: number }
export function CommunicationTemplates({ scope, canManage }: { scope: Scope; canManage: boolean }) {
  const [rows, setRows] = useState<Template[]>([])
  const [edit, setEdit] = useState<Template | null>(null)
  const [revision, setRevision] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    let active = true
    if (!canManage) return
    setLoading(true); setError('')
    read<Template>('list_communication_templates', scope).then(r => { if (active) setRows(r) }).catch(() => { if (active) setError('Templates could not be loaded.') }).finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [scope.organization_id, scope.brand_id, revision, canManage])
  useEffect(() => { if (message) { const timer = setTimeout(() => setMessage(''), 4000); return () => clearTimeout(timer) } }, [message])
  async function approve(t: Template) {
    setBusy(true); setError('')
    try { await verifyPublicationPasskey(); await write('approve_communication_template', { ...scope, template_id: t.id, expected_version: t.version, operation_id: id() }); setRevision(v => v + 1); setMessage('Template version approved.') }
    catch (e) { setError(mutationError(e)) }
    finally { setBusy(false) }
  }
  async function save(f: FormData) {
    setBusy(true); setError(''); setMessage('')
    try { await write('save_communication_template', { ...scope, template_id: edit?.id ?? id(), expected_version: edit?.version ?? 0, name: val(f, 'name'), subject: val(f, 'subject'), body: val(f, 'body'), operation_id: id() }); setEdit(null); setRevision(v => v + 1); setMessage('Template saved. No email was sent.') }
    catch (e) { setError(mutationError(e)) }
    finally { setBusy(false) }
  }
  return <section className={panel}><h2 className="text-xl font-semibold">Communication templates</h2><p>Brand-scoped text for unsent drafts. Provider is chosen in the approved connector workflow; templates grant no sending authority. Do not put candidate personal data in templates.</p>{!canManage ? <p>Brand-wide owner or recruiter access is required to manage templates.</p> : <>{loading ? <LoadingState /> : <>{!rows.length && <p>No templates saved.</p>}<ul>{rows.map(t => <li key={t.id} className="my-3">{t.name} · version {t.version}<details><summary>Review template text</summary><h3>{t.subject}</h3><p className="whitespace-pre-wrap">{t.body}</p></details> <button className={button} disabled={busy} onClick={() => setEdit(t)}>Edit {t.name}</button> {t.approved ? <span>Approved</span> : <button className={button} disabled={busy} onClick={() => void approve(t)}>Approve version {t.version} (owner)</button>}</li>)}</ul><Form key={edit?.id ?? 'new-' + revision} busy={busy} onSubmit={save} submitLabel={edit ? 'Save template changes' : 'Create template'}><TextField name="name" label="Template name" defaultValue={edit?.name} /><TextField name="subject" label="Template subject" defaultValue={edit?.subject} /><MultilineField name="body" label="Template body" defaultValue={edit?.body} /></Form>{edit && <button className={button} onClick={() => setEdit(null)}>Cancel editing</button>}</>}{error && <ErrorState retry={() => { setEdit(null); setRevision(v => v + 1) }}>{error}</ErrorState>}<p role="status">{message}</p></>}</section>
}
