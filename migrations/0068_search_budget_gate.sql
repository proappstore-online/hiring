CREATE VIEW hiring_search_budget_gate AS
SELECT user_id,window_start,requests FROM hiring_search_budget WHERE 0;

CREATE TRIGGER hiring_search_budget_gate_insert
INSTEAD OF INSERT ON hiring_search_budget_gate
BEGIN
  INSERT INTO hiring_search_budget(user_id,window_start,requests)
  VALUES (NEW.user_id,NEW.window_start,1)
  ON CONFLICT(user_id) DO UPDATE SET
    window_start=excluded.window_start,
    requests=CASE WHEN hiring_search_budget.window_start<>excluded.window_start
      THEN 1 ELSE min(hiring_search_budget.requests+1,31) END;
END;
