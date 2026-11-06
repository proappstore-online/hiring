// Additive terminal classification and candidate-linked hiring-team plans.
// No production rows are changed by this source file. The migration classifies
// legacy active applications through a separate immutable ledger.
import { readFileSync, writeFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

const effective = a => `COALESCE(${a}.workflow_stage,${a}.lifecycle_stage,${a}.accepted_stage,${a}.stage_extension,${a}.stage)`
const terminal = `('rejected','withdrawn','onboarded','active')`
const access = a => `EXISTS(SELECT 1 FROM hiring_effective_access g WHERE g.organization_id=${a}.organization_id AND g.brand_id=${a}.brand_id AND g.user_id=:__user_id AND g.role IN ('owner','recruiter') AND (g.requisition_id IS NULL OR g.requisition_id=${a}.requisition_id))`
const latest = a => `(SELECT MAX(x.revision) FROM hiring_next_action_plan_events x WHERE x.application_id=${a}.application_id)`

export const terminalMigration = { name: '0074_terminal_next_actions', sql: `
CREATE TABLE hiring_terminal_archive (
 application_id TEXT PRIMARY KEY,organization_id TEXT NOT NULL,brand_id TEXT NOT NULL,requisition_id TEXT NOT NULL,
 terminal_stage TEXT NOT NULL CHECK(terminal_stage IN ('rejected','withdrawn','onboarded')),
 archive_status TEXT NOT NULL CHECK(archive_status IN ('rejected','withdrawn','onboarded_inactive')),
 reason TEXT NOT NULL,source TEXT NOT NULL CHECK(source IN ('transition','legacy_active')),
 operation_id TEXT NOT NULL UNIQUE,created_at INTEGER NOT NULL,
 FOREIGN KEY(application_id,organization_id,brand_id) REFERENCES hiring_applications(id,organization_id,brand_id));
CREATE TRIGGER hiring_terminal_archive_no_update BEFORE UPDATE ON hiring_terminal_archive BEGIN SELECT RAISE(ABORT,'Terminal history is immutable'); END;
CREATE TRIGGER hiring_terminal_archive_no_delete BEFORE DELETE ON hiring_terminal_archive BEGIN SELECT RAISE(ABORT,'Terminal history is immutable'); END;
CREATE TRIGGER hiring_terminal_archive_audit AFTER INSERT ON hiring_terminal_archive BEGIN
 INSERT INTO hiring_audit_events(id,organization_id,brand_id,application_id,action,actor_user_id,operation_id,created_at,redacted_summary)
 VALUES(NEW.operation_id,NEW.organization_id,NEW.brand_id,NEW.application_id,'application.terminal_classified','system:terminal_classifier',NEW.operation_id,NEW.created_at,NEW.source);
END;
INSERT INTO hiring_terminal_archive(application_id,organization_id,brand_id,requisition_id,terminal_stage,archive_status,reason,source,operation_id,created_at)
 SELECT a.id,a.organization_id,a.brand_id,a.requisition_id,'onboarded','onboarded_inactive',
 'Legacy active stage classified as onboarded; checklist completion not inferred','legacy_active','legacy-active:'||a.id,a.updated_at
 FROM hiring_applications a WHERE ${effective('a')}='active';
CREATE TRIGGER hiring_terminal_archive_new AFTER UPDATE OF stage,workflow_stage,lifecycle_stage,accepted_stage,stage_extension ON hiring_applications
 WHEN ${effective('NEW')} IN ('rejected','withdrawn','onboarded') AND NOT EXISTS(SELECT 1 FROM hiring_terminal_archive WHERE application_id=NEW.id)
 BEGIN
 INSERT INTO hiring_terminal_archive(application_id,organization_id,brand_id,requisition_id,terminal_stage,archive_status,reason,source,operation_id,created_at)
 VALUES(NEW.id,NEW.organization_id,NEW.brand_id,NEW.requisition_id,${effective('NEW')},
 CASE WHEN ${effective('NEW')}='onboarded' THEN 'onboarded_inactive' ELSE ${effective('NEW')} END,
 'Terminal transition; see the recorded stage or lifecycle event',
 'transition','terminal:'||NEW.id||':'||NEW.version,NEW.updated_at);
 END;
CREATE TRIGGER hiring_terminal_freeze BEFORE UPDATE OF stage,workflow_stage,lifecycle_stage,accepted_stage,stage_extension ON hiring_applications
 WHEN EXISTS(SELECT 1 FROM hiring_terminal_archive WHERE application_id=OLD.id)
 AND ${effective('NEW')} IS NOT ${effective('OLD')}
 BEGIN SELECT RAISE(ABORT,'Terminal application cannot change stage'); END;
CREATE TRIGGER hiring_no_new_active BEFORE UPDATE OF stage,workflow_stage,lifecycle_stage,accepted_stage,stage_extension ON hiring_applications
 WHEN ${effective('NEW')}='active' AND ${effective('OLD')}<>'active'
 BEGIN SELECT RAISE(ABORT,'Active is no longer a Hiring stage'); END;
CREATE TRIGGER hiring_no_terminal_lifecycle BEFORE INSERT ON hiring_lifecycle_events_v2
 WHEN NEW.from_stage IN ${terminal} OR NEW.to_stage='active'
 BEGIN SELECT RAISE(ABORT,'Terminal application cannot change lifecycle'); END;
CREATE TRIGGER hiring_no_terminal_legacy_lifecycle BEFORE INSERT ON hiring_lifecycle_events
 WHEN NEW.from_stage IN ${terminal} OR NEW.to_stage='active'
 BEGIN SELECT RAISE(ABORT,'Terminal application cannot change lifecycle'); END;
CREATE TABLE hiring_next_action_plan_events (
 operation_id TEXT PRIMARY KEY,organization_id TEXT NOT NULL,brand_id TEXT NOT NULL,requisition_id TEXT NOT NULL,
 application_id TEXT NOT NULL,revision INTEGER NOT NULL CHECK(revision>0),kind TEXT NOT NULL CHECK(kind IN ('actionable','blocked','deferred','closed')),
 owner TEXT NOT NULL CHECK(owner IN ('Serge','bot')),action TEXT NOT NULL DEFAULT '',blocker_reason TEXT NOT NULL DEFAULT '',review_at INTEGER,
 actor_user_id TEXT NOT NULL,created_at INTEGER NOT NULL,UNIQUE(application_id,revision),
 FOREIGN KEY(application_id,organization_id,brand_id) REFERENCES hiring_applications(id,organization_id,brand_id));
CREATE INDEX hiring_next_action_plan_scope ON hiring_next_action_plan_events(organization_id,brand_id,application_id,revision DESC);
CREATE TRIGGER hiring_next_action_plan_validate BEFORE INSERT ON hiring_next_action_plan_events BEGIN
 SELECT RAISE(ABORT,'Plan requires scoped recruiter and nonterminal application') WHERE NOT EXISTS(
  SELECT 1 FROM hiring_applications a JOIN hiring_effective_access g ON g.organization_id=a.organization_id AND g.brand_id=a.brand_id AND g.user_id=NEW.actor_user_id
  WHERE a.id=NEW.application_id AND a.organization_id=NEW.organization_id AND a.brand_id=NEW.brand_id AND a.requisition_id=NEW.requisition_id
  AND g.role IN ('owner','recruiter') AND (g.requisition_id IS NULL OR g.requisition_id=a.requisition_id)
  AND ${effective('a')} NOT IN ${terminal}) AND NEW.kind<>'closed';
 SELECT RAISE(ABORT,'Plan revision conflict') WHERE NEW.revision<>1+COALESCE((SELECT MAX(revision) FROM hiring_next_action_plan_events WHERE application_id=NEW.application_id),0);
 SELECT RAISE(ABORT,'Invalid next action plan') WHERE length(trim(NEW.operation_id)) NOT BETWEEN 1 AND 128
  OR (NEW.kind='actionable' AND length(trim(NEW.action))=0)
  OR (NEW.kind='blocked' AND length(trim(NEW.blocker_reason))=0)
  OR (NEW.kind='deferred' AND (NEW.review_at IS NULL OR NEW.review_at<=NEW.created_at))
  OR (NEW.kind='closed' AND NEW.actor_user_id<>'system:terminal_classifier');
END;
CREATE TRIGGER hiring_next_action_plan_audit AFTER INSERT ON hiring_next_action_plan_events BEGIN
 INSERT INTO hiring_audit_events(id,organization_id,brand_id,application_id,action,actor_user_id,operation_id,created_at,redacted_summary)
 VALUES(NEW.operation_id,NEW.organization_id,NEW.brand_id,NEW.application_id,'hiring.next_action_'||NEW.kind,NEW.actor_user_id,NEW.operation_id,NEW.created_at,'Hiring team plan updated');
END;
CREATE TRIGGER hiring_next_action_plan_no_update BEFORE UPDATE ON hiring_next_action_plan_events BEGIN SELECT RAISE(ABORT,'Next action history is immutable'); END;
CREATE TRIGGER hiring_next_action_plan_no_delete BEFORE DELETE ON hiring_next_action_plan_events BEGIN SELECT RAISE(ABORT,'Next action history is immutable'); END;
CREATE TRIGGER hiring_next_action_close_terminal AFTER INSERT ON hiring_terminal_archive
 WHEN EXISTS(SELECT 1 FROM hiring_next_action_plan_events WHERE application_id=NEW.application_id AND kind<>'closed')
 BEGIN
 INSERT INTO hiring_next_action_plan_events(operation_id,organization_id,brand_id,requisition_id,application_id,revision,kind,owner,action,blocker_reason,review_at,actor_user_id,created_at)
 SELECT 'terminal-plan:'||NEW.application_id||':'||NEW.created_at,NEW.organization_id,NEW.brand_id,NEW.requisition_id,NEW.application_id,
 1+MAX(revision),'closed','bot','','',NULL,'system:terminal_classifier',NEW.created_at
 FROM hiring_next_action_plan_events WHERE application_id=NEW.application_id;
 END;
CREATE TABLE hiring_next_action_enforcement(organization_id TEXT PRIMARY KEY,enabled_at INTEGER NOT NULL);
CREATE TRIGGER hiring_plan_stage_gate INSTEAD OF INSERT ON hiring_stage_checks_v3
 WHEN EXISTS(SELECT 1 FROM hiring_next_action_enforcement WHERE organization_id=NEW.organization_id)
 AND NEW.to_stage NOT IN ${terminal}
 AND NOT EXISTS(SELECT 1 FROM hiring_next_action_plan_events e WHERE e.application_id=NEW.application_id
  AND e.revision=(SELECT MAX(x.revision) FROM hiring_next_action_plan_events x WHERE x.application_id=e.application_id)
  AND e.kind IN ('actionable','blocked','deferred'))
 BEGIN SELECT RAISE(ABORT,'Candidate-linked next action required'); END;
CREATE TRIGGER hiring_plan_lifecycle_gate BEFORE INSERT ON hiring_lifecycle_events_v2
 WHEN EXISTS(SELECT 1 FROM hiring_next_action_enforcement WHERE organization_id=NEW.organization_id)
 AND NEW.to_stage NOT IN ${terminal}
 AND NOT EXISTS(SELECT 1 FROM hiring_next_action_plan_events e WHERE e.application_id=NEW.application_id
  AND e.revision=(SELECT MAX(x.revision) FROM hiring_next_action_plan_events x WHERE x.application_id=e.application_id)
  AND e.kind IN ('actionable','blocked','deferred'))
 BEGIN SELECT RAISE(ABORT,'Candidate-linked next action required'); END;
` }

const str={type:'string'}, int={type:'integer'}
const scope={organization_id:str,brand_id:str,requisition_id:str,application_id:str}
export const terminalTools = [
 {name:'set_candidate_next_action_plan',description:'Append a scoped hiring-team plan for one nonterminal application. Owner is Serge or bot; no fabricated due date.',operation:'execute',requires_auth:true,params:{...scope,operation_id:str,expected_revision:int,kind:str,owner:str,action:str,blocker_reason:str,review_at:{type:'integer',optional:true}},sql:`INSERT INTO hiring_next_action_plan_events(operation_id,organization_id,brand_id,requisition_id,application_id,revision,kind,owner,action,blocker_reason,review_at,actor_user_id,created_at) SELECT :operation_id,:organization_id,:brand_id,:requisition_id,:application_id,:expected_revision+1,:kind,:owner,:action,:blocker_reason,:review_at,:__user_id,:__now WHERE NOT EXISTS(SELECT 1 FROM hiring_next_action_plan_events WHERE operation_id=:operation_id)`},
 {name:'get_candidate_next_action_plan',description:'Read the latest candidate-linked hiring-team plan in the authorized requisition.',operation:'query',requires_auth:true,params:scope,sql:`SELECT e.* FROM hiring_next_action_plan_events e JOIN hiring_applications a ON a.id=e.application_id AND a.organization_id=e.organization_id AND a.brand_id=e.brand_id WHERE e.organization_id=:organization_id AND e.brand_id=:brand_id AND e.requisition_id=:requisition_id AND e.application_id=:application_id AND e.revision=${latest('e')} AND ${access('a')} LIMIT 1`},
 {name:'get_candidate_next_action_plan_result',description:'Exact readback for a candidate-linked next-action write.',operation:'query',requires_auth:true,params:{...scope,operation_id:str,expected_revision:int,kind:str,owner:str,action:str,blocker_reason:str,review_at:{type:'integer',optional:true}},sql:`SELECT e.* FROM hiring_next_action_plan_events e JOIN hiring_applications a ON a.id=e.application_id AND a.organization_id=e.organization_id AND a.brand_id=e.brand_id WHERE e.organization_id=:organization_id AND e.brand_id=:brand_id AND e.requisition_id=:requisition_id AND e.application_id=:application_id AND e.operation_id=:operation_id AND e.revision=:expected_revision+1 AND e.kind=:kind AND e.owner=:owner AND e.action=:action AND e.blocker_reason=:blocker_reason AND e.review_at IS :review_at AND e.actor_user_id=:__user_id AND ${access('a')}`},
 {name:'list_candidate_next_action_gaps',description:'Report nonterminal applications lacking a valid current hiring-team plan; terminal history is excluded.',operation:'query',requires_auth:true,params:{organization_id:str,brand_id:str,limit:{type:'integer',optional:true}},sql:`SELECT a.id AS application_id,a.candidate_id,a.requisition_id,c.name AS candidate_name,${effective('a')} AS stage FROM hiring_applications a JOIN hiring_candidates c ON c.id=a.candidate_id AND c.organization_id=a.organization_id AND c.brand_id=a.brand_id WHERE a.organization_id=:organization_id AND a.brand_id=:brand_id AND ${effective('a')} NOT IN ${terminal} AND ${access('a')} AND NOT EXISTS(SELECT 1 FROM hiring_next_action_plan_events e WHERE e.application_id=a.id AND e.revision=(SELECT MAX(x.revision) FROM hiring_next_action_plan_events x WHERE x.application_id=a.id) AND e.kind IN ('actionable','blocked','deferred')) ORDER BY a.updated_at DESC,a.id LIMIT min(max(coalesce(:limit,100),1),100)`},
 {name:'get_terminal_archive',description:'Read immutable terminal classification and reason for a scoped application.',operation:'query',requires_auth:true,params:scope,sql:`SELECT t.*,COALESCE((SELECT e.reason FROM hiring_stage_events e WHERE e.application_id=t.application_id AND e.to_stage=t.terminal_stage ORDER BY e.created_at DESC LIMIT 1),(SELECT e.evidence FROM hiring_lifecycle_events_v2 e WHERE e.application_id=t.application_id AND e.to_stage=t.terminal_stage ORDER BY e.created_at DESC LIMIT 1),t.reason) AS terminal_reason FROM hiring_terminal_archive t JOIN hiring_applications a ON a.id=t.application_id AND a.organization_id=t.organization_id AND a.brand_id=t.brand_id WHERE t.organization_id=:organization_id AND t.brand_id=:brand_id AND t.requisition_id=:requisition_id AND t.application_id=:application_id AND ${access('a')} LIMIT 1`},
 {name:'enable_candidate_plan_gate',description:'Owner enables mandatory plan checks only after reviewing and resolving the gap report. No production activation is performed by this repository change.',operation:'execute',requires_auth:true,params:{organization_id:str,brand_id:str},sql:`INSERT INTO hiring_next_action_enforcement(organization_id,enabled_at) SELECT :organization_id,:__now WHERE EXISTS(SELECT 1 FROM hiring_organizations o JOIN hiring_effective_access g ON g.organization_id=o.id AND g.brand_id=:brand_id AND g.user_id=:__user_id AND g.role='owner' AND g.requisition_id IS NULL WHERE o.id=:organization_id AND o.created_by=:__user_id) AND NOT EXISTS(SELECT 1 FROM hiring_applications a WHERE a.organization_id=:organization_id AND ${effective('a')} NOT IN ${terminal} AND NOT EXISTS(SELECT 1 FROM hiring_next_action_plan_events e WHERE e.application_id=a.id AND e.revision=(SELECT MAX(x.revision) FROM hiring_next_action_plan_events x WHERE x.application_id=a.id) AND e.kind IN ('actionable','blocked','deferred'))) ON CONFLICT DO NOTHING`},
]

// A scheduler may call this read-only function after an owner chooses a cadence.
// No cron is registered by the code change.
export const checkCandidatePlanGaps = (read, scope) => read('list_candidate_next_action_gaps',{...scope,limit:100})

if(process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href && process.argv.includes('--write')){
 const migrationPath=new URL('../migrations.json',import.meta.url),manifestPath=new URL('../mcp.json',import.meta.url)
 const migrations=JSON.parse(readFileSync(migrationPath)),manifest=JSON.parse(readFileSync(manifestPath))
 if(migrations.migrations.some(x=>x.name===terminalMigration.name))throw Error('Migration already exists')
 migrations.migrations.push(terminalMigration)
 for(const next of terminalTools){if(manifest.tools.some(x=>x.name===next.name))throw Error(`Tool already exists: ${next.name}`);manifest.tools.push(next)}
 writeFileSync(migrationPath,JSON.stringify(migrations,null,2)+'\n');writeFileSync(manifestPath,JSON.stringify(manifest,null,2)+'\n')
}
