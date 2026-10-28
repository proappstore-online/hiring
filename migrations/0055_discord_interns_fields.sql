ALTER TABLE hiring_applications ADD COLUMN discord_handle TEXT;
ALTER TABLE hiring_applications ADD COLUMN interns_app_id TEXT;
ALTER TABLE hiring_applications ADD COLUMN interns_invite_status TEXT NOT NULL DEFAULT 'not_started' CHECK(interns_invite_status IN ('not_started','email_pending','invited'));

CREATE TRIGGER hiring_onboarding_interns_pending AFTER INSERT ON hiring_lifecycle_events_v2
WHEN NEW.to_stage='onboarding'
BEGIN
  UPDATE hiring_applications
  SET interns_invite_status='email_pending'
  WHERE id=NEW.application_id AND organization_id=NEW.organization_id AND brand_id=NEW.brand_id
    AND interns_app_id IS NULL AND interns_invite_status<>'email_pending';
  INSERT INTO hiring_notes(id,organization_id,brand_id,application_id,body,actor_user_id,created_at)
  SELECT NEW.operation_id||':interns_email_pending',NEW.organization_id,NEW.brand_id,NEW.application_id,
    'Serge: Interns invitation email pending. Verify the sender is admin@freeappstore.online before sending or linking an invite.',
    NEW.actor_user_id,NEW.created_at
  WHERE EXISTS(SELECT 1 FROM hiring_applications a WHERE a.id=NEW.application_id
    AND a.organization_id=NEW.organization_id AND a.brand_id=NEW.brand_id
    AND a.interns_app_id IS NULL AND a.interns_invite_status='email_pending')
    AND NOT EXISTS(SELECT 1 FROM hiring_notes WHERE id=NEW.operation_id||':interns_email_pending');
END;

CREATE TRIGGER hiring_interns_invite_linked AFTER UPDATE OF interns_app_id ON hiring_applications
WHEN NEW.interns_app_id IS NOT NULL AND NEW.interns_app_id<>'' AND NEW.interns_app_id IS NOT OLD.interns_app_id
BEGIN
  UPDATE hiring_applications SET interns_invite_status='invited' WHERE id=NEW.id;
END;
