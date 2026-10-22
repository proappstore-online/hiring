import { useEffect, useState } from 'react'
import { getOrgRecruitingPlaybook, saveOrgRecruitingPlaybook, type Role } from './api'
import { meetingTiming, parsePlaybook, type Playbook } from './playbook'
import { button, field, panel } from './ui'
export function PlaybookEditor({ organizationId, role, isCreator }: { organizationId: string; role: Role; isCreator: boolean }) {
  const [book, setBook] = useState<Playbook | null>(null)
  const [text, setText] = useState('{}')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [confirmed, setConfirmed] = useState(false)
  const [status, setStatus] = useState('')
  const [reload, setReload] = useState(0)
  useEffect(() => {
    let live = true
    setBook(null); setError(''); setConfirmed(false)
    getOrgRecruitingPlaybook(organizationId).then(rows => {
      if (!live) return
      if (!rows[0]) throw Error('Playbook access denied.')
      const payload = parsePlaybook(rows[0].payload)
      setText(JSON.stringify(payload, null, 2)); setBook(rows[0])
    }).catch(() => { if (live) setError('Playbook could not be loaded. Check organisation access and retry.') })
    return () => { live = false }
  }, [organizationId, reload])
  const timing = book ? meetingTiming(parsePlaybook(book.payload)) : null
  return <section className={panel + ' min-w-0'} aria-labelledby="playbook-title"><h1 id="playbook-title" className="text-2xl font-semibold">Recruiting playbook</h1>
    {error && <p role="alert">{error}</p>}{status && <p role="status">{status}</p>}
    <button className={button} disabled={busy} onClick={() => setReload(n => n + 1)}>Reload playbook</button>
    {!book ? !error && <p role="status">Loading playbook…</p> : <>
      <p className="my-3 font-semibold">Playbook version {book.version}</p>
      {!book.version && <p>No playbook configured — contact your administrator before issuing invitations.</p>}
      {!timing && <p role="status">Daily meeting time not configured — contact your administrator before issuing working-interview invitations. Use HH:mm and an IANA timezone.</p>}
      <p>Secure join configuration cannot be verified from this redacted view. Confirm it privately with your administrator. Join details are sent privately.</p>
      {role === 'owner' && isCreator ? <form className="mt-4 space-y-3" onSubmit={async e => {
        e.preventDefault(); setError(''); setStatus(''); setBusy(true)
        try { parsePlaybook(text); await saveOrgRecruitingPlaybook(organizationId, text, book.version); setStatus('Playbook saved.'); setReload(n => n + 1) }
        catch (e) { setError(String(e)) } finally { setBusy(false) }
      }}><label className="block">Playbook JSON<textarea className={field + ' min-h-80 font-mono'} value={text} onChange={e => setText(e.target.value)} required /></label>
        <p>Saving replaces the complete policy. Secret fields are omitted from reads, including owner reads. Re-enter all required secret references before saving; otherwise they will be removed.</p>
        <label className="block"><input type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)} /> I have restored required secret references and reviewed the complete replacement policy.</label>
        <button className={button} disabled={busy || !confirmed}>Save new version</button></form> : <><p>Read-only — only the organisation creator with owner access can edit.</p><pre className="mt-4 whitespace-pre-wrap break-all text-sm">{JSON.stringify(parsePlaybook(book.payload), null, 2)}</pre></>}
    </>}
  </section>
}
