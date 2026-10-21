import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { resolve } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const read = (path) => JSON.parse(readFileSync(resolve(root, path), 'utf8'))

test('runtime gate is default-closed and the only public action', () => {
  const migrations = read('migrations.json').migrations
  const manifest = read('mcp.json')
  assert.equal(migrations[0].name, '0001_init')
  assert.equal(migrations[1].name, '0002_hiring_runtime_gate')
  assert.deepEqual(manifest.tools.filter(({ requires_auth }) => !requires_auth).map(({ name }) => name), ['get_hiring_runtime_gate'])
  assert.ok(manifest.tools.slice(1).every(({ requires_auth }) => requires_auth))
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

test('registered actions cannot open intake or expose anonymous candidate data', () => {
  const tools = read('mcp.json').tools
  for (const tool of tools) {
    for (const sql of tool.statements ?? [tool.sql]) {
      if (tool.name === 'get_hiring_runtime_gate') {
        assert.match(sql, /^SELECT intake_status, reason_code, updated_at FROM hiring_runtime_gate WHERE id = 1 LIMIT 1$/)
      } else {
        // Opening intake must be a deliberate reviewed release, never a client tool call.
        assert.doesNotMatch(sql, /\bhiring_runtime_gate\b/i, tool.name)
        assert.equal(tool.requires_auth, true, tool.name)
      }
    }
  }
})
