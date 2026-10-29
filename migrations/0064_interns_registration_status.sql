ALTER TABLE hiring_applications ADD COLUMN interns_registration_status TEXT CHECK(interns_registration_status IN ('invited','registered','expired','revoked'));
