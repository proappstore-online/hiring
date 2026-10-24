import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
const playbook = read('docs/incident-response.md')
const tabletops = JSON.parse(read('docs/incident-tabletops.json'))

test('versioned incident playbook covers response stages and resolves local references', () => {
  assert.match(playbook, /Version 1/)
  for (const section of ['Command and escalation', 'Triage and containment', 'Affected-tenant and candidate assessment', 'Evidence handling and processor contact', 'Jurisdiction and notification decision', 'Recovery and closure', 'Restricted incident record template', 'Exercises and readiness']) {
    assert.ok(playbook.includes(`## ${section}`), section)
  }
  for (const [, path] of playbook.matchAll(/\]\(([^)#]+)(?:#[^)]*)?\)/g)) {
    assert.ok(existsSync(new URL(`../docs/${path}`, import.meta.url)), path)
  }
  for (const safeguard of ['no dedicated', 'overlapping', 'compatibility actions', 'earliest plausible clock', 'no-notify', 'checksum', 'No approved jurisdiction', 'no unreviewed public claim']) {
    assert.ok(playbook.includes(safeguard), safeguard)
  }
})

test('both synthetic tabletops record all required stages without claiming live success', () => {
  assert.equal(tabletops.version, 1)
  assert.equal(tabletops.playbook_version, 1)
  assert.deepEqual(tabletops.exercises.map(e => e.id).sort(), ['cross-brand-exposure', 'lost-candidate-token'])
  for (const exercise of tabletops.exercises) {
    for (const key of ['date', 'facilitator', 'detection', 'containment', 'candidate_impact', 'evidence', 'notification_decision', 'remediation', 'follow_up']) {
      assert.ok(typeof exercise[key] === 'string' && exercise[key].trim(), `${exercise.id}: ${key}`)
    }
    assert.equal(exercise.mode, 'synthetic-desk-walkthrough')
    assert.equal(exercise.outcome, 'unverified')
    assert.equal(exercise.live_evidence, null)
    assert.deepEqual(exercise.operator_participants, [])
  }
})

test('incident readiness remains blocked pending real owner and exercise evidence', () => {
  const gate = JSON.parse(read('docs/launch-evidence.json')).checks.find(c => c.id === 'incident-response')
  assert.equal(gate.status, 'blocked')
  assert.equal(gate.evidence, null)
  assert.match(gate.blocker.reason, /backup/)
  assert.match(gate.blocker.reason, /jurisdiction/)
  assert.ok(gate.repository_evidence.includes('docs/incident-response.md'))
})
