import { useEffect, useState } from 'react'
import { getOrgRecruitingPlaybook, getWorkingInterview, recordWorkingInterviewInvitation, recordWorkingInterviewOutcome, workingInterviewKey, type Application, type Role, type Scope } from './api'
import { composeInvitation, parsePlaybook, type Playbook, type WorkingInterviewRecord } from './playbook'
import { button, field, panel } from './ui'
export function WorkingInterviewInvitation({ a, scope, role }: { a: Application; scope: Scope; role: Role }) {
  const key = workingInterviewKey(scope, a.id)
  const [record, setRecord] = useState<WorkingInterviewRecord | undefined>(() => getWorkingInterview(key))
  const [book, setBook] = useState<Playbook | null>(null)
  const [error, setError] = useState('')
  const [owner, setOwner] = useState(a.assignee_user_id ?? '')
  const [confirmed, setConfirmed] = useState(false)
  const allowed = role === 'owner' || role === 'recruiter'
  useEffect(() => {
    if (!allowed) return
    let live = true
    getOrgRecruitingPlaybook(scope.organization_id).then(rows => { if (live) { if (rows[0]) parsePlaybook(rows[0].payload); setBook(rows[0] ?? null) } }).catch(() => { if (live) setError('Could not load playbook. Invitations are unavailable.') })
    return () => { live = false }
  }, [scope.organization_id, allowed])
  if (!allowed) return null
  const invitation = book ? composeInvitation(a.candidate_name, parsePlaybook(book.payload)) : ''
  return <section className={panel} aria-labelledby="working-title"><h3 id="working-title" className="font-semibold">Working interview</h3>
    <p>Session-only preview: records disappear on reload and are not shared or audited. This form does not send email. Use the approved mail workflow to send invitations.</p>
    {error && <p role="alert">{error}</p>}
    {record ? <div><p>Invitation playbook version {record.invitation.playbookVersion}</p><p>Owner: {record.invitation.owner} · Sent: {new Date(record.invitation.sentAt).toLocaleString()}</p><pre className="whitespace-pre-wrap break-words">{record.invitation.invitationText}</pre>{record.outcome && <p>Outcome: {record.outcome.outcome} · Exceptions: {record.outcome.exceptions || 'None'} · Completed: {new Date(record.outcome.completedAt).toLocaleString()}</p>}</div> : <p>No working interview recorded</p>}
    {!invitation || !book?.version ? <p role="status">Daily meeting time or playbook not configured — contact your administrator before issuing working-interview invitations.</p> : <form className="mt-4 space-y-3" onSubmit={e => { e.preventDefault(); setRecord(recordWorkingInterviewInvitation(key, { playbookVersion: book.version, invitationText: invitation, owner, sentAt: Date.now() })) }}>
      <label className="block">Invitation preview<textarea className={field + ' min-h-64'} readOnly value={invitation} /></label>
      <label className="block">Invitation owner<input className={field} required value={owner} onChange={e => setOwner(e.target.value)} /></label>
      <p>Secure join configuration is hidden. Join details are sent privately.</p>
      <label className="block"><input type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)} /> I verified secure join configuration privately and sent this invitation through the approved mail workflow.</label>
      <button className={button} disabled={!confirmed || !!record}>Record sent invitation for this session</button>
    </form>}
    {record && <form className="mt-4 space-y-3" onSubmit={e => { e.preventDefault(); const f = new FormData(e.currentTarget); setRecord(recordWorkingInterviewOutcome(key, { outcome: String(f.get('outcome')), exceptions: String(f.get('exceptions')), completedAt: Date.now() })) }}><label className="block">Interview outcome<textarea className={field} name="outcome" required defaultValue={record.outcome?.outcome} /></label><label className="block">Exceptions<textarea className={field} name="exceptions" defaultValue={record.outcome?.exceptions} /></label><button className={button}>Record outcome for this session</button></form>}
  </section>
}
