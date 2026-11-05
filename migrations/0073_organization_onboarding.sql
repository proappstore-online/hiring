-- Organisation policy versions and candidate evidence are append-only. Existing
-- lifecycle and offer ledgers remain in place for historical reads.
CREATE TABLE hiring_onboarding_policies (
  organization_id TEXT NOT NULL REFERENCES hiring_organizations(id),
  audit_brand_id TEXT NOT NULL,
  version INTEGER NOT NULL CHECK(version > 0),
  steps_json TEXT NOT NULL CHECK(json_valid(steps_json)),
  invitation_mode TEXT NOT NULL DEFAULT 'none' CHECK(invitation_mode IN ('none','freeappstore_interns')),
  operation_id TEXT NOT NULL UNIQUE,
  actor_user_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY(organization_id,version)
);
CREATE TRIGGER hiring_onboarding_policy_validate BEFORE INSERT ON hiring_onboarding_policies BEGIN
  SELECT RAISE(ABORT,'Onboarding policy requires organisation owner') WHERE NOT EXISTS (
    SELECT 1 FROM hiring_organizations o JOIN hiring_brands b ON b.organization_id=o.id AND b.id=NEW.audit_brand_id
    WHERE o.id=NEW.organization_id AND o.status='active'
      AND (o.created_by=NEW.actor_user_id OR EXISTS (
        SELECT 1 FROM hiring_grants g WHERE g.organization_id=o.id AND g.brand_id IS NULL
          AND g.requisition_id IS NULL AND g.user_id=NEW.actor_user_id AND g.role='owner' AND g.status='active')));
  SELECT RAISE(ABORT,'Onboarding policy version conflict') WHERE NEW.version<>1+COALESCE(
    (SELECT MAX(version) FROM hiring_onboarding_policies WHERE organization_id=NEW.organization_id),0);
  SELECT RAISE(ABORT,'Onboarding policy requires 1 to 30 steps') WHERE json_type(NEW.steps_json)<>'array'
    OR json_array_length(NEW.steps_json) NOT BETWEEN 1 AND 30;
  SELECT RAISE(ABORT,'Invalid onboarding step') WHERE EXISTS (
    SELECT 1 FROM json_each(NEW.steps_json) s WHERE
      json_type(s.value,'$.key')<>'text' OR length(trim(json_extract(s.value,'$.key'))) NOT BETWEEN 1 AND 64
      OR json_type(s.value,'$.label')<>'text' OR length(trim(json_extract(s.value,'$.label'))) NOT BETWEEN 1 AND 160
      OR json_extract(s.value,'$.kind') NOT IN ('text','url','identity','membership','document','confirmation')
      OR json_type(s.value,'$.required') NOT IN ('true','false'));
  SELECT RAISE(ABORT,'Duplicate onboarding step key') WHERE EXISTS (
    SELECT 1 FROM json_each(NEW.steps_json) a JOIN json_each(NEW.steps_json) b
      ON a.key<b.key AND json_extract(a.value,'$.key')=json_extract(b.value,'$.key'));
  SELECT RAISE(ABORT,'Fresh onboarding operation required') WHERE length(trim(NEW.operation_id)) NOT BETWEEN 1 AND 128
    OR NEW.actor_user_id IN ('system','automation','api_key','system:worker');
END;
CREATE TRIGGER hiring_onboarding_policy_no_update BEFORE UPDATE ON hiring_onboarding_policies BEGIN SELECT RAISE(ABORT,'Onboarding policy is immutable'); END;
CREATE TRIGGER hiring_onboarding_policy_no_delete BEFORE DELETE ON hiring_onboarding_policies BEGIN SELECT RAISE(ABORT,'Onboarding policy is immutable'); END;
CREATE TRIGGER hiring_onboarding_policy_audit AFTER INSERT ON hiring_onboarding_policies BEGIN
  INSERT INTO hiring_audit_events(id,organization_id,brand_id,action,actor_user_id,operation_id,created_at,redacted_summary)
  VALUES(NEW.operation_id,NEW.organization_id,NEW.audit_brand_id,'onboarding.policy_published',NEW.actor_user_id,NEW.operation_id,NEW.created_at,'onboarding.policy_published');
END;

CREATE TABLE hiring_onboarding_assignments (
  organization_id TEXT NOT NULL,
  brand_id TEXT NOT NULL,
  application_id TEXT NOT NULL,
  policy_version INTEGER NOT NULL,
  actor_user_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY(application_id),
  FOREIGN KEY(application_id,organization_id,brand_id) REFERENCES hiring_applications(id,organization_id,brand_id),
  FOREIGN KEY(organization_id,policy_version) REFERENCES hiring_onboarding_policies(organization_id,version)
);
CREATE TRIGGER hiring_onboarding_assignment_validate BEFORE INSERT ON hiring_onboarding_assignments BEGIN
  SELECT RAISE(ABORT,'Onboarding assignment requires scoped recruiter') WHERE NOT EXISTS (
    SELECT 1 FROM hiring_applications a JOIN hiring_effective_access g
      ON g.organization_id=a.organization_id AND g.brand_id=a.brand_id AND g.user_id=NEW.actor_user_id
    WHERE a.id=NEW.application_id AND a.organization_id=NEW.organization_id AND a.brand_id=NEW.brand_id
      AND g.role IN ('owner','recruiter') AND (g.requisition_id IS NULL OR g.requisition_id=a.requisition_id)
      AND COALESCE(a.workflow_stage,a.lifecycle_stage,a.accepted_stage,a.stage_extension,a.stage)='onboarding');
  SELECT RAISE(ABORT,'Current onboarding policy required') WHERE NEW.policy_version<>(
    SELECT MAX(version) FROM hiring_onboarding_policies WHERE organization_id=NEW.organization_id);
END;
CREATE TRIGGER hiring_onboarding_assignment_no_update BEFORE UPDATE ON hiring_onboarding_assignments BEGIN SELECT RAISE(ABORT,'Onboarding assignment is immutable'); END;
CREATE TRIGGER hiring_onboarding_assignment_no_delete BEFORE DELETE ON hiring_onboarding_assignments BEGIN SELECT RAISE(ABORT,'Onboarding assignment is immutable'); END;

CREATE TABLE hiring_onboarding_step_events (
  operation_id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  brand_id TEXT NOT NULL,
  application_id TEXT NOT NULL,
  policy_version INTEGER NOT NULL,
  step_key TEXT NOT NULL,
  version INTEGER NOT NULL CHECK(version>0),
  status TEXT NOT NULL CHECK(status IN ('pending','in_progress','completed','blocked')),
  value_json TEXT NOT NULL DEFAULT 'null' CHECK(json_valid(value_json)),
  comment TEXT NOT NULL DEFAULT '' CHECK(length(comment)<=10000),
  evidence TEXT NOT NULL DEFAULT '' CHECK(length(evidence)<=10000),
  verifier_user_id TEXT,
  actor_user_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  UNIQUE(application_id,step_key,version),
  FOREIGN KEY(application_id) REFERENCES hiring_onboarding_assignments(application_id)
);
CREATE INDEX idx_hiring_onboarding_step_history ON hiring_onboarding_step_events(application_id,step_key,version DESC);
CREATE TRIGGER hiring_onboarding_step_validate BEFORE INSERT ON hiring_onboarding_step_events BEGIN
  SELECT RAISE(ABORT,'Onboarding step requires scoped recruiter and assigned policy') WHERE NOT EXISTS (
    SELECT 1 FROM hiring_onboarding_assignments x JOIN hiring_applications a
      ON a.id=x.application_id AND a.organization_id=x.organization_id AND a.brand_id=x.brand_id
    JOIN hiring_effective_access g ON g.organization_id=a.organization_id AND g.brand_id=a.brand_id AND g.user_id=NEW.actor_user_id
    WHERE x.application_id=NEW.application_id AND x.organization_id=NEW.organization_id AND x.brand_id=NEW.brand_id
      AND x.policy_version=NEW.policy_version AND g.role IN ('owner','recruiter')
      AND (g.requisition_id IS NULL OR g.requisition_id=a.requisition_id)
      AND COALESCE(a.workflow_stage,a.lifecycle_stage,a.accepted_stage,a.stage_extension,a.stage)='onboarding');
  SELECT RAISE(ABORT,'Unknown onboarding step') WHERE NOT EXISTS (
    SELECT 1 FROM hiring_onboarding_policies p,json_each(p.steps_json) s
    WHERE p.organization_id=NEW.organization_id AND p.version=NEW.policy_version
      AND json_extract(s.value,'$.key')=NEW.step_key);
  SELECT RAISE(ABORT,'Onboarding step version conflict') WHERE NEW.version<>1+COALESCE(
    (SELECT MAX(version) FROM hiring_onboarding_step_events WHERE application_id=NEW.application_id AND step_key=NEW.step_key),0);
  SELECT RAISE(ABORT,'Completed step requires value, evidence and verifier') WHERE NEW.status='completed'
    AND (NEW.value_json='null' OR length(trim(NEW.evidence))=0 OR NEW.verifier_user_id IS NOT NEW.actor_user_id);
  SELECT RAISE(ABORT,'Invalid onboarding field value') WHERE NEW.status='completed' AND EXISTS (
    SELECT 1 FROM hiring_onboarding_policies p,json_each(p.steps_json) s
    WHERE p.organization_id=NEW.organization_id AND p.version=NEW.policy_version
      AND json_extract(s.value,'$.key')=NEW.step_key AND NOT (
        (json_extract(s.value,'$.kind') IN ('text','url','identity','document')
          AND json_type(NEW.value_json)='text' AND length(trim(json_extract(NEW.value_json,'$'))) BETWEEN 1 AND 1000
          AND (json_extract(s.value,'$.kind')<>'url' OR json_extract(NEW.value_json,'$') LIKE 'https://%'))
        OR (json_extract(s.value,'$.kind')='membership' AND json_type(NEW.value_json)='object'
          AND json_type(NEW.value_json,'$.identity')='text' AND length(trim(json_extract(NEW.value_json,'$.identity'))) BETWEEN 1 AND 160
          AND json_type(NEW.value_json,'$.joined')='true')
        OR (json_extract(s.value,'$.kind')='confirmation' AND json_type(NEW.value_json)='true')));
  SELECT RAISE(ABORT,'Only completed steps may have a verifier') WHERE NEW.status<>'completed' AND NEW.verifier_user_id IS NOT NULL;
  SELECT RAISE(ABORT,'Candidate erasure or restore tombstone') WHERE EXISTS (
    SELECT 1 FROM hiring_applications a WHERE a.id=NEW.application_id AND (
      EXISTS(SELECT 1 FROM erasure_requests t WHERE t.candidate_id=a.candidate_id AND t.organization_id=a.organization_id AND t.brand_id=a.brand_id)
      OR EXISTS(SELECT 1 FROM hiring_deletion_tombstones t WHERE t.candidate_id=a.candidate_id AND t.organization_id=a.organization_id AND t.brand_id=a.brand_id)
      OR EXISTS(SELECT 1 FROM hiring_restore_tombstones t WHERE t.candidate_id=a.candidate_id AND t.organization_id=a.organization_id AND t.brand_id=a.brand_id)));
  SELECT RAISE(ABORT,'Fresh onboarding operation required') WHERE length(trim(NEW.operation_id)) NOT BETWEEN 1 AND 128
    OR NEW.actor_user_id IN ('system','automation','api_key','system:worker')
    OR EXISTS(SELECT 1 FROM hiring_audit_events WHERE id=NEW.operation_id OR operation_id=NEW.operation_id);
END;
CREATE TRIGGER hiring_onboarding_step_no_update BEFORE UPDATE ON hiring_onboarding_step_events BEGIN SELECT RAISE(ABORT,'Onboarding step history is immutable'); END;
CREATE TRIGGER hiring_onboarding_step_no_delete BEFORE DELETE ON hiring_onboarding_step_events BEGIN SELECT RAISE(ABORT,'Onboarding step history is immutable'); END;
CREATE TRIGGER hiring_onboarding_step_audit AFTER INSERT ON hiring_onboarding_step_events BEGIN
  INSERT INTO hiring_audit_events(id,organization_id,brand_id,application_id,action,actor_user_id,operation_id,created_at,redacted_summary)
  VALUES(NEW.operation_id,NEW.organization_id,NEW.brand_id,NEW.application_id,'onboarding.step_recorded',NEW.actor_user_id,NEW.operation_id,NEW.created_at,'onboarding.step_recorded');
END;

-- Applied lifecycle triggers cannot be replaced by the additive migrator.
-- This successor guard applies to both historical and current write ledgers.
CREATE TRIGGER hiring_onboarding_completion_v2 BEFORE INSERT ON hiring_lifecycle_events_v2 WHEN NEW.to_stage='onboarded' BEGIN
  SELECT RAISE(ABORT,'Required onboarding checklist incomplete') WHERE NOT EXISTS (
    SELECT 1 FROM hiring_onboarding_assignments x WHERE x.application_id=NEW.application_id
      AND x.organization_id=NEW.organization_id AND x.brand_id=NEW.brand_id)
    OR EXISTS (
      SELECT 1 FROM hiring_onboarding_assignments x JOIN hiring_onboarding_policies p
        ON p.organization_id=x.organization_id AND p.version=x.policy_version,json_each(p.steps_json) s
      WHERE x.application_id=NEW.application_id AND json_type(s.value,'$.required')='true'
        AND NOT EXISTS (SELECT 1 FROM hiring_onboarding_step_events e
          WHERE e.application_id=x.application_id AND e.step_key=json_extract(s.value,'$.key')
            AND e.policy_version=x.policy_version AND e.version=(SELECT MAX(z.version) FROM hiring_onboarding_step_events z
              WHERE z.application_id=e.application_id AND z.step_key=e.step_key)
            AND e.status='completed' AND e.verifier_user_id IS NOT NULL AND length(trim(e.evidence))>0));
END;
CREATE TRIGGER hiring_onboarding_completion_legacy BEFORE INSERT ON hiring_lifecycle_events WHEN NEW.to_stage='onboarded' BEGIN
  SELECT RAISE(ABORT,'Required onboarding checklist incomplete') WHERE NOT EXISTS (
    SELECT 1 FROM hiring_onboarding_assignments x WHERE x.application_id=NEW.application_id
      AND x.organization_id=NEW.organization_id AND x.brand_id=NEW.brand_id)
    OR EXISTS (
      SELECT 1 FROM hiring_onboarding_assignments x JOIN hiring_onboarding_policies p
        ON p.organization_id=x.organization_id AND p.version=x.policy_version,json_each(p.steps_json) s
      WHERE x.application_id=NEW.application_id AND json_type(s.value,'$.required')='true'
        AND NOT EXISTS (SELECT 1 FROM hiring_onboarding_step_events e
          WHERE e.application_id=x.application_id AND e.step_key=json_extract(s.value,'$.key')
            AND e.policy_version=x.policy_version AND e.version=(SELECT MAX(z.version) FROM hiring_onboarding_step_events z
              WHERE z.application_id=e.application_id AND z.step_key=e.step_key)
            AND e.status='completed' AND e.verifier_user_id IS NOT NULL AND length(trim(e.evidence))>0));
END;

-- The old FreeAppStore invitation trigger remains deployed. Ignore its
-- status update for organisations that did not opt into that integration.
CREATE TRIGGER hiring_onboarding_interns_opt_in BEFORE UPDATE OF interns_invite_status ON hiring_applications
WHEN NEW.interns_invite_status='email_pending' AND OLD.interns_invite_status<>'email_pending'
  AND COALESCE((SELECT invitation_mode FROM hiring_onboarding_policies p
    WHERE p.organization_id=OLD.organization_id ORDER BY p.version DESC LIMIT 1),'none')<>'freeappstore_interns'
BEGIN SELECT RAISE(IGNORE); END;
