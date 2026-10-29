CREATE TABLE next_actions (id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  brand_id TEXT NOT NULL,
  candidate_id TEXT,
  org_id TEXT NOT NULL,
  action TEXT NOT NULL CHECK(length(trim(action)) BETWEEN 1 AND 5000),
  due_at INTEGER NOT NULL,
  owner TEXT NOT NULL CHECK(length(trim(owner)) BETWEEN 1 AND 300),
  status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','done','blocked')),
  blocker_reason TEXT,
  triggering_event_id TEXT REFERENCES mcp_audit_log(id),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  operation_id TEXT NOT NULL UNIQUE
);
CREATE INDEX next_actions_candidate_status ON next_actions(organization_id,brand_id,candidate_id,status,due_at);
CREATE INDEX next_actions_org_status ON next_actions(organization_id,brand_id,status,due_at);
