/**
 * Regression test for the pairing key hand-off (site/lib/pairing.ts pollPairing).
 *
 * Guards a real bug the pairing e2e caught: `UPDATE ... SET key_once = NULL ... RETURNING
 * key_once` returns the POST-update value (NULL) in Postgres, so the key was cleared but
 * never delivered and every `actuals login` failed with "approved but sent no key".
 *
 * There is no separate test database, so this runs against the configured DATABASE_URL with
 * a synthetic user and pairing row that it inserts and deletes. Run:
 *   node --env-file=.env.local --import tsx scripts/pairing-handoff.test.ts
 */
import { neon } from "@neondatabase/serverless";
import { pollPairing, hashPoll } from "../lib/pairing";

const sql = neon(process.env.DATABASE_URL as string);
const fail = (m: string): never => { throw new Error(m); };

async function main(): Promise<void> {
  const secret = "e2e-handoff-" + Date.now() + "-" + Math.random().toString(36).slice(2);
  const code = "ZZZ-" + Math.random().toString(36).slice(2, 6).toUpperCase();
  const key = "ak_regression_" + Math.random().toString(36).slice(2, 18);
  const clerk = "e2e-regression-" + Date.now();
  let userId = "";
  try {
    const u = (await sql.query(
      `INSERT INTO hosted.users (clerk_user_id, handle, email) VALUES ($1,$2,$3) RETURNING id`,
      [clerk, "e2e-regression", null],
    )) as Array<{ id: string }>;
    userId = u[0]!.id;
    await sql.query(
      `INSERT INTO hosted.pairings (code, poll_hash, device, cli, expires_at, approved_at, user_id, key_once)
       VALUES ($1,$2,$3,$4, now()+interval '10 minutes', now(), $5, $6)`,
      [code, hashPoll(secret), "e2e-probe-handoff", "0.1.1", userId, key],
    );

    // poll #1: the key must ride on this one answer
    const first = await pollPairing(secret);
    if (first.status !== "approved") fail(`poll#1 status ${first.status}, expected approved`);
    if (first.key !== key) fail(`poll#1 key mismatch: got ${first.key === undefined ? "undefined" : JSON.stringify(first.key)}, expected the stored key_once`);
    if (first.handle !== "e2e-regression") fail(`poll#1 handle ${JSON.stringify(first.handle)}, expected e2e-regression`);

    // the stored key must now be cleared
    const rows = (await sql.query(`SELECT key_once IS NULL AS cleared FROM hosted.pairings WHERE code=$1`, [code])) as Array<{ cleared: boolean }>;
    if (!rows[0]?.cleared) fail("key_once was not cleared after the first poll");

    // poll #2: the key must never be handed out twice
    const second = await pollPairing(secret);
    if (second.key) fail("poll#2 returned a key; the key must be delivered exactly once");

    console.log("PASS: key delivered once, matched the stored key_once, cleared after, none on the second poll");
  } finally {
    await sql.query(`DELETE FROM hosted.pairings WHERE code=$1`, [code]);
    if (userId) await sql.query(`DELETE FROM hosted.users WHERE id=$1`, [userId]);
  }
}
main().then(() => process.exit(0)).catch((e) => { console.error("FAIL: " + (e instanceof Error ? e.message : String(e))); process.exit(1); });
