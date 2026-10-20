import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'

const script = new URL('../scripts/deploy-json.mjs', import.meta.url)
const parse = (mode, path, input, fallback) => spawnSync(process.execPath, [script.pathname, mode, path, ...(fallback === undefined ? [] : [fallback])], { input: JSON.stringify(input), encoding: 'utf8' })

test('portable deploy parser extracts responses without printing credentials by default', () => {
  const response = { ok: true, value: 'oidc-token', applied: ['0005'], warnings: ['check scope'], accessKeyId: 'key' }
  assert.equal(parse('true', 'ok', response).status, 0)
  assert.equal(parse('raw', 'value', response).stdout, 'oidc-token')
  assert.equal(parse('raw', 'missing', response).stdout, '')
  assert.equal(parse('json', 'applied', response).stdout, '["0005"]')
  assert.equal(parse('json', 'already', response, '[]').stdout, '[]')
  assert.equal(parse('lines', 'warnings', response, '::warning::mcp.json: ').stdout, '::warning::mcp.json: check scope\n')
  assert.equal(parse('true', 'ok', { ok: false }).status, 1)
  const invalid = spawnSync(process.execPath, [script.pathname, 'raw', 'value'], { input: '{', encoding: 'utf8' })
  assert.equal(invalid.status, 1)
  assert.equal(invalid.stdout, '')
})
