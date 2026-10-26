// Versioned agent surface reuses the deployed workflow SQL, including its atomic
// audit and current grants. Generate after changing a source action; CI tests
// compare the generated definitions so the two authorization paths cannot drift.
import { readFileSync, writeFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

export const MUTATIONS_V1 = Object.freeze({
  hiring_v1_create_requisition: 'create_requisition',
  hiring_v1_update_requisition: 'save_pd_draft',
  hiring_v1_advance_application: 'change_application_stage',
  hiring_v1_submit_scorecard: 'save_own_scorecard',
  hiring_v1_record_decision: 'record_decision',
  hiring_v1_draft_message: 'create_communication_draft',
  hiring_v1_send_approved_message: 'queue_communication',
})

export function buildMutationTools(tools) {
  return Object.entries(MUTATIONS_V1).map(([name, source]) => {
    const original = tools.find(t => t.name === source)
    if (!original) throw new Error(`Missing source action ${source}`)
    const tool = structuredClone(original)
    tool.name = name
    tool.description = `Hiring mutation contract v1. ${original.description} Refused stage and decision writes return an error; zero changes may indicate a retry.`
    if (tool.params.tenant_id) {
      tool.params.organization_id = tool.params.tenant_id
      delete tool.params.tenant_id
    }
    delete tool.params.actor_id
    delete tool.params.actor_role
    tool.params.expected_version = { type: 'integer' }
    let guard = " AND :__user_id NOT IN ('system','automation','api_key','system'||char(58)||'worker') AND length(trim(:operation_id)) BETWEEN 1 AND 128 AND typeof(:expected_version) IN ('integer','real') AND :expected_version=CAST(:expected_version AS INTEGER) AND :expected_version>=0"
    if (source === 'create_requisition') guard += ' AND :expected_version=0'
    if (source === 'change_application_stage') {
      // Final dispositions must use the dedicated human decision workflow.
      guard += " AND :to_stage NOT IN ('hired','rejected','withdrawn','accepted')"
      tool.step_up = true
    }
    if (source === 'save_own_scorecard') guard += " AND :status='submitted'"
    if (source === 'create_communication_draft') {
      guard += ' AND EXISTS (SELECT 1 FROM hiring_applications v WHERE v.id=:application_id AND v.organization_id=:organization_id AND v.brand_id=:brand_id AND v.version=:expected_version)'
    }
    if (source === 'queue_communication') {
      guard += ' AND EXISTS (SELECT 1 FROM hiring_outbox v WHERE v.id=:draft_id AND v.organization_id=:organization_id AND v.brand_id=:brand_id AND v.application_id=:application_id AND v.template_id IS NOT NULL AND v.template_version=:expected_version)'
      tool.description += ' Requires preview of the immutable draft and pinned approved template version; the authorised user confirms the queued message in the app, not a provider delivery receipt.'
    }
    tool.statements = tool.statements.map(sql => {
      const adapted = sql.replaceAll(':tenant_id', ':organization_id')
        .replaceAll(':actor_id', 'NULL').replaceAll(':actor_role', 'NULL')
      return adapted.startsWith('INSERT INTO hiring_mutation_checks') ? adapted : adapted + guard
    })
    return tool
  })
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const url = new URL('../mcp.json', import.meta.url)
  const registry = JSON.parse(readFileSync(url, 'utf8'))
  registry.tools = registry.tools.filter(t => !Object.hasOwn(MUTATIONS_V1, t.name))
  registry.tools.push(...buildMutationTools(registry.tools))
  writeFileSync(url, JSON.stringify(registry, null, 2) + '\n')
}
