import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'

const migrations = JSON.parse(readFileSync(new URL('../migrations.json', import.meta.url))).migrations
const tools = JSON.parse(readFileSync(new URL('../mcp.json', import.meta.url))).tools
export function fixture() {
  const db = new DatabaseSync(':memory:')
  db.exec('PRAGMA foreign_keys=ON')
  for (const m of migrations) db.exec(m.sql)
  const call = (name, user, values = {}) => {
    const t = tools.find(t => t.name === name)
    assert.equal(t.requires_auth, true)
    const params = { ...values, __user_id: user, __now: 123 }
    db.exec('BEGIN')
    try {
      const results = (t.statements ?? [t.sql]).map(statement => {
        const bindings = []
        const sql = statement.replace(/:([a-z_][a-z0-9_]*)/gi, (_, key) => {
          assert.notEqual(params[key], undefined, key)
          bindings.push(params[key]); return '?'
        })
        const stmt = db.prepare(sql)
        return /^\s*(SELECT|WITH)\b/i.test(sql) ? stmt.all(...bindings).map(r => ({ ...r })) : stmt.run(...bindings).changes
      })
      db.exec('COMMIT')
      return t.operation === 'query' ? results[0] : results
    } catch (e) { db.exec('ROLLBACK'); throw e }
  }
  for (const id of ['a', 'b']) call('create_workspace', 'owner-' + id, {
    organization_id: id, brand_id: 'brand-' + id, requisition_id: 'req-' + id,
    organization_name: id, brand_name: id, requisition_title: 'Engineer', operation_id: 'boot-' + id,
  })
  for (const [user, role, req] of [['recruiter','recruiter',null],['agent','recruiter',null],['reviewer','reviewer',null],['auditor','auditor',null],['scoped','recruiter','req-a']]) {
    db.prepare("INSERT INTO hiring_grants(id,organization_id,user_id,role,brand_id,requisition_id,granted_by,created_at) VALUES (?,'a',?,?,?,?,'owner-a',0)")
      .run(user,user,role,req ? 'brand-a' : null,req)
  }
  const get = (user = 'owner-a', org = 'a') => call('get_org_recruiting_playbook',user,{ organization_id:org })
  const save = (version = 0, user = 'owner-a', payload = '{}', operation = 'save-' + version) =>
    call('save_org_recruiting_playbook', user, { organization_id:'a', expected_version:version, payload, operation_id:operation })
  return { db, call, get, save }
}
