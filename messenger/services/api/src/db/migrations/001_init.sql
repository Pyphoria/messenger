-- init schema for messenger PoC

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  username TEXT UNIQUE NOT NULL,
  email TEXT UNIQUE,
  password_hash TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

CREATE TABLE IF NOT EXISTS devices (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  device_name TEXT,
  public_key TEXT NOT NULL, -- client's public identity key (base64)
  signed_prekey TEXT,       -- optional signed prekey
  prekeys JSONB,            -- array of one-time prekeys (public only)
  last_seen TIMESTAMP WITH TIME ZONE DEFAULT now(),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

CREATE TABLE IF NOT EXISTS messages (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  from_device UUID NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  to_device UUID NOT NULL, -- we keep as UUID for now, reference later if desired
  payload TEXT NOT NULL, -- base64 encrypted message blob
  sent_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  delivered BOOLEAN DEFAULT FALSE
);