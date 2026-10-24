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
    const date = Date.parse(check.reviewed_at)
    if (!text(check.reviewed_at) || !Number.isFinite(date) || date > now) blockers.push(`${id}: valid non-future review date required`)
  }
  if (checks.some(check => !REQUIRED_CHECKS.includes(check?.id))) blockers.push('Unknown check IDs')
  return { ready: blockers.length === 0, blockers }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const record = JSON.parse(readFileSync(process.argv[2] ?? 'docs/launch-evidence.json', 'utf8'))
    const result = checkLaunchEvidence(record, process.argv[3])
    console.log(result.ready ? 'Recorded launch evidence is complete; owner must verify artifacts before release.' : 'Launch held:\n' + result.blockers.map(reason => `- ${reason}`).join('\n'))
    process.exitCode = result.ready ? 0 : 1
  } catch {
    console.error('Launch held: evidence could not be read. Supply a JSON file and exact candidate SHA.')
    process.exitCode = 1
  }
}
