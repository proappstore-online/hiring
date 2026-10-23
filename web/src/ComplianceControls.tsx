import { useState } from 'react'
import type { Role } from './api'
import { ConfirmDialog } from './ConfirmDialog'
import { button, panel } from './ui'

// Capabilities are supplied only when a server-enforced action is registered.
// Core erasure can be supplied by the scoped owner workflow; completion needs separate evidence.
export function ComplianceControls({ role, onExport, onDelete }: { role: Role; onExport?: () => Promise<void>; onDelete?: () => Promise<void> }) {
  const [step, setStep] = useState(0)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  async function perform(action: () => Promise<void>) {
    setBusy(true); setMessage('')
    try { await action(); setMessage('Request recorded. Completion has not been confirmed.') }
    catch { setMessage('Request could not be confirmed. Check its status before trying again.') }
    finally { setBusy(false) }
  }
  return <section className={panel}><h1 className="text-2xl font-semibold">Compliance</h1><aside className="my-4 rounded border-2 p-4" aria-label="Retention policy"><h2 className="font-bold">Indefinite retention — no automatic purge</h2><p>Candidate records are retained indefinitely under the approved policy. This interface does not schedule or perform automatic deletion.</p></aside>
    <h2 className="font-semibold">Subject rights</h2><p>Follow the approved identity verification process with the organization contact. A core erasure request does not confirm deletion from every store or processor.</p>
    <h2 className="mt-4 font-semibold">Data export</h2>{role === 'owner' && onExport ? <button className={button} disabled={busy} onClick={() => void perform(onExport)}>Request data export</button> : <p>Data export is unavailable{role !== 'owner' ? ' for this role' : ': no backend capability is registered'}.</p>}
    <h2 className="mt-4 font-semibold">Deletion requests</h2>{role === 'owner' && onDelete ? <button className={button} disabled={busy} onClick={() => setStep(1)}>Request deletion</button> : <p>Deletion requests are unavailable{role !== 'owner' ? ' for this role' : ': no backend capability is registered'}. No deletion has been scheduled.</p>}
    <p role="status">{message}</p>{step > 0 && <ConfirmDialog title={step === 1 ? 'Review deletion request' : 'Confirm irreversible deletion'} body={step === 1 ? 'Verify identity, scope, legal holds and the approved privacy process before continuing.' : 'Deletion is irreversible. Confirm only after the affected records and legal obligations have been reviewed.'} confirmLabel={step === 1 ? 'Continue review' : 'Confirm deletion request'} variant="danger" onCancel={() => setStep(0)} onConfirm={() => { if (step === 1) setStep(2); else { setStep(0); if (onDelete) void perform(onDelete) } }} />}
  </section>
}
