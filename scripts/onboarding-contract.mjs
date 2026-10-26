// Additive successor to the already-deployed acceptance/lifecycle triggers.
// Old ledgers and their guards remain intact; all new writes use the versioned
// ledgers below. In particular, no paid terms are invented to satisfy an old guard.
import { readFileSync, writeFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { retentionTools } from './retention-contract.mjs'

export const effectiveStage = alias => `COALESCE(${alias}workflow_stage,${alias}lifecycle_stage,${alias}accepted_stage,${alias}stage_extension,${alias}stage)`
const actor = `NEW.actor_user_id NOT IN ('system','automation','api_key','system:worker') AND length(trim(NEW.actor_user_id))>0`
const access = role => `EXISTS(SELECT 1 FROM hiring_effective_access g WHERE g.user_id=NEW.actor_user_id AND g.organization_id=a.organization_id AND g.brand_id=a.brand_id AND g.role IN (${role}) AND (g.requisition_id IS NULL OR g.requisition_id=a.requisition_id))`
const recruiter = access("'owner','recruiter'")
const owner = access("'owner'")
const operationGuard = `SELECT RAISE(ABORT,'Human actor and fresh operation required') WHERE NOT (${actor}) OR length(trim(NEW.operation_id)) NOT BETWEEN 1 AND 128 OR EXISTS(SELECT 1 FROM hiring_audit_events WHERE id=NEW.operation_id OR operation_id=NEW.operation_id) OR EXISTS(SELECT 1 FROM hiring_stage_events WHERE id=NEW.operation_id);`
const audit = action => `INSERT INTO hiring_audit_events(id,organization_id,brand_id,application_id,action,actor_user_id,operation_id,created_at,redacted_summary) VALUES(NEW.operation_id,NEW.organization_id,NEW.brand_id,NEW.application_id,'${action}',NEW.actor_user_id,NEW.operation_id,NEW.created_at,'${action}');`
const history = `INSERT INTO hiring_stage_events(id,organization_id,brand_id,application_id,from_stage,to_stage,version,reason,actor_user_id,created_at) VALUES(NEW.operation_id,NEW.organization_id,NEW.brand_id,NEW.application_id,NEW.from_stage,NEW.to_stage,NEW.expected_version+1,NEW.evidence,NEW.actor_user_id,NEW.created_at);`
const immutable = table => `CREATE TRIGGER ${table}_no_update BEFORE UPDATE ON ${table} BEGIN SELECT RAISE(ABORT,'History is immutable'); END;
CREATE TRIGGER ${table}_no_delete BEFORE DELETE ON ${table} BEGIN SELECT RAISE(ABORT,'History is immutable'); END;`
const fence = table => `CREATE TRIGGER ${table}_privacy_fence BEFORE INSERT ON ${table} BEGIN
 SELECT RAISE(ABORT,'Candidate erasure or restore tombstone') WHERE EXISTS(SELECT 1 FROM hiring_applications a WHERE a.id=NEW.application_id AND (
 EXISTS(SELECT 1 FROM erasure_requests t WHERE t.candidate_id=a.candidate_id AND t.organization_id=a.organization_id AND t.brand_id=a.brand_id) OR
 EXISTS(SELECT 1 FROM hiring_deletion_tombstones t WHERE t.candidate_id=a.candidate_id AND t.organization_id=a.organization_id AND t.brand_id=a.brand_id) OR
 EXISTS(SELECT 1 FROM hiring_restore_tombstones t WHERE t.candidate_id=a.candidate_id AND t.organization_id=a.organization_id AND t.brand_id=a.brand_id)));
END;`

export const onboardingMigration = { name: '0051_onboarding_ledger_upgrade', sql: `
ALTER TABLE hiring_applications ADD COLUMN workflow_stage TEXT CHECK(workflow_stage IS NULL OR workflow_stage IN ('accepted','onboarding','onboarded','active','rejected','withdrawn'));
ALTER TABLE hiring_applications ADD COLUMN workflow_acceptance_evidence TEXT;
CREATE TABLE hiring_acceptances_v2 (
 operation_id TEXT PRIMARY KEY, organization_id TEXT NOT NULL, brand_id TEXT NOT NULL, application_id TEXT NOT NULL UNIQUE,
 offer_id TEXT NOT NULL, offer_version INTEGER NOT NULL, actor_user_id TEXT NOT NULL, expected_version INTEGER NOT NULL,
 acceptance_evidence TEXT NOT NULL CHECK(length(trim(acceptance_evidence)) BETWEEN 1 AND 10000), created_at INTEGER NOT NULL,
 FOREIGN KEY(application_id,organization_id,brand_id) REFERENCES hiring_applications(id,organization_id,brand_id));
CREATE VIEW hiring_acceptance_history AS SELECT * FROM hiring_acceptances UNION ALL SELECT * FROM hiring_acceptances_v2;
CREATE TRIGGER hiring_acceptances_v2_validate BEFORE INSERT ON hiring_acceptances_v2 BEGIN
 ${operationGuard}
 SELECT RAISE(ABORT,'Acceptance requires an offered application, current version, approved offer and recruiter access') WHERE NOT EXISTS(
 SELECT 1 FROM hiring_applications a JOIN hiring_offers o ON o.application_id=a.id AND o.tenant_id=a.organization_id AND o.brand_id=a.brand_id
 JOIN hiring_offer_versions v ON v.offer_id=o.id AND v.version=o.current_version
 WHERE a.id=NEW.application_id AND a.organization_id=NEW.organization_id AND a.brand_id=NEW.brand_id AND a.version=NEW.expected_version
 AND ${effectiveStage('a.')}='offered' AND o.id=NEW.offer_id AND o.current_version=NEW.offer_version AND o.status='approved' AND ${recruiter});
 SELECT RAISE(ABORT,'Acceptance already recorded') WHERE EXISTS(SELECT 1 FROM hiring_acceptance_history WHERE application_id=NEW.application_id);
END;
CREATE TRIGGER hiring_acceptances_v2_commit AFTER INSERT ON hiring_acceptances_v2 BEGIN
 UPDATE hiring_applications SET workflow_stage='accepted',workflow_acceptance_evidence=NEW.acceptance_evidence,version=version+1,updated_at=NEW.created_at WHERE id=NEW.application_id;
 INSERT INTO hiring_stage_events(id,organization_id,brand_id,application_id,from_stage,to_stage,version,reason,actor_user_id,created_at) VALUES(NEW.operation_id,NEW.organization_id,NEW.brand_id,NEW.application_id,'offered','accepted',NEW.expected_version+1,NEW.acceptance_evidence,NEW.actor_user_id,NEW.created_at);
 ${audit('application.accepted')}
END;
${immutable('hiring_acceptances_v2')}
${fence('hiring_acceptances_v2')}
CREATE TABLE hiring_lifecycle_events_v2 (
 operation_id TEXT PRIMARY KEY, organization_id TEXT NOT NULL, brand_id TEXT NOT NULL, requisition_id TEXT NOT NULL, application_id TEXT NOT NULL,
 from_stage TEXT NOT NULL, to_stage TEXT NOT NULL, expected_version INTEGER NOT NULL, evidence TEXT NOT NULL CHECK(length(trim(evidence)) BETWEEN 1 AND 10000),
 registration_evidence TEXT NOT NULL, requirements_evidence TEXT NOT NULL, handoff_evidence TEXT NOT NULL, actor_user_id TEXT NOT NULL, created_at INTEGER NOT NULL,
 UNIQUE(application_id,expected_version), FOREIGN KEY(application_id,organization_id,brand_id) REFERENCES hiring_applications(id,organization_id,brand_id));
CREATE VIEW hiring_lifecycle_history AS SELECT * FROM hiring_lifecycle_events UNION ALL SELECT * FROM hiring_lifecycle_events_v2;
CREATE TRIGGER hiring_lifecycle_events_v2_validate BEFORE INSERT ON hiring_lifecycle_events_v2 BEGIN
 ${operationGuard}
 SELECT RAISE(ABORT,'Lifecycle transition requires current version, matching scope and recruiter access') WHERE NOT EXISTS(
 SELECT 1 FROM hiring_applications a WHERE a.id=NEW.application_id AND a.organization_id=NEW.organization_id AND a.brand_id=NEW.brand_id AND a.requisition_id=NEW.requisition_id AND a.version=NEW.expected_version AND ${effectiveStage('a.')}=NEW.from_stage AND ${recruiter});
 SELECT RAISE(ABORT,'Invalid lifecycle transition') WHERE NOT ((NEW.from_stage='accepted' AND NEW.to_stage IN ('onboarding','rejected','withdrawn')) OR (NEW.from_stage='onboarding' AND NEW.to_stage IN ('onboarded','rejected','withdrawn')) OR (NEW.from_stage='onboarded' AND NEW.to_stage IN ('active','rejected','withdrawn')));
 SELECT RAISE(ABORT,'Registration, requirements acknowledgement and team/Discord handoff evidence are required') WHERE NEW.to_stage='onboarded' AND (length(trim(NEW.registration_evidence))=0 OR length(trim(NEW.requirements_evidence))=0 OR length(trim(NEW.handoff_evidence))=0);
END;
CREATE TRIGGER hiring_lifecycle_events_v2_commit AFTER INSERT ON hiring_lifecycle_events_v2 BEGIN
 UPDATE hiring_applications SET workflow_stage=NEW.to_stage,version=version+1,updated_at=NEW.created_at WHERE id=NEW.application_id;
 ${history}
 ${audit('application.lifecycle_changed')}
END;
${immutable('hiring_lifecycle_events_v2')}
${fence('hiring_lifecycle_events_v2')}
CREATE TABLE hiring_offer_corrections (
 operation_id TEXT PRIMARY KEY, organization_id TEXT NOT NULL, brand_id TEXT NOT NULL, application_id TEXT NOT NULL, offer_id TEXT NOT NULL,
 offer_version INTEGER NOT NULL, expected_offer_lock_version INTEGER NOT NULL, expected_application_version INTEGER NOT NULL,
 correction_version INTEGER NOT NULL, terms_json TEXT NOT NULL CHECK(json_valid(terms_json)), acceptance_evidence TEXT NOT NULL CHECK(length(trim(acceptance_evidence)) BETWEEN 1 AND 10000),
 reason TEXT NOT NULL CHECK(length(trim(reason)) BETWEEN 1 AND 10000), actor_user_id TEXT NOT NULL, created_at INTEGER NOT NULL,
 UNIQUE(offer_id,correction_version), UNIQUE(application_id,expected_application_version),
 FOREIGN KEY(application_id,organization_id,brand_id) REFERENCES hiring_applications(id,organization_id,brand_id));
CREATE TRIGGER hiring_offer_corrections_validate BEFORE INSERT ON hiring_offer_corrections BEGIN
 ${operationGuard}
 SELECT RAISE(ABORT,'Correction requires owner, current accepted application and exact approved offer') WHERE NOT EXISTS(
 SELECT 1 FROM hiring_applications a JOIN hiring_offers o ON o.application_id=a.id AND o.tenant_id=a.organization_id AND o.brand_id=a.brand_id
 WHERE a.id=NEW.application_id AND a.organization_id=NEW.organization_id AND a.brand_id=NEW.brand_id AND a.version=NEW.expected_application_version
 AND ${effectiveStage('a.')} IN ('accepted','onboarding') AND o.id=NEW.offer_id AND o.status='approved' AND o.current_version=NEW.offer_version AND o.lock_version=NEW.expected_offer_lock_version
 AND EXISTS(SELECT 1 FROM hiring_acceptance_history x WHERE x.application_id=a.id AND x.offer_id=o.id AND x.offer_version=o.current_version AND x.organization_id=a.organization_id AND x.brand_id=a.brand_id)
 AND ${owner});
 SELECT RAISE(ABORT,'Correction version conflict') WHERE NEW.correction_version<>1+COALESCE((SELECT MAX(correction_version) FROM hiring_offer_corrections WHERE offer_id=NEW.offer_id),0);
 SELECT RAISE(ABORT,'Explicit corrected terms required') WHERE json_extract(NEW.terms_json,'$.compensation_type') IS NULL OR json_extract(NEW.terms_json,'$.compensation_type') NOT IN ('paid','unpaid','internship','volunteer') OR json_type(NEW.terms_json,'$.subject') IS NOT 'text' OR length(trim(json_extract(NEW.terms_json,'$.subject'))) NOT BETWEEN 1 AND 200 OR json_type(NEW.terms_json,'$.body') IS NOT 'text' OR length(trim(json_extract(NEW.terms_json,'$.body'))) NOT BETWEEN 1 AND 40000;
END;
CREATE TRIGGER hiring_offer_corrections_commit AFTER INSERT ON hiring_offer_corrections BEGIN
 UPDATE hiring_applications SET workflow_acceptance_evidence=NEW.acceptance_evidence,version=version+1,updated_at=NEW.created_at WHERE id=NEW.application_id;
 ${audit('offer.accepted_terms_corrected')}
END;
${immutable('hiring_offer_corrections')}
${fence('hiring_offer_corrections')}
CREATE TRIGGER hiring_workflow_stage_guard BEFORE UPDATE OF workflow_stage ON hiring_applications WHEN NEW.workflow_stage IS NOT OLD.workflow_stage BEGIN
 SELECT RAISE(ABORT,'Controlled workflow transition required') WHERE NOT EXISTS(SELECT 1 FROM hiring_acceptances_v2 x WHERE x.application_id=OLD.id AND x.organization_id=OLD.organization_id AND x.brand_id=OLD.brand_id AND x.expected_version=OLD.version AND NEW.workflow_stage='accepted') AND NOT EXISTS(SELECT 1 FROM hiring_lifecycle_events_v2 x WHERE x.application_id=OLD.id AND x.organization_id=OLD.organization_id AND x.brand_id=OLD.brand_id AND x.expected_version=OLD.version AND x.from_stage=${effectiveStage('OLD.')} AND x.to_stage=NEW.workflow_stage);
END;
CREATE TRIGGER hiring_workflow_evidence_guard BEFORE UPDATE OF workflow_acceptance_evidence ON hiring_applications WHEN NEW.workflow_acceptance_evidence IS NOT OLD.workflow_acceptance_evidence BEGIN
 SELECT RAISE(ABORT,'Controlled acceptance evidence required') WHERE NOT EXISTS(SELECT 1 FROM hiring_acceptances_v2 x WHERE x.application_id=OLD.id AND x.organization_id=OLD.organization_id AND x.brand_id=OLD.brand_id AND x.expected_version=OLD.version AND x.acceptance_evidence=NEW.workflow_acceptance_evidence) AND NOT EXISTS(SELECT 1 FROM hiring_offer_corrections x WHERE x.application_id=OLD.id AND x.organization_id=OLD.organization_id AND x.brand_id=OLD.brand_id AND x.expected_application_version=OLD.version AND x.acceptance_evidence=NEW.workflow_acceptance_evidence);
END;
CREATE TRIGGER hiring_workflow_insert_guard BEFORE INSERT ON hiring_applications WHEN NEW.workflow_stage IS NOT NULL OR NEW.workflow_acceptance_evidence IS NOT NULL BEGIN SELECT RAISE(ABORT,'Controlled workflow required'); END;
CREATE TRIGGER hiring_workflow_legacy_guard BEFORE UPDATE OF stage,stage_extension,accepted_stage,lifecycle_stage ON hiring_applications WHEN OLD.workflow_stage IS NOT NULL AND (NEW.stage IS NOT OLD.stage OR NEW.stage_extension IS NOT OLD.stage_extension OR NEW.accepted_stage IS NOT OLD.accepted_stage OR NEW.lifecycle_stage IS NOT OLD.lifecycle_stage) BEGIN SELECT RAISE(ABORT,'Controlled workflow required'); END;
CREATE TRIGGER hiring_workflow_decision_guard BEFORE INSERT ON hiring_decisions WHEN EXISTS(SELECT 1 FROM hiring_applications a WHERE a.id=NEW.application_id AND a.workflow_stage IS NOT NULL) BEGIN SELECT RAISE(ABORT,'Accepted workflow requires lifecycle transitions; decision is terminal'); END;
CREATE TRIGGER hiring_workflow_dispatch_guard BEFORE UPDATE OF delivery_state ON hiring_outbox WHEN NEW.delivery_state IN ('pending','sending') AND EXISTS(SELECT 1 FROM hiring_applications a WHERE a.id=NEW.application_id AND a.workflow_stage IS NOT NULL) BEGIN SELECT RAISE(ABORT,'Accepted workflow dispatch is terminal'); END;
CREATE TRIGGER hiring_corrected_offer_dispatch_guard BEFORE INSERT ON hiring_outbox_authorizations WHEN EXISTS(SELECT 1 FROM hiring_offer_corrections WHERE offer_id=NEW.offer_id) BEGIN SELECT RAISE(ABORT,'Corrected accepted terms do not authorize an offer dispatch'); END;
` }

const string = { type: 'string' }, integer = { type: 'integer' }
const correctionParams = Object.fromEntries(['organization_id','brand_id','application_id','offer_id','terms_json','acceptance_evidence','reason','operation_id'].map(key => [key,string]))
for (const key of ['expected_application_version','expected_offer_version','expected_offer_lock_version','expected_correction_version']) correctionParams[key] = integer
const correctionMatch = `x.organization_id=:organization_id AND x.brand_id=:brand_id AND x.application_id=:application_id AND x.offer_id=:offer_id`
const correctionAccess = `EXISTS(SELECT 1 FROM hiring_effective_access g JOIN hiring_applications a ON a.id=x.application_id AND a.organization_id=g.organization_id AND a.brand_id=g.brand_id WHERE g.user_id=:__user_id AND g.organization_id=x.organization_id AND g.brand_id=x.brand_id AND g.role='owner' AND (g.requisition_id IS NULL OR g.requisition_id=a.requisition_id))`
export const correctionTools = [
 { name:'correct_accepted_offer', description:'Owner records an evidence-backed administrative correction of mistaken accepted offer terms. Preserves original offer/acceptance and does not send or authorize a new offer. Read get_offer_correction_result after writes or lost responses.', requires_auth:true, operation:'execute', params:correctionParams,
 sql:`INSERT INTO hiring_offer_corrections(operation_id,organization_id,brand_id,application_id,offer_id,offer_version,expected_offer_lock_version,expected_application_version,correction_version,terms_json,acceptance_evidence,reason,actor_user_id,created_at) SELECT :operation_id,:organization_id,:brand_id,:application_id,:offer_id,:expected_offer_version,:expected_offer_lock_version,:expected_application_version,:expected_correction_version+1,:terms_json,:acceptance_evidence,:reason,:__user_id,:__now WHERE NOT EXISTS(SELECT 1 FROM hiring_offer_corrections WHERE operation_id=:operation_id)` },
 { name:'get_offer_correction_result', description:'Owner-scoped exact correction readback; changed payloads and other actors do not reconcile as success.', requires_auth:true, operation:'query', params:correctionParams,
 sql:`SELECT x.* FROM hiring_offer_corrections x WHERE ${correctionMatch} AND x.operation_id=:operation_id AND x.actor_user_id=:__user_id AND x.expected_application_version=:expected_application_version AND x.offer_version=:expected_offer_version AND x.expected_offer_lock_version=:expected_offer_lock_version AND x.correction_version=:expected_correction_version+1 AND x.terms_json=:terms_json AND x.acceptance_evidence=:acceptance_evidence AND x.reason=:reason AND ${correctionAccess}` },
 { name:'list_offer_corrections', description:'Owner reads immutable administrative corrections of one accepted offer.', requires_auth:true, operation:'query', params:Object.fromEntries(['organization_id','brand_id','application_id','offer_id'].map(key=>[key,string])),
 sql:`SELECT x.* FROM hiring_offer_corrections x WHERE ${correctionMatch} AND ${correctionAccess} ORDER BY x.correction_version DESC LIMIT 100` },
]

// One-time manifest upgrade. Keep this explicit so changes are reviewable and
// generators cannot quietly reintroduce the old effective-stage calculation.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href && process.argv.includes('--write')) {
 const path = new URL('../mcp.json',import.meta.url), manifest = JSON.parse(readFileSync(path))
 if(manifest.tools.some(t=>t.name==='correct_accepted_offer'))throw new Error('The one-time manifest upgrade is already applied; edit the successor contract explicitly.')
 const transform = sql => sql.replace(/COALESCE\((a\.)?lifecycle_stage,\1accepted_stage,\1stage_extension,\1stage\)/g,(_,alias='')=>effectiveStage(alias)).replace(/a\.acceptance_evidence(?![a-z_])/g,'COALESCE(a.workflow_acceptance_evidence,a.acceptance_evidence)')
 for (const tool of manifest.tools) {
  if (tool.sql) tool.sql=transform(tool.sql)
  if (tool.statements) tool.statements=tool.statements.map(transform)
  // Preserve the stable response field rather than leaking SQL expression names.
  if (tool.sql) tool.sql=tool.sql.replace(/COALESCE\(a.workflow_acceptance_evidence,a.acceptance_evidence\)(?=,| FROM)/g,'COALESCE(a.workflow_acceptance_evidence,a.acceptance_evidence) AS acceptance_evidence')
 }
 const tool = name => manifest.tools.find(t=>t.name===name)
 tool('record_acceptance').statements[0]=tool('record_acceptance').statements[0].replace('INSERT INTO hiring_acceptances ','INSERT INTO hiring_acceptances_v2 ').replace('FROM hiring_acceptances WHERE','FROM hiring_acceptance_history WHERE')
 tool('get_acceptance_result').sql=tool('get_acceptance_result').sql.replace('JOIN hiring_acceptances x','JOIN hiring_acceptance_history x')
 tool('record_lifecycle_transition').sql=tool('record_lifecycle_transition').sql.replaceAll('hiring_lifecycle_events','hiring_lifecycle_events_v2')
 for (const name of ['get_lifecycle_result','list_lifecycle_events']) tool(name).sql=tool(name).sql.replace('FROM hiring_lifecycle_events e','FROM hiring_lifecycle_history e')
 const offer=tool('get_offer')
 offer.sql=offer.sql.replace('v.terms_json,',`COALESCE((SELECT x.terms_json FROM hiring_offer_corrections x WHERE x.offer_id=o.id ORDER BY x.correction_version DESC LIMIT 1),v.terms_json) AS terms_json,v.terms_json AS original_terms_json,COALESCE((SELECT MAX(x.correction_version) FROM hiring_offer_corrections x WHERE x.offer_id=o.id),0) AS correction_version,(SELECT json_group_array(json_object('version',x.correction_version,'reason',x.reason,'actor',x.actor_user_id,'created_at',x.created_at)) FROM hiring_offer_corrections x WHERE x.offer_id=o.id) AS corrections_json,`)
 for(const next of correctionTools) {const index=manifest.tools.findIndex(t=>t.name===next.name);if(index<0)manifest.tools.push(next);else manifest.tools[index]=next}
 // The retention verifier must conservatively count every new protected ledger.
 tool('verify_store_d1').sql=retentionTools.find(t=>t.name==='verify_store_d1').sql
 writeFileSync(path,JSON.stringify(manifest,null,2)+'\n')
 const migrationPath=new URL('../migrations.json',import.meta.url), migrations=JSON.parse(readFileSync(migrationPath))
 if(!migrations.migrations.some(m=>m.name===onboardingMigration.name))migrations.migrations.push(onboardingMigration)
 writeFileSync(migrationPath,JSON.stringify(migrations,null,2)+'\n')
}
