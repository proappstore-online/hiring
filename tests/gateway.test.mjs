import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import * as gw from '../scripts/gateway-contract.mjs'

const migrations = JSON.parse(readFileSync(new URL('../migrations.json', import.meta.url)))
const tools = JSON.parse(readFileSync(new URL('../mcp.json', import.meta.url))).tools
const gateway = tools.filter(t => t.name.startsWith('gateway_'))
const find = name => { const t = tools.find(x => x.name === name); assert.ok(t, name); return t }

function fixture() {
  const db = new DatabaseSync(':memory:')
  db.exec('PRAGMA foreign_keys=ON')
  for (const m of migrations.migrations) db.exec(m.sql)
  let clock = 1_000
  const call = (name, user, values = {}) => {
    const tool = find(name)
    const optional = Object.fromEntries(Object.entries(tool.params ?? {}).filter(([, s]) => s.optional).map(([k]) => [k, null]))
    const params = { ...optional, ...values, __user_id: user, __now: ++clock, __uuid: crypto.randomUUID() }
    const out = []
    db.exec('BEGIN')
    try {
      for (const statement of tool.statements ?? [tool.sql]) {
        const binds = []
        const sql = statement.replace(/:([a-z_][a-z0-9_]*)/gi, (_, k) => { binds.push(params[k]); return '?' })
        assert.ok(binds.every(v => v !== undefined), `${name}: missing param`)
        out.push(tool.operation === 'query' ? db.prepare(sql).all(...binds) : db.prepare(sql).run(...binds).changes)
      }
      db.exec('COMMIT')
      return tool.operation === 'query' ? out[0] : out
    } catch (e) { db.exec('ROLLBACK'); throw e }
  }
  return { db, call }
}

const A = { organization_id: 'org-a', brand_id: 'brand-a' }
const B = { organization_id: 'org-b', brand_id: 'brand-b' }
const boot = (s, req, op) => ({ ...s, requisition_id: req, organization_name: s.organization_id, brand_name: s.brand_id, requisition_title: `Role ${req}`, operation_id: op })
const person = (s, n) => ({ ...s, requisition_id: s.brand_id === 'brand-a' ? 'req-a' : 'req-b', candidate_id: `c-${s.brand_id}-${n}`, application_id: `app-${s.brand_id}-${n}`, operation_id: `op-${s.brand_id}-${n}`, candidate_name: `Person ${n}`, email: `p${n}@example.com`, phone: '555-0100', linkedin_url: 'https://www.linkedin.com/in/p', source_detail: 'secret source text', basis_reference: 'secret basis', contact_context: 'secret context', assignee_user_id: s.brand_id === 'brand-a' ? 'staff-a' : 'staff-b' })

function seeded(count = 3) {
  const f = fixture()
  f.call('create_workspace', 'staff-a', boot(A, 'req-a', 'boot-a'))
  f.call('create_workspace', 'staff-b', boot(B, 'req-b', 'boot-b'))
  for (let i = 1; i <= count; i++) {
    assert.equal(f.call('create_linkedin_application', 'staff-a', person(A, i)).at(-1), 1)
  }
  assert.equal(f.call('create_linkedin_application', 'staff-b', person(B, 1)).at(-1), 1)
  return f
}

test('gateway tools are schema-coherent and accept no identity or role parameters', () => {
  assert.deepEqual(gateway.map(t => t.name).sort(), ['gateway_get_application', 'gateway_get_requisition', 'gateway_list_applications', 'gateway_list_requisitions'])
  for (const t of gateway) {
    assert.equal(t.requires_auth, true)
    assert.equal(t.operation, 'query', 'reads cannot write audit rows in one query; see contract gaps')
    for (const s of t.statements ?? [t.sql]) {
      assert.ok(!s.includes(';'), `${t.name}: semicolon`)
      assert.match(s, /LIMIT (1|25)$/, `${t.name}: bounded`)
      assert.match(s, /hiring_effective_access p WHERE p\.organization_id=:organization_id AND p\.brand_id=:brand_id AND p\.user_id=:__user_id/)
      const used = new Set([...s.matchAll(/:([a-z_][a-z0-9_]*)/gi)].map(m => m[1]).filter(n => !n.startsWith('__')))
      assert.deepEqual([...used].sort(), Object.keys(t.params).sort(), `${t.name}: declared params match SQL`)
    }
    for (const key of Object.keys(t.params)) assert.ok(!/user|role|actor|grant/i.test(key), `${t.name}: forged-claim param ${key}`)
  }
})

test('forged user_id and role arguments are ignored by the SQL actions', () => {
  const { call } = seeded()
  const forged = { ...A, user_id: 'staff-a', role: 'owner', actor_user_id: 'staff-a', __user_id: 'ignored' }
  // The platform binds :__user_id itself; undeclared arguments never reach SQL.
  assert.equal(call('gateway_list_applications', 'outsider', { ...A, user_id: 'staff-a', role: 'owner', actor_user_id: 'staff-a' }).length, 0)
  assert.equal(call('gateway_list_requisitions', 'outsider', { ...A, user_id: 'staff-a', role: 'owner' }).length, 0)
  assert.equal(call('gateway_list_applications', 'staff-a', A).length, 3)
  const { args, stripped } = gw.stripForgedClaims(forged)
  assert.deepEqual(args, A)
  assert.deepEqual(stripped.sort(), ['__user_id', 'actor_user_id', 'role', 'user_id'])
  assert.throws(() => gw.parseEnvelope(forged, { strict: true }), e => e.code === 'VALIDATION')
})

test('forged tenant IDs and cross-brand access are denied and masked', () => {
  const { call } = seeded()
  assert.equal(call('gateway_list_applications', 'staff-b', A).length, 0)
  assert.equal(call('gateway_list_requisitions', 'staff-b', A).length, 0)
  assert.equal(call('gateway_get_application', 'staff-b', { ...A, application_id: 'app-brand-a-1' }).length, 0)
  assert.equal(call('gateway_get_requisition', 'staff-b', { ...A, requisition_id: 'req-a' }).length, 0)
  // Real brand-b IDs under brand-a's scope, and brand-a IDs under brand-b's scope.
  assert.equal(call('gateway_get_application', 'staff-a', { ...A, application_id: 'app-brand-b-1' }).length, 0)
  assert.equal(call('gateway_get_application', 'staff-a', { organization_id: 'org-b', brand_id: 'brand-a', application_id: 'app-brand-a-1' }).length, 0)
  assert.equal(call('gateway_get_application', 'staff-b', { ...B, application_id: 'app-brand-a-1' }).length, 0)
  assert.equal(call('gateway_list_applications', 'staff-b', B).length, 1)
  assert.throws(() => gw.singleResult(call('gateway_get_application', 'staff-b', { ...A, application_id: 'app-brand-a-1' })), e => e.code === 'NOT_FOUND')
})

test('outsiders are denied everything', () => {
  const { call } = seeded()
  for (const [name, extra] of [['gateway_list_applications', {}], ['gateway_list_requisitions', {}], ['gateway_get_application', { application_id: 'app-brand-a-1' }], ['gateway_get_requisition', { requisition_id: 'req-a' }]]) {
    assert.equal(call(name, 'outsider', { ...A, ...extra }).length, 0, name)
    assert.equal(call(name, 'staff-a', { ...A, ...extra }).length > 0, true, name)
  }
})

test('keyset pagination is bounded to 25 and cursors round-trip without gaps or repeats', () => {
  const { call } = seeded(30)
  const seen = []
  let cursor = null
  let pages = 0
  for (;;) {
    const rows = call('gateway_list_applications', 'staff-a', { ...A, ...gw.decodeCursor(cursor) })
    assert.ok(rows.length <= 25)
    const page = gw.paginate(rows)
    seen.push(...page.items.map(r => r.id))
    pages++
    if (!page.next_cursor) break
    cursor = page.next_cursor
  }
  assert.equal(pages, 2)
  assert.equal(seen.length, 30)
  assert.equal(new Set(seen).size, 30)
  assert.deepEqual(gw.decodeCursor(gw.encodeCursor({ id: 'x', updated_at: 5 })), { cursor_at: 5, cursor_id: 'x' })
  for (const bad of ['!!!', Buffer.from('{"t":"x","i":1}').toString('base64url')]) assert.throws(() => gw.decodeCursor(bad), e => e.code === 'VALIDATION')
  assert.equal(gw.clampPageSize(1000), 25)
  assert.equal(gw.clampPageSize(0), 25)
  assert.equal(gw.clampPageSize(3), 3)
})

test('requisition pagination handles ties on created_at', () => {
  const { db, call } = seeded(1)
  for (let i = 0; i < 30; i++) db.prepare("INSERT INTO hiring_requisitions(id,organization_id,brand_id,title,created_at) VALUES (?,?,?,?,?)").run(`r-${String(i).padStart(2, '0')}`, 'org-a', 'brand-a', 't', 50)
  const first = call('gateway_list_requisitions', 'staff-a', A)
  assert.equal(first.length, 25)
  const second = call('gateway_list_requisitions', 'staff-a', { ...A, cursor_at: first.at(-1).created_at, cursor_id: first.at(-1).id })
  const ids = [...first, ...second].map(r => r.id)
  assert.equal(new Set(ids).size, ids.length)
  assert.equal(ids.length, 31)
})

test('gateway reads are redacted; the full recruiter view still has contact details', () => {
  const { call } = seeded()
  const [row] = call('gateway_get_application', 'staff-a', { ...A, application_id: 'app-brand-a-1' })
  for (const hidden of ['email', 'phone', 'linkedin_url', 'contact_context', 'basis_reference', 'source_detail']) assert.ok(!(hidden in row), hidden)
  assert.equal(row.has_email, 1)
  assert.equal(row.has_phone, 1)
  assert.equal(row.has_linkedin, 1)
  assert.equal(row.candidate_name, 'Person 1')
  assert.equal(JSON.stringify(row).includes('example.com'), false)
  const [full] = call('list_applications', 'staff-a', A)
  assert.ok(full.email && full.phone)
  const sample = { id: 'a', email: 'x@y.z', phone: '', linkedin_url: null, contact_context: 'c', stage: 'submitted' }
  assert.deepEqual(gw.redact(sample, 'restricted'), { id: 'a', stage: 'submitted', has_email: true, has_phone: false, has_linkedin: false })
  assert.deepEqual(gw.redact(sample, 'full'), sample)
  assert.throws(() => gw.redact(sample, 'nope'), e => e.code === 'VALIDATION')
})

test('structured errors, zero-change mapping and rate limiting', () => {
  for (const code of gw.ERROR_CODES) assert.equal(new gw.GatewayError(code, 'm', 'req-1').toJSON().error.code, code)
  assert.throws(() => new gw.GatewayError('BOOM', 'x'), TypeError)
  assert.throws(() => gw.parseEnvelope({ organization_id: 'o' }, { requestId: 'r' }), e => e.code === 'VALIDATION' && e.requestId === 'r')
  assert.throws(() => gw.mutationResult([1, 1, 0]), e => e.code === 'CONFLICT')
  assert.throws(() => gw.mutationResult([]), e => e.code === 'CONFLICT')
  assert.equal(gw.mutationResult([1, 1, 1]).ok, true)
  let t = 0
  const limit = gw.createRateLimiter({ limit: 2, windowMs: 100, now: () => t })
  limit('k'); limit('k')
  assert.throws(() => limit('k'), e => e.code === 'RATE_LIMITED')
  limit('other')
  t = 100
  limit('k')
})

test('replayed operation IDs on mutations behind the gateway write nothing twice', () => {
  const { db, call } = seeded(1)
  const again = { ...person(A, 1) }
  assert.equal(call('create_linkedin_application', 'staff-a', again).at(-1), 0)
  assert.equal(db.prepare("SELECT count(*) AS n FROM hiring_audit_events WHERE application_id='app-brand-a-1'").get().n, 1)
  const stage = { ...A, application_id: 'app-brand-a-1', expected_version: 1, from_stage: 'submitted', to_stage: 'in_review', reason: 'r', operation_id: 'stage-x' }
  assert.equal(call('change_application_stage', 'staff-a', stage).at(-1), 1)
  assert.equal(call('change_application_stage', 'staff-a', stage).at(-1), 0)
  assert.equal(call('gateway_get_application', 'staff-a', { ...A, application_id: 'app-brand-a-1' })[0].version, 2)
})
