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

test('APPNAME appears only in files pas create substitutes', () => {
  // pas create replaces APPNAME in .ts/.json/... but not .astro, so app config stays in src/site.ts.
  const walk = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? walk(join(dir, entry.name)) : [join(dir, entry.name)])
  for (const file of walk(resolve(root, 'marketing/src')).filter((f) => f.endsWith('.astro'))) {
    assert.doesNotMatch(readFileSync(file, 'utf8'), /APPNAME/, file)
  }
})
