ALTER TABLE devices ADD COLUMN encrypted_public_key LONGTEXT;
ALTER TABLE devices ADD COLUMN encrypted_private_key LONGTEXT;
ALTER TABLE devices ADD COLUMN encrypted_user_key LONGTEXT;

ALTER TABLE users ADD COLUMN locale VARCHAR(16) NOT NULL DEFAULT 'en';
ALTER TABLE users ADD COLUMN guest_attached_at DATETIME;

CREATE TABLE subscriptions (
  uuid CHAR(36) NOT NULL PRIMARY KEY,
  user_uuid CHAR(36),
  org_uuid CHAR(36),
  plan_code VARCHAR(32) NOT NULL,
  kind VARCHAR(8) NOT NULL CHECK (kind IN ('base', 'addon')),
  quantity INTEGER NOT NULL DEFAULT 1 CHECK (quantity > 0),
  status VARCHAR(32) NOT NULL,
  provider VARCHAR(16),
  provider_customer_id VARCHAR(128),
  provider_subscription_id VARCHAR(128),
  current_period_end BIGINT,
  updated_at DATETIME NOT NULL,
  FOREIGN KEY (user_uuid) REFERENCES users (uuid),
  FOREIGN KEY (org_uuid) REFERENCES organizations (uuid),
  CHECK ((user_uuid IS NULL) <> (org_uuid IS NULL)),
  INDEX idx_subscriptions_user_uuid (user_uuid),
  INDEX idx_subscriptions_org_uuid (org_uuid),
  UNIQUE INDEX idx_subscriptions_provider_sub (provider, provider_subscription_id)
);
CREATE TABLE billing_events (
  provider VARCHAR(16) NOT NULL,
  event_id VARCHAR(128) NOT NULL,
  received_at DATETIME NOT NULL,
  PRIMARY KEY (provider, event_id)
);
CREATE TABLE decision_balances (
  owner_uuid VARCHAR(36) NOT NULL PRIMARY KEY,
  allowance_day VARCHAR(10) NOT NULL,
  used_today INTEGER NOT NULL DEFAULT 0,
  credit_units BIGINT NOT NULL DEFAULT 0,
  updated_at DATETIME NOT NULL
);

CREATE TABLE telemetry_daily (
  utc_day   VARCHAR(10) NOT NULL,
  event     VARCHAR(32) NOT NULL,
  surface   VARCHAR(32) NOT NULL,
  os        VARCHAR(16) NOT NULL,
  locale    VARCHAR(16) NOT NULL,
  page_slug VARCHAR(64) NOT NULL,
  count     BIGINT NOT NULL DEFAULT 0,
  PRIMARY KEY (utc_day, event, surface, os, locale, page_slug)
);

CREATE TABLE webauthn_credentials (
  uuid CHAR(36) NOT NULL PRIMARY KEY,
  user_uuid CHAR(36) NOT NULL,
  name VARCHAR(50) NOT NULL,
  credential_id VARCHAR(256) NOT NULL,
  supports_prf BOOLEAN NOT NULL,
  encrypted_user_key LONGTEXT,
  encrypted_public_key LONGTEXT,
  encrypted_private_key LONGTEXT,
  passkey LONGTEXT NOT NULL,
  created_at DATETIME NOT NULL,
  FOREIGN KEY (user_uuid) REFERENCES users(uuid) ON DELETE CASCADE,
  UNIQUE (user_uuid, credential_id)
);

CREATE TABLE webauthn_challenges (
  challenge VARCHAR(128) NOT NULL PRIMARY KEY,
  consumed_at DATETIME NOT NULL
);
