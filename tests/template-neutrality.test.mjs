import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const read = (path) => readFileSync(resolve(root, path), 'utf8')

test('the starter uses independently branded shell controls', () => {
  const app = read('web/src/App.tsx')

  assert.match(app, /<ProShell app=\{app\} appName="APPNAME" nav=\{NAV\} branding="app">/)
  assert.doesNotMatch(app, /Built for ProAppStore|href="https:\/\/proappstore\.online"/)
})

test('public starter metadata and manifest are neutral', () => {
  const html = read('web/index.html')
  const vite = read('web/vite.config.ts')

  assert.match(html, /<title>APPNAME<\/title>/)
  assert.match(html, /content="Explore APPNAME\."/)
  assert.doesNotMatch(html, /ProAppStore/)
  assert.match(vite, /name: 'APPNAME'/)
  assert.match(vite, /description: 'Explore APPNAME\.'/)
  assert.doesNotMatch(vite, /ProAppStore/)
})

test('compliance does not require a public platform link', () => {
  const workflow = read('.github/workflows/compliance.yml')

  assert.doesNotMatch(workflow, /ProAppStore link/)
  assert.doesNotMatch(workflow, /grep -r "proappstore\.online" web\/src/)
})
