import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const read = (path) => readFileSync(resolve(root, path), 'utf8')

test('the marketing site pins Astro and ships home, Privacy and Terms pages', () => {
  const pkg = JSON.parse(read('marketing/package.json'))

  assert.match(pkg.devDependencies.astro, /^\d+\.\d+\.\d+$/)
  assert.deepEqual(readdirSync(resolve(root, 'marketing/src/pages')).sort(), ['index.astro', 'privacy.astro', 'terms.astro'])
  assert.match(read('marketing/astro.config.ts'), /output: 'static'/)
})

test('hiring appears only in files pas create substitutes', () => {
  // pas create replaces hiring in .ts/.json/... but not .astro, so app config stays in src/site.ts.
  const walk = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? walk(join(dir, entry.name)) : [join(dir, entry.name)])
  for (const file of walk(resolve(root, 'marketing/src')).filter((f) => f.endsWith('.astro'))) {
    assert.doesNotMatch(readFileSync(file, 'utf8'), /hiring/, file)
  }
})

test('marketing describes existing recruiting features and discloses the closed intake gate', () => {
  const config = read('marketing/src/site.ts')
  assert.doesNotMatch(config, /Describe in one or two sentences|First benefit|Second benefit|Third benefit|Describe the first thing/)
  assert.match(config, /Public candidate intake remains closed/)
  assert.match(config, /Provider acceptance is recorded separately from confirmed delivery/)
})
