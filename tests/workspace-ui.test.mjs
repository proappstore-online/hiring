import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const dir = resolve(root, 'web/src')
const source = () => readdirSync(dir).filter(f => /\.tsx?$/.test(f)).map(f => readFileSync(resolve(dir, f), 'utf8')).join('\n')

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
