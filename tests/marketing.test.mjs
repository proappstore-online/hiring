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

test('marketing app identity and URLs come from shared site configuration', () => {
  // Recruiting prose may say hiring; app-specific destinations belong in site.ts.
  const walk = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? walk(join(dir, entry.name)) : [join(dir, entry.name)])
  for (const file of walk(resolve(root, 'marketing/src')).filter((f) => f.endsWith('.astro'))) {
    assert.doesNotMatch(readFileSync(file, 'utf8'), /https:\/\/(?:about-)?hiring\.proappstore\.online|The hiring team/, file)
  }
})

test('marketing describes existing recruiting features and discloses the closed intake gate', () => {
  const config = read('marketing/src/site.ts')
  assert.doesNotMatch(config, /Describe in one or two sentences|First benefit|Second benefit|Third benefit|Describe the first thing/)
  assert.match(config, /Public candidate intake remains closed/)
  assert.match(config, /Provider acceptance is recorded separately from confirmed delivery/)
})

test('public copy contains no template commercial or fulfillment promises', () => {
  const privacy = read('marketing/src/pages/privacy.astro')
  const terms = read('marketing/src/pages/terms.astro')
  assert.doesNotMatch(privacy, /We do not process special-category|we delete your content and account details|We use cookieless analytics/)
  assert.doesNotMatch(terms, /Some features may require a paid subscription|access continues until the end|We will give reasonable notice/)
  assert.match(privacy, /retained indefinitely/)
  assert.match(privacy, /Core erasure does not establish complete deletion/)
  assert.match(terms, /Human reviewers remain responsible/)
  assert.doesNotMatch(read('marketing/src/pages/index.astro'), /<form|\/enquiries/)
})

test('approved copy stays in draft presentation until identity and publication are verified', () => {
  assert.match(read('marketing/src/site.ts'), /approvalStatus: 'pending'/)
  assert.doesNotMatch(read('marketing/src/site.ts'), /The hiring team/)
  assert.match(read('marketing/src/layouts/Layout.astro'), /noindex, nofollow/)
  assert.match(read('marketing/src/layouts/Layout.astro'), /await owner approval/)
  assert.match(read('marketing/src/layouts/Legal.astro'), /Draft version \{site.legalVersion\}/)
  const review = JSON.parse(read('docs/public-copy-review.json'))
  assert.equal(review.status, 'approved')
  assert.equal(review.reviewer, 'Serge Ivy (owner)')
  assert.equal(review.reviewed_at, '2026-10-29')
  assert.equal(review.approval_evidence, 'https://github.com/proappstore-online/hiring/issues/36#issuecomment-6490651741')
  for (const field of ['operator', 'public_contact', 'processor_arrangements']) assert.equal(review[field], null)
  const gate = JSON.parse(read('docs/launch-evidence.json')).checks.find(check => check.id === 'identity-policies')
  assert.equal(gate.status, 'blocked')
})

test('copy review binds the exact marketing source and existing brand assets', async () => {
  const { createHash } = await import('node:crypto')
  const review = JSON.parse(read('docs/public-copy-review.json'))
  assert.match(read('marketing/src/site.ts'), new RegExp(review.copy_version))
  const walk = dir => readdirSync(resolve(root, dir), { withFileTypes: true }).flatMap(entry =>
    entry.isDirectory() ? walk(`${dir}/${entry.name}`) : [`${dir}/${entry.name}`])
  const expected = [...walk('marketing/src'), ...walk('marketing/public'), 'web/public/icon-192.png', 'web/public/icon-512.png', 'web/public/og-image.png'].sort()
  assert.deepEqual(Object.keys(review.files).sort(), expected)
  for (const [file, digest] of Object.entries(review.files)) {
    assert.equal(createHash('sha256').update(readFileSync(resolve(root, file))).digest('hex'), digest, file)
  }
})
