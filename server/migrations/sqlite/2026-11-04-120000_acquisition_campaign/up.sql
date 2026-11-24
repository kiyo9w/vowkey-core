ALTER TABLE users ADD COLUMN acquisition_campaign TEXT NOT NULL DEFAULT '';
ALTER TABLE billing_events ADD COLUMN plan_code TEXT;
ALTER TABLE billing_events ADD COLUMN campaign TEXT;
