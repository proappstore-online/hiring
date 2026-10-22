// Optional caller adapter for the registered SQL action; not a deployed gateway.
// Authorization and redaction remain server-side in mcp.json.
export const PLAYBOOK_SCHEMA_VERSION = 1
export const PLAYBOOK_BOOTSTRAP = 'Before recruiting activity, load get_org_recruiting_playbook for the authorised organisation and follow its current version. On missing, denied, invalid or failed reads, stop policy-dependent activity and ask the organisation owner. Never use cached policy or infer redacted join details.'

const object = value => value !== null && typeof value === 'object' && !Array.isArray(value)
const secretKey = key => /^secret_/i.test(key) || /^meeting_password$/i.test(key)
function containsSecret(value) {
  return value !== null && typeof value === 'object' && Object.entries(value).some(([key, child]) => secretKey(key) || containsSecret(child))
}
const unavailable = () => ({ status: 'unavailable', can_act: false })

// Input is the extracted query rows, never a transport-specific MCP envelope.
// Invalid/unknown shapes fail closed; errors and payloads are never echoed.
export function interpretPlaybookRows(rows) {
  if (!Array.isArray(rows) || rows.length !== 1 || !object(rows[0])) return unavailable()
  const row = rows[0]
  const keys = ['schema_version', 'version', 'payload', 'updated_at', 'actor_user_id', 'message']
  if (Object.keys(row).length !== keys.length || !keys.every(key => Object.hasOwn(row, key)) ||
      row.schema_version !== PLAYBOOK_SCHEMA_VERSION || !Number.isSafeInteger(row.version) || row.version < 0) return unavailable()
  if (row.version === 0) {
    return row.payload === null && row.updated_at === null && row.actor_user_id === null && row.message === 'No playbook configured'
      ? { status: 'missing', can_act: false, schema_version: 1, version: 0 } : unavailable()
  }
  if (typeof row.payload !== 'string' || !Number.isSafeInteger(row.updated_at) || row.updated_at < 0 ||
      typeof row.actor_user_id !== 'string' || !row.actor_user_id.length || row.message !== null) return unavailable()
  try {
    const payload = JSON.parse(row.payload)
    if (!object(payload) || containsSecret(payload)) return unavailable()
    // Ready means policy loaded, not permission to send mail or reveal secrets.
    return { status: 'ready', schema_version: 1, version: row.version, payload,
      updated_at: row.updated_at, actor_user_id: row.actor_user_id }
  } catch { return unavailable() }
}

export async function loadAgentPlaybook(readRows, organizationId) {
  if (typeof organizationId !== 'string' || !organizationId.trim()) return unavailable()
  try {
    return interpretPlaybookRows(await readRows('get_org_recruiting_playbook', { organization_id: organizationId }))
  } catch { return unavailable() }
}
