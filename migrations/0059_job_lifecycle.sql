ALTER TABLE hiring_job_publications ADD COLUMN lifecycle_status TEXT CHECK(lifecycle_status IN ('published','expired','closed'));
ALTER TABLE hiring_job_publications ADD COLUMN linkedin_job_id TEXT;
ALTER TABLE hiring_job_publications ADD COLUMN expiry_date INTEGER;
CREATE INDEX idx_hiring_jobs_linkedin_id ON hiring_job_publications(linkedin_job_id);
CREATE TABLE hiring_linkedin_repost_history (
  id TEXT PRIMARY KEY,
  operation_id TEXT NOT NULL UNIQUE,
  requisition_id TEXT NOT NULL,
  organization_id TEXT NOT NULL,
  brand_id TEXT NOT NULL,
  previous_linkedin_job_id TEXT,
  new_linkedin_job_id TEXT NOT NULL,
  actor_user_id TEXT NOT NULL,
  reason TEXT NOT NULL,
  reposted_at INTEGER NOT NULL,
  FOREIGN KEY(requisition_id,organization_id,brand_id) REFERENCES hiring_requisitions(id,organization_id,brand_id)
);
CREATE INDEX idx_hiring_linkedin_reposts_requisition ON hiring_linkedin_repost_history(requisition_id,reposted_at);
CREATE TRIGGER hiring_linkedin_reposts_no_update BEFORE UPDATE ON hiring_linkedin_repost_history BEGIN SELECT RAISE(ABORT,'Repost history is immutable'); END;
CREATE TRIGGER hiring_linkedin_reposts_no_delete BEFORE DELETE ON hiring_linkedin_repost_history BEGIN SELECT RAISE(ABORT,'Repost history is immutable'); END;
