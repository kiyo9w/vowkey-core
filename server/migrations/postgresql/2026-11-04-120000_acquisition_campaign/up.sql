ALTER TABLE users ADD COLUMN acquisition_campaign VARCHAR(32) NOT NULL DEFAULT '';
ALTER TABLE billing_events ADD COLUMN plan_code VARCHAR(32);
ALTER TABLE billing_events ADD COLUMN campaign VARCHAR(32);
