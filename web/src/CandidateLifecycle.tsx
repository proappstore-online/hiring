import { useEffect, useState } from 'react'
import { allowedNextStages, id, read, write, type Application, type Scope } from './api'
import { Form, TextField, field, panel, val, date } from './ui'

type Event = { operation_id: string; from_stage: string; to_stage: string; evidence: string; registration_evidence: string; requirements_evidence: string; handoff_evidence: string; actor_user_id: string; created_at: number }
export function CandidateLifecycle({ a, scope, manage, onChanged }: { a: Application; scope: Scope; manage: boolean; onChanged: () => void }) {
  const [events, setEvents] = useState<Event[]>([])
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const [next, setNext] = useState(allowedNextStages(a.stage)[0] ?? '')
  const [pending, setPending] = useState<Record<string, unknown> | null>(null)
  const p = { ...scope, requisition_id: a.requisition_id, application_id: a.id }
  useEffect(() => { void read<Event>('list_lifecycle_events', p).then(setEvents).catch(() => setMessage('Could not load lifecycle history. Refresh to retry.')) }, [a.id, a.version, scope.organization_id, scope.brand_id])
  async function save(f: FormData) {
    const values = pending ?? { ...p, operation_id: id(), expected_version: a.version, from_stage: a.stage, to_stage: val(f, 'to_stage'), evidence: val(f, 'evidence'), registration_evidence: val(f, 'registration_evidence'), requirements_evidence: val(f, 'requirements_evidence'), handoff_evidence: val(f, 'handoff_evidence') }
    setPending(values); setBusy(true); setMessage('')
    try { await write('record_lifecycle_transition', values); setPending(null); onChanged(); setMessage('Lifecycle transition recorded.') } catch (e) { setMessage(`${e instanceof Error ? e.message : 'Could not confirm transition.'} Retry submits the same operation. Reload to review the current version before changing details.`) } finally { setBusy(false) }
  }
  return <section className={panel}><h3 className="font-semibold">Candidate lifecycle</h3><p>Accepted means the candidate agreed to join. Onboarding records setup in progress; onboarded requires completed registration, requirements acknowledgement and team/Discord handoff. Active means participation has started.</p>{manage && ['accepted', 'onboarding', 'onboarded'].includes(a.stage) && <Form busy={busy} onSubmit={save}><label>Next lifecycle stage<select className={field} name="to_stage" value={next} disabled={!!pending} onChange={e => setNext(e.target.value as typeof next)}>{allowedNextStages(a.stage).map(s => <option key={s} value={s}>{s}</option>)}</select></label><TextField name="evidence" label="Transition evidence / participation reference" />{next === 'onboarded' && <><TextField name="registration_evidence" label="Completed registration evidence" /><TextField name="requirements_evidence" label="Requirements acknowledgement evidence" /><TextField name="handoff_evidence" label="Completed team / Discord handoff evidence" /></>}</Form>}{message && <p role="status">{message}</p>}<ul>{events.map(e => <li className="mt-3 break-words" key={e.operation_id}>{e.from_stage} → {e.to_stage} · {date(e.created_at)} · {e.actor_user_id}<p>{e.evidence}</p>{e.registration_evidence && <p>Registration: {e.registration_evidence}</p>}{e.requirements_evidence && <p>Requirements: {e.requirements_evidence}</p>}{e.handoff_evidence && <p>Team / Discord handoff: {e.handoff_evidence}</p>}</li>)}</ul></section>
}
