-- MeetMesh hub schema (M2). Applied idempotently on hub startup.
-- Postgres owns Directory, Registrar sessions, and the durable offline mailbox.

-- MM-202: stable agent identity and its out-of-band bootstrap credential.
CREATE TABLE IF NOT EXISTS agent_identities (
  agent_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  bootstrap_secret_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- MM-201: discoverable profile. Visibility is evaluated relative to the requester.
CREATE TABLE IF NOT EXISTS agent_profiles (
  agent_id TEXT PRIMARY KEY REFERENCES agent_identities(agent_id) ON DELETE CASCADE,
  display_name TEXT NOT NULL,
  visibility TEXT NOT NULL CHECK (visibility IN ('private', 'friends', 'public')),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- MM-201: normalized capability tags for deterministic search (not embeddings).
CREATE TABLE IF NOT EXISTS agent_capabilities (
  agent_id TEXT NOT NULL REFERENCES agent_profiles(agent_id) ON DELETE CASCADE,
  capability TEXT NOT NULL,
  PRIMARY KEY (agent_id, capability)
);

-- MM-201: directed friendship; a 'friends' profile is visible to agents listed here.
CREATE TABLE IF NOT EXISTS friendships (
  agent_id TEXT NOT NULL REFERENCES agent_profiles(agent_id) ON DELETE CASCADE,
  friend_agent_id TEXT NOT NULL,
  PRIMARY KEY (agent_id, friend_agent_id)
);

-- MM-202: one active session per agent. A new REGISTER bumps generation and rotates the token.
CREATE TABLE IF NOT EXISTS sessions (
  agent_id TEXT PRIMARY KEY REFERENCES agent_identities(agent_id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  generation INTEGER NOT NULL,
  token_hash TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('online', 'offline')),
  endpoint TEXT,
  last_seen TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- MM-203: per-recipient durable mailbox with explicit delivery states.
CREATE TABLE IF NOT EXISTS mailbox (
  id BIGSERIAL PRIMARY KEY,
  message_key TEXT NOT NULL UNIQUE,
  recipient_agent_id TEXT NOT NULL,
  sender_agent_id TEXT NOT NULL,
  meeting_id TEXT NOT NULL,
  message_id TEXT NOT NULL,
  content JSONB NOT NULL,
  status TEXT NOT NULL DEFAULT 'QUEUED' CHECK (status IN ('QUEUED', 'SENT', 'DELIVERED', 'EXPIRED')),
  attempts INTEGER NOT NULL DEFAULT 0,
  locked_until TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  delivered_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS mailbox_recipient_status ON mailbox (recipient_agent_id, status);
