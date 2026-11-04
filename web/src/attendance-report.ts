// Exact recurring series selected by the owner. Titles alone are not identity.
export const attendanceSelection = {
  calendar_id: '35924e97c4e2ba297a4f4f925584e92ee21229a40a1592870be3414dead9c552@group.calendar.google.com',
  series_id: '7ggsell6kej1abqp9v030et2ja',
  second_series_id: '3c69fv935ibfl22p9dpqufapum',
}
export const attendanceTimezone = 'Australia/Melbourne'
const parts = (value: number) => Object.fromEntries(new Intl.DateTimeFormat('en-AU', {
  timeZone: attendanceTimezone, year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
}).formatToParts(value).map(p => [p.type, p.value]))
const asUTC = (p: Record<string, string>) => Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second)
// Solve each local midnight independently, including weeks crossing DST.
function midnight(localDate: number) {
  let instant = localDate
  for (let i = 0; i < 3; i++) instant += localDate - asUTC(parts(instant))
  return instant
}
export function attendanceWeek(now: number, previous = false) {
  const p = parts(now), day = Date.UTC(+p.year, +p.month - 1, +p.day)
  const monday = day - ((new Date(day).getUTCDay() + 6) % 7 + (previous ? 7 : 0)) * 86400000
  return { starts_at: midnight(monday), ends_at: midnight(monday + 7 * 86400000) }
}
export const attendanceDate = (value: number) => new Intl.DateTimeFormat('en-AU', { timeZone: attendanceTimezone, day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }).format(value)
export const attendanceDay = (value: number) => new Intl.DateTimeFormat('en-AU', { timeZone: attendanceTimezone, day: 'numeric', month: 'short' }).format(value)
export type AttendanceRow = {
  id: string; application_id: string; candidate_name: string; calendar_event_id: string; meeting_code: string;
  starts_at: number; ends_at: number; enabled: number; source_ready: number; identity_linked: number;
  status: string | null; duration_seconds: number | null; first_join_at: number | null; last_leave_at: number | null;
  error_code: string | null; checked_at: number | null; total_count: number;
}
export function attendanceResult(row: AttendanceRow, now: number) {
  if (!row.enabled) return 'Tracking paused'
  if (!row.source_ready) return 'Meeting needs attention'
  if (row.ends_at > now) return row.starts_at > now ? 'Scheduled' : 'In progress'
  if (row.ends_at + 900000 > now) return 'Waiting for reporting window'
  const labels: Record<string, string> = {
    attended: 'Attended', not_observed: 'Not observed · review needed', identity_unresolved: 'Identity unresolved',
    no_record: 'No conference record', error: 'Check failed', scheduled: 'Awaiting attendance check',
  }
  return labels[row.status ?? ''] ?? 'Awaiting attendance check'
}
