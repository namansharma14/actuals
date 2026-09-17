/**
 * The pooled Neon client for the site's usage tables, which it creates itself on first use.
 *
 * `DATABASE_URL` is already set in every Vercel environment for this project, and it is the
 * same database for production and preview: there is one Neon instance behind both, so a
 * preview deploy writes into the same `usage` rows a production deploy would. That is fine
 * here because a usage table is low stakes: it holds install ids and the numbers a person
 * chose to share, never a transcript, a path or a line of code, and losing or mixing a few
 * preview rows costs nothing.
 */
import { neon, type NeonQueryFunction } from "@neondatabase/serverless";

export const dbConfigured = (): boolean => Boolean(process.env.DATABASE_URL);

let cached: NeonQueryFunction<false, false> | null = null;

/** The pooled connection. Every table this app touches lives in the `usage` schema. */
export function db(): NeonQueryFunction<false, false> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set on this deployment");
  cached ??= neon(url);
  return cached;
}

/**
 * The usage tables, created on the first request that needs them (every statement is
 * idempotent). No migration step: the database has whatever the deployed code expects.
 * usage.numbers holds one row per share with the JSON the CLI sent, already refused by the
 * endpoint's schema if it carries anything but aggregates and versions; usage.events holds
 * one row per counted landing interaction, today just the copy button.
 */
const USAGE_DDL = [
  "CREATE SCHEMA IF NOT EXISTS usage",
  "CREATE TABLE IF NOT EXISTS usage.numbers (id bigserial PRIMARY KEY, received_at timestamptz NOT NULL DEFAULT now(), install_id text NOT NULL, v int NOT NULL, payload jsonb NOT NULL)",
  "CREATE INDEX IF NOT EXISTS numbers_install_received_idx ON usage.numbers (install_id, received_at)",
  "CREATE TABLE IF NOT EXISTS usage.events (id bigserial PRIMARY KEY, received_at timestamptz NOT NULL DEFAULT now(), name text NOT NULL)",
];
let ensured: Promise<void> | null = null;

/** Resolves once the usage tables exist; runs the DDL at most once per instance and retries on the next call if it failed. */
export function ensureUsage(): Promise<void> {
  ensured ??= (async () => { for (const stmt of USAGE_DDL) await db().query(stmt); })().catch((e: unknown) => { ensured = null; throw e; });
  return ensured;
}
