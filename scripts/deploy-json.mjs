// Parse deploy API responses without requiring jq on a routed runner.
// Input comes from stdin so OIDC tokens and deploy credentials never enter argv.
import { readFileSync } from 'node:fs'

const [mode, path, fallback = ''] = process.argv.slice(2)
let document
try {
  document = JSON.parse(readFileSync(0, 'utf8'))
} catch {
  process.stderr.write('Invalid JSON response from deploy service\n')
  process.exit(1)
}
const value = path?.split('.').reduce((part, key) => part?.[key], document)

if (mode === 'true') process.exit(value === true ? 0 : 1)
if (mode === 'raw') {
  if (value !== undefined && value !== null) process.stdout.write(String(value))
  else process.stdout.write(fallback)
} else if (mode === 'json') {
  process.stdout.write(JSON.stringify(value ?? JSON.parse(fallback || 'null')))
} else if (mode === 'lines') {
  if (!Array.isArray(value)) process.exit(0)
  for (const entry of value) process.stdout.write(`${fallback}${String(entry)}\n`)
} else {
  process.stderr.write('Unknown deploy JSON mode\n')
  process.exit(2)
}
