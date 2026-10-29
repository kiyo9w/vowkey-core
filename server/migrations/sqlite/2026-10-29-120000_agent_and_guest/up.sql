CREATE TABLE agent_pairings (
  uuid                 TEXT NOT NULL PRIMARY KEY,
  user_uuid            TEXT NOT NULL REFERENCES users (uuid),
  local_executor_id    TEXT NOT NULL,
  executor_device_id   TEXT,
  encrypted_metadata   TEXT NOT NULL,
  revoked_at           DATETIME,
  revision             INTEGER NOT NULL,
  updated_at           DATETIME NOT NULL,
  created_at           DATETIME NOT NULL
);

CREATE TABLE agent_requests (
  uuid                   TEXT NOT NULL PRIMARY KEY,
  user_uuid              TEXT NOT NULL REFERENCES users (uuid),
  executor_device_id     TEXT NOT NULL,
  cipher_ids             TEXT NOT NULL,
  routing                TEXT NOT NULL,
  note                   TEXT,
  answer                 TEXT,
  result                 TEXT,
  status                 TEXT NOT NULL,
  received_at            DATETIME NOT NULL,
  deadline               DATETIME NOT NULL,
  answer_revision        INTEGER NOT NULL,
  result_revision        INTEGER NOT NULL,
  revision               INTEGER NOT NULL,
  updated_at             DATETIME NOT NULL
);

CREATE TABLE agent_grants (
  uuid               TEXT NOT NULL PRIMARY KEY,
  user_uuid          TEXT NOT NULL REFERENCES users (uuid),
  source_cipher_uuid TEXT REFERENCES ciphers (uuid),
  encrypted_grant    TEXT NOT NULL,
  revoked_at         DATETIME,
  revision           INTEGER NOT NULL,
  updated_at         DATETIME NOT NULL,
  created_at         DATETIME NOT NULL
);

CREATE TABLE agent_activity (
  uuid                TEXT NOT NULL PRIMARY KEY,
  user_uuid           TEXT NOT NULL REFERENCES users (uuid),
  kind                TEXT NOT NULL,
  request_uuid        TEXT,
  source_cipher_uuid  TEXT,
  entry_id            TEXT,
  event_id            TEXT,
  encrypted_activity  TEXT NOT NULL,
  revision            INTEGER NOT NULL,
  created_at          DATETIME NOT NULL
);

CREATE UNIQUE INDEX agent_activity_fill
  ON agent_activity (user_uuid, request_uuid, source_cipher_uuid, entry_id)
  WHERE kind = 'fill';

CREATE UNIQUE INDEX agent_activity_proxy
  ON agent_activity (user_uuid, event_id)
  WHERE kind = 'proxy';

CREATE TABLE form_bindings (
  uuid                TEXT NOT NULL PRIMARY KEY,
  user_uuid           TEXT NOT NULL REFERENCES users (uuid),
  profile_cipher_uuid TEXT,
  encrypted_binding   TEXT NOT NULL,
  revision            INTEGER NOT NULL,
  updated_at          DATETIME NOT NULL,
  created_at          DATETIME NOT NULL
);

CREATE TABLE agent_tombstones (
  uuid        TEXT NOT NULL PRIMARY KEY,
  user_uuid   TEXT NOT NULL REFERENCES users (uuid),
  kind        TEXT NOT NULL,
  row_uuid    TEXT NOT NULL,
  revision    INTEGER NOT NULL,
  deleted_at  DATETIME NOT NULL
);

CREATE TABLE migration_maps (
  user_uuid          TEXT NOT NULL REFERENCES users (uuid),
  migration_id       TEXT NOT NULL,
  resource_kind      TEXT NOT NULL,
  parent_key         TEXT NOT NULL,
  local_resource_id  TEXT NOT NULL,
  remote_id          TEXT NOT NULL,
  request_hash       TEXT NOT NULL,
  bytes_checksum     TEXT,
  gone               INTEGER NOT NULL DEFAULT 0,
  created_at         DATETIME NOT NULL,
  PRIMARY KEY (user_uuid, migration_id, resource_kind, parent_key, local_resource_id)
);

CREATE TABLE guest_decision_use (
  bucket TEXT NOT NULL,
  day    TEXT NOT NULL,
  count  INTEGER NOT NULL,
  PRIMARY KEY (bucket, day)
);

CREATE TABLE guest_installations (
  installation_id TEXT NOT NULL PRIMARY KEY,
  created_at      DATETIME NOT NULL
);

ALTER TABLE agent_requests ADD COLUMN pairing_uuid TEXT NOT NULL;
ALTER TABLE agent_activity ADD COLUMN organization_uuid TEXT;
CREATE TABLE agent_revision (id INTEGER NOT NULL PRIMARY KEY, revision INTEGER NOT NULL);
INSERT INTO agent_revision (id, revision) VALUES (1, 0);
ALTER TABLE ciphers ADD COLUMN migration_pending BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE agent_requests ADD COLUMN request_hash TEXT NOT NULL;
