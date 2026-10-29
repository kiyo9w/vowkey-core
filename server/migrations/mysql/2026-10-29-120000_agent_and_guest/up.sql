CREATE TABLE agent_pairings (
  uuid                 CHAR(36) NOT NULL PRIMARY KEY,
  user_uuid            CHAR(36) NOT NULL,
  local_executor_id    TEXT NOT NULL,
  executor_device_id   CHAR(36),
  encrypted_metadata   LONGTEXT NOT NULL,
  revoked_at           DATETIME,
  revision             INTEGER NOT NULL,
  updated_at           DATETIME NOT NULL,
  created_at           DATETIME NOT NULL,
  FOREIGN KEY (user_uuid) REFERENCES users (uuid)
);

CREATE TABLE agent_requests (
  uuid                   CHAR(36) NOT NULL PRIMARY KEY,
  user_uuid              CHAR(36) NOT NULL,
  executor_device_id     CHAR(36) NOT NULL,
  cipher_ids             TEXT NOT NULL,
  routing                LONGTEXT NOT NULL,
  note                   LONGTEXT,
  answer                 LONGTEXT,
  result                 LONGTEXT,
  status                 VARCHAR(32) NOT NULL,
  received_at            DATETIME NOT NULL,
  deadline               DATETIME NOT NULL,
  answer_revision        INTEGER NOT NULL,
  result_revision        INTEGER NOT NULL,
  revision               INTEGER NOT NULL,
  updated_at             DATETIME NOT NULL,
  FOREIGN KEY (user_uuid) REFERENCES users (uuid)
);

CREATE TABLE agent_grants (
  uuid               CHAR(36) NOT NULL PRIMARY KEY,
  user_uuid          CHAR(36) NOT NULL,
  source_cipher_uuid CHAR(36),
  encrypted_grant    LONGTEXT NOT NULL,
  revoked_at         DATETIME,
  revision           INTEGER NOT NULL,
  updated_at         DATETIME NOT NULL,
  created_at         DATETIME NOT NULL,
  FOREIGN KEY (user_uuid) REFERENCES users (uuid),
  FOREIGN KEY (source_cipher_uuid) REFERENCES ciphers (uuid)
);

CREATE TABLE agent_activity (
  uuid                CHAR(36) NOT NULL PRIMARY KEY,
  user_uuid           CHAR(36) NOT NULL,
  kind                VARCHAR(16) NOT NULL,
  request_uuid        CHAR(36),
  source_cipher_uuid  CHAR(36),
  entry_id            VARCHAR(64),
  event_id            VARCHAR(64),
  encrypted_activity  LONGTEXT NOT NULL,
  revision            INTEGER NOT NULL,
  created_at          DATETIME NOT NULL,
  fill_key            VARCHAR(220) GENERATED ALWAYS AS (
    CASE WHEN kind = 'fill' THEN CONCAT(request_uuid, ':', source_cipher_uuid, ':', entry_id) ELSE NULL END
  ) STORED,
  proxy_key           VARCHAR(80) GENERATED ALWAYS AS (
    CASE WHEN kind = 'proxy' THEN event_id ELSE NULL END
  ) STORED,
  FOREIGN KEY (user_uuid) REFERENCES users (uuid),
  UNIQUE KEY agent_activity_fill (user_uuid, fill_key),
  UNIQUE KEY agent_activity_proxy (user_uuid, proxy_key)
);

CREATE TABLE form_bindings (
  uuid                CHAR(36) NOT NULL PRIMARY KEY,
  user_uuid           CHAR(36) NOT NULL,
  profile_cipher_uuid CHAR(36),
  encrypted_binding   LONGTEXT NOT NULL,
  revision            INTEGER NOT NULL,
  updated_at          DATETIME NOT NULL,
  created_at          DATETIME NOT NULL,
  FOREIGN KEY (user_uuid) REFERENCES users (uuid)
);

CREATE TABLE agent_tombstones (
  uuid        CHAR(36) NOT NULL PRIMARY KEY,
  user_uuid   CHAR(36) NOT NULL,
  kind        VARCHAR(16) NOT NULL,
  row_uuid    CHAR(36) NOT NULL,
  revision    INTEGER NOT NULL,
  deleted_at  DATETIME NOT NULL,
  FOREIGN KEY (user_uuid) REFERENCES users (uuid)
);

CREATE TABLE migration_maps (
  user_uuid          CHAR(36) NOT NULL,
  migration_id       VARCHAR(64) NOT NULL,
  resource_kind      VARCHAR(16) NOT NULL,
  parent_key         VARCHAR(64) NOT NULL,
  local_resource_id  VARCHAR(64) NOT NULL,
  remote_id          TEXT NOT NULL,
  request_hash       CHAR(64) NOT NULL,
  bytes_checksum     CHAR(64),
  gone               BOOLEAN NOT NULL DEFAULT FALSE,
  created_at         DATETIME NOT NULL,
  PRIMARY KEY (user_uuid, migration_id, resource_kind, parent_key, local_resource_id),
  FOREIGN KEY (user_uuid) REFERENCES users (uuid)
);

CREATE TABLE guest_decision_use (
  bucket VARCHAR(80) NOT NULL,
  day    CHAR(10) NOT NULL,
  count  INTEGER NOT NULL,
  PRIMARY KEY (bucket, day)
);

CREATE TABLE guest_installations (
  installation_id CHAR(36) NOT NULL PRIMARY KEY,
  created_at      DATETIME NOT NULL
);

ALTER TABLE agent_requests ADD COLUMN pairing_uuid CHAR(36) NOT NULL;
ALTER TABLE agent_activity ADD COLUMN organization_uuid CHAR(36);
CREATE TABLE agent_revision (id INTEGER NOT NULL PRIMARY KEY, revision INTEGER NOT NULL);
INSERT INTO agent_revision (id, revision) VALUES (1, 0);
ALTER TABLE ciphers ADD COLUMN migration_pending BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE agent_requests ADD COLUMN request_hash TEXT NOT NULL;
