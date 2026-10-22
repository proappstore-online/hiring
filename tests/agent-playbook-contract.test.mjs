import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fixture } from './playbook-fixture.mjs'
import { interpretPlaybookRows, loadAgentPlaybook, PLAYBOOK_BOOTSTRAP } from '../scripts/agent-playbook-contract.mjs'

const unavailable = { status: 'unavailable', can_act: false }

test('registered read exposes schema 1 independently of current policy version', async () => {
  const { db, save, get, call } = fixture()
  try {
    const schema = JSON.parse(readFileSync(new URL('../contracts/org-playbook-read.v1.schema.json', import.meta.url)))
    save(0, 'owner-a', '{"meeting":{"time":"09:00"}}')
    save(1, 'owner-a', '{"meeting":{"time":"10:00"}}')
    const rows = get('agent')
    assert.deepEqual(Object.keys(rows[0]).sort(), schema.items.required.toSorted())
    assert.equal(rows[0].schema_version, schema.items.properties.schema_version.const)
    assert.equal(rows[0].version, 2)
    const loaded = await loadAgentPlaybook((name, params) => call(name, 'agent', params), 'a')
    assert.equal(loaded.status, 'ready')
    assert.equal(loaded.version, 2)
    assert.equal(loaded.payload.meeting.time, '10:00')
    // Minimal historical object remains readable without invented policy defaults.
    save(2)
    assert.deepEqual(interpretPlaybookRows(get('agent')).payload, {})
  } finally { db.close() }
})

test('agent contract denies other tenants, unsupported roles and requisition-only grants', () => {
  const { db, save, get } = fixture()
  try {
    save()
    for (const user of ['owner-b', 'outsider', 'reviewer', 'auditor', 'scoped', null]) {
      assert.deepEqual(get(user), [])
      assert.deepEqual(interpretPlaybookRows(get(user)), unavailable)
    }
    assert.deepEqual(interpretPlaybookRows(get('agent', 'b')), unavailable)
    assert.deepEqual(interpretPlaybookRows(get('agent', 'nonexistent')), unavailable)
    assert.equal(interpretPlaybookRows(get('agent')).status, 'ready')
    db.exec("INSERT INTO hiring_grants(id,organization_id,brand_id,user_id,role,granted_by,created_at) VALUES ('brand-agent','a','brand-a','brand-agent','recruiter','owner-a',0)")
    assert.equal(interpretPlaybookRows(get('brand-agent')).status, 'ready')
    db.exec("UPDATE hiring_grants SET status='revoked' WHERE user_id='agent'")
    assert.deepEqual(interpretPlaybookRows(get('agent')), unavailable)
    db.exec("UPDATE hiring_organizations SET status='suspended' WHERE id='a'")
    assert.deepEqual(interpretPlaybookRows(get('owner-a')), unavailable)
  } finally { db.close() }
})

test('missing and denied reads stop policy-dependent activity without leaking tenant existence', () => {
  const { db, get } = fixture()
  try {
    assert.deepEqual(interpretPlaybookRows(get('agent')), { status:'missing', can_act:false, schema_version:1, version:0 })
    for (const org of ['a', 'b', 'nonexistent']) assert.deepEqual(interpretPlaybookRows(get('outsider', org)), unavailable)
  } finally { db.close() }
})

test('registered redaction applies to every supported role and nested arrays', () => {
  const { db, save, get } = fixture()
  try {
    const payload = { meeting: { time:'09:00', Secret_reference:'sensitive' }, steps:[{ MEETING_PASSWORD:'sensitive', nested:[{secret_url:'sensitive',label:'observe'}] }] }
    save(0,'owner-a',JSON.stringify(payload))
    for (const user of ['owner-a','recruiter','agent']) {
      const loaded = interpretPlaybookRows(get(user))
      assert.equal(loaded.status, 'ready')
      assert.deepEqual(loaded.payload,{meeting:{time:'09:00'},steps:[{nested:[{label:'observe'}]}]})
      assert.ok(!JSON.stringify(loaded).includes('sensitive'))
    }
  } finally { db.close() }
})

test('invalid and future schemas fail closed without echoing policy or error content', async () => {
  const valid = {schema_version:1,version:1,payload:'{}',updated_at:123,actor_user_id:'owner',message:null}
  const invalid = [null, {}, [], [valid,valid], [{...valid,schema_version:2}], [{...valid,version:0}],
    [{...valid,version:1.5}], [{...valid,updated_at:null}], [{...valid,actor_user_id:null}],
    [{...valid,message:'unexpected'}], [{...valid,extra:true}]]
  for (const payload of ['invalid', '[]', 'null', '42', '{"nested":[{"Secret_link":"sensitive"}]}', '{"MEETING_PASSWORD":"sensitive"}']) invalid.push([{...valid,payload}])
  for (const rows of invalid) assert.deepEqual(interpretPlaybookRows(rows), unavailable)
  for (const code of ['FORBIDDEN', 'UNAUTHENTICATED', 'timeout']) {
    assert.deepEqual(await loadAgentPlaybook(async () => { throw Error(code + ' sensitive') }, 'a'), unavailable)
  }
  let calls = 0
  assert.deepEqual(await loadAgentPlaybook(async () => { calls++; return [valid] }, ''), unavailable)
  assert.equal(calls,0)
  // A later denied read never uses an earlier successful policy.
  assert.equal((await loadAgentPlaybook(async () => [valid], 'a')).status,'ready')
  assert.deepEqual(await loadAgentPlaybook(async () => [], 'a'),unavailable)
})

test('documented bootstrap matches reference instruction and contains no mutable policy', () => {
  const doc = readFileSync(new URL('../docs/agent-playbook-contract.md',import.meta.url),'utf8')
  assert.ok(doc.includes('> ' + PLAYBOOK_BOOTSTRAP))
  assert.ok(PLAYBOOK_BOOTSTRAP.length < 400)
})
