import { useEffect, useState } from 'react'
import { app, id, read, write, type Attachment, type Scope } from './api'
import { button } from './ui'

type AttachmentProps = { scope: Scope; applicationId: string; userId: string; canUpload?: boolean; canRelease?: boolean }
export function Attachments(props: AttachmentProps) {
  // Remount on every identity/scope change so old reads and mutations cannot
  // populate the next application's attachment list or cleanup controls.
  return <ScopedAttachments key={JSON.stringify([props.scope.organization_id, props.scope.brand_id, props.applicationId, props.userId, props.canUpload, props.canRelease])} {...props} />
}
function ScopedAttachments({ scope, applicationId, userId, canUpload = true, canRelease = false }: AttachmentProps) {
  const [rows, setRows] = useState<Attachment[]>([])
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [cleanup, setCleanup] = useState<string | null>(null)
  const [uploadAllowed, setUploadAllowed] = useState<boolean | null>(null)
  const params = { organization_id: scope.organization_id, brand_id: scope.brand_id, application_id: applicationId }
  async function refresh() { setRows(await read<Attachment>('list_application_attachments', params)) }
  useEffect(() => { let current = true; read<Attachment>('list_application_attachments', params).then(data => { if (current) setRows(data) }).catch(() => { if (current) setError('Attachments could not be loaded.') }); return () => { current = false } }, [scope.organization_id, scope.brand_id, applicationId])
  useEffect(() => { if (!canUpload) return; let current = true; setUploadAllowed(null); read<{ allow_candidate_file_uploads: number }>('get_candidate_upload_settings', params).then(rows => { if (current) setUploadAllowed(rows[0]?.allow_candidate_file_uploads === 1) }).catch(() => { if (current) setError('Upload settings could not be loaded. Refresh to retry.') }); return () => { current = false } }, [scope.organization_id, scope.brand_id, applicationId, canUpload])
  async function upload(file: File) {
    setBusy(true); setError('')
    try {
      const settings = await read<{ allow_candidate_file_uploads: number }>('get_candidate_upload_settings', params)
      if (settings[0]?.allow_candidate_file_uploads !== 1) { setUploadAllowed(false); throw new Error('Candidate file uploads are disabled for this organization.') }
      if (!['application/pdf', 'text/plain'].includes(file.type) || file.size < 1 || file.size > 5 * 1024 * 1024) throw new Error('Choose a PDF or plain text file, up to 5 MB.')
      const attachmentId = id()
      const checksum = [...new Uint8Array(await crypto.subtle.digest('SHA-256', await file.arrayBuffer()))].map(n => n.toString(16).padStart(2, '0')).join('')
      await write('create_application_attachment', { ...params, attachment_id: attachmentId, filename: file.name, mime_type: file.type, size_bytes: file.size, checksum, operation_id: id() })
      await app.storage.upload('intake/' + attachmentId, file, file.type)
      await write('complete_application_attachment_upload', { ...params, attachment_id: attachmentId, operation_id: id() })
      await refresh()
    } catch (e) { setError(e instanceof Error ? e.message : 'Upload failed. Refresh the list before retrying; a reserved attachment may remain pending.') } finally { setBusy(false) }
  }
  async function remove(row: Attachment) {
    setBusy(true); setError('')
    try {
      // Deny application access before object cleanup. Never make a private file public.
      await write('delete_application_attachment', { ...params, attachment_id: row.id, operation_id: id() })
      setCleanup(row.id)
      await app.storage.delete('intake/' + row.id)
      setCleanup(null); await refresh()
    } catch { setError('Removal could not be completed. Retry private file cleanup below if available.'); await refresh().catch(() => {}) } finally { setBusy(false) }
  }
  async function release(row: Attachment) {
    setBusy(true); setError('')
    try { await write('release_application_attachment', { ...params, attachment_id: row.id, operation_id: id() }); await refresh() }
    catch (e) { setError(e instanceof Error ? e.message : 'Release failed. Refresh and check your access.'); await refresh().catch(() => {}) }
    finally { setBusy(false) }
  }
  return <section aria-label="Private attachments" className="mt-3 space-y-3"><h4 className="font-medium">Private attachments</h4><p className="text-xs">Uploads stay quarantined until a brand owner releases them. Staff byte downloads remain unavailable until scoped file serving is configured.</p>{error && <p role="alert">{error}</p>}{canUpload && uploadAllowed === false && <p>Candidate file uploads are disabled for this organization. Existing files remain listed below.</p>}{canUpload && uploadAllowed === true && <label className="block text-sm">Attach a PDF or plain text file (up to 5 MB, three files)<input type="file" accept="application/pdf,text/plain" disabled={busy || rows.length >= 3} onChange={e => { const file = e.target.files?.[0]; if (file) void upload(file); e.target.value = '' }} /></label>}<ul>{rows.map(row => <li key={row.id} className="mt-2 text-sm">{row.filename} · {row.size_bytes} bytes · {row.review_status}{canRelease && row.review_status === 'pending_review' && row.uploaded_at !== null && <button className={button + ' ml-3'} disabled={busy} aria-label={'Release attachment ' + row.filename} onClick={() => release(row)}>Release</button>}{row.uploader_user_id === userId && <button className={button + ' ml-3'} disabled={busy} aria-label={'Delete attachment ' + row.filename} onClick={() => remove(row)}>Delete attachment</button>}</li>)}</ul>{cleanup && <button className={button} disabled={busy} onClick={async () => { setBusy(true); try { await app.storage.delete('intake/' + cleanup); setCleanup(null); setError('') } catch { setError('Private file cleanup failed. Retry later.') } finally { setBusy(false) } }}>Retry private file cleanup</button>}</section>
}
