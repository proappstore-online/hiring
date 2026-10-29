ALTER TABLE hiring_requisitions ADD COLUMN lifecycle_status TEXT CHECK(lifecycle_status IN ('draft','published','paused','expired','closed'));
ALTER TABLE hiring_requisitions ADD COLUMN linkedin_job_id TEXT;
ALTER TABLE hiring_requisitions ADD COLUMN linkedin_expiry_date INTEGER;
CREATE INDEX idx_hiring_requisitions_linkedin_id ON hiring_requisitions(organization_id,brand_id,linkedin_job_id);
CREATE TRIGGER hiring_requisition_lifecycle_publication_insert AFTER INSERT ON hiring_job_publications BEGIN
  UPDATE hiring_requisitions SET lifecycle_status=CASE WHEN NEW.lifecycle_status='expired' THEN 'expired' WHEN NEW.lifecycle_status='closed' OR NEW.status='closed' THEN 'closed' WHEN EXISTS(SELECT 1 FROM hiring_publication_controls WHERE requisition_id=NEW.requisition_id AND paused=1) THEN 'paused' ELSE 'published' END,linkedin_job_id=NEW.linkedin_job_id,linkedin_expiry_date=NEW.expiry_date WHERE id=NEW.requisition_id AND organization_id=NEW.organization_id AND brand_id=NEW.brand_id;
END;
CREATE TRIGGER hiring_requisition_lifecycle_publication_update AFTER UPDATE OF status,lifecycle_status,linkedin_job_id,expiry_date ON hiring_job_publications BEGIN
  UPDATE hiring_requisitions SET lifecycle_status=CASE WHEN NEW.lifecycle_status='expired' THEN 'expired' WHEN NEW.lifecycle_status='closed' OR NEW.status='closed' THEN 'closed' WHEN EXISTS(SELECT 1 FROM hiring_publication_controls WHERE requisition_id=NEW.requisition_id AND paused=1) THEN 'paused' ELSE 'published' END,linkedin_job_id=NEW.linkedin_job_id,linkedin_expiry_date=NEW.expiry_date WHERE id=NEW.requisition_id AND organization_id=NEW.organization_id AND brand_id=NEW.brand_id;
END;
CREATE TRIGGER hiring_requisition_lifecycle_pause_insert AFTER INSERT ON hiring_publication_controls BEGIN
  UPDATE hiring_requisitions SET lifecycle_status=CASE WHEN (SELECT lifecycle_status FROM hiring_job_publications WHERE requisition_id=NEW.requisition_id)='expired' THEN 'expired' WHEN (SELECT status FROM hiring_job_publications WHERE requisition_id=NEW.requisition_id)='closed' THEN 'closed' WHEN NEW.paused=1 THEN 'paused' ELSE 'published' END WHERE id=NEW.requisition_id;
END;
CREATE TRIGGER hiring_requisition_lifecycle_pause_update AFTER UPDATE OF paused ON hiring_publication_controls BEGIN
  UPDATE hiring_requisitions SET lifecycle_status=CASE WHEN (SELECT lifecycle_status FROM hiring_job_publications WHERE requisition_id=NEW.requisition_id)='expired' THEN 'expired' WHEN (SELECT status FROM hiring_job_publications WHERE requisition_id=NEW.requisition_id)='closed' THEN 'closed' WHEN NEW.paused=1 THEN 'paused' ELSE 'published' END WHERE id=NEW.requisition_id;
END;
