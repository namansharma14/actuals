import { neon, type NeonQueryFunction } from "@neondatabase/serverless";

export const dbConfigured = (): boolean => Boolean(process.env.DATABASE_URL);

let cached: NeonQueryFunction<false, false> | null = null;

/** The pooled Neon connection. Every table this app touches is in the `hosted` schema. */
export function db(): NeonQueryFunction<false, false> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set on this deployment");
  cached ??= neon(url);
  return cached;
}

export interface UserRow {
  id: string;
  clerk_user_id: string;
  handle: string | null;
  email: string | null;
  licence_hash: string | null;
  licence_issued_at: Date | string | null;
  free_runs: number;
}

export async function userByLicenceHash(hash: string): Promise<UserRow | null> {
  const rows = (await db().query(
    `SELECT id, clerk_user_id, handle, email, licence_hash, licence_issued_at, free_runs
       FROM hosted.users WHERE licence_hash = $1`,
    [hash],
  )) as UserRow[];
  return rows[0] ?? null;
}

export async function upsertUserByClerkId(clerkUserId: string, handle: string | null, email: string | null): Promise<UserRow> {
  const rows = (await db().query(
    `INSERT INTO hosted.users (clerk_user_id, handle, email) VALUES ($1, $2, $3)
       ON CONFLICT (clerk_user_id) DO UPDATE SET handle = COALESCE(EXCLUDED.handle, hosted.users.handle),
                                                 email = COALESCE(EXCLUDED.email, hosted.users.email)
     RETURNING id, clerk_user_id, handle, email, licence_hash, licence_issued_at, free_runs`,
    [clerkUserId, handle, email],
  )) as UserRow[];
  const row = rows[0];
  if (!row) throw new Error("could not create the account row");
  return row;
}

export interface Standing {
  lifetime_runs: number;
  runs_this_month: number;
  credits: number;
  free_runs: number;
  tier: string;
  status: string;
}

export async function standing(userId: string): Promise<Standing> {
  const rows = (await db().query(
    `SELECT (SELECT count(*)::int FROM hosted.runs WHERE user_id = $1) AS lifetime_runs,
            (SELECT count(*)::int FROM hosted.runs WHERE user_id = $1 AND created_at >= date_trunc('month', now())) AS runs_this_month,
            (SELECT COALESCE(sum(delta), 0)::int FROM hosted.credits WHERE user_id = $1) AS credits,
            (SELECT free_runs FROM hosted.users WHERE id = $1) AS free_runs,
            COALESCE((SELECT tier FROM hosted.subscriptions WHERE user_id = $1), 'free') AS tier,
            COALESCE((SELECT status FROM hosted.subscriptions WHERE user_id = $1), 'none') AS status`,
    [userId],
  )) as Standing[];
  const row = rows[0];
  if (!row) throw new Error("could not read the account standing");
  return row;
}

/** One row per email and tier for a tier that is coming soon. Nothing is sent from here. */
export async function addInterest(email: string, tier: string): Promise<void> {
  await db().query(`INSERT INTO hosted.interest (email, tier) VALUES ($1, $2) ON CONFLICT DO NOTHING`, [email, tier]);
}

export interface HistoryRow {
  id: string;
  created_at: Date | string;
  generated_at: Date | string | null;
  window_since: Date | string | null;
  window_until: Date | string | null;
  charged: string;
  cost_usd: string | null;
  commits: number | null;
  cost_per_commit: string | null;
  files_alive: number | null;
  files_written: number | null;
  runs_no_fate: number | null;
  biggest_tree: number | null;
  sticker_path: string | null;
}

/** Every hosted run of one account, newest first, with the columns the history page shows. */
export async function runsForUser(userId: string, limit = 200): Promise<HistoryRow[]> {
  return (await db().query(
    `SELECT id, created_at, generated_at, window_since, window_until, charged, cost_usd, commits, cost_per_commit,
            files_alive, files_written, runs_no_fate, biggest_tree, sticker_path
       FROM hosted.runs WHERE user_id = $1
      ORDER BY COALESCE(generated_at, created_at) DESC LIMIT $2`,
    [userId, limit],
  )) as HistoryRow[];
}

export interface WeekRow {
  week: Date | string;
  run_id: string;
  runs_pushed: number;
  cost_usd: string | null;
  commits: number | null;
  cost_per_commit: string | null;
  files_alive: number | null;
  files_written: number | null;
  runs_no_fate: number | null;
  biggest_tree: number | null;
}

/**
 * The newest run of each week (weeks start Monday). A week's line is that snapshot of the
 * meter, never a sum: two reports pushed in one week usually cover the same sessions, and
 * adding them would count the same dollars twice.
 */
export async function weeksForUser(userId: string, limit = 12): Promise<WeekRow[]> {
  return (await db().query(
    `SELECT DISTINCT ON (date_trunc('week', COALESCE(generated_at, created_at)))
            date_trunc('week', COALESCE(generated_at, created_at))::date AS week,
            id AS run_id,
            count(*) OVER (PARTITION BY date_trunc('week', COALESCE(generated_at, created_at)))::int AS runs_pushed,
            cost_usd, commits, cost_per_commit, files_alive, files_written, runs_no_fate, biggest_tree
       FROM hosted.runs WHERE user_id = $1
      ORDER BY date_trunc('week', COALESCE(generated_at, created_at)) DESC, COALESCE(generated_at, created_at) DESC
      LIMIT $2`,
    [userId, limit],
  )) as WeekRow[];
}
