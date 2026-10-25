import { useEffect, useMemo, useRef, useState } from 'react'
import { ConfirmDialog } from './ConfirmDialog'
import { id, read, write, type Application, type Scope } from './api'
import { button, field, panel } from './ui'

type Decision = { id: string; disposition: string; rationale: string; actor_id: string; decided_at: number }
type Offer = { id: string; status: 'draft' | 'pending_approval' | 'approved' | 'revoked'; current_version: number; lock_version: number; terms_json: string; events_json: string }
type PendingAction = { action: string; values: Record<string, unknown>; title: string; body: string; label: string; variant?: 'danger' | 'warning' | 'info' }

const terminal = new Set(['accepted', 'hired', 'rejected', 'withdrawn'])
const labels: Record<string, string> = { hired: 'Mark hired', rejected: 'Reject candidate', withdrawn: 'Record withdrawal', deferred: 'Defer decision' }

function parseTerms(value: string) {
  try { return JSON.parse(value) as { compensation_type?: string; subject?: string; body?: string } } catch { return {} }
}

/** A compact, human-operated decision area; role checks and audit are server-side. */
export function DecisionsOffers({ scope, application, onChanged }: { scope: Scope; application: Application; onChanged: () => void }) {
  const [decisions, setDecisions] = useState<Decision[]>([])
  const [offer, setOffer] = useState<Offer | null>(null)
  const [rationale, setRationale] = useState('')
  const [disposition, setDisposition] = useState('')
  const [subject, setSubject] = useState('')
  const [body, setBody] = useState('')
  const [draftId, setDraftId] = useState('')
  const [acceptanceEvidence, setAcceptanceEvidence] = useState('')
  const [pending, setPending] = useState<PendingAction | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [revision, setRevision] = useState(0)
  // Preserve an idempotency key after an uncertain confirmation so a retry
  // can retrieve the first result instead of creating a second record.
  const pendingOperations = useRef(new Map<string, string>())
  const params = useMemo(() => ({ tenant_id: scope.organization_id, brand_id: scope.brand_id, application_id: application.id }), [scope.organization_id, scope.brand_id, application.id])

  useEffect(() => {
    let active = true
    setLoaded(false); setError('')
    Promise.all([read<Decision>('list_application_decisions', params), read<Offer>('get_offer', params)])
      .then(([nextDecisions, offers]) => {
        if (!active) return
        setDecisions(nextDecisions); setOffer(offers[0] ?? null)
        const terms = offers[0] && parseTerms(offers[0].terms_json)
        if (terms) { setSubject(terms.subject ?? ''); setBody(terms.body ?? '') }
      })
      .catch(() => { if (active) setError('Could not load decision information. Refresh and try again.') })
      .finally(() => { if (active) setLoaded(true) })
    return () => { active = false }
  }, [params, revision])

  async function run(action: string, values: Record<string, unknown>) {
    setBusy(true); setError('')
    const operationId = typeof values.operation_id === 'string' ? values.operation_id : id()
    try {
      await write(action, { ...params, ...values, operation_id: operationId })
      for (const [key, value] of pendingOperations.current) if (value === operationId) pendingOperations.current.delete(key)
      setRationale(''); setDisposition(''); setAcceptanceEvidence(''); setRevision(value => value + 1); onChanged()
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'This change could not be confirmed. Refresh and try again.') }
    finally { setBusy(false); setPending(null) }
  }
  function confirm(action: string, values: Record<string, unknown>, title: string, bodyText: string, label: string, variant: PendingAction['variant'] = 'warning') {
    const key = `${action}:${JSON.stringify(values)}`
    const operationId = pendingOperations.current.get(key) ?? id()
    pendingOperations.current.set(key, operationId)
    setPending({ action, values: { ...values, operation_id: operationId }, title, body: bodyText, label, variant })
  }
  const terms = offer ? parseTerms(offer.terms_json) : null
  const canDecide = Boolean(application.requisition_id && disposition && rationale.trim() && !terminal.has(application.stage))

  return <section className={panel} aria-label="Decision and offer">
    <header className="flex flex-wrap items-start justify-between gap-3"><div><h3 className="font-semibold">Decision</h3><p className="mt-1 text-sm text-[var(--muted)]">Record a final outcome when it is ready. Your role and the audit history identify who made it.</p></div><button type="button" className="min-h-11 text-sm underline" disabled={busy} onClick={() => setRevision(value => value + 1)}>Refresh</button></header>
    {error && <p role="alert" className="mt-3">{error}</p>}
    {!loaded ? <p role="status" className="mt-3">Loading decision details…</p> : <>
      {terminal.has(application.stage) ? <p className="mt-4 rounded-lg bg-[var(--line)] p-3 text-sm">This application is closed: <strong>{application.stage.replaceAll('_', ' ')}</strong>.</p> : <div className="mt-4 grid gap-3 md:grid-cols-[minmax(0,1fr)_auto]"><label className="block text-sm"><span className="mb-1 block font-medium">Outcome</span><select className={field} value={disposition} onChange={event => setDisposition(event.target.value)}><option value="">Choose an outcome</option>{Object.entries(labels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><label className="block text-sm md:col-span-2"><span className="mb-1 block font-medium">Reason</span><textarea className={field} rows={3} value={rationale} onChange={event => setRationale(event.target.value)} placeholder="Brief, factual hiring reason" /></label><div className="md:col-span-2"><button type="button" className={button} disabled={!canDecide || busy} onClick={() => confirm('record_decision', { requisition_id: application.requisition_id, expected_version: application.version, disposition, rationale }, `Record ${labels[disposition]?.toLowerCase() ?? 'decision'}?`, 'This updates the candidate stage and writes an immutable audit record. You can review the decision history below.', 'Record decision', disposition === 'rejected' ? 'danger' : 'warning')}>Record decision</button></div></div>}
      {decisions.length > 0 && <details className="mt-4 rounded-lg border border-[var(--line)] p-3"><summary className="cursor-pointer font-medium">Decision history ({decisions.length})</summary><ul className="mt-3 space-y-2 text-sm">{decisions.map(item => <li key={item.id}><strong>{item.disposition.replaceAll('_', ' ')}</strong> · {new Date(item.decided_at).toLocaleString()}<span className="block text-[var(--muted)]">{item.rationale}</span></li>)}</ul></details>}
      <details className="mt-5 rounded-lg border border-[var(--line)] p-3"><summary className="cursor-pointer font-medium">Offer management{offer ? ` · ${offer.status.replaceAll('_', ' ')}` : ''}</summary><div className="mt-4 space-y-4">
        {!offer || offer.status === 'draft' ? <><p className="text-sm text-[var(--muted)]">Use this only for a paid employment offer. Volunteer and internship arrangements should use the normal onboarding process.</p><label className="block text-sm"><span className="mb-1 block font-medium">Offer subject</span><input className={field} value={subject} onChange={event => setSubject(event.target.value)} /></label><label className="block text-sm"><span className="mb-1 block font-medium">Terms</span><textarea className={field} rows={5} value={body} onChange={event => setBody(event.target.value)} /></label><div className="flex flex-wrap gap-3"><button type="button" className={button} disabled={busy || !application.requisition_id || !subject.trim() || !body.trim()} onClick={() => void run('save_offer_draft', { requisition_id: application.requisition_id, expected_version: offer?.lock_version ?? 0, terms_json: JSON.stringify({ compensation_type: 'paid', subject, body }) })}>Save offer draft</button>{offer && <button type="button" className="min-h-11 underline" disabled={busy} onClick={() => confirm('submit_offer_for_approval', { offer_id: offer.id, expected_version: offer.lock_version }, 'Submit offer for approval?', 'The exact saved terms will be locked for review. This does not send anything.', 'Submit for approval')}>Submit for approval</button>}</div></> : <>
          <p className="text-sm">Status: <strong>{offer.status.replaceAll('_', ' ')}</strong> · revision {offer.current_version}</p>{terms && <details><summary className="cursor-pointer underline">View exact terms</summary><p className="mt-2 whitespace-pre-wrap text-sm">{terms.body}</p></details>}
          {offer.status === 'pending_approval' && <button type="button" className={button} disabled={busy} onClick={() => confirm('approve_offer', { offer_id: offer.id, expected_version: offer.lock_version }, 'Approve this offer?', 'Confirm that you reviewed this exact saved revision. Approval alone does not send an email.', 'Approve offer')}>Approve offer</button>}
          {offer.status === 'approved' && <div className="space-y-3"><label className="block text-sm"><span className="mb-1 block font-medium">Approved communication draft ID</span><input className={field} value={draftId} onChange={event => setDraftId(event.target.value)} /></label><button type="button" className={button} disabled={busy || !draftId.trim()} onClick={() => confirm('authorize_offer_dispatch', { offer_id: offer.id, draft_id: draftId, expected_version: offer.lock_version }, 'Authorise this offer draft?', 'The draft must exactly match these approved paid terms and the candidate recipient. It will still need to be queued through the approved mail workflow.', 'Authorise draft')}>Authorise draft</button></div>}
          {offer.status !== 'revoked' && <button type="button" className="min-h-11 underline" disabled={busy} onClick={() => confirm('revoke_offer', { offer_id: offer.id, expected_version: offer.lock_version, note: rationale }, 'Revoke this offer?', 'This prevents the approved offer from being dispatched. It does not delete the audit record.', 'Revoke offer', 'danger')}>Revoke offer</button>}
        </>}
        {application.stage === 'offered' && offer?.status === 'approved' && terms?.compensation_type === 'paid' && <div className="border-t border-[var(--line)] pt-4"><label className="block text-sm"><span className="mb-1 block font-medium">Candidate acceptance evidence</span><textarea className={field} rows={3} value={acceptanceEvidence} onChange={event => setAcceptanceEvidence(event.target.value)} /></label><button type="button" className={button + ' mt-3'} disabled={busy || !acceptanceEvidence.trim()} onClick={() => confirm('record_acceptance', { expected_version: application.version, acceptance_evidence: acceptanceEvidence }, 'Record candidate acceptance?', 'Record only evidence that the candidate explicitly accepted these approved terms.', 'Record acceptance')}>Record acceptance</button></div>}
      </div></details>
    </>}
    {pending && <ConfirmDialog title={pending.title} body={pending.body} confirmLabel={pending.label} variant={pending.variant} onCancel={() => setPending(null)} onConfirm={() => void run(pending.action, pending.values)} />}
  </section>
}
