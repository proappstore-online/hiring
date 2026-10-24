import test from 'node:test'
import assert from 'node:assert/strict'
import { describeBackupProcedure, describeRestoreProcedure, verifyRestoreIntegrity } from '../scripts/backup-restore.mjs'

const fixture = () => ({ expected: { tombstones: ['brand-a:deleted-after-backup'], holds: ['brand-b:hold'], revocations: ['brand-a:revoked'] }, restored: { tombstones: ['brand-a:deleted-after-backup'], holds: ['brand-b:hold'], revocations: ['brand-a:revoked'] }, rpoMs: 100, maxRPOMs: 100, rtoMs: 200, maxRTOMs: 200 })

test('backup documents database, objects, independent ledgers and recovery objectives', () => {
  const steps = describeBackupProcedure().join('\n')
  for (const requirement of [/database snapshot/i, /object storage/i, /checksums/i, /encrypt/i, /tombstones/i, /holds/i, /revocations/i, /after backup/i, /RPO/, /RTO/]) assert.match(steps, requirement)
})
test('restore documents isolation, replay, holds, revocations, integrity and owner sign-off', () => {
  const steps = describeRestoreProcedure().join('\n')
  for (const requirement of [/isolated environment/i, /dispatch closed/i, /replay/i, /deletion records must remain/i, /owner holds/i, /revocations/i, /checksums/i, /RPO/, /RTO/, /owner signature/i]) assert.match(steps, requirement)
  assert.equal(verifyRestoreIntegrity(fixture()).valid, true)
})
for (const ledger of ['tombstones', 'holds', 'revocations']) {
  test(`restore rejects missing or substituted ${ledger}`, () => {
    const record = fixture()
    record.restored[ledger] = ['another-brand:unrelated']
    const result = verifyRestoreIntegrity(record)
    assert.equal(result.valid, false)
    assert.match(result.errors.join('\n'), new RegExp(`${ledger}: missing`))
  })
}
test('RPO/RTO require defined finite bounds and measurements within bounds', () => {
  for (const key of ['rpoMs', 'maxRPOMs', 'rtoMs', 'maxRTOMs']) {
    for (const value of [undefined, null, -1, Infinity, NaN, '100']) assert.equal(verifyRestoreIntegrity({ ...fixture(), [key]: value }).valid, false)
  }
  assert.equal(verifyRestoreIntegrity({ ...fixture(), rpoMs: 101 }).valid, false)
  assert.equal(verifyRestoreIntegrity({ ...fixture(), rtoMs: 201 }).valid, false)
})
test('missing and malformed ledger observations fail closed', () => {
  assert.equal(verifyRestoreIntegrity().valid, false)
  for (const value of [undefined, null, [''], ['duplicate', 'duplicate']]) {
    const record = fixture(); record.restored.holds = value
    assert.equal(verifyRestoreIntegrity(record).valid, false)
  }
})
