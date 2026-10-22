import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { resolve } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const read = (path) => JSON.parse(readFileSync(resolve(root, path), 'utf8'))

test('runtime gate is default-closed and only approved public queries are exposed', () => {
  const migrations = read('migrations.json').migrations
  const manifest = read('mcp.json')
  assert.equal(migrations[0].name, '0001_init')
  assert.equal(migrations[1].name, '0002_hiring_runtime_gate')
  assert.deepEqual(manifest.tools.filter(({ requires_auth }) => !requires_auth).map(({ name }) => name), ['get_hiring_runtime_gate', 'list_public_jobs', 'get_public_job', 'listVacancies', 'getVacancyDetail'])
  assert.ok(manifest.tools.filter(t => !['get_hiring_runtime_gate', 'list_public_jobs', 'get_public_job', 'listVacancies', 'getVacancyDetail'].includes(t.name)).every(({ requires_auth }) => requires_auth))
  assert.equal(manifest.tools[0].requires_auth, false)
  assert.match(manifest.tools[0].sql, /LIMIT 1$/)

  const db = new DatabaseSync(':memory:')
  try {
    for (const migration of migrations) db.exec(migration.sql)
    const rows = db.prepare(manifest.tools[0].sql).all().map((row) => ({ ...row }))
    assert.deepEqual(rows, [{
      intake_status: 'closed',
      reason_code: 'public_intake_route_unverified',
      updated_at: 0,
    }])
    assert.throws(() => db.prepare('INSERT INTO hiring_runtime_gate VALUES (2, ?, ?, ?)').run('open', 'test', 1))
    assert.throws(() => db.prepare('UPDATE hiring_runtime_gate SET intake_status = ? WHERE id = 1').run('unknown'))
  } finally {
    db.close()
  }
})

test('deploy applies migrations before registering dependent actions', () => {
  const workflow = readFileSync(resolve(root, '.github/workflows/deploy.yml'), 'utf8')
  assert.ok(workflow.indexOf('Apply D1 migrations') < workflow.indexOf('Register app tools'))
})

test('only the guarded owner action can change intake and no anonymous candidate data is exposed', () => {
  const tools = read('mcp.json').tools
  for (const tool of tools) {
    for (const sql of tool.statements ?? [tool.sql]) {
      if (tool.name === 'get_hiring_runtime_gate') {
        assert.match(sql, /^SELECT intake_status, reason_code, updated_at FROM hiring_runtime_gate WHERE id = 1 LIMIT 1$/)
      } else {
        if (tool.name === 'set_hiring_runtime_gate') {
          assert.equal(tool.requires_auth, true)
          assert.equal(tool.step_up, true)
          if (/UPDATE\s+hiring_runtime_gate/i.test(sql)) {
            assert.match(sql, /hiring_effective_access/)
            assert.match(sql, /p\.role='owner'/)
          }
        } else assert.doesNotMatch(sql, /(?:UPDATE|INTO|DELETE FROM)\s+hiring_runtime_gate\b/i, tool.name)
        if (['list_public_jobs', 'get_public_job', 'listVacancies', 'getVacancyDetail'].includes(tool.name)) {
          assert.equal(tool.requires_auth, false)
          assert.match(sql, /^SELECT /)
          assert.doesNotMatch(sql, /hiring_candidates|hiring_applications|hiring_attachments/)
        } else assert.equal(tool.requires_auth, true, tool.name)
      }
    }
  }
})
