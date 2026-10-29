CREATE TRIGGER hiring_expire_freegamestore_intern AFTER INSERT ON hiring_audit_events
WHEN NEW.id='migration:0061:expire-freegamestore-developer-intern' AND NEW.action='requisition.expired_data_fix'
BEGIN
  UPDATE hiring_job_publications SET status='closed',lifecycle_status='expired',version=version+1
  WHERE requisition_id=NEW.object_id AND organization_id=NEW.organization_id AND brand_id=NEW.brand_id
    AND status='published' AND coalesce(lifecycle_status,'published')='published';
END;
INSERT INTO hiring_audit_events(id,organization_id,brand_id,action,actor_user_id,operation_id,created_at,object_type,object_id,redacted_summary)
SELECT 'migration:0061:expire-freegamestore-developer-intern',r.organization_id,r.brand_id,
  'requisition.expired_data_fix','migration:0061','migration:0061:expire-freegamestore-developer-intern',
  cast(strftime('%s','now') AS INTEGER),'requisition',r.id,
  'FreeGameStore Developer Intern LinkedIn posting observed closed; mark expired'
FROM hiring_requisitions r
JOIN hiring_brands b ON b.id=r.brand_id AND b.organization_id=r.organization_id
JOIN hiring_job_publications j ON j.requisition_id=r.id AND j.organization_id=r.organization_id AND j.brand_id=r.brand_id
WHERE r.id LIKE '658e8dce%' AND r.title LIKE '%Developer Intern%' AND b.name='FreeGameStore'
  AND j.status='published' AND coalesce(j.lifecycle_status,'published')='published'
  AND (SELECT count(*) FROM hiring_requisitions r2 JOIN hiring_brands b2 ON b2.id=r2.brand_id AND b2.organization_id=r2.organization_id WHERE r2.id LIKE '658e8dce%' AND r2.title LIKE '%Developer Intern%' AND b2.name='FreeGameStore')=1;
