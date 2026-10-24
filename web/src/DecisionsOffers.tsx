import { useEffect, useRef, useState } from 'react'
import { id, read, write, interviewScope, type Scope, type Application } from './api'
import { verifyPublicationPasskey, registerPublicationPasskey } from './passkey'
import { button, field, panel } from './ui'

type Offer = { id: string; status: string; current_version: number; lock_version: number; terms_json: string; events_json: string }
type Decision = { id: string; disposition: string; rationale: string; actor_id: string; decided_at: number }
export function DecisionsOffers({ scope, application, onChanged }: { scope: Scope; application: Application; onChanged: () => void }) {
  const pendingAcceptance = useRef<{ key: string; operationId: string } | null>(null)
  const params = interviewScope(scope, application.id)
  const [offer, setOffer] = useState<Offer>()
  const [decisions, setDecisions] = useState<Decision[]>([])
  const [subject, setSubject] = useState('Offer of employment')
  const [body, setBody] = useState('')
  const [draftId, setDraftId] = useState('')
  const [rationale, setRationale] = useState('')
  const [acceptanceEvidence, setAcceptanceEvidence] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [loaded, setLoaded] = useState(false)
  const [revision, refresh] = useState(0)
  useEffect(() => {
    let active = true
    setLoaded(false); setOffer(undefined); setDecisions([]); setError('')
    void Promise.all([read<Offer>('get_offer', params), read<Decision>('list_application_decisions', params)]).then(([offers, history]) => {
      if (!active) return
      setOffer(offers[0]); setDecisions(history)
      if (offers[0]) { const terms = JSON.parse(offers[0].terms_json); setSubject(terms.subject); setBody(terms.body) }
      setLoaded(true)
    }).catch(() => { if (active) setError('Could not load decisions and offers. Refresh to retry.') })
    return () => { active = false }
  }, [scope.organization_id, scope.brand_id, application.id, revision])
  async function act(action: string, values: Record<string, unknown>, human = false) {
    setBusy(true); setError('')
    try {
      if (human) await verifyPublicationPasskey()
      const key = JSON.stringify([params, values])
      if (action === 'record_acceptance' && pendingAcceptance.current?.key !== key) pendingAcceptance.current = { key, operationId: id() }
      await write(action, { ...params, ...values, operation_id: action === 'record_acceptance' ? pendingAcceptance.current!.operationId : id() })
      if (action === 'record_acceptance') pendingAcceptance.current = null
      refresh(n => n + 1); onChanged()
    } catch { setError('Action could not be confirmed. Refresh and check the current state before retrying. Human actions require a registered passkey.') }
    finally { setBusy(false) }
  }
  return <section className={panel} aria-label="Decisions and offers"><h3 className="font-semibold">Human decisions and offers</h3><p>Review the exact application and terms before confirming with your passkey. Approval does not mean sent. Unpaid arrangements cannot be dispatched.</p>{error && <p role="alert">{error}</p>}<button className={button} disabled={busy} onClick={() => refresh(n => n + 1)}>Refresh decisions and offers</button><button className={button} disabled={busy} onClick={() => { setBusy(true); void registerPublicationPasskey().catch(() => setError('Could not register passkey.')).finally(() => setBusy(false)) }}>Register decision passkey</button>{!loaded && !error && <p role="status">Loading decisions and offers…</p>}{loaded && <fieldset disabled={busy} className="space-y-3"><label className="block">Decision rationale<textarea className={field} value={rationale} onChange={e => setRationale(e.target.value)} /></label>{(['hired','rejected','withdrawn','deferred'] as const).map(disposition => <button key={disposition} className={button} disabled={!application.requisition_id || !rationale.trim() || ['accepted','hired','rejected','withdrawn'].includes(application.stage)} onClick={() => void act('record_decision', { requisition_id: application.requisition_id, expected_version: application.version, disposition, rationale }, true)}>Confirm {disposition} with passkey</button>)}{decisions.map(d => <p key={d.id}>{d.disposition} · {d.actor_id} · {new Date(d.decided_at).toISOString()} · {d.rationale}</p>)}{application.stage === 'offered' && offer?.status === 'approved' && JSON.parse(offer.terms_json).compensation_type === 'paid' && <div><label>Candidate acceptance evidence<textarea aria-label="Candidate acceptance evidence" className={field} value={acceptanceEvidence} onChange={e => setAcceptanceEvidence(e.target.value)} /></label><p>Record only evidence that the candidate actually accepted these offer terms.</p><button className={button} disabled={!acceptanceEvidence.trim()} onClick={() => void act('record_acceptance', { expected_version: application.version, acceptance_evidence: acceptanceEvidence }, true)}>Record acceptance with passkey</button></div>}<p>Offer: {offer ? `${offer.status} · terms version ${offer.current_version}` : 'No offer'}</p><label className="block">Offer subject<input className={field} value={subject} disabled={!!offer && offer.status !== 'draft'} onChange={e => setSubject(e.target.value)} /></label><label className="block">Paid offer terms<textarea className={field} value={body} disabled={!!offer && offer.status !== 'draft'} onChange={e => setBody(e.target.value)} /></label>{(!offer || offer.status === 'draft') && <button className={button} disabled={!application.requisition_id || !body.trim() || !subject.trim()} onClick={() => void act('save_offer_draft', { requisition_id: application.requisition_id, expected_version: offer?.lock_version ?? 0, terms_json: JSON.stringify({ compensation_type: 'paid', subject, body }) })}>Save offer revision</button>}{offer && <>{offer.status === 'draft' && <button className={button} onClick={() => void act('submit_offer_for_approval', { offer_id: offer.id, expected_version: offer.lock_version }, true)}>Submit terms for approval with passkey</button>}{offer.status === 'pending_approval' && <button className={button} onClick={() => void act('approve_offer', { offer_id: offer.id, expected_version: offer.lock_version }, true)}>Approve exact terms with passkey</button>}{offer.status === 'approved' && <><label className="block">Exact communication draft ID<input className={field} value={draftId} onChange={e => setDraftId(e.target.value)} /></label><button className={button} disabled={!draftId.trim()} onClick={() => void act('authorize_offer_dispatch', { offer_id: offer.id, draft_id: draftId, expected_version: offer.lock_version }, true)}>Authorize exact offer draft with passkey</button><p>Authorization does not queue or send a message. The draft must match these exact paid terms and the candidate recipient.</p></>}{offer.status !== 'revoked' && <button className={button} onClick={() => void act('revoke_offer', { offer_id: offer.id, expected_version: offer.lock_version, note: rationale }, true)}>Revoke offer with passkey</button>}<details><summary>Approval evidence</summary><pre className="whitespace-pre-wrap">{JSON.stringify(JSON.parse(offer.events_json), null, 2)}</pre></details></>}</fieldset>}</section>
}
