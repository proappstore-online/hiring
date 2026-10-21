import type { Communication, Draft } from './api'

export const statusLabel = (status: string) => ({ draft: 'Draft', pending: 'Queued', queued: 'Queued', sending: 'Sending', sent: 'Sent (provider accepted)', accepted: 'Sent (provider accepted)', failed: 'Failed', unknown: 'Unknown', cancelled: 'Cancelled', received: 'Received' })[status] ?? 'Unknown'
export function emailCards(drafts: Draft[], archives: Communication[]) {
  const cards = drafts.map(d => ({ key: `outbox:${d.id}`, logicalId: d.logical_email_id, subject: d.subject, body: d.body, status: d.current_status ?? d.delivery_state, at: d.latest_activity_at ?? d.created_at, timeLabel: d.latest_activity_at ? 'Latest activity' : 'Created', from: '', to: d.recipient_email, provider: '', reference: '', legacy: !d.logical_email_id }))
  for (const a of archives) {
    const linked = a.logical_email_id && cards.find(c => c.logicalId === a.logical_email_id)
    if (linked) {
      linked.from = a.from_email; linked.to = a.to_email; linked.provider = a.provider; linked.reference = a.provider_message_id
      linked.at = Math.max(linked.at, a.occurred_at); linked.timeLabel = 'Latest activity'
    } else cards.push({ key: `${a.channel}:${a.id}`, logicalId: a.logical_email_id, subject: a.subject, body: a.body, status: a.direction === 'inbound' ? 'received' : 'accepted', at: a.occurred_at, timeLabel: 'Provider event', from: a.from_email, to: a.to_email, provider: a.provider, reference: a.provider_message_id, legacy: !a.logical_email_id })
  }
  return cards.sort((a, b) => b.at - a.at || a.key.localeCompare(b.key))
}
