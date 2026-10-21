import { useEffect, useState } from 'react'
import { app, id, read, write, type Attachment, type Scope } from './api'
import { button } from './ui'

export function Attachments({ scope, applicationId, userId, canUpload = true }: { scope: Scope; applicationId: string; userId: string; canUpload?: boolean }) {
  const [rows, setRows] = useState<Attachment[]>([])
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [cleanup, setCleanup] = useState<string | null>(null)
  const params = { organization_id: scope.organization_id, brand_id: scope.brand_id, application_id: applicationId }
  async function refresh() { setRows(await read<Attachment>('list_application_attachments', params)) }
  useEffect(() => { let current = true; read<Attachment>('list_application_attachments', params).then(data => { if (current) setRows(data) }).catch(() => { if (current) setError('Attachments could not be loaded.') }); return () => { current = false } }, [scope.organization_id, scope.brand_id, applicationId])
  async function upload(file: File) {
    setBusy(true); setError('')
    try {
      if (!['application/pdf', 'text/plain'].includes(file.type) || file.size < 1 || file.size > 5 * 1024 * 1024) throw new Error('Choose a PDF or plain text file, up to 5 MB.')
      const attachmentId = id()
      const checksum = [...new Uint8Array(await crypto.subtle.digest('SHA-256', await file.arrayBuffer()))].map(n => n.toString(16).padStart(2, '0')).join('')
      await write('create_application_attachment', { ...params, attachment_id: attachmentId, filename: file.name, mime_type: file.type, size_bytes: file.size, checksum, operation_id: id() })
      await app.storage.upload('intake/' + attachmentId, file, file.type)
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
  return <section className="mt-3 space-y-3"><h4 className="font-medium">Private attachments</h4><p className="text-xs">Files are quarantined. Reviewer downloads remain unavailable until trusted scanning and scoped file serving are configured.</p>{error && <p role="alert">{error}</p>}{canUpload && <label className="block text-sm">Attach a PDF or plain text file (up to 5 MB, three files)<input type="file" accept="application/pdf,text/plain" disabled={busy || rows.length >= 3} onChange={e => { const file = e.target.files?.[0]; if (file) void upload(file); e.target.value = '' }} /></label>}<ul>{rows.map(row => <li key={row.id} className="mt-2 text-sm">{row.filename} · {row.size_bytes} bytes · {row.scan_state}{row.uploader_user_id === userId && <button className={button + ' ml-3'} disabled={busy} onClick={() => remove(row)}>Delete attachment</button>}</li>)}</ul>{cleanup && <button className={button} disabled={busy} onClick={async () => { setBusy(true); try { await app.storage.delete('intake/' + cleanup); setCleanup(null); setError('') } catch { setError('Private file cleanup failed. Retry later.') } finally { setBusy(false) } }}>Retry private file cleanup</button>}</section>
}
