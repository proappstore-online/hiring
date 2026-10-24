import { useRef, useState } from 'react'
import { app, id, read, type Scope } from './api'
import { verifyPublicationPasskey } from './passkey'
import { button, field, panel } from './ui'

type Step = { correction_id: string; field: string; processor_id: string; state: string; version: number; reason_reference: string }
export function CorrectionControls({ scope, applicationId, requestId, rightsVersion }: { scope: Scope; applicationId: string; requestId: string; rightsVersion: number }) {
  const [version, setVersion] = useState<number>()
  const [selected, setSelected] = useState('email')
  const [value, setValue] = useState('')
  const [reason, setReason] = useState('')
  const [steps, setSteps] = useState<Step[]>([])
  const [evidence, setEvidence] = useState('')
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const pending = useRef<{ key: string; operation: string } | null>(null)
  const params = { ...scope, application_id: applicationId, request_id: requestId }
  const load = () => read<Step>('list_candidate_rectifications', params)
  async function run(fn: () => Promise<void>) {
    setBusy(true); setMessage('')
    try { await fn() } catch (e) { setMessage(e instanceof Error ? e.message : 'Could not confirm correction. Refresh before retrying.') } finally { setBusy(false) }
  }
  async function apply() {
    await verifyPublicationPasskey()
    const values = { ...params, expected_version: rightsVersion, expected_application_version: version, field: selected, new_value: value, reason_reference: reason.trim() }
    const key = JSON.stringify(values)
    if (pending.current?.key !== key) pending.current = { key, operation: id() }
    const operation_id = pending.current.operation
    try { await app.actions.call('apply_candidate_correction', { ...values, operation_id }) } catch { /* Reconcile uncertain writes with the durable queue. */ }
    const current = await load(); setSteps(current)
    if (!current.some(row => row.correction_id === operation_id)) throw Error('Correction not confirmed. Check scope, version, shared candidate and identity review; refresh before retrying.')
    pending.current = null; setValue(''); setVersion(undefined)
    setMessage('Correction applied. Processor rectification is pending; submitted evidence is preserved.')
  }
  async function record(step: Step, state: string) {
    await verifyPublicationPasskey()
    const operation_id = id()
    try { await app.actions.call('record_candidate_rectification', { ...params, processor_id: step.processor_id, expected_version: step.version, operation_id, state, evidence_reference: evidence.trim() }) } catch { /* Reconcile durable outcome below. */ }
    const current = await load(); setSteps(current)
    if (!current.some(row => row.processor_id === step.processor_id && row.version === step.version + 1 && row.state === state)) throw Error('Processor outcome not confirmed. Refresh and inspect private provider evidence before retrying.')
    setMessage('Processor outcome recorded. Only attest fulfillment once all required processors are complete.')
  }
  return <section className={panel} aria-label="Candidate correction">
    <h3 className="font-semibold">Process verified correction</h3>
    <p>Correct one current field per request. Contact changes on a shared candidate require separate review. Reason and processor evidence must be opaque private case references. Submitted statements, attachments and decisions cannot be edited here.</p>
    <fieldset disabled={busy} className="space-y-3">
      <button className={button} onClick={() => void run(async () => {
        const [row] = await read<{ version: number }>('gateway_get_application', params)
        setVersion(row?.version); setSteps(await load()); setMessage(row ? 'Current version loaded. Review the correction before applying.' : 'Application unavailable.')
      })}>Load correction context and processor status</button>
      {version !== undefined && <p>Application version: {version}</p>}
      <label className="block">Current field<select className={field} value={selected} onChange={e => setSelected(e.target.value)}>{Object.entries({ name: 'Candidate name', email: 'Email address', phone: 'Phone number', contact_context: 'Current contact context' }).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
      <label className="block">Corrected value<input className={field} maxLength={2000} value={value} onChange={e => setValue(e.target.value)} /></label>
      <label className="block">Correction reason reference<input className={field} maxLength={128} value={reason} onChange={e => setReason(e.target.value)} /></label>
      <button className={button} disabled={version === undefined || !reason.trim() || steps.length > 0} onClick={() => void run(apply)}>Approve and apply correction with passkey</button>
      <p>Use the private processor service to deliver or retry each queued correction. If a provider is unavailable, keep the outcome failed or unknown. Record complete only after verifying the provider has applied this exact correction.</p>
      <label className="block">Private processor evidence reference<input className={field} maxLength={128} value={evidence} onChange={e => setEvidence(e.target.value)} /></label>
      <ul>{steps.map(step => <li key={step.processor_id}>{step.processor_id}: {step.state} · attempt {step.version}
        {step.state !== 'complete' && <>{['complete','failed','unknown'].map(state => <button className={button} key={state} disabled={!evidence.trim()} onClick={() => void run(() => record(step, state))}>Record {step.processor_id} {state}</button>)}</>}
      </li>)}</ul>
    </fieldset><p role="status">{message}</p>
  </section>
}
