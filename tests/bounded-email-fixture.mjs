import { readFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'

const migrations = JSON.parse(readFileSync(new URL('../migrations.json', import.meta.url))).migrations
const tools = JSON.parse(readFileSync(new URL('../mcp.json', import.meta.url))).tools
export const scope = { organization_id: 'org', brand_id: 'brand', application_id: 'app' }

export function emailFixture(filename = ':memory:') {
  const db = new DatabaseSync(filename)
  db.exec('PRAGMA foreign_keys=ON')
  for (const migration of migrations) db.exec(migration.sql)
  const actions = async (name, values) => {
    const tool = tools.find(t => t.name === name)
    const optional = Object.fromEntries(Object.entries(tool.params ?? {}).filter(([, p]) => p.optional).map(([k]) => [k, null]))
    const params = { ...optional, ...values, __user_id: 'owner', __now: Date.now(), __uuid: crypto.randomUUID() }
    db.exec('BEGIN')
    try {
      const results = (tool.statements ?? [tool.sql]).map(statement => {
        const binds = []
        const sql = statement.replace(/:([a-z_][a-z0-9_]*)/gi, (_, k) => { binds.push(params[k]); return '?' })
        return tool.operation === 'query' ? db.prepare(sql).all(...binds) : { meta: { changes: db.prepare(sql).run(...binds).changes } }
      })
      db.exec('COMMIT')
      return tool.operation === 'query' ? { rows: results[0] } : { results }
    } catch (error) { db.exec('ROLLBACK'); throw error }
  }
  const storage = {
    query: async (sql, params) => ({ rows: db.prepare(sql).all(...params) }),
    execute: async (sql, params) => ({ meta: { changes: db.prepare(sql).run(...params).changes } }),
  }
  return { db, storage, actions }
}

export async function seedEmailApplication(f) {
  await f.actions('create_workspace', { ...scope, requisition_id: 'req', organization_name: 'Org', brand_name: 'Brand', requisition_title: 'Role', operation_id: 'boot' })
  await f.actions('create_application', { ...scope, requisition_id: 'req', candidate_id: 'candidate', candidate_name: 'Test Contact', email: 'candidate@example.test', phone: '', source: 'manual', source_detail: 'Owner test fixture', basis_reference: 'Approved test', contact_context: 'Synthetic', assignee_user_id: 'owner', operation_id: 'person' })
}
