ALTER TABLE devices ADD COLUMN encrypted_public_key TEXT;
ALTER TABLE devices ADD COLUMN encrypted_private_key TEXT;
ALTER TABLE devices ADD COLUMN encrypted_user_key TEXT;

ALTER TABLE users ADD COLUMN locale TEXT NOT NULL DEFAULT 'en';
ALTER TABLE users ADD COLUMN guest_attached_at DATETIME;

CREATE TABLE subscriptions (
  uuid TEXT NOT NULL PRIMARY KEY,
  user_uuid TEXT REFERENCES users (uuid),
  org_uuid TEXT REFERENCES organizations (uuid),
  plan_code TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('base', 'addon')),
  quantity INTEGER NOT NULL DEFAULT 1 CHECK (quantity > 0),
  status TEXT NOT NULL,
  provider TEXT,
  provider_customer_id TEXT,
  provider_subscription_id TEXT,
  current_period_end BIGINT,
  updated_at DATETIME NOT NULL,
  CHECK ((user_uuid IS NULL) <> (org_uuid IS NULL))
);
CREATE INDEX idx_subscriptions_user_uuid ON subscriptions (user_uuid);
CREATE INDEX idx_subscriptions_org_uuid ON subscriptions (org_uuid);
CREATE UNIQUE INDEX idx_subscriptions_provider_sub ON subscriptions (provider, provider_subscription_id);

CREATE TABLE billing_events (
  provider TEXT NOT NULL,
  event_id TEXT NOT NULL,
  received_at DATETIME NOT NULL,
  PRIMARY KEY (provider, event_id)
);
CREATE TABLE decision_balances (
  owner_uuid TEXT NOT NULL PRIMARY KEY,
  allowance_day TEXT NOT NULL,
  used_today INTEGER NOT NULL DEFAULT 0,
  credit_units BIGINT NOT NULL DEFAULT 0,
  updated_at DATETIME NOT NULL
);

CREATE TABLE telemetry_daily (
  utc_day   TEXT NOT NULL,
  event     TEXT NOT NULL,
  surface   TEXT NOT NULL,
  os        TEXT NOT NULL,
  locale    TEXT NOT NULL,
  page_slug TEXT NOT NULL,
  count     BIGINT NOT NULL DEFAULT 0,
  PRIMARY KEY (utc_day, event, surface, os, locale, page_slug)
);

CREATE TABLE webauthn_credentials (
  uuid TEXT NOT NULL PRIMARY KEY,
  user_uuid TEXT NOT NULL REFERENCES users(uuid) ON DELETE CASCADE,
  name TEXT NOT NULL,
  credential_id TEXT NOT NULL,
  supports_prf BOOLEAN NOT NULL,
  encrypted_user_key TEXT,
  encrypted_public_key TEXT,
  encrypted_private_key TEXT,
  passkey TEXT NOT NULL,
  created_at DATETIME NOT NULL,
  UNIQUE (user_uuid, credential_id)
);

CREATE TABLE webauthn_challenges (
  challenge TEXT NOT NULL PRIMARY KEY,
  consumed_at TIMESTAMP NOT NULL
);
