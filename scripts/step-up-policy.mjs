// Passkey step-up policy (Serge, 26 Oct 2026): OFF by default.
// mcp.json keeps the `step_up: true` declarations so the gate can be re-enabled;
// at deploy time this script strips them unless HIRING_PASSKEY_STEP_UP=on.
// The platform only enforces step-up on tools registered with `step_up: true`.
import { readFileSync, writeFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

export function stepUpEnabled(value = process.env.HIRING_PASSKEY_STEP_UP) {
  return ['on', 'true', '1'].includes(String(value ?? '').trim().toLowerCase())
}

export function applyStepUpPolicy(registry, enabled) {
  const out = structuredClone(registry)
  if (!enabled) for (const tool of out.tools) delete tool.step_up
  return out
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [src = 'mcp.json', dest = 'mcp.registered.json'] = process.argv.slice(2)
  const enabled = stepUpEnabled()
  const registry = applyStepUpPolicy(JSON.parse(readFileSync(src, 'utf8')), enabled)
  writeFileSync(dest, JSON.stringify(registry, null, 2) + '\n')
  console.log(`Passkey step-up ${enabled ? 'ON' : 'OFF'}: ${registry.tools.filter(t => t.step_up).length} step_up tool(s) registered`)
}
