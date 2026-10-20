import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const read = (path) => readFileSync(resolve(root, path), 'utf8')

test('signed-out Hiring offers both native PAS providers after session hydration', () => {
  const app = read('web/src/App.tsx')
  assert.match(app, /useAuth\(app\)/)
  assert.match(app, /if \(loading\)/)
  assert.match(app, /if \(!user\)/)
  assert.match(app, /<SignInButton app=\{app\} provider="google" label="Continue with Google"/)
  assert.match(app, /<SignInButton app=\{app\} provider="github" label="Continue with GitHub"/)
})

test('Google credentials and OAuth token exchange stay outside Hiring', () => {
  const app = read('web/src/App.tsx')
  const manifest = read('mcp.json')
  const migration = read('migrations.json')
  for (const value of [app, manifest, migration]) {
    assert.doesNotMatch(value, /GOOGLE_CLIENT_SECRET|client_secret|oauth2\.googleapis\.com|accounts\.google\.com\/o\/oauth2/)
    assert.doesNotMatch(value, /pas_session|localStorage\.setItem/)
  }
  const operatorNote = read('docs/google-sign-in.md')
  assert.match(operatorNote, /https:\/\/api\.proappstore\.online\/v1\/auth\/google\/callback/)
  assert.match(operatorNote, /GOOGLE_CLIENT_ID/)
  assert.match(operatorNote, /GOOGLE_CLIENT_SECRET/)
})
