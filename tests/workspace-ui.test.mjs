import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const source = () => ['App.tsx', ...['api.ts', 'ui.tsx', 'forms.tsx', 'ApplicationDetail.tsx'].filter(f => { try { readFileSync(resolve(root, 'web/src', f)); return true } catch { return false } })]
  .map(f => readFileSync(resolve(root, 'web/src', f), 'utf8')).join('\n')

test('workspace and application data are keyed so stale loads never render under another record', () => {
  const app = source()
  assert.match(app, /work\?\.brand_id === selected \? work : emptyWork/)
  assert.match(app, /detail\?\.application_id === activeId \? detail : emptyDetail/)
  assert.match(app, /if \(seq === workSeq\.current\)/)
  assert.match(app, /if \(seq === detailSeq\.current\)/)
})

test('a failed workspace load offers retry instead of the create-workspace form', () => {
  assert.match(source(), /!spaces \? <button[^>]*onClick=\{loadSpaces\}/)
})

test('the assignee picker remounts once members load so it defaults to the signed-in user', () => {
  assert.match(source(), /<CreateApplication key=\{members\.map\(m => m\.user_id\)\.join\(\)\}/)
})
