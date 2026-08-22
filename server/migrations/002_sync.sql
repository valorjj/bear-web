-- D2: note data on the server. Every table here is user-scoped and cascades
-- from `users`, so `DELETE FROM users WHERE id = ?` in routes/account.ts stays
-- the one statement that removes an account.

CREATE TABLE notes (
  user_id     CHAR(36)   NOT NULL,
  id          CHAR(36)   NOT NULL,
  -- The user's revision at the moment this row was last written. Pull is
  -- `WHERE user_id = ? AND rev > ?` and needs no clock comparison.
  rev         BIGINT     NOT NULL,
  -- `title` is deliberately absent: it is a derived cache of the first
  -- non-empty line of `text`, and `src/data/derive.ts` stays its only author.
  text        MEDIUMTEXT NOT NULL,
  created_at  BIGINT     NOT NULL,
  updated_at  BIGINT     NOT NULL,
  pinned      TINYINT(1) NOT NULL DEFAULT 0,
  trashed_at  BIGINT     NULL,
  archived_at BIGINT     NULL,
  -- A tombstone: `deleted = 1` rows carry an empty `text` and survive 90 days
  -- so every other device learns of the purge. Without them the next pull
  -- resurrects the note on every other device, forever.
  deleted     TINYINT(1) NOT NULL DEFAULT 0,
  deleted_at  BIGINT     NULL,
  -- UTF-8 byte length of `text`, maintained on write so the quota check is a
  -- SUM over the user's own rows rather than a scan of every note body.
  byte_size   INT        NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, id),
  KEY idx_notes_user_rev (user_id, rev),
  KEY idx_notes_deleted_at (deleted, deleted_at),
  CONSTRAINT fk_notes_user FOREIGN KEY (user_id)
    REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Tag METADATA only: order, icon, collapsed. Which notes carry a tag is
-- derived locally by parseTags and is never synced.
CREATE TABLE tag_meta (
  user_id    CHAR(36)     NOT NULL,
  tag        VARCHAR(255) NOT NULL,
  rev        BIGINT       NOT NULL,
  collapsed  TINYINT(1)   NOT NULL DEFAULT 0,
  icon_key   VARCHAR(64)  NULL,
  sort_order INT          NOT NULL DEFAULT 0,
  deleted    TINYINT(1)   NOT NULL DEFAULT 0,
  deleted_at BIGINT       NULL,
  PRIMARY KEY (user_id, tag),
  KEY idx_tag_meta_user_rev (user_id, rev),
  KEY idx_tag_meta_deleted_at (deleted, deleted_at),
  CONSTRAINT fk_tag_meta_user FOREIGN KEY (user_id)
    REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
