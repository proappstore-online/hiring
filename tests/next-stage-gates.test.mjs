import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'

const root = new URL('../', import.meta.url)
const read = path => readFileSync(new URL(path, root), 'utf8')
const register = JSON.parse(read('docs/next-stage-gates.json'))
const expected = {
  talent_pool: 39, funnel_analytics: 40,
  calendar: 41, job_listing: 41, job_candidate_transfer: 41,
  import: 49, outbound_webhooks: 49,
  ai_assistance: 50, background_checks: 50, agency_workflows: 50,
}

test('epic assigns every child capability independent approval and review gates', () => {
  assert.equal(register.version, 1)
  assert.equal(register.issue, 44)
  assert.equal(register.launch_dependency, 38)
  assert.equal(register.capabilities.length, Object.keys(expected).length)
  assert.deepEqual(Object.fromEntries(register.capabilities.map(c => [c.id, c.issue])), expected)
  for (const capability of register.capabilities) {
    assert.equal(capability.owner, 'Serge', capability.id)
    assert.deepEqual(capability.approval, { status: 'pending', evidence: null }, capability.id)
    assert.deepEqual(Object.keys(capability.reviews), ['legal_basis_and_notice', 'fairness', 'security', 'commercial'])
    for (const review of Object.values(capability.reviews)) {
      assert.deepEqual(review, { status: 'pending', evidence: null }, capability.id)
    }
    assert.equal(capability.production_activation_authorized, false, capability.id)
    assert.equal(capability.candidate_transfer_authorized, false, capability.id)
    assert.ok(capability.unblock_criteria.trim().length > 50, capability.id)
  }
})

test('implemented internal features do not open conditional or sibling integration gates', () => {
  const integrations = JSON.parse(read('docs/integration-decisions.json'))
  assert.equal(integrations.implementation_authorized, false)
  for (const capability of register.capabilities) {
    const internal = ['talent_pool', 'funnel_analytics'].includes(capability.id)
    assert.equal(capability.delivery_status, internal ? 'repository_implemented' : 'blocked', capability.id)
    const integration = integrations.gates.find(g => g.id === capability.id)
    if (capability.issue === 41) {
      assert.ok(integration, capability.id)
      assert.equal(integration.status, capability.delivery_status)
      assert.equal(integration.candidate_transfer_authorized, capability.candidate_transfer_authorized)
      assert.equal(integration.approved_contract, null)
    }
    if (internal) {
      assert.equal(capability.repository_tests.length, 2)
      const names = JSON.parse(read('mcp.json')).tools.map(t => t.name)
      assert.ok(names.includes(capability.issue === 39 ? 'list_talent_pool' : 'get_funnel_analytics'))
    }
  }
})

test('gate evidence links resolve and the epic is discoverable from planning contracts', () => {
  const doc = read('docs/next-stage-gates.md')
  for (const capability of register.capabilities) {
    for (const path of [capability.contract, ...capability.repository_tests]) {
      assert.ok(existsSync(new URL(path, root)), path)
    }
  }
  for (const match of doc.matchAll(/\]\(([^)]+)\)/g)) {
    assert.ok(existsSync(new URL(match[1].split('#')[0], new URL('docs/', root))), match[1])
  }
  for (const path of ['README.md', 'delivery-roadmap.md', 'product-boundary.md', 'capability-governance-gates.md']) {
    assert.ok(read(`docs/${path}`).includes('(next-stage-gates.md)'), path)
  }
})

test('handoff preserves owner policy, assessment-only boundaries and server enforcement requirements', () => {
  assert.equal(register.external_legal_signoff_required, false)
  const doc = read('docs/next-stage-gates.md')
  for (const requirement of [
    'waives external legal sign-off', 'Indefinite application',
    'must not build or enable', 'no automated ranking, rejection or offers',
    'trusted server-side approval lookup', 'before every operation and queued retry',
    'expired, revoked and wrong-brand', 'editing a status field alone grants no runtime permission',
    'Actual revision-bound live evidence', 'not a deployed authorization service',
  ]) assert.ok(doc.includes(requirement), requirement)
})
