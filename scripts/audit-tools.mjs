import { readFileSync, writeFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

const str = { type: 'string' }
const integer = { type: 'integer' }
const optional = spec => ({ ...spec, optional: true })
const scope = { organization_id: str, brand_id: str }
const candidate = { candidate_id: optional(str) }
const read = "EXISTS (SELECT 1 FROM hiring_effective_access p WHERE p.organization_id=:organization_id AND p.brand_id=:brand_id AND p.user_id=:__user_id AND p.role IN ('owner','recruiter','auditor'))"
const write = "EXISTS (SELECT 1 FROM hiring_effective_access p WHERE p.organization_id=:organization_id AND p.brand_id=:brand_id AND p.user_id=:__user_id AND p.role IN ('owner','recruiter') AND p.requisition_id IS NULL)"
const scopedCandidate = "(:candidate_id IS NULL OR EXISTS (SELECT 1 FROM hiring_candidates c WHERE c.id=:candidate_id AND c.organization_id=:organization_id AND c.brand_id=:brand_id))"
const limit = 'LIMIT min(max(coalesce(:limit,100),1),100)'

const query = (name, description, params, sql) => ({ name, description, operation: 'query', requires_auth: true, params: { ...scope, ...params }, sql })
const batch = (name, description, params, statements) => {
  const candidateId = Object.hasOwn(params, 'target_candidate_id') ? ':target_candidate_id' : Object.hasOwn(params, 'candidate_id') ? ':candidate_id' : 'NULL'
  const entityId = Object.hasOwn(params, 'id') ? ':id' : ':operation_id'
  const inputPairs = Object.keys(params).flatMap(key => [`'${key}'`, key === 'params_json' || /token|secret|password|api_key|credential|auth/i.test(key) ? "'[REDACTED]'" : `:${key}`])
  const inputJson = `json_object(${inputPairs.join(',')})`
  return { name, description, operation: 'batch', requires_auth: true, params: { ...scope, ...params }, statements: [...statements,
    `INSERT INTO mcp_audit_log(id,organization_id,brand_id,candidate_id,entity_id,timestamp,caller_agent_id,caller_session_id,tool_name,input_json,result_status,result_summary,affected_entity_ids_json,operation_id) SELECT lower(hex(randomblob(16))),:organization_id,:brand_id,${candidateId},${entityId},:__now,NULL,NULL,'${name}',${inputJson},'completed','SQL mutation completed',json_array(${entityId}),:operation_id WHERE changes()=1 AND :__user_id IS NOT NULL`
  ] }
}

export function buildAuditTools() {
  return [
    query('query_audit_log', 'Read scoped MCP audit entries by candidate, entity, time, tool, or caller. Results include redacted input JSON.', { ...candidate, entity_id: optional(str), tool_name: optional(str), caller_agent_id: optional(str), from_ts: optional(integer), to_ts: optional(integer), limit: optional(integer) },
      `SELECT id,timestamp,caller_agent_id,caller_session_id,tool_name,input_json,result_status,result_summary,affected_entity_ids_json,operation_id,candidate_id,entity_id FROM mcp_audit_log WHERE organization_id=:organization_id AND brand_id=:brand_id AND ${read} AND (:candidate_id IS NULL OR candidate_id=:candidate_id) AND (:entity_id IS NULL OR entity_id=:entity_id) AND (:tool_name IS NULL OR tool_name=:tool_name) AND (:caller_agent_id IS NULL OR caller_agent_id=:caller_agent_id) AND (:from_ts IS NULL OR timestamp>=:from_ts) AND (:to_ts IS NULL OR timestamp<:to_ts) ORDER BY timestamp DESC,id DESC ${limit}`),
    batch('log_external_action', 'Record an actual email, LinkedIn, or Discord action with provider IDs and full parameters. This tool does not send a message.', { kind: str, target_candidate_id: optional(str), target_org_id: optional(str), performed_by: str, performed_at: integer, params_json: str, gmail_message_id: optional(str), linkedin_message_id: optional(str), discord_message_id: optional(str), notes: optional(str), operation_id: str }, [
      `INSERT INTO external_actions(id,organization_id,brand_id,target_candidate_id,target_org_id,performed_at,kind,gmail_message_id,linkedin_message_id,discord_message_id,params_json,performed_by,notes,operation_id) SELECT :operation_id,:organization_id,:brand_id,:target_candidate_id,coalesce(:target_org_id,:organization_id),:performed_at,:kind,:gmail_message_id,:linkedin_message_id,:discord_message_id,:params_json,:performed_by,:notes,:operation_id WHERE ${write} AND :performed_by=:__user_id AND json_valid(:params_json) AND (:target_org_id IS NULL OR :target_org_id=:organization_id) AND (:target_candidate_id IS NULL OR EXISTS (SELECT 1 FROM hiring_candidates c WHERE c.id=:target_candidate_id AND c.organization_id=:organization_id AND c.brand_id=:brand_id)) AND length(trim(:operation_id)) BETWEEN 1 AND 128 AND NOT EXISTS (SELECT 1 FROM external_actions WHERE operation_id=:operation_id)`,
    ]),
    query('get_activity_timeline', 'Read a chronological timeline of scoped MCP audit and externally recorded actions.', { ...candidate, org_id: optional(str), from_ts: optional(integer), to_ts: optional(integer), limit: optional(integer) },
      `SELECT * FROM (SELECT id,timestamp AS ts,'mcp' AS source,tool_name AS kind,caller_agent_id AS actor,result_summary AS summary,operation_id,candidate_id,organization_id AS org_id FROM mcp_audit_log WHERE organization_id=:organization_id AND brand_id=:brand_id AND (:candidate_id IS NULL OR candidate_id=:candidate_id) AND (:org_id IS NULL OR organization_id=:org_id) UNION ALL SELECT id,performed_at AS ts,'external' AS source,kind,performed_by AS actor,notes AS summary,operation_id,target_candidate_id AS candidate_id,target_org_id AS org_id FROM external_actions WHERE organization_id=:organization_id AND brand_id=:brand_id AND (:candidate_id IS NULL OR target_candidate_id=:candidate_id) AND (:org_id IS NULL OR target_org_id=:org_id)) WHERE ${read} AND (:from_ts IS NULL OR ts>=:from_ts) AND (:to_ts IS NULL OR ts<:to_ts) ORDER BY ts DESC,id DESC ${limit}`),
    batch('create_next_action', 'Create an open next action linked to a candidate or organization and optionally an audit event.', { ...candidate, org_id: optional(str), action: str, due_at: integer, owner: str, triggering_event_id: optional(str), operation_id: str }, [
      `INSERT INTO next_actions(id,organization_id,brand_id,candidate_id,org_id,action,due_at,owner,status,triggering_event_id,created_at,updated_at,operation_id) SELECT :operation_id,:organization_id,:brand_id,:candidate_id,coalesce(:org_id,:organization_id),:action,:due_at,:owner,'open',:triggering_event_id,:__now,:__now,:operation_id WHERE ${write} AND ${scopedCandidate} AND (:org_id IS NULL OR :org_id=:organization_id) AND (:triggering_event_id IS NULL OR EXISTS (SELECT 1 FROM mcp_audit_log a WHERE a.id=:triggering_event_id AND a.organization_id=:organization_id AND a.brand_id=:brand_id)) AND length(trim(:operation_id)) BETWEEN 1 AND 128 AND NOT EXISTS (SELECT 1 FROM next_actions WHERE operation_id=:operation_id)`,
    ]),
    batch('update_next_action', 'Update an existing next action, including blocker state and due date.', { id: str, action: optional(str), due_at: optional(integer), owner: optional(str), status: optional(str), blocker_reason: optional(str), operation_id: str }, [
      `UPDATE next_actions SET action=coalesce(:action,action),due_at=coalesce(:due_at,due_at),owner=coalesce(:owner,owner),status=coalesce(:status,status),blocker_reason=CASE WHEN :status='blocked' THEN :blocker_reason WHEN :status IS NOT NULL THEN NULL ELSE coalesce(:blocker_reason,blocker_reason) END,updated_at=:__now,operation_id=:operation_id WHERE id=:id AND organization_id=:organization_id AND brand_id=:brand_id AND ${write} AND status<>'done' AND (:status IS NULL OR :status IN ('open','done','blocked')) AND (:status IS NULL OR :status<>'blocked' OR length(trim(:blocker_reason))>0) AND length(trim(:operation_id)) BETWEEN 1 AND 128 AND NOT EXISTS (SELECT 1 FROM next_actions n WHERE n.operation_id=:operation_id) AND NOT EXISTS (SELECT 1 FROM mcp_audit_log a WHERE a.operation_id=:operation_id)`,
    ]),
    batch('complete_next_action', 'Mark one scoped next action done.', { id: str, operation_id: str }, [
      `UPDATE next_actions SET status='done',blocker_reason=NULL,updated_at=:__now,operation_id=:operation_id WHERE id=:id AND organization_id=:organization_id AND brand_id=:brand_id AND ${write} AND status<>'done' AND length(trim(:operation_id)) BETWEEN 1 AND 128 AND NOT EXISTS (SELECT 1 FROM next_actions n WHERE n.operation_id=:operation_id) AND NOT EXISTS (SELECT 1 FROM mcp_audit_log a WHERE a.operation_id=:operation_id)`,
    ]),
    query('list_next_actions', 'List scoped next actions by candidate, organization, status, and owner.', { ...candidate, org_id: optional(str), status: optional(str), owner: optional(str), limit: optional(integer) },
      `SELECT id,candidate_id,org_id,action,due_at,owner,status,blocker_reason,triggering_event_id,created_at,updated_at FROM next_actions WHERE organization_id=:organization_id AND brand_id=:brand_id AND ${read} AND (:candidate_id IS NULL OR candidate_id=:candidate_id) AND (:org_id IS NULL OR org_id=:org_id) AND (:status IS NULL OR status=:status) AND (:owner IS NULL OR owner=:owner) ORDER BY due_at ASC,id ASC ${limit}`),
    query('session_start', 'Resume work with open actions, overdue actions, and recent audit or external activity since a timestamp.', { since: optional(integer) },
      `SELECT (SELECT coalesce(json_group_array(json_object('id',id,'candidate_id',candidate_id,'action',action,'due_at',due_at,'owner',owner,'status',status)),json('[]')) FROM (SELECT id,candidate_id,action,due_at,owner,status FROM next_actions WHERE organization_id=:organization_id AND brand_id=:brand_id AND status='open' ORDER BY due_at LIMIT 100)) AS open_actions,(SELECT coalesce(json_group_array(json_object('id',id,'candidate_id',candidate_id,'action',action,'due_at',due_at,'owner',owner)),json('[]')) FROM (SELECT id,candidate_id,action,due_at,owner FROM next_actions WHERE organization_id=:organization_id AND brand_id=:brand_id AND status='open' AND due_at<:__now ORDER BY due_at LIMIT 100)) AS overdue_actions,(SELECT coalesce(json_group_array(json_object('id',id,'ts',ts,'kind',kind,'source',source)),json('[]')) FROM (SELECT id,timestamp AS ts,tool_name AS kind,'mcp' AS source FROM mcp_audit_log WHERE organization_id=:organization_id AND brand_id=:brand_id AND timestamp>=coalesce(:since,:__now-86400000) UNION ALL SELECT id,performed_at AS ts,kind,'external' AS source FROM external_actions WHERE organization_id=:organization_id AND brand_id=:brand_id AND performed_at>=coalesce(:since,:__now-86400000) ORDER BY ts DESC LIMIT 100)) AS recent_activity WHERE ${read}`),
  ]
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const path = new URL('../mcp.json', import.meta.url)
  const registry = JSON.parse(readFileSync(path))
  const names = new Set(buildAuditTools().map(t => t.name))
  registry.tools = registry.tools.filter(t => !names.has(t.name))
  registry.tools.push(...buildAuditTools())
  writeFileSync(path, JSON.stringify(registry, null, 2) + '\n')
}
