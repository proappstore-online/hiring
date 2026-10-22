import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const dir = resolve(root, 'web/src')
const source = () => readdirSync(dir).filter(f => /\.tsx?$/.test(f)).map(f => readFileSync(resolve(dir, f), 'utf8')).join('\n')

test('recruiter screens reset scoped data and reject late responses after route changes', () => {
  const app = source()
  assert.match(app, /JSON\.stringify\(\[name, params\]\)/)
  assert.match(app, /if \(live\) setState\(\{ rows, loading: false, error: false \}\)/)
  assert.match(app, /return \(\) => \{ live = false \}/)
  assert.match(app, /<RecruiterContext\.Provider/)
})

test('a failed workspace load offers retry instead of the create-workspace form', () => {
  assert.match(source(), /spaceError \? <ErrorState retry=\{\(\) => void reloadSpaces\(\)\}/)
})

test('the assignee picker remounts once members load so it defaults to the signed-in user', () => {
  assert.match(source(), /<CreateApplication[^>]*key=\{members\.rows\.map\(row => row\.user_id\)\.join\(\)\}/)
})

test('candidate and staff routes are separated; job and notice text render as escaped React content', () => {
  const app = readFileSync(resolve(dir, 'App.tsx'), 'utf8')
  const jobs = readFileSync(resolve(dir, 'Jobs.tsx'), 'utf8')
  assert.match(app, /path="jobs\/:jobId"/)
  assert.match(app, /<Jobs[^>]*userId=\{user\?\.id\}/)
  assert.match(jobs, /job\.organization_name/)
  assert.match(jobs, /job\.brand_name/)
  assert.match(jobs, /job\.notice_text/)
  assert.doesNotMatch(jobs, /dangerouslySetInnerHTML/)
  assert.match(jobs, /name="notice_acknowledged" type="checkbox" required/)
  for (const name of ['talent_pool_consent','communications_consent']) {
    assert.match(jobs, new RegExp(`name="${name}" type="checkbox"`))
  }
  assert.doesNotMatch(jobs, /defaultChecked|checked=\{true\}/)
  assert.match(jobs, /role="alert"/)
  assert.match(jobs, /role="status"/)
  assert.match(jobs, /submittedPayload\.current/)
  assert.match(jobs, /get_my_application_receipt/)
  assert.match(jobs, /flex flex-col items-start gap-3/)
})

test('attachments use private uploads, never public URLs or unscanned reviewer downloads', () => {
  const files = readFileSync(resolve(dir, 'attachments.tsx'), 'utf8')
  assert.match(files, /app\.storage\.upload\(/)
  assert.doesNotMatch(files, /uploadPublic|uploadUserPublic|uploadForReview|publicUrl|downloadForReview|dangerouslySetInnerHTML/)
  assert.match(files, /crypto\.subtle\.digest\('SHA-256'/)
  assert.match(files, /delete_application_attachment/)
  assert.ok(files.indexOf("await write('delete_application_attachment'") < files.indexOf("await app.storage.delete('intake/' + row.id)"))
  assert.match(files, /Reviewer downloads remain unavailable/)
  const jobs = readFileSync(resolve(dir, 'Jobs.tsx'), 'utf8')
  assert.match(jobs, /Publish & open applications/)
  assert.doesNotMatch(jobs, /passkey|Verify with passkey|Register passkey/)
})
