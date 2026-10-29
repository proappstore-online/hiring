import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createAttachmentScanner } from '../scripts/attachment-scanner.mjs'

test('trusted scanner adapter accepts injected byte reader and scanner', async () => {
  const seen = []
  const inspect = createAttachmentScanner({
    readBytes: async path => { seen.push(path); return new Uint8Array([1, 2, 3]) },
    scanner: { scan: async (bytes, metadata) => { seen.push([...bytes], metadata); return 'clean' } },
  })
  assert.equal(await inspect({ storagePath: 'intake/id', checksum: 'abc', mimeType: 'application/pdf' }), 'clean')
  assert.deepEqual(seen, ['intake/id', [1, 2, 3], { checksum: 'abc', mimeType: 'application/pdf' }])
  assert.throws(() => createAttachmentScanner({}), /required/)
})
