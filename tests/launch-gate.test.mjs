import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { checkLaunchGate } from '../scripts/launch-gate.mjs'

const decision = () => ({ id: 'launch-decision', status: 'approved', reviewer: 'Owner', reviewed_at: '2026-10-24T09:00:00Z' })
function withEvidence(t, record) {
  const directory = mkdtempSync(join(tmpdir(), 'hiring-launch-'))
  t.after(() => rmSync(directory, { recursive: true, force: true }))
  const path = join(directory, 'evidence.json')
  if (record !== undefined) writeFileSync(path, JSON.stringify(record))
  return path
}
test('missing evidence blocks launch', t => assert.equal(checkLaunchGate(withEvidence(t)).approved, false))
test('missing launch decision blocks launch', t => assert.equal(checkLaunchGate(withEvidence(t, { checks: [] })).approved, false))
for (const patch of [{ status: 'blocked' }, { reviewer: undefined }, { reviewer: ' ' }, { reviewed_at: undefined }, { reviewed_at: 'invalid' }, { reviewed_at: '2099-01-01T00:00:00Z' }]) {
  test(`incomplete decision blocks launch: ${JSON.stringify(patch)}`, t => {
    assert.equal(checkLaunchGate(withEvidence(t, { checks: [{ ...decision(), ...patch }] })).approved, false)
  })
}
test('complete owner decision passes signature check and CLI', t => {
  const path = withEvidence(t, { checks: [decision()] })
  assert.equal(checkLaunchGate(path).approved, true)
  assert.equal(spawnSync(process.execPath, ['scripts/launch-gate.mjs', path]).status, 0)
})
test('duplicate and malformed evidence block launch and CLI', t => {
  const path = withEvidence(t, { checks: [decision(), decision()] })
  assert.equal(checkLaunchGate(path).approved, false)
  writeFileSync(path, '{broken')
  assert.equal(checkLaunchGate(path).approved, false)
  assert.equal(spawnSync(process.execPath, ['scripts/launch-gate.mjs', path]).status, 1)
})
