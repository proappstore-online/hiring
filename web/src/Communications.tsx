import { useState } from 'react'
import { read, type Communication, type Draft, type EmailStatusEvent, type Scope } from './api'
import { emailCards, statusLabel } from './email-model'
import { date } from './ui'

export function Communications({ scope, applicationId, drafts, communications }: { scope: Scope; applicationId: string; drafts: Draft[]; communications: Communication[] }) {
  const cards = emailCards(drafts, communications)
  return cards.length ? <ul className="mt-4 space-y-3">{cards.map(card => <EmailCard key={`${card.key}:${card.at}:${card.status}`} card={card} scope={scope} applicationId={applicationId} />)}</ul> : <p className="mt-4 text-sm text-[var(--muted)]">No communications recorded yet.</p>
}
function EmailCard({ card, scope, applicationId }: { card: ReturnType<typeof emailCards>[number]; scope: Scope; applicationId: string }) {
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
    <p className="font-medium">{statusLabel(card.status)}</p>
    <p className="text-xs text-[var(--muted)]">{card.timeLabel}: {date(card.at)}</p>
    {card.legacy && <p className="text-xs">Legacy / Unverified link</p>}
    <h4 className="mt-1 font-medium">{card.subject}</h4>
    <p className="text-xs">From: {card.from || 'Not recorded'} · To: {card.to}{card.provider && ` · ${card.provider === 'gmail' ? 'Gmail' : 'Cloudflare email'}`}</p>
    <p className="mt-2 whitespace-pre-wrap">{card.body}</p>
    <button type="button" className="mt-3 underline" aria-expanded={expanded} aria-controls={`history-${card.key}`} onClick={() => { setExpanded(!expanded); if (!expanded && !loaded) void load() }}>Status history</button>
    {expanded && <div id={`history-${card.key}`} className="mt-2" aria-busy={loading}>
      {card.reference && <p className="text-xs">Provider reference: {card.reference}</p>}
      {loading && <p role="status">Loading history…</p>}
      {error && <p role="alert">{error} <button type="button" className="underline" onClick={() => void load()}>Retry</button></p>}
      {(!card.logicalId || (loaded && !events.length)) && <p>Status history unavailable for this record.</p>}
      <ol className="space-y-2">{events.map(e => <li key={e.id}><time dateTime={new Date(e.timestamp).toISOString()}>{date(e.timestamp)}</time> · {statusLabel(e.status)} · {e.actor}{e.attempt_number != null && ` · Attempt ${e.attempt_number}`}{e.provider_reference && <span className="block text-xs">Provider reference: {e.provider_reference}</span>}</li>)}</ol>
      {more && <button type="button" disabled={loading} className="mt-2 underline" onClick={() => void load()}>Load more history</button>}
    </div>}
  </li>
}
