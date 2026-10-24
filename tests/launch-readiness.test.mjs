import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { checkLaunchEvidence, REQUIRED_CHECKS } from '../scripts/launch-readiness.mjs'

const revision = 'a'.repeat(40)
const now = Date.parse('2026-10-24T10:00:00Z')
const fixture = () => ({ version: 1, revision, environment: 'https://hiring.proappstore.online', checks: REQUIRED_CHECKS.map(id => ({ id, owner: 'Owner', reviewer: 'Reviewer', status: 'pass', evidence: 'https://example.com/restricted-evidence', reviewed_at: '2026-10-24T09:00:00Z' })) })

test('release evidence requires every scenario and signed review for the exact live revision', () => {
  assert.equal(checkLaunchEvidence(fixture(), revision, now).ready, true)
  for (const id of REQUIRED_CHECKS) {
    for (const patch of [{ status: 'pending' }, { status: 'failed' }, { reviewer: '' }, { owner: '' }, { evidence: null }, { evidence: 'http://example.com' }, { evidence: 'https://secret@example.com' }, { reviewed_at: 'invalid' }, { reviewed_at: '2099-01-01' }]) {
      const record = fixture()
      Object.assign(record.checks.find(check => check.id === id), patch)
      assert.equal(checkLaunchEvidence(record, revision, now).ready, false, `${id}: ${JSON.stringify(patch)}`)
    }
    const missing = fixture(); missing.checks = missing.checks.filter(check => check.id !== id)
    assert.equal(checkLaunchEvidence(missing, revision, now).ready, false)
  }
})

test('malformed, duplicate, unknown and stale revision evidence cannot approve release', () => {
  for (const record of [null, {}, { ...fixture(), version: 2 }, { ...fixture(), checks: null }, { ...fixture(), environment: 'file:///tmp/local' }, { ...fixture(), checks: [...fixture().checks, fixture().checks[0]] }, { ...fixture(), checks: [...fixture().checks, { id: 'invented' }] }]) {
    assert.equal(checkLaunchEvidence(record, revision, now).ready, false)
  }
  assert.equal(checkLaunchEvidence(fixture(), 'b'.repeat(40), now).ready, false)
  assert.equal(checkLaunchEvidence({ ...fixture(), revision: undefined }, undefined, now).ready, false)
})

test('repository evidence and CLI hold launch until real artifacts and reviews exist', () => {
  const record = JSON.parse(readFileSync(new URL('../docs/launch-evidence.json', import.meta.url)))
  assert.equal(checkLaunchEvidence(record, revision, now).ready, false)
  const cli = spawnSync(process.execPath, ['scripts/launch-readiness.mjs', 'docs/launch-evidence.json', revision], { encoding: 'utf8' })
  assert.equal(cli.status, 1)
  assert.match(cli.stdout, /Launch held/)
  const missing = spawnSync(process.execPath, ['scripts/launch-readiness.mjs', '/nonexistent/evidence.json', revision], { encoding: 'utf8' })
  assert.equal(missing.status, 1)
  assert.match(missing.stderr, /Launch held/)
})
