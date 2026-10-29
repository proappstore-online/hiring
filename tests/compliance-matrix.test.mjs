import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'

const document = new URL('../docs/compliance-verification.md', import.meta.url)
const matrix = readFileSync(document, 'utf8')
const register = JSON.parse(readFileSync(new URL('../docs/launch-evidence.json', import.meta.url)))

test('policy matrix maps every release gate to criterion, repository evidence and backlog handoff', () => {
  const rows = matrix.split('\n').filter(line => /^\| `[^`]+` \|/.test(line))
  assert.equal(rows.length, register.checks.length)
  for (const check of register.checks) {
    const matches = rows.filter(row => row.startsWith(`| \`${check.id}\` |`))
    assert.equal(matches.length, 1, check.id)
    const row = matches[0]
    assert.ok(row.includes(`| ${check.gate} |`), check.id)
    assert.ok(row.includes(check.criterion), check.id)
    assert.ok(row.includes(check.issue), check.id)
    assert.ok(row.includes(check.blocker.next_action), check.id)
    for (const path of check.repository_evidence) assert.ok(row.includes(`../${path}`), path)
  }
  assert.match(matrix, /owner for every requirement: \*\*Serge/i)
})

test('matrix sources and discoverability links resolve', () => {
  for (const match of matrix.matchAll(/\]\(([^)]+)\)/g)) {
    assert.ok(existsSync(new URL(match[1], document)), match[1])
  }
  for (const path of ['README.md', 'delivery-roadmap.md']) {
    assert.ok(readFileSync(new URL('../docs/' + path, import.meta.url), 'utf8').includes('(compliance-verification.md)'))
  }
})

test('verification design preserves approved policies and explicitly records manual workflow gaps', () => {
  for (const phrase of ['No scheduled purge', 'No lawyer sign-off', 'unchecked', 'No ranking, rejection or offer solely by AI', 'immediate revocation', 'screen-reader', 'Unsupported IDs/callbacks/bounces', 'No workflow code is changed', 'not a full release-evidence interlock', 'all its checks are currently blocked', '#108', '#35', '#36', '#37', '#38', '#42', '#47', '#48', '#58']) {
    assert.ok(matrix.includes(phrase), phrase)
  }
  for (const workflow of ['ci.yml', 'compliance.yml', 'deploy.yml']) assert.ok(matrix.includes(`../.github/workflows/${workflow}`))
})
