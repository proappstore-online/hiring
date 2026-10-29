import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createAttachmentScanner } from '../scripts/attachment-scanner.mjs'

const bytes = new Uint8Array([1, 2, 3])
const checksum = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), b => b.toString(16).padStart(2, '0')).join('')
const target = { storagePath: 'intake/id', checksum, mimeType: 'application/pdf', sizeBytes: bytes.length }

test('trusted scanner receives only bytes bound to the reserved checksum and size', async () => {
  const seen = []
  const inspect = createAttachmentScanner({
    readBytes: async path => { seen.push(path); return bytes },
    scanner: { scan: async (content, metadata) => { seen.push([...content], metadata); return 'clean' } },
  })
  assert.equal(await inspect(target), 'clean')
  assert.deepEqual(seen, ['intake/id', [1, 2, 3], { checksum, mimeType: 'application/pdf' }])
  assert.equal(await inspect({ ...target, checksum: 'a'.repeat(64) }), 'failed')
  assert.equal(await inspect({ ...target, sizeBytes: 2 }), 'failed')
  assert.equal(seen.length, 5) // Only the matching object reached the scanner.
  assert.throws(() => createAttachmentScanner({}), /required/)
})

test('storage errors, scanner errors and unknown verdicts fail closed', async () => {
  for (const readBytes of [async () => { throw Error('unavailable') }, async () => null]) {
    assert.equal(await createAttachmentScanner({ readBytes, scanner: { scan: async () => 'clean' } })(target), 'failed')
  }
  for (const scan of [async () => { throw Error('unavailable') }, async () => 'unknown']) {
    assert.equal(await createAttachmentScanner({ readBytes: async () => bytes, scanner: { scan } })(target), 'failed')
  }
  assert.equal(await createAttachmentScanner({ readBytes: async () => bytes, scanner: { scan: async () => 'infected' } })(target), 'infected')
})
