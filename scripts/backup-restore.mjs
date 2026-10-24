// Procedural checks only: callers supply observations from a real isolated drill.
export function describeBackupProcedure() {
  return [
    'Define owner-approved RPO and RTO bounds in milliseconds before the drill.',
    'Record release SHA, schema migrations, backup timestamp and access controls.',
    'Export a consistent database snapshot using the platform-supported procedure.',
    'Export matching private object storage with inventory and checksums; encrypt and restrict both exports.',
    'Preserve the latest deletion tombstones, owner holds and revocations independently of the snapshot, including changes after backup.',
    'Verify snapshot and object checksums and record the protected backup location.'
  ]
}

export function describeRestoreProcedure() {
  return [
    'Restore the database snapshot and object storage to an isolated environment with intake, access and dispatch closed.',
    'Apply compatible additive migrations before dependent tools and clients.',
    'Replay the latest deletion tombstones across every store before reopening; deletion records must remain and erased content must not return.',
    'Preserve owner holds and revocations from the independent latest ledger; verify revoked access remains denied.',
    'Verify retained row/object inventory and checksums, erased-content denial, brand isolation and audit integrity; hold unknown sends for manual reconciliation.',
    'Measure RPO (lost-data interval) and RTO (time until verified recovery) in milliseconds against owner-defined bounds.',
    'Record evidence and obtain the owner signature on the restore drill and launch/rollback record before reopening.'
  ]
}

// Each ledger is an array of immutable, scoped record IDs from the independent
// latest checkpoint, compared with the observed restored ledger. This does not
// verify content erasure or evidence authenticity; operators must do those checks.
export function verifyRestoreIntegrity(options = {}) {
  const errors = []
  for (const name of ['tombstones', 'holds', 'revocations']) {
    const expected = options.expected?.[name]
    const restored = options.restored?.[name]
    const valid = values => Array.isArray(values) && values.every(id => typeof id === 'string' && id.trim()) && new Set(values).size === values.length
    if (!valid(expected) || !valid(restored)) {
      errors.push(`${name}: explicit unique record-ID arrays required`)
      continue
    }
    const found = new Set(restored)
    for (const id of expected) if (!found.has(id)) errors.push(`${name}: missing ${id}`)
  }
  for (const metric of ['rpo', 'rto']) {
    const measured = options[`${metric}Ms`]
    const bound = options[`max${metric.toUpperCase()}Ms`]
    if (!Number.isFinite(measured) || measured < 0 || !Number.isFinite(bound) || bound < 0) errors.push(`${metric}: nonnegative measured value and defined bound required in milliseconds`)
    else if (measured > bound) errors.push(`${metric}: exceeds owner-defined bound`)
  }
  return { valid: errors.length === 0, errors }
}
