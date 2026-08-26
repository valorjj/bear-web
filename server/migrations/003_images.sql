-- K2: image METADATA. The bytes live on disk under IMAGE_ROOT; this table is
-- what makes them findable and what the quota sums.
--
-- Cascades from `users` so `DELETE FROM users WHERE id = ?` stays the one
-- statement that removes an account. The directory on disk is the one thing
-- that cascade cannot reach, and `routes/account.ts` removes it explicitly.
CREATE TABLE image_files (
  user_id    CHAR(36)    NOT NULL,
  id         CHAR(36)    NOT NULL,
  -- Recorded for K3's export and for debugging. NEVER used for authorisation:
  -- `user_id` is what scopes every query.
  note_id    CHAR(36)    NOT NULL,
  mime       VARCHAR(64) NOT NULL,
  width      INT         NOT NULL,
  height     INT         NOT NULL,
  -- Denormalised so the quota is a SUM over rows rather than a walk of disk.
  bytes      INT         NOT NULL,
  created_at BIGINT      NOT NULL,
  PRIMARY KEY (user_id, id),
  KEY idx_image_files_user_note (user_id, note_id),
  CONSTRAINT fk_image_files_user FOREIGN KEY (user_id)
    REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
