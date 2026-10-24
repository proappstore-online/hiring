export type PlaybookPayload = {
  meeting?: { time?: string; timezone?: string; cadence?: string; join_instructions?: string; [key: string]: unknown }
  [key: string]: unknown
}
export type Playbook = { version: number; payload: string | null }
export type WorkingInterviewRecord = {
  id: string; version: number; invitation: string; owner_user_id: string; playbook_version: number;
  outcome: string | null; exceptions: string | null; invited_at: number; completed_at: number | null;
  created_at: number; actor_user_id: string
}
export function parsePlaybook(payload: string | null): PlaybookPayload {
  const value: unknown = JSON.parse(payload ?? '{}')
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('Playbook must be a JSON object.')
  return value as PlaybookPayload
}
export function meetingTiming(payload: PlaybookPayload): string | null {
  const m = payload.meeting
  if (typeof m?.time !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(m.time) || typeof m.timezone !== 'string') return null
  try { new Intl.DateTimeFormat('en', { timeZone: m.timezone }).format() } catch { return null }
  return `${m.time} (${m.timezone})`
}
export function composeInvitation(name: string, payload: PlaybookPayload): string {
  const timing = meetingTiming(payload)
  if (!timing) return ''
  return `Dear ${name},\n\nWe would like to invite you to a working interview at ${timing}. You will observe our daily stand-up meeting to learn how the team works. Please remain after stand-up for a one-to-one interview, where we can discuss the role and answer your questions.\n\n[Join details will be sent separately]\n\nPlease confirm your availability. We look forward to meeting you.\n\nKind regards,\nThe recruiting team`
}
