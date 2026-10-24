import { readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

// This checks recorded attestations, not their authenticity or the live system.
export const REQUIRED_CHECKS = Object.freeze([
  'identity-policies', 'intake-files', 'intake-authorization', 'security',
  'accessibility', 'monitoring', 'incident-response', 'privacy', 'ci-deploy',
  'recovery', ...Array.from({ length: 7 }, (_, i) => `scenario-${i + 1}`),
  'launch-decision',
])
const text = value => typeof value === 'string' && value.trim().length > 0
const https = value => {
  try { const url = new URL(value); return url.protocol === 'https:' && !url.username && !url.password }
  catch { return false }
}

export function checkLaunchRegister(record) {
  const errors = []
  if (record?.version !== 1) errors.push('Unsupported evidence version')
  const checks = Array.isArray(record?.checks) ? record.checks : []
  for (const id of REQUIRED_CHECKS) {
    const entries = checks.filter(check => check?.id === id)
    if (entries.length !== 1) { errors.push(`${id}: exactly one check required`); continue }
    const check = entries[0]
    if (!text(check.owner) || !text(check.criterion) || !/^#\d+$/.test(check.issue ?? '') || !['intake', 'launch'].includes(check.gate)) errors.push(`${id}: owner, criterion, issue and gate required`)
    if (!Array.isArray(check.repository_evidence) || !check.repository_evidence.length || !check.repository_evidence.every(text)) errors.push(`${id}: repository evidence required`)
    if (!['pass', 'pending', 'failed', 'blocked'].includes(check.status)) errors.push(`${id}: invalid status`)
    if (check.status !== 'pass' && (!['owner_action', 'infrastructure', 'implementation_dependency'].includes(check.blocker?.kind) || !text(check.blocker?.reason) || !text(check.blocker?.next_action))) errors.push(`${id}: unresolved check needs blocker kind, reason and next action`)
  }
  if (checks.some(check => !REQUIRED_CHECKS.includes(check?.id))) errors.push('Unknown check IDs')
  return { valid: errors.length === 0, errors }
}

export function checkLaunchEvidence(record, revision, now = Date.now()) {
  const blockers = []
  if (record?.version !== 1) blockers.push('Unsupported evidence version')
  if (!/^[a-f0-9]{40}$/.test(revision ?? '') || record?.revision !== revision) blockers.push('Exact candidate revision required')
  if (!https(record?.environment)) blockers.push('HTTPS live environment required')
  const checks = Array.isArray(record?.checks) ? record.checks : []
  for (const id of REQUIRED_CHECKS) {
    const entries = checks.filter(check => check?.id === id)
    if (entries.length !== 1) { blockers.push(`${id}: exactly one check required`); continue }
    const check = entries[0]
    if (check.status !== 'pass') blockers.push(`${id}: not passed`)
    if (!text(check.owner) || !text(check.reviewer)) blockers.push(`${id}: owner and reviewer required`)
    if (!https(check.evidence)) blockers.push(`${id}: HTTPS evidence reference required`)
    if (check.revision !== revision || check.environment !== record.environment) blockers.push(`${id}: evidence must match candidate revision and environment`)
    const date = Date.parse(check.reviewed_at)
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(check.reviewed_at ?? '') || !Number.isFinite(date) || date > now) blockers.push(`${id}: valid non-future review date with timezone required`)
  }
  if (checks.some(check => !REQUIRED_CHECKS.includes(check?.id))) blockers.push('Unknown check IDs')
  return { ready: blockers.length === 0, blockers }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    if (process.argv[2] === '--check-register') {
      const record = JSON.parse(readFileSync(process.argv[3] ?? 'docs/launch-evidence.json', 'utf8'))
      const result = checkLaunchRegister(record)
      console.log(result.valid ? 'Launch register is complete. This does not approve launch or pass live checks.' : result.errors.join('\n'))
      process.exitCode = result.valid ? 0 : 1
    } else {
      const record = JSON.parse(readFileSync(process.argv[2] ?? 'docs/launch-evidence.json', 'utf8'))
      const result = checkLaunchEvidence(record, process.argv[3])
      console.log(result.ready ? 'Recorded launch evidence is complete; owner must verify artifacts before release.' : 'Launch held:\n' + result.blockers.map(reason => `- ${reason}`).join('\n'))
      process.exitCode = result.ready ? 0 : 1
    }
  } catch {
    console.error('Launch held: evidence could not be read. Supply a JSON file and exact candidate SHA.')
    process.exitCode = 1
  }
}
