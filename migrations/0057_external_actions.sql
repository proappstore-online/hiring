CREATE TABLE external_actions (id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  brand_id TEXT NOT NULL,
  target_candidate_id TEXT,
  target_org_id TEXT NOT NULL,
  performed_at INTEGER NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('email','linkedin','discord')),
  gmail_message_id TEXT,
  linkedin_message_id TEXT,
  discord_message_id TEXT,
  params_json TEXT NOT NULL CHECK(json_valid(params_json)),
  performed_by TEXT NOT NULL,
  notes TEXT,
  operation_id TEXT NOT NULL UNIQUE,
  CHECK(kind<>'email' OR gmail_message_id IS NOT NULL)
);
CREATE INDEX external_actions_candidate_time ON external_actions(organization_id,brand_id,target_candidate_id,performed_at DESC);
CREATE INDEX external_actions_org_time ON external_actions(organization_id,brand_id,performed_at DESC);
CREATE TRIGGER external_actions_no_update BEFORE UPDATE ON external_actions BEGIN SELECT RAISE(ABORT,'external actions are append-only'); END;
CREATE TRIGGER external_actions_no_delete BEFORE DELETE ON external_actions BEGIN SELECT RAISE(ABORT,'external actions are append-only'); END;
