import { useEffect, useState } from 'react'
import { id, read, write, type Application, type Scope } from './api'
import { Form, TextField, date, field, val } from './ui'

type Step = { policy_version: number; step_key: string; label: string; kind: string; required: number; step_version: number | null; status: string; value_json: string | null; comment: string | null; evidence: string | null; verifier_user_id: string | null; created_at: number | null }
type Policy = { version: number }
const valueText = (step: Step) => { try { const value=JSON.parse(step.value_json ?? 'null');return typeof value==='string'?value:value?.identity ?? '' } catch { return '' } }

export function CandidateOnboardingChecklist({ a, scope, manage, onCompleteChange }: { a: Application; scope: Scope; manage: boolean; onCompleteChange: (complete: boolean) => void }) {
  const [steps,setSteps] = useState<Step[]>([])
  const [policy,setPolicy] = useState<Policy | null>(null)
  const [busy,setBusy] = useState(false)
  const [message,setMessage] = useState('')
  async function load() {
    const [rows,policies]=await Promise.all([read<Step>('list_onboarding_checklist',{...scope,application_id:a.id}),read<Policy>('get_onboarding_policy',scope)])
    setSteps(rows);setPolicy(policies[0] ?? null)
    onCompleteChange(rows.length>0 && rows.every(s=>!s.required || s.status==='completed' && Boolean(s.verifier_user_id)))
  }
  useEffect(()=>{void load().catch(()=>setMessage('Could not load onboarding checklist.'))},[a.id,scope.organization_id,scope.brand_id])
  async function assign() {setBusy(true);setMessage('');try {await write('assign_onboarding_policy',{...scope,application_id:a.id});await load();setMessage('Checklist assigned.')} catch(e) {setMessage(e instanceof Error?e.message:'Could not assign checklist.')} finally {setBusy(false)}}
  async function record(step: Step,f: FormData) {
    setBusy(true);setMessage('')
    try {
      const status=val(f,'status'),raw=val(f,'value')
      const value_json=step.kind==='confirmation'?JSON.stringify(f.has('confirmed')):step.kind==='membership'?JSON.stringify({identity:raw,joined:f.has('joined')}):JSON.stringify(raw)
      await write('record_onboarding_step',{...scope,application_id:a.id,policy_version:step.policy_version,step_key:step.step_key,expected_version:step.step_version ?? 0,status,value_json,comment:val(f,'comment'),evidence:val(f,'evidence'),operation_id:id()})
      await load();setMessage(`${step.label} recorded.`)
    } catch(e) {setMessage(e instanceof Error?e.message:'Could not record checklist step.')} finally {setBusy(false)}
  }
  return <section className="mt-5"><h4 className="font-semibold">Candidate onboarding checklist</h4><p className="text-sm">These candidate setup records are separate from hiring-team reminders.</p>
    {!steps.length && <p className="mt-2 text-sm">{policy?'Assign the current organisation criteria to begin.':'An organisation owner must publish onboarding criteria before completion.'}</p>}
    {manage && !steps.length && policy && <button className="mt-2 min-h-11 underline" disabled={busy} onClick={()=>void assign()}>Assign checklist version {policy.version}</button>}
    {steps.map(step=><div className="mt-3 rounded-lg border border-[var(--line)] p-3" key={step.step_key}>
      <h5 className="font-medium">{step.label}{step.required?' · required':''}</h5><p className="text-sm">{step.status} · {step.kind} · version {step.step_version ?? 0}{step.verifier_user_id?` · verified by ${step.verifier_user_id}`:''}{step.created_at?` · ${date(step.created_at)}`:''}</p>
      {step.value_json && <p className="break-words text-sm">Value: {step.value_json}</p>}{step.evidence && <p className="break-words text-sm">Evidence: {step.evidence}</p>}{step.comment && <p className="break-words text-sm">Comment: {step.comment}</p>}
      {manage && <Form busy={busy} submitLabel={`Record ${step.label}`} onSubmit={f=>void record(step,f)}><label className="block text-sm">Status<select className={field} name="status" defaultValue={step.status}>{['pending','in_progress','completed','blocked'].map(s=><option key={s}>{s}</option>)}</select></label>
        {step.kind==='confirmation'?<label className="flex min-h-11 items-center gap-2"><input type="checkbox" name="confirmed" defaultChecked={step.value_json==='true'} />Confirmed</label>:<TextField name="value" label={step.kind==='membership'?'Membership identity':step.kind==='document'?'Document reference':step.label} defaultValue={valueText(step)} required={false} type={step.kind==='url'?'url':'text'} />}
        {step.kind==='membership' && <label className="flex min-h-11 items-center gap-2"><input type="checkbox" name="joined" defaultChecked={step.value_json ? Boolean(JSON.parse(step.value_json).joined) : false} />Membership verified</label>}
        <TextField name="evidence" label="Verification evidence reference" defaultValue={step.evidence ?? ''} required={false} /><TextField name="comment" label="Comment" defaultValue={step.comment ?? ''} required={false} />
      </Form>}
    </div>)}
    {message && <p role="status" className="mt-2">{message}</p>}
  </section>
}
