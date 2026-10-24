// Generate the registered SQL boundary. No index, browser role or cursor is authority.
import { readFileSync, writeFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

const access = `EXISTS (SELECT 1 FROM hiring_effective_access p WHERE p.organization_id=a.organization_id AND p.brand_id=a.brand_id AND p.user_id=:__user_id AND (p.requisition_id IS NULL OR p.requisition_id=a.requisition_id) AND (p.role IN ('owner','recruiter') OR (p.role='reviewer' AND EXISTS (SELECT 1 FROM interviews i JOIN interview_assignments ia ON ia.interview_id=i.id AND ia.tenant_id=i.tenant_id AND ia.brand_id=i.brand_id AND ia.requisition_id=i.requisition_id AND ia.application_id=i.application_id WHERE i.application_id=a.id AND i.tenant_id=a.organization_id AND i.brand_id=a.brand_id AND i.requisition_id=a.requisition_id AND i.status='scheduled' AND ia.reviewer_id=:__user_id AND ia.revoked_at IS NULL))))`
const live = `NOT EXISTS (SELECT 1 FROM erasure_requests e WHERE e.candidate_id=c.id AND e.organization_id=c.organization_id AND e.brand_id=c.brand_id) AND NOT EXISTS (SELECT 1 FROM hiring_deletion_tombstones d WHERE d.candidate_id=c.id AND d.organization_id=c.organization_id AND d.brand_id=c.brand_id) AND NOT EXISTS (SELECT 1 FROM hiring_restore_tombstones d WHERE d.candidate_id=c.id AND d.organization_id=c.organization_id AND d.brand_id=c.brand_id)`
const budget = `INSERT INTO hiring_search_budget(user_id,window_start,requests) VALUES (:__user_id,CAST(:__now/60000 AS INTEGER),1) ON CONFLICT(user_id) DO UPDATE SET window_start=excluded.window_start,requests=CASE WHEN hiring_search_budget.window_start<>excluded.window_start THEN 1 ELSE min(hiring_search_budget.requests+1,31) END`

const scopeParams = { organization_id:{type:'string'}, brand_id:{type:'string'}, requisition_id:{type:'string',optional:true} }

export function buildSearchTools() {
  return ['candidates','applications'].flatMap(kind => [false,true].map(exact => {
    const candidate = kind==='candidates'
    const name = exact ? `get_search_${candidate?'candidate':'application'}` : `search_${kind}`
    const params = { ...structuredClone(scopeParams), ...(exact ? {id:{type:'string'}} : {q:{type:'string',max:200},limit:{type:'integer',optional:true,default:20},cursor:{type:'string',optional:true}}), ...(!candidate ? {stage:{type:'string',optional:true}} : {}) }
    const columns = candidate ? 'c.id,c.name AS full_name,NULL AS email,c.created_at' : 'a.id,a.candidate_id,a.requisition_id,COALESCE(a.accepted_stage,a.stage_extension,a.stage) AS stage,a.created_at'
    const rowId = candidate ? 'c.id' : 'a.id'
    const cursor = `hex(json_array('${name}',:__user_id,:organization_id,:brand_id,:requisition_id,${candidate?'NULL':':stage'},${rowId}))`
    // DISTINCT prevents candidates with several authorized applications being duplicated.
    const base = `SELECT DISTINCT ${columns}${exact?'':`,${cursor} AS token`} FROM hiring_applications a JOIN hiring_candidates c ON c.id=a.candidate_id AND c.organization_id=a.organization_id AND c.brand_id=a.brand_id WHERE a.organization_id=:organization_id AND a.brand_id=:brand_id AND (:requisition_id IS NULL OR a.requisition_id=:requisition_id) AND ${access} AND ${live}${candidate?'':' AND (:stage IS NULL OR COALESCE(a.accepted_stage,a.stage_extension,a.stage)=:stage)'} AND ${exact?`${rowId}=:id`:`typeof(:q)='text' AND length(:q)<=200 AND instr(:q,char(0))=0 AND c.name LIKE '%' || replace(replace(replace(:q,'\\','\\\\'),'%','\\%'),'_','\\_') || '%' ESCAPE '\\' AND (:limit IS NULL OR (typeof(:limit) IN ('integer','real') AND :limit=CAST(:limit AS INTEGER) AND :limit BETWEEN 1 AND 50)) AND (:cursor IS NULL OR length(:cursor)<=4096)`}`
    const sql = exact ? `${base} LIMIT 1` : `WITH authorized AS (${base}), anchor AS (SELECT created_at,id FROM authorized WHERE token=:cursor), page AS (SELECT * FROM authorized WHERE :cursor IS NULL OR EXISTS (SELECT 1 FROM anchor x WHERE authorized.created_at<x.created_at OR (authorized.created_at=x.created_at AND authorized.id>x.id)) ORDER BY created_at DESC,id ASC LIMIT CASE WHEN :limit IS NULL THEN 20 WHEN typeof(:limit) IN ('integer','real') AND :limit=CAST(:limit AS INTEGER) AND :limit BETWEEN 1 AND 50 THEN CAST(:limit AS INTEGER) ELSE 0 END) SELECT ${candidate?'id,full_name,email,created_at':'id,candidate_id,requisition_id,stage,created_at'},CASE WHEN EXISTS (SELECT 1 FROM authorized n WHERE n.created_at<page.created_at OR (n.created_at=page.created_at AND n.id>page.id)) THEN token ELSE NULL END AS next_cursor FROM page ORDER BY created_at DESC,id ASC LIMIT 50`
    const jsonRow = candidate ? "json_object('id',id,'full_name',full_name,'email',email,'created_at',created_at" : "json_object('id',id,'candidate_id',candidate_id,'requisition_id',requisition_id,'stage',stage,'created_at',created_at"
    const payload = `SELECT json_group_array(json(${jsonRow}${exact?'':",'next_cursor',next_cursor"}))) FROM (${sql})`
    const statement = `${budget} RETURNING CASE WHEN requests<=30 THEN 200 ELSE 429 END AS status,CASE WHEN requests<=30 THEN 0 ELSE 60-CAST((:__now%60000)/1000 AS INTEGER) END AS retry_after,CASE WHEN requests<=30 THEN (${payload}) ELSE '[]' END AS rows_json`
    return {name,description:exact?'Fetch one currently authorized search record.':'Bounded search within current grants and assignments.',operation:'batch',params,requires_auth:true,'x-rate-limit':{requests:30,window_seconds:60,scope:'authenticated_user',shared:'hiring_search'},statements:[statement]}
  }))
}
if (process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href) {
  const url=new URL('../mcp.json',import.meta.url)
  const registry=JSON.parse(readFileSync(url,'utf8'))
  const names=new Set(buildSearchTools().map(t=>t.name))
  registry.tools=registry.tools.filter(t=>!names.has(t.name))
  registry.tools.push(...buildSearchTools())
  writeFileSync(url,JSON.stringify(registry,null,2)+'\n')
}
