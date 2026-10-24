import { useEffect, useState } from 'react'
import { id, write, read, type Communication, type Draft, type EmailStatusEvent, type Scope } from './api'
import { emailCards, statusLabel } from './email-model'
import { date } from './ui'
import { verifyPublicationPasskey } from './passkey'

export function Communications({ scope, applicationId, drafts, communications, loading = false, error = '', onRetry, brandName }: { scope: Scope; applicationId: string; drafts: Draft[]; communications: Communication[]; loading?: boolean; error?: string; onRetry?: () => void; brandName?: string }) {
  const cards = emailCards(drafts, communications)
  if (loading && !cards.length) return <p role="status" className="mt-4">Loading communications…</p>
  if (error) return <div role="alert" className="mt-4">Could not load communications. {onRetry && <button type="button" className="min-h-[44px] min-w-[44px] underline" onClick={onRetry}>Retry communications</button>}</div>
  return <><section aria-label="Delivery reconciliation" className="my-3 border p-3"><h3 className="font-semibold">Delivery reconciliation</h3><p>{cards.filter(c => statusLabel(c.status) === 'Unknown').length} unresolved unknown outcomes in loaded records</p>{cards.some(c => statusLabel(c.status) === 'Unknown') && <p>Manual reconciliation required — check provider dashboard for delivery status. Compare the provider reference and status history below, then refresh records after evidence is recorded through the approved connector workflow. Do not resend while the outcome is unknown.</p>}<p>Provider acceptance does not confirm delivery. Record reconciliation only after checking definitive provider evidence.</p></section>{drafts.filter(d => ['failed','unknown'].includes(d.delivery_state)).map(d => <Recovery key={JSON.stringify([scope.organization_id, scope.brand_id, applicationId, d.id])} scope={scope} applicationId={applicationId} draft={d} onChanged={onRetry} />)}{cards.length ? <ul className="mt-4 space-y-3">{cards.map(card => <EmailCard key={JSON.stringify([scope.organization_id, scope.brand_id, applicationId, card.logicalId || card.key])} card={card} scope={scope} applicationId={applicationId} brandName={brandName} />)}</ul> : <p className="mt-4 text-sm text-[var(--muted)]">No communications recorded yet.</p>}</>
}
function EmailCard({ card, scope, applicationId, brandName }: { card: ReturnType<typeof emailCards>[number]; scope: Scope; applicationId: string; brandName?: string }) {
  const [expanded, setExpanded] = useState(false)
  const [events, setEvents] = useState<EmailStatusEvent[]>([])
  const [loaded, setLoaded] = useState(false)
  const [more, setMore] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  async function load() {
    if (!card.logicalId || loading) return
    setLoading(true); setError('')
    try {
      const last = events.at(-1)
      const page = await read<EmailStatusEvent>('list_email_status_history', { ...scope, application_id: applicationId, logical_email_id: card.logicalId, cursor_at: last?.timestamp ?? null, cursor_id: last?.id ?? null })
      setEvents(old => [...old, ...page]); setLoaded(true); setMore(page.length === 50)
    } catch { setError('Could not load status history. Try again.') }
    finally { setLoading(false) }
  }
  return <li className="rounded-lg border border-[var(--line)] p-3 text-sm break-words">
    <p className="font-medium">{statusLabel(card.status)}</p><p>Brand: {brandName || scope.brand_id} · Provider: {card.provider === 'gmail' ? 'Gmail' : card.provider === 'cloudflare' ? 'Cloudflare email' : 'Not recorded'}</p>
    <p className="text-xs text-[var(--muted)]">{card.timeLabel}: {date(card.at)}</p>
    {card.legacy && <p className="text-xs">Legacy / Unverified link</p>}
    <h4 className="mt-1 font-medium">{card.subject}</h4>
    <p className="text-xs">From: {card.from || 'Not recorded'} · To: {card.to}{card.provider && ` · ${card.provider === 'gmail' ? 'Gmail' : 'Cloudflare email'}`}</p>
    <p className="mt-2 whitespace-pre-wrap">{card.body}</p>
    <button type="button" className="mt-3 min-h-[44px] min-w-[44px] underline" aria-expanded={expanded} aria-controls={`history-${card.key}`} onClick={() => { setExpanded(!expanded); if (!expanded && !loaded) void load() }}>Status history</button>
    {expanded && <div id={`history-${card.key}`} className="mt-2" aria-busy={loading}>
      {card.reference && <p className="text-xs">Provider reference: {card.reference}</p>}
      {loading && <p role="status">Loading history…</p>}
      {error && <p role="alert">{error} <button type="button" className="min-h-[44px] min-w-[44px] underline" onClick={() => void load()}>Retry</button></p>}
      {(!card.logicalId || (loaded && !events.length)) && <p>Status history unavailable for this record.</p>}
      <ol className="space-y-2">{events.map(e => <li key={e.id}><time dateTime={new Date(e.timestamp).toISOString()}>{date(e.timestamp)}</time> · {statusLabel(e.status)} · {e.actor}{e.attempt_number != null && ` · Attempt ${e.attempt_number}`}{e.provider_reference && <span className="block text-xs">Provider reference: {e.provider_reference}</span>}</li>)}</ol>
      {more && <button type="button" disabled={loading} className="mt-2 min-h-[44px] min-w-[44px] underline" onClick={() => void load()}>Load more history</button>}
    </div>}
  </li>
}

function Recovery({ scope, applicationId, draft, onChanged }: { scope: Scope; applicationId: string; draft: Draft; onChanged?: () => void }) {
  const [evidence, setEvidence] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [recovered, setRecovered] = useState(false)
  useEffect(() => {
    let active = true
    void read<{ outcome: string; replacement_draft_id: string | null }>('get_communication_reconciliation', { ...scope, application_id: applicationId, draft_id: draft.id }).then(rows => {
      if (active && rows[0]) {
        setRecovered(true)
        setMessage(rows[0].outcome === 'accepted' ? 'Provider acceptance recorded.' : rows[0].replacement_draft_id ? `Reconciled as not accepted. Replacement draft: ${rows[0].replacement_draft_id}. Review before queueing.` : 'Reconciled as not accepted. Resend is blocked by the one-job receipt or offer authorization contract; arrange approved alternate contact.')
      }
    }).catch(() => { if (active) setMessage('Could not load reconciliation. Refresh before recording a recovery.') })
    return () => { active = false }
  }, [scope.organization_id, scope.brand_id, applicationId, draft.id])
  async function reconcile(outcome: string) {
    setBusy(true); setMessage('')
    try {
      await verifyPublicationPasskey()
      await write('reconcile_communication', { ...scope, application_id: applicationId, draft_id: draft.id, outcome, evidence, operation_id: id() })
      const rows = await read<{ replacement_draft_id: string | null }>('get_communication_reconciliation', { ...scope, application_id: applicationId, draft_id: draft.id })
      setRecovered(true)
      setMessage(outcome === 'accepted' ? 'Provider acceptance recorded.' : rows[0]?.replacement_draft_id ? 'One unsent replacement draft created. Review before queueing; no message was sent.' : 'Non-acceptance recorded. Resend is blocked by the receipt or offer authorization contract; no replacement was created. Arrange approved alternate contact.')
      onChanged?.()
    } catch { setMessage('Recovery could not be confirmed. Refresh and check the recorded reconciliation before retrying.') }
    finally { setBusy(false) }
  }
  return <details className="my-3 border p-3"><summary>Reconcile: {draft.subject}</summary>{draft.delivery_reason && <p>{deliveryGuidance(draft.delivery_reason)}</p>}<p>Check the provider outcome first. Never retry an uncertain send. Non-acceptance creates an unsent replacement only for messages other than application receipts and offers. Receipt and offer resends remain blocked. Recovery preserves the original attempt and requires a passkey.</p><label>Provider evidence (no secrets)<textarea maxLength={2000} value={evidence} onChange={e => setEvidence(e.target.value)} /></label><fieldset disabled={busy || recovered || !evidence.trim()}><button type="button" className="min-h-[44px] underline mr-4" onClick={() => void reconcile('accepted')}>Confirm provider accepted</button><button type="button" className="min-h-[44px] underline" onClick={() => void reconcile('not_accepted')}>Confirm provider did not accept</button></fieldset>{message && <p role="status">{message}</p>}</details>
}

function deliveryGuidance(reason: string) {
  if (reason === 'quota') return 'Mail quota reached. Check the provider reset time, then reconcile before preparing a replacement.'
  if (reason === 'unavailable') return 'Mail connector unavailable. Check approved connector setup before recovery.'
  if (reason === 'forbidden') return 'Mail access denied. Review connector permissions before recovery.'
  if (['approval_unavailable', 'approval_required', 'scope_mismatch', 'invalid_payload'].includes(reason)) return 'Mail approval checks failed. Review the approved template, recipient, sender and suppression status before recovery.'
  return 'Check provider acceptance evidence before preparing any replacement.'
}


export function ApprovedMessage({ scope, applicationId, recipient, onChanged }: { scope: Scope; applicationId: string; recipient: string; onChanged: () => void }) {
  type Template = { id: string; name: string; subject: string; body: string; version: number }
  const [templates, setTemplates] = useState<Template[]>([])
  const [selected, setSelected] = useState('')
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const t = templates.find(row => row.id === selected)
  useEffect(() => {
    let active = true
    setTemplates([]); setSelected('')
    read<Template>('list_approved_communication_templates', { ...scope, application_id: applicationId }).then(rows => { if (active) setTemplates(rows) }).catch(() => { if (active) setMessage('Could not load approved templates.') })
    return () => { active = false }
  }, [scope.organization_id, scope.brand_id, applicationId])
  async function send() {
    if (!t) return
    setBusy(true); setMessage('')
    try {
      await verifyPublicationPasskey()
      const draft = id()
      await write('create_communication_draft', { ...scope, application_id: applicationId, draft_id: draft, recipient_email: recipient, subject: t.subject, body: t.body, template_id: t.id, template_version: t.version, operation_id: id() })
      await write('queue_communication', { ...scope, application_id: applicationId, draft_id: draft, operation_id: id() })
      setMessage('Queued for the approved mail connector. Delivery is shown in message history.'); onChanged()
    } catch { setMessage('Send could not be confirmed. Refresh message history before trying again.') }
    finally { setBusy(false) }
  }
  return <section className="my-3 border p-3"><h3>Send approved message</h3><label>Approved template<select className="min-h-[44px]" value={selected} onChange={e => setSelected(e.target.value)}><option value="">Choose template</option>{templates.map(row => <option key={row.id} value={row.id}>{row.name} · version {row.version}</option>)}</select></label>{t && <div aria-label="Message preview"><p>To: {recipient} · Brand: {scope.brand_id}</p><h4>{t.subject}</h4><p className="whitespace-pre-wrap">{t.body}</p><button className="min-h-[44px] underline" disabled={busy || !recipient} onClick={() => void send()}>Confirm and send this message</button></div>}<p role="status">{message}</p></section>
}
