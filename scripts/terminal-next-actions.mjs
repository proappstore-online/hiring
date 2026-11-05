import { readFileSync, writeFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

const string = { type: 'string' }
const integer = { type: 'integer' }
const optional = spec => ({ ...spec, optional: true })
const scope = { organization_id: string, brand_id: string }
const staff = "EXISTS (SELECT 1 FROM hiring_effective_access g WHERE g.user_id=:__user_id AND g.organization_id=a.organization_id AND g.brand_id=a.brand_id AND g.role IN ('owner','recruiter') AND (g.requisition_id IS NULL OR g.requisition_id=a.requisition_id))"
const reader = "EXISTS (SELECT 1 FROM hiring_effective_access g WHERE g.user_id=:__user_id AND g.organization_id=a.organization_id AND g.brand_id=a.brand_id AND g.role IN ('owner','recruiter','auditor') AND (g.requisition_id IS NULL OR g.requisition_id=a.requisition_id))"
export const effectiveStage = alias => `CASE WHEN COALESCE(${alias}workflow_stage,${alias}lifecycle_stage,${alias}accepted_stage,${alias}stage_extension,${alias}stage)='active' THEN 'onboarded' ELSE COALESCE(${alias}workflow_stage,${alias}lifecycle_stage,${alias}accepted_stage,${alias}stage_extension,${alias}stage) END`
const validPlan = `p.closed_at IS NULL AND p.owner IN ('Serge','bot') AND length(trim(p.action))>0 AND ((p.state='actionable' AND p.blocker_reason IS NULL AND p.review_at IS NULL) OR (p.state='blocked' AND length(trim(coalesce(p.blocker_reason,'')))>0) OR (p.state='deferred' AND coalesce(p.review_at,0)>0))`

export const nextActionTools = [
  {
    name: 'record_application_next_action',
    description: 'Record the current candidate-linked hiring-team action. Actionable has a clear task and no invented due date; blocked needs a reason; deferred needs a real Unix-ms review date. Serge or bot owns the task, never the candidate. Exact operation retries are read back with get_application_next_action_result.',
    operation: 'execute', requires_auth: true,
    params: { ...scope, application_id: string, expected_action_version: integer, owner: string, state: string, action: string, blocker_reason: optional(string), review_at: optional(integer), operation_id: string },
    sql: `INSERT INTO hiring_application_next_action_events(operation_id,application_id,organization_id,brand_id,candidate_id,expected_version,owner,state,action,blocker_reason,review_at,actor_user_id,created_at)
      SELECT :operation_id,a.id,a.organization_id,a.brand_id,a.candidate_id,:expected_action_version,:owner,:state,:action,:blocker_reason,:review_at,:__user_id,:__now
      FROM hiring_applications a WHERE a.id=:application_id AND a.organization_id=:organization_id AND a.brand_id=:brand_id AND ${staff}
      AND ${effectiveStage('a.')} NOT IN ('onboarded','rejected','withdrawn')
      AND NOT EXISTS (SELECT 1 FROM hiring_application_next_action_events e WHERE e.operation_id=:operation_id)`
  },
  {
    name: 'get_application_next_action_result',
    description: 'Scoped exact operation readback for a candidate-linked hiring-team action; a changed payload is never reported as success.',
    operation: 'query', requires_auth: true,
    params: { ...scope, application_id: string, expected_action_version: integer, owner: string, state: string, action: string, blocker_reason: optional(string), review_at: optional(integer), operation_id: string },
    sql: `SELECT e.* FROM hiring_application_next_action_events e JOIN hiring_applications a ON a.id=e.application_id AND a.organization_id=e.organization_id AND a.brand_id=e.brand_id
      WHERE e.operation_id=:operation_id AND e.application_id=:application_id AND e.organization_id=:organization_id AND e.brand_id=:brand_id AND e.actor_user_id=:__user_id
      AND e.expected_version=:expected_action_version AND e.owner=:owner AND e.state=:state AND e.action=:action
      AND e.blocker_reason IS :blocker_reason AND e.review_at IS :review_at AND ${staff}`
  },
  {
    name: 'list_application_next_actions',
    description: 'Read current candidate-linked hiring-team plan and its archived terminal state for one scoped application.',
    operation: 'query', requires_auth: true,
    params: { ...scope, application_id: string },
    sql: `SELECT p.* FROM hiring_application_next_action_current p JOIN hiring_applications a ON a.id=p.application_id AND a.organization_id=p.organization_id AND a.brand_id=p.brand_id
      WHERE a.id=:application_id AND a.organization_id=:organization_id AND a.brand_id=:brand_id AND ${reader}`
  },
  {
    name: 'list_application_next_action_history',
    description: 'Read immutable candidate-linked hiring-team action changes for one scoped application.',
    operation: 'query', requires_auth: true,
    params: { ...scope, application_id: string },
    sql: `SELECT e.* FROM hiring_application_next_action_events e JOIN hiring_applications a ON a.id=e.application_id AND a.organization_id=e.organization_id AND a.brand_id=e.brand_id
      WHERE a.id=:application_id AND a.organization_id=:organization_id AND a.brand_id=:brand_id AND ${reader} ORDER BY e.created_at DESC,e.operation_id DESC LIMIT 100`
  },
  {
    name: 'get_next_action_gaps',
    description: 'Report scoped nonterminal applications without a valid candidate-linked hiring-team action; organisation-wide prose never counts as coverage.',
    operation: 'query', requires_auth: true,
    params: { ...scope, limit: optional(integer) },
    sql: `SELECT a.id AS application_id,a.candidate_id,a.requisition_id,${effectiveStage('a.')} AS stage,a.version AS application_version,
      CASE WHEN p.application_id IS NULL THEN 'missing' ELSE 'invalid' END AS gap_reason
      FROM hiring_applications a LEFT JOIN hiring_application_next_action_current p ON p.application_id=a.id AND p.organization_id=a.organization_id AND p.brand_id=a.brand_id AND p.candidate_id=a.candidate_id
      WHERE a.organization_id=:organization_id AND a.brand_id=:brand_id AND ${reader}
      AND ${effectiveStage('a.')} NOT IN ('onboarded','rejected','withdrawn')
      AND (p.application_id IS NULL OR NOT (${validPlan})) ORDER BY a.updated_at DESC,a.id LIMIT min(max(coalesce(:limit,100),1),100)`
  },
  {
    name: 'list_legacy_active_reclassifications',
    description: 'Read scoped immutable legacy active-to-onboarded reclassifications, including missing completion evidence flags. No evidence is fabricated.',
    operation: 'query', requires_auth: true,
    params: { ...scope, limit: optional(integer) },
    sql: `SELECT x.* FROM hiring_legacy_active_reclassification x JOIN hiring_applications a ON a.id=x.application_id AND a.organization_id=x.organization_id AND a.brand_id=x.brand_id
      WHERE a.organization_id=:organization_id AND a.brand_id=:brand_id AND ${reader} ORDER BY x.recorded_at DESC,x.application_id LIMIT min(max(coalesce(:limit,100),1),100)`
  }
]

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href && process.argv.includes('--write')) {
  const migrationPath = new URL('../migrations.json', import.meta.url)
  const migrations = JSON.parse(readFileSync(migrationPath))
  const sql = readFileSync(new URL('../migrations/0074_terminal_next_actions.sql', import.meta.url), 'utf8')
  const migration = { name: '0074_terminal_next_actions', sql }
  const prior = migrations.migrations.findIndex(row => row.name === migration.name)
  if (prior < 0) migrations.migrations.push(migration)
  else migrations.migrations[prior] = migration
  writeFileSync(migrationPath, JSON.stringify(migrations, null, 2) + '\n')

  const manifestPath = new URL('../mcp.json', import.meta.url)
  const manifest = JSON.parse(readFileSync(manifestPath))
  for (const tool of nextActionTools) {
    const index = manifest.tools.findIndex(row => row.name === tool.name)
    if (index < 0) manifest.tools.push(tool)
    else manifest.tools[index] = tool
  }
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n')
}
