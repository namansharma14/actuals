-- Actuals v2 hosted layer.
--
-- Everything lives in the `hosted` schema. The v1 portal owns `public` on this same Neon
-- database (public.runs, public.tenants, public.stripe_events and friends) and is still
-- serving getactuals.net, so v2 takes its own namespace rather than a table name that is
-- already taken. Nothing here reads or writes a v1 table.
--
-- Applied with `npm run db:migrate`. Neon's HTTP driver runs one statement per round trip,
-- so this file holds plain statements only: no functions, no DO blocks, no dollar quoting.
-- Every statement is idempotent, so migrate is safe to re-run.
--
-- What is stored: the account, the bookkeeping for a hosted run, and pointers to the two
-- files in blob storage. Never a transcript, a prompt, a path or a line of code.

CREATE SCHEMA IF NOT EXISTS hosted;

CREATE TABLE IF NOT EXISTS hosted.users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clerk_user_id text NOT NULL UNIQUE,
  handle text,
  email text,
  -- The licence key is shown once and never stored: this is sha256(key), hex.
  licence_hash text UNIQUE,
  licence_issued_at timestamptz,
  free_runs integer NOT NULL DEFAULT 5,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS hosted.runs (
  id text PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES hosted.users (id) ON DELETE CASCADE,
  repo_id text NOT NULL DEFAULT '',
  report_path text NOT NULL DEFAULT '',
  sticker_path text,
  charged text NOT NULL DEFAULT 'free',
  generated_at timestamptz,
  window_since timestamptz,
  window_until timestamptz,
  cost_usd numeric(12, 2),
  commits integer,
  cost_per_commit numeric(12, 2),
  files_alive integer,
  files_written integer,
  runs_no_fate integer,
  biggest_tree integer,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS runs_user_created_idx ON hosted.runs (user_id, created_at DESC);

-- Append-only ledger: +n bought, -1 spent. The balance is the sum.
CREATE TABLE IF NOT EXISTS hosted.credits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES hosted.users (id) ON DELETE CASCADE,
  delta integer NOT NULL,
  reason text NOT NULL,
  stripe_session_id text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS credits_user_idx ON hosted.credits (user_id);

CREATE UNIQUE INDEX IF NOT EXISTS credits_session_idx ON hosted.credits (stripe_session_id) WHERE stripe_session_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS hosted.subscriptions (
  user_id uuid PRIMARY KEY REFERENCES hosted.users (id) ON DELETE CASCADE,
  stripe_customer_id text UNIQUE,
  stripe_subscription_id text UNIQUE,
  tier text NOT NULL DEFAULT 'free',
  status text NOT NULL DEFAULT 'none',
  current_period_end timestamptz,
  -- The created time of the Stripe event that last wrote this row, so a late delivery
  -- cannot roll a newer state back.
  event_created timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- The webhook is the only writer of subscription state, and it must be able to say "seen".
CREATE TABLE IF NOT EXISTS hosted.stripe_events (
  id text PRIMARY KEY,
  type text NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now()
);

-- 2026-09-04: the blob store on this project is private, so a run stores the pathname of
-- each file and the app streams it back. These two statements move an already-created
-- table from the url columns to the path columns; both are no-ops afterwards.
ALTER TABLE hosted.runs ADD COLUMN IF NOT EXISTS report_path text NOT NULL DEFAULT '';
ALTER TABLE hosted.runs ADD COLUMN IF NOT EXISTS sticker_path text;
ALTER TABLE hosted.runs DROP COLUMN IF EXISTS report_url;
ALTER TABLE hosted.runs DROP COLUMN IF EXISTS sticker_url;

ALTER TABLE hosted.subscriptions ADD COLUMN IF NOT EXISTS event_created timestamptz;

-- 2026-09-06: Pro and Max are coming soon at launch (2026-09-06). One field on /pricing
-- takes an email for each. No email provider exists yet, so nothing is sent: the row is
-- there so the first mail can go out when the tier does.
CREATE TABLE IF NOT EXISTS hosted.interest (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL,
  tier text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS interest_email_tier_idx ON hosted.interest (lower(email), tier);

-- 2026-09-06: pairing replaces the copied licence key.
-- One licence per connected computer, revocable on its own; the pairing row carries the
-- key exactly once, for the terminal's next poll after approval, then it is cleared.
CREATE TABLE IF NOT EXISTS hosted.licences (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES hosted.users (id) ON DELETE CASCADE,
  hash text NOT NULL UNIQUE,
  device text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz,
  revoked_at timestamptz
);

CREATE INDEX IF NOT EXISTS licences_user_idx ON hosted.licences (user_id);

CREATE TABLE IF NOT EXISTS hosted.pairings (
  code text PRIMARY KEY,
  poll_hash text NOT NULL UNIQUE,
  device text NOT NULL DEFAULT '',
  cli text NOT NULL DEFAULT '',
  user_id uuid REFERENCES hosted.users (id) ON DELETE SET NULL,
  licence_id uuid REFERENCES hosted.licences (id) ON DELETE SET NULL,
  key_once text,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  approved_at timestamptz,
  denied_at timestamptz,
  last_poll_at timestamptz
);

-- A key issued before pairing existed keeps working as one licence row.
INSERT INTO hosted.licences (user_id, hash, device, created_at)
  SELECT id, licence_hash, 'key issued before pairing', COALESCE(licence_issued_at, now())
    FROM hosted.users WHERE licence_hash IS NOT NULL
  ON CONFLICT (hash) DO NOTHING;
