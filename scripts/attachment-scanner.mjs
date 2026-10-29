// Trusted-worker integration seam. The browser never supplies a clean verdict.
// The adapter binds bytes to the reserved checksum before trusting a scanner.
// It does not grant download access or persist a verdict by itself.
export function createAttachmentScanner({ readBytes, scanner }) {
  if (typeof readBytes !== 'function' || typeof scanner?.scan !== 'function') throw new TypeError('readBytes and scanner.scan are required')
  return async ({ storagePath, checksum, mimeType, sizeBytes }) => {
    if (typeof storagePath !== 'string' || !storagePath || !/^[a-f0-9]{64}$/.test(checksum) || !Number.isInteger(sizeBytes) || sizeBytes < 1 || sizeBytes > 5242880) return 'failed'
    try {
      const bytes = await readBytes(storagePath)
      if (!(bytes instanceof Uint8Array) || bytes.byteLength !== sizeBytes) return 'failed'
      const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))
      const actual = Array.from(digest, byte => byte.toString(16).padStart(2, '0')).join('')
      if (actual !== checksum) return 'failed'
      const verdict = await scanner.scan(bytes, { checksum, mimeType })
      return ['clean', 'infected'].includes(verdict) ? verdict : 'failed'
    } catch {
      // Storage and scanner failures are retryable; never infer a clean verdict.
      return 'failed'
    }
  }
}
