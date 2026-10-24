// Hiring MCP gateway contract: the pure rules every gateway call must follow.
// The deployed enforcement boundary is the registered SQL action (membership
// EXISTS in every statement, identity from :__user_id). These helpers define the
// envelope, error codes, pagination, redaction and rate limiting that callers
// and a future admin-enabled worker share. See docs/hiring-mcp-contract.md.

export const ERROR_CODES = Object.freeze(['UNAUTHENTICATED', 'FORBIDDEN', 'NOT_FOUND', 'CONFLICT', 'VALIDATION', 'RATE_LIMITED'])
export const MAX_PAGE_SIZE = 25
const MAX_ID_LENGTH = 128

// Caller input may never carry identity, role or grant claims.
const FORBIDDEN_KEY = /^(__.*|user_?id|actor(_user)?_?id|role|roles|grants?|permissions?|is_?(admin|owner)|tenant(_id)?|scope)$/i

export class GatewayError extends Error {
  constructor(code, message, requestId = null) {
    super(message)
    if (!ERROR_CODES.includes(code)) throw new TypeError(`unknown gateway error code ${code}`)
    this.name = 'GatewayError'
    this.code = code
    this.requestId = requestId
  }
  toJSON() {
    return { ok: false, error: { code: this.code, message: this.message, request_id: this.requestId } }
  }
}

export const ok = (data, requestId = null) => ({ ok: true, data, request_id: requestId })

// Drop identity/role claims from tool input. The server derives grants itself.
export function stripForgedClaims(args = {}) {
  const clean = {}
  const stripped = []
  for (const [key, value] of Object.entries(args ?? {})) {
    if (FORBIDDEN_KEY.test(key)) stripped.push(key)
    else clean[key] = value
  }
  return { args: clean, stripped }
}

const isId = value => typeof value === 'string' && value.trim().length > 0 && value.length <= MAX_ID_LENGTH

// Validate the explicit organization/brand selection. `strict` rejects forged
// claims with VALIDATION instead of silently stripping them.
export function parseEnvelope(input, { requestId = null, strict = false } = {}) {
  const { args, stripped } = stripForgedClaims(input)
  if (strict && stripped.length) throw new GatewayError('VALIDATION', `forbidden arguments: ${stripped.join(', ')}`, requestId)
  for (const key of ['organization_id', 'brand_id']) {
    if (!isId(args[key])) throw new GatewayError('VALIDATION', `${key} is required`, requestId)
  }
  return { args, stripped, organization_id: args.organization_id, brand_id: args.brand_id, request_id: requestId }
}

// Keyset cursor over (updated_at DESC, id ASC). Opaque to callers.
export function encodeCursor(row, field = 'updated_at') {
  return Buffer.from(JSON.stringify({ t: row[field], i: row.id })).toString('base64url')
}

export function decodeCursor(cursor, requestId = null) {
  if (cursor === undefined || cursor === null || cursor === '') return { cursor_at: null, cursor_id: null }
  try {
    const { t, i } = JSON.parse(Buffer.from(String(cursor), 'base64url').toString('utf8'))
    if (Number.isSafeInteger(t) && isId(i)) return { cursor_at: t, cursor_id: i }
  } catch { /* fall through */ }
  throw new GatewayError('VALIDATION', 'invalid cursor', requestId)
}

export function clampPageSize(requested) {
  const n = Number(requested ?? MAX_PAGE_SIZE)
  if (!Number.isInteger(n) || n < 1) return MAX_PAGE_SIZE
  return Math.min(n, MAX_PAGE_SIZE)
}

// A full page may have a successor; a short page is the end.
export function paginate(rows, { pageSize = MAX_PAGE_SIZE, cursorField = 'updated_at' } = {}) {
  const limit = clampPageSize(pageSize)
  const items = rows.slice(0, limit)
  const next_cursor = rows.length >= limit && items.length ? encodeCursor(items.at(-1), cursorField) : null
  return { items, next_cursor }
}

const CONTACT_FIELDS = ['email', 'phone', 'linkedin_url', 'contact_context', 'basis_reference', 'source_detail']
export const REDACTION_PROFILES = Object.freeze({
  full: [],
  restricted: CONTACT_FIELDS,
})

// Restricted view hides contact and free-text fields and exposes presence flags only.
export function redact(row, profile = 'restricted') {
  const hidden = REDACTION_PROFILES[profile]
  if (!hidden) throw new GatewayError('VALIDATION', `unknown redaction profile ${profile}`)
  const out = { ...row }
  for (const field of hidden) {
    if (field in out) {
      if (['email', 'phone', 'linkedin_url'].includes(field)) out[`has_${field.replace('_url', '')}`] = Boolean(out[field])
      delete out[field]
    }
  }
  return out
}

// Masks unauthorized existence: an empty read is NOT_FOUND whether the record is
// missing or the caller has no grant.
export function singleResult(rows, requestId = null) {
  if (!rows?.length) throw new GatewayError('NOT_FOUND', 'not found', requestId)
  return ok(rows[0], requestId)
}

export function listResult(rows, { pageSize, requestId = null } = {}) {
  return ok(paginate(rows, { pageSize }), requestId)
}

// PAS reports per-statement change counts for batch tools. The final statement
// is the audit/commit marker; zero means nothing was applied (stale version,
// replayed operation or no grant), which must not be reported as success.
export function mutationResult(changes, requestId = null) {
  const applied = Array.isArray(changes) && changes.length > 0 && changes.at(-1) > 0
  if (!applied) throw new GatewayError('CONFLICT', 'not applied: stale version, replayed operation or no grant', requestId)
  return ok({ applied: true }, requestId)
}

// In-memory limiter for a future trusted gateway. Legacy gateway reads do not
// enforce it. Search uses its own durable atomic SQL budget (search-tools.mjs).
export function createRateLimiter({ limit, windowMs, now = Date.now }) {
  const buckets = new Map()
  return key => {
    const t = now()
    const bucket = buckets.get(key)
    if (!bucket || t - bucket.start >= windowMs) { buckets.set(key, { start: t, count: 1 }); return }
    if (bucket.count >= limit) throw new GatewayError('RATE_LIMITED', 'rate limit exceeded')
    bucket.count += 1
  }
}
