import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
const read = p => readFileSync(new URL('../' + p, import.meta.url), 'utf8')
const decisions = JSON.parse(read('docs/conditional-workflow-decisions.json'))
const epic = JSON.parse(read('docs/next-stage-gates.json'))
const doc = read('docs/conditional-workflow-assessment.md')

test('conditional assessments independently deny build, activation and candidate transfer', () => {
  assert.equal(decisions.issue, 50)
  assert.equal(decisions.assessment_only, true)
  assert.equal(decisions.external_legal_signoff_required, false)
  assert.deepEqual(decisions.capabilities.map(c => c.id), ['ai_assistance', 'background_checks', 'agency_workflows'])
  for (const c of decisions.capabilities) {
    assert.equal(c.owner, 'Serge')
    assert.equal(c.decision, 'no_go')
    assert.equal(c.status, 'blocked')
    for (const field of ['implementation_authorized', 'production_activation_authorized', 'candidate_transfer_authorized']) assert.equal(c[field], false, `${c.id}:${field}`)
    assert.deepEqual(c.jurisdiction_legal_basis.jurisdiction, null)
    assert.equal(c.jurisdiction_legal_basis.basis, null)
    assert.equal(c.jurisdiction_legal_basis.status, 'unresolved')
    for (const field of ['security_review', 'commercial_review']) {
      assert.equal(c[field].status, 'pending')
      assert.equal(c[field].evidence, null)
      assert.ok(c[field].requirement.length > 100)
    }
    assert.ok(c.processor_data_flow.includes('->'))
    assert.ok(c.candidate_notice_impact.length > 80)
    assert.ok(c.launch_holds.length >= 2)
    const gate = epic.capabilities.find(g => g.id === c.id)
    assert.equal(gate.status ?? gate.delivery_status, c.status)
    assert.equal(gate.contract, 'docs/conditional-workflow-assessment.md')
    assert.equal(gate.candidate_transfer_authorized, false)
  }
})

test('each capability has owned, distinct follow-on backlog and review evidence requirements', () => {
  const ids = new Set()
  for (const c of decisions.capabilities) {
    assert.equal(c.follow_on_backlog.length, 4)
    for (const task of c.follow_on_backlog) {
      assert.ok(!ids.has(task.id)); ids.add(task.id)
      assert.equal(task.owner, c.owner)
      assert.equal(task.status, 'unstarted')
      assert.ok(task.requirement.length > 60)
    }
  }
  for (const phrase of ['automated ranking, rejection and offers', 'human editor and approving actor/time', 'synthetic fairness evaluation', 'prohibit training and secondary use', 'check-specific consent', 'separate affirmative representation/sharing consent', 'No broad agency candidate access', 'retention is a launch hold', 'queued retry', 'partial downstream deletion', 'no runtime authorization']) assert.ok(doc.includes(phrase), phrase)
})

test('assessment and epic handoff remain linked from the planning contracts', () => {
  for (const path of ['README.md', 'product-boundary.md', 'delivery-roadmap.md', 'next-stage-gates.md']) assert.ok(read('docs/' + path).includes('(conditional-workflow-assessment.md)'), path)
  for (const match of doc.matchAll(/\]\(([^)]+)\)/g)) assert.ok(existsSync(new URL('../docs/' + match[1], import.meta.url)), match[1])
})
