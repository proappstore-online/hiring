import { useEffect, useState } from 'react'
import { id, read, write, type Application, type Scope } from './api'
import { Form, TextField, field, panel, date, val } from './ui'

type Plan = { application_id: string; owner: 'Serge' | 'bot'; state: 'actionable' | 'blocked' | 'deferred'; action: string; blocker_reason: string | null; review_at: number | null; version: number; closed_at: number | null }
const terminal = (stage: string) => ['onboarded', 'rejected', 'withdrawn'].includes(stage)

export function ApplicationNextAction({ application, scope, manage }: { application: Application; scope: Scope; manage: boolean }) {
  const [plan, setPlan] = useState<Plan | null>(null)
  const [loading, setLoading] = useState(true)
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const [state, setState] = useState<Plan['state']>('actionable')
  const params = { ...scope, application_id: application.id }
  async function load() {
    const rows = await read<Plan>('list_application_next_actions', params)
    setPlan(rows[0] ?? null)
    setState(rows[0]?.state ?? 'actionable')
  }
  useEffect(() => { let live = true; setLoading(true); read<Plan>('list_application_next_actions', params).then(rows => { if (live) { setPlan(rows[0] ?? null); setState(rows[0]?.state ?? 'actionable') } }).catch(() => { if (live) setMessage('Could not load the hiring-team next action.') }).finally(() => { if (live) setLoading(false) }); return () => { live = false } }, [application.id, scope.organization_id, scope.brand_id])
  async function save(form: FormData) {
    setBusy(true); setMessage('')
    const review = val(form, 'review_date')
    const review_at = state === 'deferred' && review ? Date.parse(`${review}T00:00:00.000Z`) : null
    try {
      await write('record_application_next_action', { ...params, expected_action_version: plan?.version ?? 0, owner: val(form, 'owner'), state, action: val(form, 'action'), blocker_reason: state === 'blocked' ? val(form, 'blocker_reason') : null, review_at, operation_id: id() })
      await load(); setMessage('Hiring-team next action saved.')
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Could not save next action. Refresh and retry.') } finally { setBusy(false) }
  }
  return <section className={panel}><h3 className="font-semibold">Hiring team next step</h3><p className="mb-3 text-sm text-[var(--muted)]">Internal task for Serge or the hiring bot. Candidates and interns are never assigned tasks here.</p>
    {loading ? <p role="status">Loading next action…</p> : plan ? <div className="space-y-1 text-sm"><p><strong>{plan.state}</strong> · {plan.owner} · {plan.action}</p>{plan.blocker_reason && <p>Blocked: {plan.blocker_reason}</p>}{plan.review_at && <p>Review: {date(plan.review_at)}</p>}{plan.closed_at && <p>Archived {date(plan.closed_at)}</p>}</div> : <p role="status">No candidate-linked next action is recorded. This application appears in the gaps report.</p>}
    {manage && !terminal(application.stage) && <details className="mt-3"><summary className="min-h-[44px] cursor-pointer">Record next hiring action</summary><Form busy={busy} onSubmit={save}><label>Hiring-team owner<select className={field} name="owner" defaultValue={plan?.owner ?? 'bot'}><option value="bot">Hiring bot</option><option value="Serge">Serge</option></select></label><label>Action state<select className={field} value={state} onChange={event => setState(event.target.value as Plan['state'])}><option value="actionable">Actionable</option><option value="blocked">Blocked</option><option value="deferred">Deferred</option></select></label><TextField name="action" label="Clear next task" defaultValue={plan?.action ?? ''} />{state === 'blocked' && <TextField name="blocker_reason" label="Blocking reason" defaultValue={plan?.blocker_reason ?? ''} />}{state === 'deferred' && <label>Review date (UTC)<input className={field} type="date" name="review_date" required defaultValue={plan?.review_at ? new Date(plan.review_at).toISOString().slice(0, 10) : ''} /></label>}</Form></details>}
    {message && <p role="status" className="mt-2">{message}</p>}
  </section>
}
