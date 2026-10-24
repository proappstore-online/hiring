import { useEffect, useState } from 'react'
import { app, createWorkingInterviewInvitation, getOrgRecruitingPlaybook, getWorkingInterviewRecords, recordWorkingInterviewOutcome, type Application, type Role, type Scope } from './api'
import { composeInvitation, parsePlaybook, type Playbook, type WorkingInterviewRecord } from './playbook'
import { button, field, panel } from './ui'
export function WorkingInterviewInvitation({ a, scope, role }: { a: Application; scope: Scope; role: Role }) {
  const [records, setRecords] = useState<WorkingInterviewRecord[]>([])
  const [book, setBook] = useState<Playbook | null>(null)
  const [error, setError] = useState('')
  const [owner, setOwner] = useState(a.assignee_user_id ?? '')
  const [confirmed, setConfirmed] = useState(false)
  const [busy, setBusy] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const [reload, setReload] = useState(0)
  const allowed = role === 'owner' || role === 'recruiter'
  useEffect(() => {
    if (!allowed) return
    let live = true
    setBook(null); setRecords([]); setError(''); setLoaded(false); setConfirmed(false)
    Promise.all([getOrgRecruitingPlaybook(scope.organization_id), getWorkingInterviewRecords(scope, a.id)]).then(([books, rows]) => {
      if (!live) return
      if (books[0]) parsePlaybook(books[0].payload)
      setBook(books[0] ?? null); setRecords(rows); setLoaded(true)
    }).catch(() => { if (live) setError('Could not load working interview records or playbook. Reload before continuing.') })
    return () => { live = false }
  }, [scope.organization_id, scope.brand_id, a.id, allowed, reload])
  if (!allowed) return null
  const invitation = book ? composeInvitation(a.candidate_name, parsePlaybook(book.payload)) : ''
  async function save(action: () => Promise<WorkingInterviewRecord[]>) {
    setBusy(true); setError('')
    try { setRecords(await action()) } catch { setError('Save could not be confirmed. Reload and check access, policy configuration or version conflicts.') }
    finally { setBusy(false) }
  }
  return <section className={panel} aria-labelledby="working-title"><h3 id="working-title" className="font-semibold">Working interview</h3>
    <p>Invitations and outcomes are saved with versioned audit evidence. This form does not send email. Use the approved mail workflow to send invitations; keep secure join details out of this record.</p>
    <button className={button} disabled={busy} onClick={() => setReload(n => n + 1)}>Reload working interview</button>
    {error && <p role="alert">{error}</p>}
    {!loaded ? <p role="status">Working interview unavailable until records load.</p> : <>
    {!records.length && <p>No working interview recorded</p>}
    {records.map(record => <div key={record.id} className="mt-4">
      <p>Invitation playbook version {record.playbook_version}</p><p>Record version {record.version}</p>
      <p>Owner: {record.owner_user_id} · Sent: {new Date(record.invited_at).toLocaleString()}</p><pre className="whitespace-pre-wrap break-words">{record.invitation}</pre>
      {record.outcome && <p>Outcome: {record.outcome} · Exceptions: {record.exceptions || 'None'} · Completed: {record.completed_at ? new Date(record.completed_at).toLocaleString() : 'Not recorded'}</p>}
      {(role === 'owner' || record.owner_user_id === app.auth.user?.id) && <form className="mt-4 space-y-3" onSubmit={e => { e.preventDefault(); const f = new FormData(e.currentTarget); void save(() => recordWorkingInterviewOutcome(scope, a.id, record, String(f.get('outcome')), String(f.get('exceptions')))) }}>
        <label className="block">Interview outcome<textarea className={field} name="outcome" required maxLength={10000} defaultValue={record.outcome ?? ''} /></label>
        <label className="block">Exceptions<textarea className={field} name="exceptions" maxLength={10000} defaultValue={record.exceptions ?? ''} /></label>
        <button className={button} disabled={busy || !!error}>Record outcome</button>
      </form>}
    </div>)}
    {!invitation || !book?.version ? <p role="status">Daily meeting time or playbook not configured — contact your administrator before issuing working-interview invitations.</p> : <form className="mt-4 space-y-3" onSubmit={e => { e.preventDefault(); void save(() => createWorkingInterviewInvitation(scope, a.id, invitation, owner, book.version)) }}>
      <label className="block">Invitation preview<textarea className={field + ' min-h-64'} readOnly value={invitation} /></label>
      <label className="block">Invitation owner<input className={field} required value={owner} onChange={e => setOwner(e.target.value)} /></label>
      <p>Secure join configuration is hidden. Join details are sent privately.</p>
      <label className="block"><input type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)} /> I verified secure join configuration privately and sent this invitation through the approved mail workflow.</label>
      <button className={button} disabled={!confirmed || busy || !!error || records.length > 0}>Record sent invitation</button>
    </form>}
    </>}
  </section>
}
