import { test } from 'node:test'
import assert from 'node:assert/strict'
import { fixture, A, B, application } from './receipt-fixture.mjs'

const links = [{ url: 'https://portfolio.example/work', label: 'Portfolio' }, { url: 'http://github.example/candidate', label: '' }]

test('candidate links are saved with the application and receipt, and scoped staff can read them', () => {
  const f = fixture()
  try {
    f.publish()
    const input = { ...application(), links_json: JSON.stringify(links) }
    assert.equal(f.call('submit_job_application', 'worker', input).at(-1), 1)
    const stored = f.db.prepare('SELECT links_json, submitted_snapshot_json FROM hiring_applications WHERE id=?').get(input.application_id)
    assert.deepEqual(JSON.parse(stored.links_json), links)
    assert.deepEqual(JSON.parse(stored.submitted_snapshot_json).links, links)
    assert.deepEqual(JSON.parse(f.call('get_my_application_receipt', 'worker', { idempotency_key: input.idempotency_key })[0].payload_json).links, links)
    assert.deepEqual(JSON.parse(f.call('get_application', 'staff-a', { ...A, application_id: input.application_id })[0].links_json), links)
    assert.deepEqual(f.call('get_application', 'staff-b', { ...A, application_id: input.application_id }), [])
    assert.deepEqual(f.call('get_application', 'staff-b', { ...B, application_id: input.application_id }), [])
    assert.equal(f.call('list_applications', 'staff-a', { ...A })[0].links_json, stored.links_json)
    assert.equal(f.call('get_my_application', 'worker', { application_id: input.application_id })[0].links_json, stored.links_json)
    assert.equal(f.call('get_my_application', 'other-worker', { application_id: input.application_id }).length, 0)
  } finally { f.db.close() }
})

test('submission rejects malformed, unsafe and over-limit links without creating an application', () => {
  const invalid = ['not json', '{}', JSON.stringify([{ url: 'javascript:alert(1)' }]), JSON.stringify([{ url: 'https://' }]), JSON.stringify([{ url: 'https://example.com', label: 42 }]), JSON.stringify([{ url: 'https://example.com', label: 'x'.repeat(101) }]), JSON.stringify(Array.from({ length: 11 }, () => ({ url: 'https://example.com' })))]
  for (const links_json of invalid) {
    const f = fixture()
    try {
      f.publish()
      const result = f.call('submit_job_application', 'worker', { ...application(), links_json })
      assert.ok(result.every(count => count === 0), links_json)
      assert.equal(f.db.prepare('SELECT count(*) AS n FROM hiring_applications').get().n, 0)
    } finally { f.db.close() }
  }
})

test('staff-created applications accept links without changing the existing profile URL', () => {
  const f = fixture()
  try {
    const input = { ...A, candidate_id: 'manual-candidate', application_id: 'manual-application', operation_id: 'manual-create', candidate_name: 'Manual Candidate', email: 'manual@example.com', phone: '', source: 'manual', source_detail: 'Direct referral', basis_reference: 'Policy', contact_context: 'Candidate supplied', assignee_user_id: 'staff-a', profile_url: 'https://linkedin.com/in/candidate', links_json: JSON.stringify(links) }
    assert.equal(f.call('create_application', 'staff-a', input).at(-1), 1)
    const row = f.call('get_application', 'staff-a', { ...A, application_id: input.application_id })[0]
    assert.equal(row.profile_url, input.profile_url)
    assert.deepEqual(JSON.parse(row.links_json), links)
  } finally { f.db.close() }
})
