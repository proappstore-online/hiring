CREATE TRIGGER hiring_mcp_refusal_codes BEFORE INSERT ON hiring_mcp_refusals BEGIN
  SELECT CASE
    WHEN NEW.message LIKE 'version_mismatch_current_%' THEN RAISE(ABORT,'APP:version_mismatch')
    WHEN NEW.message LIKE 'invalid_transition_from_%' THEN RAISE(ABORT,'APP:invalid_transition')
    WHEN NEW.message LIKE 'invalid_kind_%' THEN RAISE(ABORT,'APP:invalid_kind')
    WHEN NEW.message LIKE 'invalid_params_json%' THEN RAISE(ABORT,'APP:invalid_params_json')
    WHEN NEW.message LIKE 'invalid_observed_linkedin_status_%' THEN RAISE(ABORT,'APP:invalid_linkedin_status')
    WHEN NEW.message LIKE 'invalid_linkedin_status_%' THEN RAISE(ABORT,'APP:invalid_linkedin_status')
    WHEN NEW.message LIKE 'invalid_expiry_date_%' THEN RAISE(ABORT,'APP:invalid_expiry_date')
    WHEN NEW.message='invalid_reason' THEN RAISE(ABORT,'APP:invalid_reason')
    WHEN NEW.message='duplicate_operation_id' THEN RAISE(ABORT,'APP:operation_conflict')
    WHEN NEW.message='not_found' THEN RAISE(ABORT,'APP:not_found')
    ELSE RAISE(ABORT,'APP:invalid_request')
  END;
END;
