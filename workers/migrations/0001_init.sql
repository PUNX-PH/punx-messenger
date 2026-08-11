-- Punx Messenger — D1 schema (Cloudflare migration, Phase 0)
--
-- Replaces Firestore. Dynamic Firestore maps (reactions, typing, lastRead,
-- mentionedUids, adminUids/memberUids) are normalized into proper rows —
-- see the migration plan for the full reasoning per table.
--
-- Booleans are INTEGER 0/1 (no native BOOLEAN in SQLite/D1).
-- Timestamps are INTEGER unix-millis (matches every .toMillis() call site
-- in both clients today).

-- ───────── Users ─────────

CREATE TABLE users (
  uid         TEXT PRIMARY KEY,          -- Firebase Auth uid, unchanged
  email       TEXT NOT NULL UNIQUE,
  name        TEXT NOT NULL,
  photo_url   TEXT,
  role        TEXT NOT NULL DEFAULT 'employee' CHECK (role IN ('employee', 'admin', 'super_admin')),
  presence    TEXT NOT NULL DEFAULT 'online' CHECK (presence IN ('online', 'away')),
  last_seen   INTEGER NOT NULL DEFAULT 0,
  created_at  INTEGER NOT NULL
);
CREATE INDEX idx_users_name ON users(name);

-- was users.lastRead: { readKey: ts } — one row per container instead of a
-- dynamic map keyed by pathToReadKey().
CREATE TABLE last_read (
  uid          TEXT NOT NULL REFERENCES users(uid) ON DELETE CASCADE,
  container_id TEXT NOT NULL,   -- channel_id, dm convo_id, or 'notes'
  read_at      INTEGER NOT NULL,
  PRIMARY KEY (uid, container_id)
);

-- was users.mutedGroups: [groupId, ...]
CREATE TABLE muted_groups (
  uid      TEXT NOT NULL REFERENCES users(uid) ON DELETE CASCADE,
  group_id TEXT NOT NULL REFERENCES groups(group_id) ON DELETE CASCADE,
  PRIMARY KEY (uid, group_id)
);

-- ───────── Groups / Channels ─────────

CREATE TABLE groups (
  group_id   TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  image_url  TEXT,           -- base64 data URL, verbatim (unchanged from today)
  banner_url TEXT,
  owner_uid  TEXT NOT NULL REFERENCES users(uid),
  created_at INTEGER NOT NULL
);

-- was groups.adminUids + groups.memberUids as two parallel arrays —
-- one row per membership, is_admin flag replaces the dual-array bookkeeping.
CREATE TABLE group_members (
  group_id  TEXT NOT NULL REFERENCES groups(group_id) ON DELETE CASCADE,
  uid       TEXT NOT NULL REFERENCES users(uid) ON DELETE CASCADE,
  is_admin  INTEGER NOT NULL DEFAULT 0,
  joined_at INTEGER NOT NULL,
  PRIMARY KEY (group_id, uid)
);
CREATE INDEX idx_group_members_uid ON group_members(uid);   -- "my groups" lookup

CREATE TABLE channels (
  channel_id      TEXT PRIMARY KEY,
  group_id        TEXT NOT NULL REFERENCES groups(group_id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  type            TEXT NOT NULL DEFAULT 'text',
  created_at      INTEGER NOT NULL,
  created_by      TEXT NOT NULL REFERENCES users(uid),
  last_message_at INTEGER
);
CREATE INDEX idx_channels_group ON channels(group_id, created_at);

-- was channel/dm.typing: { uid: ts } — durability fallback only. Typing is
-- primarily held in-memory inside the relevant ChannelRoom Durable Object
-- (Phase 3); this table exists purely for crash recovery, not the hot path.
CREATE TABLE typing_state (
  container_id TEXT NOT NULL,
  uid          TEXT NOT NULL,
  started_at   INTEGER NOT NULL,
  PRIMARY KEY (container_id, uid)
);

-- ───────── DMs ─────────

-- convo_id stays the deterministic [a,b].sort().join('__') string (matches
-- dmConvoId() on both clients unchanged) — the UNIQUE index below is what
-- actually guarantees correctness, the id string is just a cheap convenience
-- that also gives free Durable Object addressing (see ChannelRoom, Phase 3).
CREATE TABLE dm_convos (
  convo_id                 TEXT PRIMARY KEY,
  member_a                 TEXT NOT NULL REFERENCES users(uid),  -- sorted, member_a < member_b
  member_b                 TEXT NOT NULL REFERENCES users(uid),
  created_at               INTEGER NOT NULL,
  last_message_at          INTEGER,
  last_message_text        TEXT,
  last_message_author_uid  TEXT
);
CREATE UNIQUE INDEX idx_dm_pair ON dm_convos(member_a, member_b);
CREATE INDEX idx_dm_member_a ON dm_convos(member_a);
CREATE INDEX idx_dm_member_b ON dm_convos(member_b);
-- Note: Firestore's dms.memberInfo (denormalized name/photoURL snapshot) is
-- deliberately dropped — the Workers API joins to `users` instead of
-- duplicating what a JOIN gives for free.

-- ───────── Messages ─────────

-- One physical table for channel + dm + notes messages (container_type
-- distinguishes) — matches how listenMessages(path) already treats all
-- three uniformly today, and makes @mention lookups a single indexed query
-- instead of Firestore's collectionGroup + array-contains dance.
CREATE TABLE messages (
  message_id       TEXT PRIMARY KEY,
  container_type   TEXT NOT NULL CHECK (container_type IN ('channel', 'dm', 'note')),
  container_id     TEXT NOT NULL,   -- channel_id / dm convo_id / uid (for notes)
  text             TEXT NOT NULL DEFAULT '',
  image_url        TEXT,
  image_meta_json  TEXT,            -- {width,height,approxBytes,originalName} as JSON
  author_uid       TEXT NOT NULL REFERENCES users(uid),
  author_name      TEXT NOT NULL,   -- denormalized snapshot, kept as-is (matches current behavior)
  author_photo_url TEXT,
  reply_to_json    TEXT,            -- {messageId,authorUid,authorName,snippet} as JSON — small immutable quote snapshot, not worth normalizing
  created_at       INTEGER NOT NULL,
  edited_at        INTEGER,
  pinned           INTEGER NOT NULL DEFAULT 0,
  client_id        TEXT UNIQUE      -- offline-queue idempotency key (Phase 3) — a replayed send becomes a no-op if it already landed
);
CREATE INDEX idx_messages_container ON messages(container_type, container_id, created_at);

-- was message.mentionedUids: [uid, ...]
CREATE TABLE message_mentions (
  message_id TEXT NOT NULL REFERENCES messages(message_id) ON DELETE CASCADE,
  uid        TEXT NOT NULL REFERENCES users(uid),
  PRIMARY KEY (message_id, uid)
);
CREATE INDEX idx_mentions_uid ON message_mentions(uid, message_id);

-- was message.reactions: { emojiKey: [uid, ...] } — a real INSERT/DELETE
-- toggle replaces Firestore's read-modify-write (which had a documented
-- last-writer-wins race under concurrent taps).
CREATE TABLE message_reactions (
  message_id TEXT NOT NULL REFERENCES messages(message_id) ON DELETE CASCADE,
  emoji_key  TEXT NOT NULL,   -- unicode emoji or ":name:" custom-emoji token
  uid        TEXT NOT NULL REFERENCES users(uid),
  reacted_at INTEGER NOT NULL,
  PRIMARY KEY (message_id, emoji_key, uid)
);
CREATE INDEX idx_reactions_message ON message_reactions(message_id);

-- ───────── Emojis ─────────

CREATE TABLE emojis (
  emoji_id   TEXT PRIMARY KEY,
  name       TEXT NOT NULL UNIQUE,   -- UNIQUE constraint replaces the old full-collection uniqueness read
  data_url   TEXT NOT NULL,
  created_by TEXT NOT NULL REFERENCES users(uid),
  created_at INTEGER NOT NULL
);

-- ───────── Calls ─────────

-- Audit log only — live call state (offer/answer/candidates/renegotiation)
-- lives entirely inside the CallRoom Durable Object (Phase 5) and is never
-- read from here on the hot path. One row written at terminal state.
CREATE TABLE call_history (
  call_id      TEXT PRIMARY KEY,
  caller_uid   TEXT NOT NULL REFERENCES users(uid),
  callee_uid   TEXT NOT NULL REFERENCES users(uid),
  dm_convo_id  TEXT NOT NULL,
  type         TEXT NOT NULL CHECK (type IN ('audio', 'video')),
  final_state  TEXT NOT NULL CHECK (final_state IN ('declined', 'cancelled', 'missed', 'ended', 'failed')),
  created_at   INTEGER NOT NULL,
  accepted_at  INTEGER,
  ended_at     INTEGER,
  ended_by     TEXT
);
