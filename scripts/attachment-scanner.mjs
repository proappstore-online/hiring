// Trusted-worker integration seam. The browser never supplies a clean verdict.
// A future PAS worker can inject byte access and a scanner, then act on a verdict
// after the platform provides object binding and scoped serving.
export function createAttachmentScanner({ readBytes, scanner }) {
  if (typeof readBytes !== 'function' || typeof scanner?.scan !== 'function') throw new TypeError('readBytes and scanner.scan are required')
  return async ({ storagePath, checksum, mimeType }) => {
    const bytes = await readBytes(storagePath)
    if (!(bytes instanceof Uint8Array)) throw new TypeError('readBytes must return Uint8Array')
    const verdict = await scanner.scan(bytes, { checksum, mimeType })
    if (!['clean', 'infected', 'failed'].includes(verdict)) throw new TypeError('Invalid scanner verdict')
    return verdict
  }
}
