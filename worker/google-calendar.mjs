// Google credentials belong to PAS. Hiring stores only an exact calendar grant.
const rows = result => result?.rows ?? result?.results?.at(-1)?.rows ?? []
const changed = result => (result?.results?.at(-1)?.meta?.changes ?? result?.meta?.changes ?? 0) > 0
export class CalendarError extends Error {
  constructor(code, status = 400) { super(code); this.code = code; this.status = status }
}
const fail = (code, status) => { throw new CalendarError(code, status) }
export async function calendarCall(pas, request) {
  if (!pas.connectors?.googleCalendar) fail('google_not_configured', 503)
  const result = await pas.connectors.googleCalendar('calendar', request)
  if (result?.error) fail(result.error, result.status ?? 502)
  return result
}
const scopeOf = value => {
  if (!value || !['organization_id', 'brand_id'].every(k => typeof value[k] === 'string' && value[k].length > 0 && value[k].length <= 128)) fail('invalid_scope')
  return { organization_id: value.organization_id, brand_id: value.brand_id }
}
const settingsPath = scope => `/recruiter/organizations/${encodeURIComponent(scope.organization_id)}/brands/${encodeURIComponent(scope.brand_id)}/settings`
async function settings(pas, scope, manage = false) {
  const value = rows(await pas.actions.call('get_google_calendar_settings', scope))[0]
  if (!value || (manage && !value.can_manage)) fail('forbidden', 403)
  return { ...scope, ...value }
}
export async function verifyConnection(pas, connection) {
  const grant = await calendarCall(pas, { operation: 'grant_status', grant_id: connection.connection_id })
  if (grant.user_id !== connection.connected_by || grant.calendar_id !== connection.calendar_id) fail('connection_invalid', 403)
  return grant
}
async function revokeConnection(pas, connection) {
  // Metadata actions are user-callable: a forged grant reference must never revoke another owner's grant.
  try { await verifyConnection(pas, connection) } catch (error) {
    if (['connection_invalid', 'reconnect_required'].includes(error.code)) return
    throw error
  }
  await calendarCall(pas, { operation: 'revoke_grant', grant_id: connection.connection_id })
}
async function activeConnection(pas, scope) {
  const connection = await settings(pas, scope)
  if (connection.status !== 'connected' || !connection.connection_id || !connection.owner_active) fail('reconnect_required', 409)
  await verifyConnection(pas, connection)
  return connection
}
export function calendarOccurrence(event) {
  if (event.status === 'cancelled') return { event_status: 'cancelled', starts_at: 0, ends_at: 1, meeting_code: '' }
  const uri = event.hangoutLink ?? event.conferenceData?.entryPoints?.find(p => p.entryPointType === 'video')?.uri
  let code
  try { const url = new URL(uri); if (url.protocol === 'https:' && url.hostname === 'meet.google.com') code = url.pathname.slice(1) } catch { /* Not a Meet event. */ }
  const starts_at = Date.parse(event.start?.dateTime), ends_at = Date.parse(event.end?.dateTime)
  if (!/^[a-z]{3}-[a-z]{4}-[a-z]{3}$/.test(code ?? '') || !Number.isFinite(starts_at) || !Number.isFinite(ends_at) || ends_at <= starts_at || ends_at - starts_at > 86_400_000) return null
  return { event_status: 'confirmed', meeting_code: code, starts_at, ends_at }
}
export const calendarEvent = (pas, connection, eventId) => calendarCall(pas, { operation: 'event', grant_id: connection.connection_id, event_id: eventId })
async function listPages(pas, request, field) {
  const items = [], seen = new Set(); let page_token = ''
  for (let page = 0; page < 5; page++) {
    const data = await calendarCall(pas, { ...request, page_token })
    if (!Array.isArray(data[field])) fail('google_invalid_response', 502)
    items.push(...data[field]); page_token = data.next_page_token ?? data.nextPageToken ?? ''
    if (!page_token) return items
    if (typeof page_token !== 'string' || seen.has(page_token)) fail('google_invalid_response', 502)
    seen.add(page_token)
  }
  fail('calendar_too_large', 422)
}
async function hash(value) {
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)))].map(b => b.toString(16).padStart(2, '0')).join('')
}

export async function handleGoogleCalendar(request, pas) {
  try {
    const url = new URL(request.url), path = url.pathname
    if (!path.startsWith('/google/')) return new Response('Not found', { status: 404 })
    let body = {}
    if (request.method === 'POST') {
      if (!request.headers.get('content-type')?.startsWith('application/json')) fail('json_required', 415)
      try { body = await request.json() } catch { fail('invalid_json') }
      if (!body || typeof body !== 'object' || Array.isArray(body)) fail('invalid_json')
    }
    if (path === '/google/complete' && request.method === 'POST') {
      return Response.json(await calendarCall(pas, { operation: 'complete', code: body.code, state: body.state }))
    }
    const scope = scopeOf(request.method === 'GET' ? Object.fromEntries(url.searchParams) : body)
    if (path === '/google/status' && request.method === 'GET') {
      const c = await settings(pas, scope)
      const account = c.can_manage ? await calendarCall(pas, { operation: 'status' }) : { configured: true }
      let connection_valid = c.status === 'connected' && !!c.owner_active
      if (connection_valid) { try { await verifyConnection(pas, c) } catch { connection_valid = false } }
      return Response.json({ status: c.status, account_email: c.account_email, calendar_id: c.calendar_id, calendar_name: c.calendar_name, version: c.version, can_manage: !!c.can_manage, configured: account.configured, owner_active: !!c.owner_active, connection_valid, account_connected: !!account.connected, available_account_email: account.email ?? null })
    }
    if (path === '/google/start' && request.method === 'POST') {
      await settings(pas, scope, true)
      return Response.json(await calendarCall(pas, { operation: 'start', callback_path: '/recruiter/google-calendar/callback', return_to: settingsPath(scope) }))
    }
    if (path === '/google/disconnect' && request.method === 'POST') {
      const c = await settings(pas, scope, true)
      if (body.expected_version !== c.version) fail('connection_changed', 409)
      if (!changed(await pas.actions.call('disconnect_google_calendar', { ...scope, expected_version: c.version, operation_id: crypto.randomUUID() }))) fail('connection_changed', 409)
      if (c.connection_id) await revokeConnection(pas, c)
      return Response.json({ ok: true })
    }
    if (path === '/google/calendars' && request.method === 'GET') {
      await settings(pas, scope, true)
      return Response.json({ calendars: await listPages(pas, { operation: 'calendars' }, 'calendars') })
    }
    if (path === '/google/select' && request.method === 'POST') {
      const c = await settings(pas, scope, true)
      if (body.expected_version !== c.version) fail('connection_changed', 409)
      const grant = await calendarCall(pas, { operation: 'grant', calendar_id: body.calendar_id })
      if (grant.user_id !== c.user_id) fail('connection_invalid', 403)
      let saved = false
      try {
        saved = changed(await pas.actions.call('link_google_calendar_grant', { ...scope, connection_id: grant.grant_id, account_email: grant.account_email, calendar_id: grant.calendar_id, calendar_name: grant.calendar_name, expected_version: c.version, operation_id: crypto.randomUUID() }))
      } catch { /* Verify uncertain writes before revoking the new grant. */ }
      if (!saved) saved = (await settings(pas, scope, true)).connection_id === grant.grant_id
      if (!saved) {
        await calendarCall(pas, { operation: 'revoke_grant', grant_id: grant.grant_id })
        fail('connection_changed', 409)
      }
      if (c.connection_id && c.connection_id !== grant.grant_id) await revokeConnection(pas, c)
      return Response.json({ ok: true })
    }
    if (!['/google/events', '/google/track'].includes(path)) return new Response('Not found', { status: 404 })
    if ((path === '/google/events' && request.method !== 'GET') || (path === '/google/track' && request.method !== 'POST')) return new Response('Method not allowed', { status: 405 })
    const c = await activeConnection(pas, scope)
    if (path === '/google/events') {
      const events = await listPages(pas, { operation: 'events', grant_id: c.connection_id }, 'items')
      return Response.json({ events: events.flatMap(event => { const occurrence = calendarOccurrence(event); return occurrence?.event_status === 'confirmed' ? [{ id: event.id, title: event.summary ?? 'Meeting', ...occurrence }] : [] }) })
    }
    if (typeof body.event_id !== 'string' || !body.event_id || body.event_id.length > 1024) fail('invalid_event')
    if (typeof body.application_id !== 'string' || !body.application_id || body.application_id.length > 128) fail('invalid_application')
    const occurrence = calendarOccurrence(await calendarEvent(pas, c, body.event_id))
    if (!occurrence || occurrence.event_status !== 'confirmed') fail('meeting_unavailable', 409)
    const { event_status, ...timing } = occurrence
    const target_id = 'calendar-' + await hash(JSON.stringify([scope.organization_id, scope.brand_id, body.application_id, c.calendar_id, body.event_id]))
    const lookup = { ...scope, application_id: body.application_id, target_id }
    const existing = rows(await pas.actions.call('list_meeting_attendance', lookup))[0]
    if (existing?.enabled === 1 && existing.google_user_id && (!body.google_user_id || body.google_user_id === existing.google_user_id)) return Response.json({ ok: true, target_id })
    await pas.actions.call('configure_meeting_attendance', { ...scope, target_id, application_id: body.application_id, kind: 'working_interview', interview_id: null, calendar_id: c.calendar_id, calendar_event_id: body.event_id, google_user_id: body.google_user_id || existing?.google_user_id || null, ...timing, enabled: 1, expected_version: existing?.version ?? 0, operation_id: crypto.randomUUID() })
    if (!rows(await pas.actions.call('list_meeting_attendance', lookup)).some(t => t.id === target_id && t.enabled === 1)) fail('forbidden', 403)
    return Response.json({ ok: true, target_id })
  } catch (error) {
    return Response.json({ error: error instanceof CalendarError ? error.code : 'calendar_request_failed' }, { status: error instanceof CalendarError ? error.status : 500 })
  }
}
