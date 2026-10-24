import { readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

// Owner-signature check only. Full release checks remain in launch-readiness.mjs.
export function checkLaunchGate(evidencePath = new URL('../docs/launch-evidence.json', import.meta.url)) {
  try {
    const evidence = JSON.parse(readFileSync(evidencePath, 'utf8'))
    const decisions = Array.isArray(evidence?.checks) ? evidence.checks.filter(check => check?.id === 'launch-decision') : []
    if (decisions.length !== 1) return { approved: false, reason: 'Exactly one launch-decision entry required.' }
    const decision = decisions[0]
    if (decision.status !== 'approved') return { approved: false, reason: 'Owner launch decision is not approved.' }
    if (typeof decision.reviewer !== 'string' || !decision.reviewer.trim()) return { approved: false, reason: 'Owner reviewer required.' }
    if (typeof decision.reviewed_at !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(decision.reviewed_at) || !Number.isFinite(Date.parse(decision.reviewed_at)) || Date.parse(decision.reviewed_at) > Date.now()) return { approved: false, reason: 'Valid non-future owner review timestamp with timezone required.' }
    return { approved: true, reason: 'Owner approval recorded; verify all release evidence separately before launch.' }
  } catch {
    return { approved: false, reason: 'Launch evidence could not be read or parsed.' }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = checkLaunchGate(process.argv[2])
  console.log(result.reason)
  process.exitCode = result.approved ? 0 : 1
}
