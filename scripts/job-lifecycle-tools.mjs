import { readFileSync, writeFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

const string = { type: 'string' }
const integer = { type: 'integer' }
const optionalString = { type: 'string', optional: true }
const optionalInteger = { type: 'integer', optional: true }
const scope = { organization_id: string, brand_id: string, requisition_id: string }
const owner = "EXISTS (SELECT 1 FROM hiring_effective_access p WHERE p.organization_id=:organization_id AND p.brand_id=:brand_id AND p.user_id=:__user_id AND p.role IN ('owner','recruiter') AND p.requisition_id IS NULL)"
const reader = "EXISTS (SELECT 1 FROM hiring_effective_access p WHERE p.organization_id=:organization_id AND p.brand_id=:brand_id AND p.user_id=:__user_id AND p.role IN ('owner','recruiter') AND (p.requisition_id IS NULL OR p.requisition_id=:requisition_id))"
const validOp = "length(trim(:operation_id)) BETWEEN 1 AND 128 AND NOT EXISTS (SELECT 1 FROM hiring_audit_events WHERE operation_id=:operation_id OR id=:operation_id)"
const status = "CASE WHEN j.lifecycle_status='expired' THEN 'expired' WHEN j.lifecycle_status='closed' OR j.status='closed' THEN 'closed' WHEN pc.paused=1 THEN 'paused' WHEN j.status='published' THEN 'published' ELSE 'draft' END"
const ms = value => `(CASE WHEN abs(${value})<10000000000 THEN ${value}*1000 ELSE ${value} END)`
const audit = action => `INSERT INTO hiring_audit_events(id,organization_id,brand_id,action,actor_user_id,operation_id,created_at,object_type,object_id,redacted_summary) SELECT :operation_id,:organization_id,:brand_id,'${action}',:__user_id,:operation_id,${ms(':__now')},'requisition',:requisition_id,:reason WHERE changes()=1`
// expected_version is always hiring_job_publications.version, including on list_requisitions.
const publication = "SELECT 1 FROM hiring_job_publications j WHERE j.requisition_id=:requisition_id AND j.organization_id=:organization_id AND j.brand_id=:brand_id"
const current = `(SELECT j.version FROM hiring_job_publications j WHERE j.requisition_id=:requisition_id AND j.organization_id=:organization_id AND j.brand_id=:brand_id)`
const state = `(SELECT CASE WHEN j.lifecycle_status='expired' THEN 'expired' WHEN j.lifecycle_status='closed' OR j.status='closed' THEN 'closed' WHEN EXISTS (SELECT 1 FROM hiring_publication_controls pc WHERE pc.requisition_id=j.requisition_id AND pc.paused=1) THEN 'paused' ELSE 'published' END FROM hiring_job_publications j WHERE j.requisition_id=:requisition_id AND j.organization_id=:organization_id AND j.brand_id=:brand_id)`
const refusal = (target, transition, validation = '') => {
  const message = `CASE WHEN NOT (${owner}) OR NOT EXISTS (${publication}) THEN 'not_found' WHEN :expected_version<>${current} THEN 'version_mismatch_current_'||${current} ${validation} WHEN NOT (${transition}) THEN 'invalid_transition_from_'||${state}||'_to_'||${target} WHEN NOT (${validOp}) THEN 'duplicate_operation_id' ELSE NULL END`
  // Migration 0063 maps this message to a safe APP: code via a BEFORE INSERT trigger.
  return `INSERT INTO hiring_mcp_refusals(message) SELECT message FROM (SELECT ${message} AS message) WHERE message IS NOT NULL`
}
const mcpAudit = name => `INSERT INTO mcp_audit_log(id,organization_id,brand_id,entity_id,timestamp,tool_name,input_json,result_status,result_summary,affected_entity_ids_json,operation_id) SELECT lower(hex(randomblob(16))),:organization_id,:brand_id,:requisition_id,${ms(':__now')},'${name}',json_object('requisition_id',:requisition_id,'expected_version',:expected_version,'operation_id',:operation_id),'completed','Publication changed',json_array(:requisition_id),:operation_id WHERE changes()=1 AND :__user_id IS NOT NULL`

export function addJobLifecycleTools(registry) {
  const tools = registry.tools
  const generatedNames = new Set(['set_linkedin_job_id','set_job_expiry_date','expire_job_requisition','republish_job_requisition','list_linkedin_repost_history','record_linkedin_status','get_job_linkedin_status','find_job_by_linkedin_id'])
  for (let i=tools.length-1;i>=0;i--) if (generatedNames.has(tools[i].name)) tools.splice(i,1)
  const get = name => { const t=tools.find(x=>x.name===name); if (!t) throw new Error(`Missing ${name}`); return t }
  for (const name of ['list_requisitions','gateway_list_requisitions','gateway_get_requisition','audited_gateway_list_requisitions','audited_gateway_get_requisition']) {
    const t=get(name)
    t.sql=t.sql.replace('r.status',`CASE WHEN j.lifecycle_status='expired' THEN 'expired' WHEN j.lifecycle_status='closed' OR j.status='closed' THEN 'closed' WHEN pc.paused=1 THEN 'paused' WHEN j.status='published' THEN 'published' ELSE 'draft' END AS status`)
      .replace('FROM hiring_requisitions r WHERE', 'FROM hiring_requisitions r LEFT JOIN hiring_job_publications j ON j.requisition_id=r.id LEFT JOIN hiring_publication_controls pc ON pc.requisition_id=r.id WHERE')
    if(name==='list_requisitions') t.sql=t.sql.replace('SELECT id,title,status FROM hiring_requisitions WHERE','SELECT r.id,r.title,j.version AS expected_version,CASE WHEN j.lifecycle_status=\'expired\' THEN \'expired\' WHEN j.lifecycle_status=\'closed\' OR j.status=\'closed\' THEN \'closed\' WHEN pc.paused=1 THEN \'paused\' WHEN j.status=\'published\' THEN \'published\' ELSE \'draft\' END AS status FROM hiring_requisitions r LEFT JOIN hiring_job_publications j ON j.requisition_id=r.id LEFT JOIN hiring_publication_controls pc ON pc.requisition_id=r.id WHERE').replaceAll('hiring_requisitions.id','r.id').replace('WHERE organization_id=:organization_id AND brand_id=:brand_id','WHERE r.organization_id=:organization_id AND r.brand_id=:brand_id').replace('ORDER BY created_at DESC','ORDER BY r.created_at DESC')
    if(name==='list_requisitions' && !t.sql.includes('expected_version')) t.sql=t.sql.replace('r.title,CASE','r.title,j.version AS expected_version,CASE')
  }
  const management=get('get_vacancy_management')
  management.sql=management.sql.replace('r.id,r.title,r.status,','r.id,r.title,CASE WHEN j.lifecycle_status=\'expired\' THEN \'expired\' WHEN j.lifecycle_status=\'closed\' OR j.status=\'closed\' THEN \'closed\' WHEN pc.paused=1 THEN \'paused\' WHEN j.status=\'published\' THEN \'published\' ELSE \'draft\' END AS status,')
  for(const name of ['list_vacancy_management','get_vacancy_management','list_job_publications']) {
    const t=get(name)
    t.sql=t.sql.replace("WHEN j.status='closed' THEN 'closed'", "WHEN j.lifecycle_status='expired' THEN 'expired' WHEN j.lifecycle_status='closed' OR j.status='closed' THEN 'closed'")
    t.sql=t.sql.replace('j.version,CASE', `j.version,j.linkedin_job_id,${ms('j.expiry_date')} AS expiry_date,CASE`)
    if(name==='get_vacancy_management') t.sql=t.sql.replace('j.version AS publication_version,',`j.version AS publication_version,j.linkedin_job_id,${ms('j.expiry_date')} AS expiry_date,`)
    if(name==='list_vacancy_management') t.sql=t.sql.replace('r.id,r.title,CASE',`r.id,r.title,j.linkedin_job_id,${ms('j.expiry_date')} AS expiry_date,CASE`)
  }
  for(const name of ['get_public_job','list_public_jobs','get_vacancy_detail','list_vacancies']) {
    const t=get(name)
    t.sql=t.sql.replace("j.status='published'", `j.status='published' AND coalesce(j.lifecycle_status,'published')='published' AND (j.expiry_date IS NULL OR ${ms('j.expiry_date')}>${ms(':__now')})`)
  }
  const close=get('close_job_requisition')
  close.statements[0]=close.statements[0].replace("SET status='closed',version=version+1", "SET status='closed',lifecycle_status='closed',version=version+1").replace("AND status='published' AND EXISTS", "AND (status='published' OR lifecycle_status='expired') AND EXISTS")
  const submit=get('submit_job_application')
  submit.statements[0]=submit.statements[0].replace("j.status='published' AND NOT EXISTS", `j.status='published' AND coalesce(j.lifecycle_status,'published')='published' AND (j.expiry_date IS NULL OR ${ms('j.expiry_date')}>${ms(':__now')}) AND NOT EXISTS`)
  tools.push(
    {name:'set_linkedin_job_id',description:'Record a LinkedIn job ID on an existing posting, with immutable ID change history. Use republish_job_requisition to reactivate an expired posting.',operation:'batch',requires_auth:true,step_up:true,params:{...scope,linkedin_job_id:string,previous_linkedin_job_id:optionalString,expiry_date:optionalInteger,expected_version:integer,operation_id:string,reason:optionalString},statements:[
      `INSERT INTO hiring_linkedin_repost_history(id,operation_id,requisition_id,organization_id,brand_id,previous_linkedin_job_id,new_linkedin_job_id,actor_user_id,reason,reposted_at) SELECT :operation_id,:operation_id,j.requisition_id,j.organization_id,j.brand_id,j.linkedin_job_id,:linkedin_job_id,:__user_id,coalesce(:reason,'LinkedIn job ID recorded'),${ms(':__now')} FROM hiring_job_publications j WHERE j.requisition_id=:requisition_id AND j.organization_id=:organization_id AND j.brand_id=:brand_id AND j.version=:expected_version AND ${owner} AND ${validOp} AND length(trim(:linkedin_job_id)) BETWEEN 1 AND 128 AND (j.linkedin_job_id IS NULL OR j.linkedin_job_id<>:linkedin_job_id) AND (:previous_linkedin_job_id IS NULL OR j.linkedin_job_id IS :previous_linkedin_job_id) AND (:reason IS NULL OR length(trim(:reason)) BETWEEN 1 AND 1000) AND (:expiry_date IS NULL OR :expiry_date>0)`,
      `UPDATE hiring_job_publications SET linkedin_job_id=:linkedin_job_id,expiry_date=coalesce(${ms(':expiry_date')},expiry_date),version=version+1 WHERE requisition_id=:requisition_id AND organization_id=:organization_id AND brand_id=:brand_id AND version=:expected_version AND ${owner} AND EXISTS (SELECT 1 FROM hiring_linkedin_repost_history h WHERE h.operation_id=:operation_id AND h.requisition_id=:requisition_id AND h.actor_user_id=:__user_id)`,
      `INSERT INTO hiring_audit_events(id,organization_id,brand_id,action,actor_user_id,operation_id,created_at,object_type,object_id,redacted_summary) SELECT :operation_id,:organization_id,:brand_id,'requisition.linkedin_id_set',:__user_id,:operation_id,${ms(':__now')},'requisition',:requisition_id,coalesce(:reason,'LinkedIn job ID recorded') WHERE changes()=1`
    ]},
    {name:'set_job_expiry_date',description:'Set or clear the expected LinkedIn expiry date on an existing posting.',operation:'batch',requires_auth:true,step_up:true,params:{...scope,expiry_date:optionalInteger,expected_version:integer,operation_id:string,reason:optionalString},statements:[
      `UPDATE hiring_job_publications SET expiry_date=CASE WHEN :expiry_date IS NULL THEN NULL ELSE ${ms(':expiry_date')} END,version=version+1 WHERE requisition_id=:requisition_id AND organization_id=:organization_id AND brand_id=:brand_id AND version=:expected_version AND ${owner} AND ${validOp} AND (:expiry_date IS NULL OR :expiry_date>0) AND (:reason IS NULL OR length(trim(:reason)) BETWEEN 1 AND 1000) AND ${ms('expiry_date')} IS NOT ${ms(':expiry_date')}`,
      `INSERT INTO hiring_audit_events(id,organization_id,brand_id,action,actor_user_id,operation_id,created_at,object_type,object_id,redacted_summary) SELECT :operation_id,:organization_id,:brand_id,'requisition.expiry_date_set',:__user_id,:operation_id,${ms(':__now')},'requisition',:requisition_id,coalesce(:reason,'LinkedIn expiry date updated') WHERE changes()=1`
    ]},
    {name:'expire_job_requisition',description:'Record that a LinkedIn posting expired or closed after an external check or its expiry date. Removes it from public listings; preserves the requisition and applicants.',operation:'batch',requires_auth:true,step_up:true,params:{...scope,expected_version:integer,operation_id:string,reason:optionalString,observed_linkedin_status:optionalString},statements:[
      `UPDATE hiring_job_publications SET status='closed',lifecycle_status='expired',version=version+1 WHERE requisition_id=:requisition_id AND organization_id=:organization_id AND brand_id=:brand_id AND status='published' AND coalesce(lifecycle_status,'published')='published' AND version=:expected_version AND ${owner} AND ${validOp} AND (:reason IS NULL OR length(trim(:reason)) BETWEEN 1 AND 1000) AND (:observed_linkedin_status IS NULL OR :observed_linkedin_status IN ('expired','closed'))`,
      audit('requisition.expired')
    ]},
    {name:'republish_job_requisition',description:'Republish an expired posting on the same requisition with a new LinkedIn job ID. Appends immutable repost history; applicants stay attached.',operation:'batch',requires_auth:true,step_up:true,params:{...scope,linkedin_job_id:string,expiry_date:optionalInteger,expected_version:integer,operation_id:string,reason:optionalString},statements:[
      `INSERT INTO hiring_linkedin_repost_history(id,operation_id,requisition_id,organization_id,brand_id,previous_linkedin_job_id,new_linkedin_job_id,actor_user_id,reason,reposted_at) SELECT :operation_id,:operation_id,j.requisition_id,j.organization_id,j.brand_id,j.linkedin_job_id,:linkedin_job_id,:__user_id,coalesce(:reason,'Reposted on LinkedIn'),${ms(':__now')} FROM hiring_job_publications j WHERE j.requisition_id=:requisition_id AND j.organization_id=:organization_id AND j.brand_id=:brand_id AND j.lifecycle_status='expired' AND j.version=:expected_version AND ${owner} AND ${validOp} AND length(trim(:linkedin_job_id)) BETWEEN 1 AND 128 AND (j.linkedin_job_id IS NULL OR j.linkedin_job_id<>:linkedin_job_id) AND (:reason IS NULL OR length(trim(:reason)) BETWEEN 1 AND 1000) AND (:expiry_date IS NULL OR ${ms(':expiry_date')}>${ms(':__now')})`,
      `UPDATE hiring_job_publications SET status='published',lifecycle_status='published',linkedin_job_id=:linkedin_job_id,expiry_date=CASE WHEN :expiry_date IS NULL THEN NULL ELSE ${ms(':expiry_date')} END,version=version+1 WHERE requisition_id=:requisition_id AND organization_id=:organization_id AND brand_id=:brand_id AND version=:expected_version AND EXISTS (SELECT 1 FROM hiring_linkedin_repost_history h WHERE h.operation_id=:operation_id AND h.requisition_id=:requisition_id AND h.actor_user_id=:__user_id)`,
      `INSERT INTO hiring_audit_events(id,organization_id,brand_id,action,actor_user_id,operation_id,created_at,object_type,object_id,redacted_summary) SELECT :operation_id,:organization_id,:brand_id,'requisition.reposted',:__user_id,:operation_id,${ms(':__now')},'requisition',:requisition_id,coalesce(:reason,'Reposted on LinkedIn') WHERE changes()=1`
    ]},
    {name:'list_linkedin_repost_history',description:'List immutable repost history for one granted requisition, most recent first.',operation:'query',requires_auth:true,params:scope,sql:`SELECT ${ms('h.reposted_at')} AS reposted_at,h.previous_linkedin_job_id,h.new_linkedin_job_id,h.actor_user_id,h.reason,h.operation_id FROM hiring_linkedin_repost_history h WHERE h.requisition_id=:requisition_id AND h.organization_id=:organization_id AND h.brand_id=:brand_id AND ${reader} ORDER BY h.reposted_at DESC,h.operation_id DESC LIMIT 100`},
    {name:'record_linkedin_status',description:'Record an observed LinkedIn state and optional expiry date; active and paused require a currently published posting, while expired and closed remove it from discovery.',operation:'batch',requires_auth:true,step_up:true,params:{...scope,linkedin_status:string,expiry_date:optionalInteger,expected_version:integer,operation_id:string,reason:string},statements:[
      `UPDATE hiring_job_publications SET status=CASE WHEN :linkedin_status IN ('expired','closed') THEN 'closed' ELSE 'published' END,lifecycle_status=CASE WHEN :linkedin_status='expired' THEN 'expired' WHEN :linkedin_status='closed' THEN 'closed' ELSE 'published' END,expiry_date=coalesce(${ms(':expiry_date')},expiry_date),version=version+1 WHERE requisition_id=:requisition_id AND organization_id=:organization_id AND brand_id=:brand_id AND version=:expected_version AND ${owner} AND ${validOp} AND :linkedin_status IN ('active','paused','expired','closed') AND length(trim(:reason)) BETWEEN 1 AND 1000 AND (:expiry_date IS NULL OR :expiry_date>0) AND (status='published' OR (:linkedin_status IN ('expired','closed') AND lifecycle_status='expired')) AND NOT (:linkedin_status='active' AND expiry_date IS NOT NULL AND ${ms('expiry_date')}<=${ms(':__now')} AND :expiry_date IS NULL)`,
      `INSERT INTO hiring_publication_controls(requisition_id,paused) SELECT :requisition_id,CASE WHEN :linkedin_status='paused' THEN 1 ELSE 0 END FROM hiring_job_publications j WHERE j.requisition_id=:requisition_id AND j.organization_id=:organization_id AND j.brand_id=:brand_id AND j.version=:expected_version+1 AND ${owner} AND changes()=1 ON CONFLICT(requisition_id) DO UPDATE SET paused=excluded.paused`,
      `INSERT INTO hiring_audit_events(id,organization_id,brand_id,action,actor_user_id,operation_id,created_at,object_type,object_id,redacted_summary) SELECT :operation_id,:organization_id,:brand_id,'requisition.linkedin_status_recorded',:__user_id,:operation_id,${ms(':__now')},'requisition',:requisition_id,:reason WHERE changes()=1`
    ]},
    {name:'get_job_linkedin_status',description:'Read the effective lifecycle status, current LinkedIn job ID, expiry date (Unix milliseconds), and expected publication version.',operation:'query',requires_auth:true,params:scope,sql:`SELECT j.requisition_id,j.linkedin_job_id,${ms('j.expiry_date')} AS expiry_date,j.version AS expected_version,${status} AS status FROM hiring_job_publications j LEFT JOIN hiring_publication_controls pc ON pc.requisition_id=j.requisition_id WHERE j.requisition_id=:requisition_id AND j.organization_id=:organization_id AND j.brand_id=:brand_id AND ${reader} LIMIT 1`},
    {name:'find_job_by_linkedin_id',description:'Search current and historical LinkedIn job IDs within an authorized brand; expected_version is the publication version.',operation:'query',requires_auth:true,params:{organization_id:string,brand_id:string,linkedin_job_id:string},sql:`SELECT j.requisition_id,j.linkedin_job_id,${ms('j.expiry_date')} AS expiry_date,j.version AS expected_version,${status} AS status FROM hiring_job_publications j LEFT JOIN hiring_publication_controls pc ON pc.requisition_id=j.requisition_id WHERE j.organization_id=:organization_id AND j.brand_id=:brand_id AND (j.linkedin_job_id=:linkedin_job_id OR EXISTS (SELECT 1 FROM hiring_linkedin_repost_history h WHERE h.requisition_id=j.requisition_id AND h.previous_linkedin_job_id=:linkedin_job_id)) AND EXISTS (SELECT 1 FROM hiring_effective_access p WHERE p.organization_id=j.organization_id AND p.brand_id=j.brand_id AND p.user_id=:__user_id AND p.role IN ('owner','recruiter') AND (p.requisition_id IS NULL OR p.requisition_id=j.requisition_id)) ORDER BY j.created_at DESC LIMIT 100`}
  )
  const transitions = {
    set_linkedin_job_id: 'length(trim(:linkedin_job_id)) BETWEEN 1 AND 128 AND (:previous_linkedin_job_id IS NULL OR :previous_linkedin_job_id IS (SELECT linkedin_job_id FROM hiring_job_publications WHERE requisition_id=:requisition_id)) AND :linkedin_job_id IS NOT (SELECT linkedin_job_id FROM hiring_job_publications WHERE requisition_id=:requisition_id)',
    set_job_expiry_date: ':expiry_date IS NOT (SELECT expiry_date FROM hiring_job_publications WHERE requisition_id=:requisition_id)',
    expire_job_requisition: `${state} IN ('published','paused')`,
    republish_job_requisition: `${state}='expired' AND length(trim(:linkedin_job_id)) BETWEEN 1 AND 128 AND :linkedin_job_id IS NOT (SELECT linkedin_job_id FROM hiring_job_publications WHERE requisition_id=:requisition_id)`,
    record_linkedin_status: `(:linkedin_status IN ('active','paused') AND ${state} IN ('published','paused') OR :linkedin_status IN ('expired','closed') AND ${state} IN ('published','paused','expired')) AND NOT (:linkedin_status='active' AND :expiry_date IS NULL AND ${ms('(SELECT expiry_date FROM hiring_job_publications WHERE requisition_id=:requisition_id)')}<=${ms(':__now')})`
  }
  for (const [name, transition] of Object.entries(transitions)) {
    const tool = get(name)
    let validation = name==='expire_job_requisition' ? "WHEN :observed_linkedin_status IS NOT NULL AND :observed_linkedin_status NOT IN ('expired','closed') THEN 'invalid_observed_linkedin_status_allowed_expired_closed'" : name==='record_linkedin_status' ? "WHEN :linkedin_status NOT IN ('active','paused','expired','closed') THEN 'invalid_linkedin_status_allowed_active_paused_expired_closed'" : ''
    if (tool.params.expiry_date) validation += " WHEN :expiry_date IS NOT NULL AND :expiry_date<=0 THEN 'invalid_expiry_date_seconds'"
    if (tool.params.reason) validation += " WHEN :reason IS NOT NULL AND length(trim(:reason)) NOT BETWEEN 1 AND 1000 THEN 'invalid_reason'"
    if (name==='republish_job_requisition') validation += ` WHEN :expiry_date IS NOT NULL AND ${ms(':expiry_date')}<=${ms(':__now')} THEN 'invalid_expiry_date_past'`
    if (name==='record_linkedin_status') validation += " WHEN :reason IS NULL THEN 'invalid_reason'"
    const target = name==='record_linkedin_status' ? ':linkedin_status' : name==='expire_job_requisition' ? "'expired'" : name==='republish_job_requisition' ? "'published'" : name==='set_linkedin_job_id' ? "'linkedin_id_change'" : "'expiry_date_change'"
    tool.statements.unshift(refusal(target, transition, validation))
    tool.statements.push(mcpAudit(name))
    if (tool.params.expiry_date) tool.params.expiry_date.description = 'Unix milliseconds; seconds are accepted and normalized. Null clears it where supported.'
    tool.params.expected_version.description = 'Current hiring_job_publications.version returned as expected_version by read tools.'
  }
  return registry
}

if (process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href) {
  const path=new URL('../mcp.json',import.meta.url)
  writeFileSync(path,JSON.stringify(addJobLifecycleTools(JSON.parse(readFileSync(path,'utf8'))),null,2)+'\n')
}
