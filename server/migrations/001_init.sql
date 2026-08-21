-- D1: accounts only. No note data exists on the server until D2.

CREATE TABLE IF NOT EXISTS schema_migrations (
  name       VARCHAR(255) NOT NULL PRIMARY KEY,
  applied_at BIGINT       NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE users (
  id          CHAR(36) NOT NULL PRIMARY KEY,
  created_at  BIGINT   NOT NULL,
  -- D2's per-user monotonic revision counter. Created here so D2 needs no
  -- migration for it; nothing in D1 reads or increments it.
  rev_counter BIGINT   NOT NULL DEFAULT 0
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Identity is a separate table from user from day one, so Google and GitHub
-- identities can both point at one account without a later migration.
CREATE TABLE identities (
  provider         VARCHAR(32)  NOT NULL,
  provider_subject VARCHAR(255) NOT NULL,
  email            VARCHAR(320) NULL,
  user_id          CHAR(36)     NOT NULL,
  created_at       BIGINT       NOT NULL,
  PRIMARY KEY (provider, provider_subject),
  KEY idx_identities_user (user_id),
  CONSTRAINT fk_identities_user FOREIGN KEY (user_id)
    REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- `id` is the SHA-256 of the token in the cookie, never the token itself: a
-- database leak must not hand over live sessions.
CREATE TABLE sessions (
  id           CHAR(64) NOT NULL PRIMARY KEY,
  user_id      CHAR(36) NOT NULL,
  created_at   BIGINT   NOT NULL,
  expires_at   BIGINT   NOT NULL,
  last_seen_at BIGINT   NOT NULL,
  KEY idx_sessions_user (user_id),
  KEY idx_sessions_expires (expires_at),
  CONSTRAINT fk_sessions_user FOREIGN KEY (user_id)
    REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
