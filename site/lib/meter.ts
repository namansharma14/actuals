/**
 * Metering. Free is five hosted runs for the life of the account (2026-09-06,
 * 2026-09-04), then a dollar a run from the credit ledger, unless a subscription covers it:
 * Go is 30 a month, Pro and Max are unlimited.
 *
 * The decision and the row that spends it are one statement, so a run cannot be recorded
 * without being paid for and a credit cannot be spent without a run.
 */
import { db } from "./db";
import type { Report } from "./socket";

export const GO_RUNS_A_MONTH = 30;

export type Charged = "free" | "credit" | "subscription";

export interface MeterResult {
  charged: Charged | null;
  lifetime: number;
  credits: number;
  free_runs: number;
}

const METER = `
WITH sub AS (
  SELECT tier, status FROM hosted.subscriptions WHERE user_id = $1
), used AS (
  SELECT count(*)::int AS lifetime,
         count(*) FILTER (WHERE created_at >= date_trunc('month', now()))::int AS this_month
    FROM hosted.runs WHERE user_id = $1
), bal AS (
  SELECT COALESCE(sum(delta), 0)::int AS credits FROM hosted.credits WHERE user_id = $1
), acct AS (
  SELECT free_runs FROM hosted.users WHERE id = $1
), decision AS (
  SELECT CASE
    WHEN (SELECT status FROM sub) = 'active' AND (SELECT tier FROM sub) IN ('pro', 'max') THEN 'subscription'
    WHEN (SELECT status FROM sub) = 'active' AND (SELECT tier FROM sub) = 'go'
         AND (SELECT this_month FROM used) < ${GO_RUNS_A_MONTH} THEN 'subscription'
    WHEN (SELECT lifetime FROM used) < (SELECT free_runs FROM acct) THEN 'free'
    WHEN (SELECT credits FROM bal) > 0 THEN 'credit'
    ELSE NULL
  END AS charged
), spent AS (
  INSERT INTO hosted.credits (user_id, delta, reason)
  SELECT $1, -1, 'hosted run ' || $2 FROM decision WHERE charged = 'credit'
  RETURNING id
), made AS (
  INSERT INTO hosted.runs (id, user_id, repo_id, charged, generated_at, window_since, window_until,
                           cost_usd, commits, cost_per_commit, files_alive, files_written,
                           runs_no_fate, biggest_tree)
  SELECT $2, $1, $3, charged, $4::timestamptz, $5::timestamptz, $6::timestamptz,
         $7, $8, $9, $10, $11, $12, $13
    FROM decision WHERE charged IS NOT NULL
  RETURNING id
)
SELECT (SELECT charged FROM decision) AS charged,
       (SELECT lifetime FROM used) AS lifetime,
       (SELECT credits FROM bal) AS credits,
       (SELECT free_runs FROM acct) AS free_runs
`;

export async function meterAndRecord(userId: string, runId: string, r: Report): Promise<MeterResult> {
  const rows = (await db().query(METER, [
    userId,
    runId,
    r.repo_id,
    r.generated_at,
    r.window.since,
    r.window.until,
    r.headline.cost_usd.value,
    r.headline.commits.value,
    r.headline.cost_per_commit.value,
    r.headline.files_alive.alive,
    r.headline.files_alive.written,
    r.headline.runs_no_fate.count,
    r.share.biggest_tree,
  ])) as MeterResult[];
  const row = rows[0];
  if (!row) throw new Error("the billing check returned nothing");
  return row;
}

/** Undo a recorded run when the files could not be stored. */
export async function unrecord(userId: string, runId: string, charged: Charged): Promise<void> {
  const sql = db();
  await sql.query(`DELETE FROM hosted.runs WHERE id = $1 AND user_id = $2`, [runId, userId]);
  if (charged === "credit") {
    await sql.query(`INSERT INTO hosted.credits (user_id, delta, reason) VALUES ($1, 1, $2)`, [
      userId,
      `refund, upload failed ${runId}`,
    ]);
  }
}

export async function attachFiles(runId: string, report: string, sticker: string | null): Promise<void> {
  await db().query(`UPDATE hosted.runs SET report_path = $2, sticker_path = $3 WHERE id = $1`, [runId, report, sticker]);
}

export interface RunRow {
  id: string;
  report_path: string;
  sticker_path: string | null;
  charged: string;
  created_at: Date | string;
  generated_at: Date | string | null;
  commits: number | null;
  cost_usd: string | null;
  cost_per_commit: string | null;
}

export async function runById(id: string): Promise<RunRow | null> {
  const rows = (await db().query(
    `SELECT id, report_path, sticker_path, charged, created_at, generated_at, commits, cost_usd, cost_per_commit
       FROM hosted.runs WHERE id = $1`,
    [id],
  )) as RunRow[];
  return rows[0] ?? null;
}
