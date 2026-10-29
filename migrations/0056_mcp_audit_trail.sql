CREATE TABLE mcp_audit_log (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  brand_id TEXT NOT NULL,
  candidate_id TEXT,
  entity_id TEXT,
  timestamp INTEGER NOT NULL,
  caller_agent_id TEXT,
  caller_session_id TEXT,
  tool_name TEXT NOT NULL,
  input_json TEXT NOT NULL CHECK(json_valid(input_json)),
  result_status TEXT NOT NULL,
  result_summary TEXT,
  affected_entity_ids_json TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(affected_entity_ids_json)),
  operation_id TEXT
);
CREATE INDEX mcp_audit_candidate_time ON mcp_audit_log(organization_id,brand_id,candidate_id,timestamp DESC);
CREATE INDEX mcp_audit_entity_time ON mcp_audit_log(organization_id,brand_id,entity_id,timestamp DESC);
CREATE INDEX mcp_audit_caller_time ON mcp_audit_log(organization_id,brand_id,caller_agent_id,caller_session_id,timestamp DESC);
CREATE INDEX mcp_audit_org_time ON mcp_audit_log(organization_id,brand_id,timestamp DESC);
CREATE TRIGGER mcp_audit_no_update BEFORE UPDATE ON mcp_audit_log BEGIN SELECT RAISE(ABORT,'mcp audit is append-only'); END;
CREATE TRIGGER mcp_audit_no_delete BEFORE DELETE ON mcp_audit_log BEGIN SELECT RAISE(ABORT,'mcp audit is append-only'); END;
