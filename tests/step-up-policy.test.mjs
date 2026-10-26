import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { applyStepUpPolicy, stepUpEnabled } from '../scripts/step-up-policy.mjs'

const registry = JSON.parse(readFileSync(new URL('../mcp.json', import.meta.url), 'utf8'))
const declared = registry.tools.filter(t => t.step_up).map(t => t.name)

test('passkey step-up defaults to off', () => {
  for (const v of [undefined, '', 'off', 'false', '0', 'no']) assert.equal(stepUpEnabled(v), false)
  for (const v of ['on', 'ON', 'true', '1']) assert.equal(stepUpEnabled(v), true)
})

test('off: no registered tool requires passkey step-up', () => {
  assert.ok(declared.includes('approve_communication_template'))
  const out = applyStepUpPolicy(registry, false)
  assert.equal(out.tools.filter(t => t.step_up).length, 0)
  assert.equal(out.tools.length, registry.tools.length)
  assert.ok(registry.tools.some(t => t.step_up), 'source manifest is not mutated')
})

test('on: declared step-up tools are preserved', () => {
  const out = applyStepUpPolicy(registry, true)
  assert.deepEqual(out.tools.filter(t => t.step_up).map(t => t.name), declared)
})

test('web passkey ceremony is skipped unless enabled', () => {
  const src = readFileSync(new URL('../web/src/passkey.ts', import.meta.url), 'utf8')
  assert.match(src, /VITE_HIRING_PASSKEY_STEP_UP/)
  assert.match(src, /if \(!passkeyStepUpEnabled\) return/)
})
