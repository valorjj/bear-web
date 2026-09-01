-- M: PUBLISHED PAGES. The rendered HTML lives on disk under PUBLISH_ROOT;
-- this table is what makes a page findable, what the quota sums, and what
-- unpublishing deletes.
--
-- Cascades from `users` so `DELETE FROM users WHERE id = ?` stays the one
-- statement that removes an account. The directory on disk is the one thing
-- that cascade cannot reach, and `routes/account.ts` removes it explicitly —
-- a cascade that leaves pages readable on the internet is not a deletion.
CREATE TABLE published_pages (
  -- `randomBytes(16).toString('base64url')` — 22 chars today, with headroom.
  -- THIS ID IS THE CAPABILITY: it is the only thing standing between the page
  -- and the public, so it is generated with a CSPRNG and never derived from
  -- the note id, the title, or anything else guessable.
  id           VARCHAR(43) NOT NULL,
  user_id      CHAR(36)    NOT NULL,
  -- Which note this snapshot came from. Used to keep republish idempotent,
  -- NEVER for authorisation.
  note_id      CHAR(36)    NOT NULL,
  -- Denormalised so the listing needs no note read. Refreshed on republish.
  title        VARCHAR(512) NOT NULL,
  -- Denormalised so the quota is a SUM over rows rather than a walk of disk.
  bytes        INT UNSIGNED NOT NULL,
  published_at BIGINT      NOT NULL,
  PRIMARY KEY (id),
  -- One note publishes to ONE url. This is what makes republish keep the id:
  -- a URL that changes when the author fixes a typo is not shareable.
  UNIQUE KEY uniq_published_user_note (user_id, note_id),
  KEY idx_published_user (user_id),
  CONSTRAINT fk_published_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
