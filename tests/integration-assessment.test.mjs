import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'

const url = new URL('../docs/integration-assessment.md', import.meta.url)
const doc = readFileSync(url, 'utf8')
const decisions = JSON.parse(readFileSync(new URL('../docs/integration-decisions.json', import.meta.url)))

test('integration evaluation leaves each distinct approval gate closed', () => {
  assert.equal(decisions.version, 1)
  assert.equal(decisions.issue, 41)
  assert.equal(decisions.implementation_authorized, false)
  assert.deepEqual(decisions.gates.map(g => g.id), ['calendar', 'job_listing', 'job_candidate_transfer'])
  for (const gate of decisions.gates) {
    assert.equal(gate.status, 'blocked', gate.id)
    assert.equal(gate.approved_contract, null, gate.id)
    assert.equal(gate.candidate_transfer_authorized, false, gate.id)
  }
})

test('assessment covers capability, privacy, security, commercial terms and separate transfer approval', () => {
  for (const heading of ['Current capability and dependency', 'Capability assessment', 'Data sharing and consent', 'Security and failure assessment', 'Commercial and privacy due diligence', 'Approval gates and implementation handoff']) {
    assert.ok(doc.includes(`## ${heading}`), heading)
  }
  for (const requirement of ['No external candidate transfer without', 'approved contract', 'Separate job-board candidate-transfer gate', 'Calendar or listing approval cannot satisfy this gate', 'server-enforced approval lookup', 'No lawyer sign-off', 'reconcile timeouts', 'cross-brand', 'subprocessors', '#38']) assert.ok(doc.includes(requirement), requirement)
  for (const match of doc.matchAll(/\]\(([^)]+)\)/g)) {
    if (!match[1].startsWith('https://')) assert.ok(existsSync(new URL(match[1].split('#')[0], url)), match[1])
  }
  for (const path of ['README.md', 'delivery-roadmap.md', 'product-boundary.md']) assert.ok(readFileSync(new URL('../docs/' + path, import.meta.url), 'utf8').includes('(integration-assessment.md)'), path)
})
