-- Legacy rows keep their original columns and lifecycle evidence. The read contract
-- maps active to onboarded; this ledger makes that interpretation auditable.
CREATE TABLE IF NOT EXISTS hiring_legacy_active_reclassification (
  application_id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  brand_id TEXT NOT NULL,
  original_stage TEXT NOT NULL CHECK(original_stage='active'),
  onboarding_evidence_missing INTEGER NOT NULL CHECK(onboarding_evidence_missing IN (0,1)),
  recorded_at INTEGER NOT NULL,
  FOREIGN KEY(application_id,organization_id,brand_id) REFERENCES hiring_applications(id,organization_id,brand_id)
);
CREATE TRIGGER IF NOT EXISTS hiring_legacy_active_reclassification_no_update BEFORE UPDATE ON hiring_legacy_active_reclassification BEGIN SELECT RAISE(ABORT,'reclassification is immutable'); END;
CREATE TRIGGER IF NOT EXISTS hiring_legacy_active_reclassification_no_delete BEFORE DELETE ON hiring_legacy_active_reclassification BEGIN SELECT RAISE(ABORT,'reclassification is immutable'); END;
INSERT OR IGNORE INTO hiring_legacy_active_reclassification(application_id,organization_id,brand_id,original_stage,onboarding_evidence_missing,recorded_at)
SELECT a.id,a.organization_id,a.brand_id,'active',
  CASE WHEN EXISTS (
    SELECT 1 FROM hiring_lifecycle_history e WHERE e.application_id=a.id AND e.organization_id=a.organization_id AND e.brand_id=a.brand_id
      AND e.to_stage='onboarded' AND length(trim(e.registration_evidence))>0 AND length(trim(e.requirements_evidence))>0 AND length(trim(e.handoff_evidence))>0
  ) THEN 0 ELSE 1 END,
  CAST(strftime('%s','now') AS INTEGER)*1000
FROM hiring_applications a WHERE COALESCE(a.workflow_stage,a.lifecycle_stage,a.accepted_stage,a.stage_extension,a.stage)='active';
INSERT OR IGNORE INTO hiring_audit_events(id,organization_id,brand_id,application_id,action,actor_user_id,operation_id,created_at,redacted_summary)
SELECT 'active-reclassification:'||application_id,organization_id,brand_id,application_id,'application.active_reclassified','system:migration',
  'active-reclassification:'||application_id,recorded_at,
  CASE WHEN onboarding_evidence_missing=1 THEN 'Legacy active interpreted as onboarded; completion evidence missing' ELSE 'Legacy active interpreted as onboarded; historical completion evidence retained' END
FROM hiring_legacy_active_reclassification;

CREATE TABLE IF NOT EXISTS hiring_application_next_action_current (
  application_id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  brand_id TEXT NOT NULL,
  candidate_id TEXT NOT NULL,
  owner TEXT NOT NULL CHECK(owner IN ('Serge','bot')),
  state TEXT NOT NULL CHECK(state IN ('actionable','blocked','deferred')),
  action TEXT NOT NULL CHECK(length(trim(action)) BETWEEN 1 AND 5000),
  blocker_reason TEXT,
  review_at INTEGER,
  version INTEGER NOT NULL CHECK(version>0),
  updated_at INTEGER NOT NULL,
  closed_at INTEGER,
  last_operation_id TEXT NOT NULL,
  FOREIGN KEY(application_id,organization_id,brand_id) REFERENCES hiring_applications(id,organization_id,brand_id),
  CHECK((state='blocked' AND length(trim(coalesce(blocker_reason,'')))>0 AND review_at IS NULL)
     OR (state='deferred' AND coalesce(review_at,0)>0 AND blocker_reason IS NULL)
     OR (state='actionable' AND blocker_reason IS NULL AND review_at IS NULL))
);
CREATE INDEX IF NOT EXISTS hiring_application_next_action_scope ON hiring_application_next_action_current(organization_id,brand_id,candidate_id,closed_at);
CREATE TABLE IF NOT EXISTS hiring_application_next_action_events (
  operation_id TEXT PRIMARY KEY,
  application_id TEXT NOT NULL,
  organization_id TEXT NOT NULL,
  brand_id TEXT NOT NULL,
  candidate_id TEXT NOT NULL,
  expected_version INTEGER NOT NULL,
  owner TEXT NOT NULL CHECK(owner IN ('Serge','bot')),
  state TEXT NOT NULL CHECK(state IN ('actionable','blocked','deferred')),
  action TEXT NOT NULL CHECK(length(trim(action)) BETWEEN 1 AND 5000),
  blocker_reason TEXT,
  review_at INTEGER,
  actor_user_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  UNIQUE(application_id,expected_version),
  FOREIGN KEY(application_id,organization_id,brand_id) REFERENCES hiring_applications(id,organization_id,brand_id),
  CHECK((state='blocked' AND length(trim(coalesce(blocker_reason,'')))>0 AND review_at IS NULL)
     OR (state='deferred' AND coalesce(review_at,0)>0 AND blocker_reason IS NULL)
     OR (state='actionable' AND blocker_reason IS NULL AND review_at IS NULL))
);
CREATE TRIGGER IF NOT EXISTS hiring_application_next_action_events_no_update BEFORE UPDATE ON hiring_application_next_action_events BEGIN SELECT RAISE(ABORT,'next-action history is immutable'); END;
CREATE TRIGGER IF NOT EXISTS hiring_application_next_action_events_no_delete BEFORE DELETE ON hiring_application_next_action_events BEGIN SELECT RAISE(ABORT,'next-action history is immutable'); END;
CREATE TRIGGER IF NOT EXISTS hiring_application_next_action_events_validate BEFORE INSERT ON hiring_application_next_action_events BEGIN
  SELECT RAISE(ABORT,'next-action scope, role, stage or version conflict') WHERE NOT EXISTS (
    SELECT 1 FROM hiring_applications a WHERE a.id=NEW.application_id AND a.organization_id=NEW.organization_id AND a.brand_id=NEW.brand_id
      AND a.candidate_id=NEW.candidate_id
      AND COALESCE(a.workflow_stage,a.lifecycle_stage,a.accepted_stage,a.stage_extension,a.stage) NOT IN ('active','onboarded','rejected','withdrawn')
      AND COALESCE((SELECT p.version FROM hiring_application_next_action_current p WHERE p.application_id=a.id),0)=NEW.expected_version
      AND EXISTS (SELECT 1 FROM hiring_effective_access g WHERE g.user_id=NEW.actor_user_id AND g.organization_id=a.organization_id AND g.brand_id=a.brand_id
        AND g.role IN ('owner','recruiter') AND (g.requisition_id IS NULL OR g.requisition_id=a.requisition_id)));
  SELECT RAISE(ABORT,'next-action actor or operation invalid') WHERE NEW.actor_user_id IN ('system','automation','api_key','system:worker') OR length(trim(NEW.operation_id)) NOT BETWEEN 1 AND 128;
END;
CREATE TRIGGER IF NOT EXISTS hiring_application_next_action_events_commit AFTER INSERT ON hiring_application_next_action_events BEGIN
  INSERT INTO hiring_application_next_action_current(application_id,organization_id,brand_id,candidate_id,owner,state,action,blocker_reason,review_at,version,updated_at,closed_at,last_operation_id)
  VALUES(NEW.application_id,NEW.organization_id,NEW.brand_id,NEW.candidate_id,NEW.owner,NEW.state,NEW.action,NEW.blocker_reason,NEW.review_at,NEW.expected_version+1,NEW.created_at,NULL,NEW.operation_id)
  ON CONFLICT(application_id) DO UPDATE SET owner=excluded.owner,state=excluded.state,action=excluded.action,blocker_reason=excluded.blocker_reason,
    review_at=excluded.review_at,version=excluded.version,updated_at=excluded.updated_at,closed_at=NULL,last_operation_id=excluded.last_operation_id;
  INSERT INTO hiring_audit_events(id,organization_id,brand_id,application_id,action,actor_user_id,operation_id,created_at,redacted_summary)
  VALUES(NEW.operation_id,NEW.organization_id,NEW.brand_id,NEW.application_id,'application.next_action_recorded',NEW.actor_user_id,NEW.operation_id,NEW.created_at,'application.next_action_recorded');
END;

-- A new application has a real initial hiring-team task without a fabricated due date.
CREATE TRIGGER IF NOT EXISTS hiring_application_initial_next_action AFTER INSERT ON hiring_applications BEGIN
  INSERT INTO hiring_application_next_action_current(application_id,organization_id,brand_id,candidate_id,owner,state,action,version,updated_at,last_operation_id)
  VALUES(NEW.id,NEW.organization_id,NEW.brand_id,NEW.candidate_id,'bot','actionable','Review this application and record the next hiring step',1,NEW.created_at,'initial:'||NEW.id);
END;
CREATE TRIGGER IF NOT EXISTS hiring_application_next_action_stage_guard BEFORE UPDATE OF stage,stage_extension,accepted_stage,lifecycle_stage,workflow_stage ON hiring_applications
WHEN COALESCE(NEW.workflow_stage,NEW.lifecycle_stage,NEW.accepted_stage,NEW.stage_extension,NEW.stage) IS NOT COALESCE(OLD.workflow_stage,OLD.lifecycle_stage,OLD.accepted_stage,OLD.stage_extension,OLD.stage)
BEGIN
  SELECT RAISE(ABORT,'active is no longer a Hiring stage') WHERE COALESCE(NEW.workflow_stage,NEW.lifecycle_stage,NEW.accepted_stage,NEW.stage_extension,NEW.stage)='active';
  SELECT RAISE(ABORT,'candidate-linked hiring next action required') WHERE COALESCE(NEW.workflow_stage,NEW.lifecycle_stage,NEW.accepted_stage,NEW.stage_extension,NEW.stage) NOT IN ('onboarded','rejected','withdrawn')
    AND NOT EXISTS (SELECT 1 FROM hiring_application_next_action_current p WHERE p.application_id=OLD.id AND p.organization_id=OLD.organization_id AND p.brand_id=OLD.brand_id
      AND p.candidate_id=OLD.candidate_id AND p.closed_at IS NULL AND p.owner IN ('Serge','bot') AND length(trim(p.action))>0
      AND ((p.state='actionable' AND p.blocker_reason IS NULL AND p.review_at IS NULL)
        OR (p.state='blocked' AND length(trim(coalesce(p.blocker_reason,'')))>0)
        OR (p.state='deferred' AND coalesce(p.review_at,0)>0)));
END;
CREATE TRIGGER IF NOT EXISTS hiring_application_terminal_next_action AFTER UPDATE OF stage,stage_extension,accepted_stage,lifecycle_stage,workflow_stage ON hiring_applications
WHEN COALESCE(NEW.workflow_stage,NEW.lifecycle_stage,NEW.accepted_stage,NEW.stage_extension,NEW.stage) IN ('onboarded','rejected','withdrawn')
 AND COALESCE(OLD.workflow_stage,OLD.lifecycle_stage,OLD.accepted_stage,OLD.stage_extension,OLD.stage) IS NOT COALESCE(NEW.workflow_stage,NEW.lifecycle_stage,NEW.accepted_stage,NEW.stage_extension,NEW.stage)
BEGIN
  UPDATE hiring_application_next_action_current SET closed_at=NEW.updated_at,updated_at=NEW.updated_at WHERE application_id=NEW.id AND organization_id=NEW.organization_id AND brand_id=NEW.brand_id AND closed_at IS NULL;
  UPDATE next_actions SET status='done',blocker_reason=NULL,updated_at=NEW.updated_at WHERE organization_id=NEW.organization_id AND brand_id=NEW.brand_id AND candidate_id=NEW.candidate_id AND status IN ('open','blocked')
    AND NOT EXISTS (SELECT 1 FROM hiring_applications other WHERE other.candidate_id=NEW.candidate_id AND other.organization_id=NEW.organization_id AND other.brand_id=NEW.brand_id AND other.id<>NEW.id
      AND COALESCE(other.workflow_stage,other.lifecycle_stage,other.accepted_stage,other.stage_extension,other.stage) NOT IN ('active','onboarded','rejected','withdrawn'));
END;
CREATE TRIGGER IF NOT EXISTS hiring_lifecycle_no_active_v2 BEFORE INSERT ON hiring_lifecycle_events_v2 WHEN NEW.to_stage='active' BEGIN SELECT RAISE(ABORT,'active is no longer a Hiring stage'); END;
CREATE TRIGGER IF NOT EXISTS hiring_lifecycle_no_active_legacy BEFORE INSERT ON hiring_lifecycle_events WHEN NEW.to_stage='active' BEGIN SELECT RAISE(ABORT,'active is no longer a Hiring stage'); END;
