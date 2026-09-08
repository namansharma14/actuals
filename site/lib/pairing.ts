/**
 * Pairing: how a computer joins an account. The terminal asks for a
 * short code, the person approves it in the browser, and the terminal receives its licence
 * on the next poll, exactly once. Nobody ever sees or copies a key.
 *
 * One licence per connected computer, revocable on its own. `/api/runs` looks its bearer
 * up here. Every query is a single statement, the way the Neon HTTP driver wants it.
 */
import { createHash, randomBytes } from "node:crypto";
import { db, type UserRow } from "./db";
import { hashLicence, newLicenceKey } from "./licence";

/** Ten minutes to approve; the GitHub device flow's own figure. */
export const PAIR_TTL_SECONDS = 600;

/* No 0, O, 1, I or L, so a code read aloud or typed cannot be misread. */
const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

export function newCode(): string {
  const bytes = randomBytes(8);
  let s = "";
  for (let i = 0; i < 8; i++) s += ALPHABET[bytes[i]! % ALPHABET.length];
  return `${s.slice(0, 4)}-${s.slice(4)}`;
}

/** Accepts `abcd1234`, `ABCD-1234`, `abcd 1234`; returns the canonical form or null. */
export function normalizeCode(raw: string): string | null {
  const s = raw.toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (s.length !== 8) return null;
  for (const ch of s) if (!ALPHABET.includes(ch)) return null;
  return `${s.slice(0, 4)}-${s.slice(4)}`;
}

export function newPollSecret(): string {
  return randomBytes(24).toString("base64url");
}

export function hashPoll(secret: string): string {
  return createHash("sha256").update(secret, "utf8").digest("hex");
}

export interface PairingRow {
  code: string;
  device: string;
  cli: string;
  user_id: string | null;
  licence_id: string | null;
  key_once: string | null;
  created_at: Date | string;
  expires_at: Date | string;
  approved_at: Date | string | null;
  denied_at: Date | string | null;
  last_poll_at: Date | string | null;
}

const PAIRING_COLUMNS =
  "code, device, cli, user_id, licence_id, key_once, created_at, expires_at, approved_at, denied_at, last_poll_at";

export function isExpired(row: Pick<PairingRow, "expires_at">): boolean {
  return new Date(row.expires_at).getTime() <= Date.now();
}

/**
 * A pairing row is short-lived. Every start and every poll sweeps the ones that are past
 * their expiry, so a plaintext key handed to a terminal that never came back cannot linger,
 * and an approved row is gone within the hour whether or not it was collected.
 */
export async function purgeStalePairings(): Promise<void> {
  await db().query(
    `DELETE FROM hosted.pairings
      WHERE expires_at < now() - interval '1 hour'
         OR (approved_at IS NULL AND expires_at < now())
         OR (approved_at IS NOT NULL AND key_once IS NULL AND approved_at < now() - interval '10 minutes')`,
  );
}

/** The terminal's first call. Retries once on the vanishingly rare code collision. */
export async function startPairing(device: string, cli: string): Promise<{ code: string; poll: string; expires_in: number }> {
  await purgeStalePairings();
  for (let attempt = 0; attempt < 3; attempt++) {
    const code = newCode();
    const poll = newPollSecret();
    try {
      await db().query(
        `INSERT INTO hosted.pairings (code, poll_hash, device, cli, expires_at)
         VALUES ($1, $2, $3, $4, now() + ($5 || ' seconds')::interval)`,
        [code, hashPoll(poll), device.slice(0, 80), cli.slice(0, 40), String(PAIR_TTL_SECONDS)],
      );
      return { code, poll, expires_in: PAIR_TTL_SECONDS };
    } catch (err) {
      if (attempt === 2) throw err;
    }
  }
  throw new Error("unreachable");
}

export async function pairingByCode(code: string): Promise<PairingRow | null> {
  const rows = (await db().query(`SELECT ${PAIRING_COLUMNS} FROM hosted.pairings WHERE code = $1`, [code])) as PairingRow[];
  return rows[0] ?? null;
}

export type ApproveResult = "approved" | "expired" | "missing" | "already" | "denied";

/**
 * The person's one click. Mints the licence for this device, then hands the key to the
 * pairing row for the terminal's next poll. If the pairing is no longer approvable the
 * licence is removed again, so a stale click can never leave a key behind.
 */
export async function approvePairing(code: string, userId: string): Promise<ApproveResult> {
  const row = await pairingByCode(code);
  if (!row) return "missing";
  if (row.denied_at) return "denied";
  if (row.approved_at) return row.user_id === userId ? "already" : "missing";
  if (isExpired(row)) return "expired";

  const key = newLicenceKey();
  const made = (await db().query(
    `INSERT INTO hosted.licences (user_id, hash, device) VALUES ($1, $2, $3) RETURNING id`,
    [userId, hashLicence(key), row.device],
  )) as Array<{ id: string }>;
  const licenceId = made[0]?.id;
  if (!licenceId) throw new Error("the licence row was not created");

  const updated = (await db().query(
    `UPDATE hosted.pairings
        SET approved_at = now(), user_id = $2, licence_id = $3, key_once = $4
      WHERE code = $1 AND approved_at IS NULL AND denied_at IS NULL AND expires_at > now()
      RETURNING code`,
    [code, userId, licenceId, key],
  )) as Array<{ code: string }>;
  if (!updated.length) {
    await db().query(`DELETE FROM hosted.licences WHERE id = $1`, [licenceId]);
    return "expired";
  }
  return "approved";
}

export async function denyPairing(code: string): Promise<void> {
  await db().query(`UPDATE hosted.pairings SET denied_at = now() WHERE code = $1 AND approved_at IS NULL`, [code]);
}

export type PollStatus = "pending" | "approved" | "expired" | "denied";
export interface PollResult {
  status: PollStatus;
  key?: string;
  handle?: string | null;
  /** polled faster than once a second */
  slow_down?: boolean;
}

/**
 * The terminal's poll. The key rides on exactly one answer: the row's `key_once` is read
 * and cleared in the same statement, so two polls can never both receive it.
 */
export async function pollPairing(secret: string): Promise<PollResult> {
  await purgeStalePairings();
  const hash = hashPoll(secret);
  const rows = (await db().query(
    `SELECT ${PAIRING_COLUMNS}, (last_poll_at IS NOT NULL AND last_poll_at > now() - interval '1 second') AS too_fast
       FROM hosted.pairings WHERE poll_hash = $1`,
    [hash],
  )) as Array<PairingRow & { too_fast: boolean }>;
  const row = rows[0];
  if (!row) return { status: "denied" };
  if (row.too_fast) return { status: row.approved_at ? "approved" : "pending", slow_down: true };
  await db().query(`UPDATE hosted.pairings SET last_poll_at = now() WHERE poll_hash = $1`, [hash]);
  if (row.denied_at) return { status: "denied" };
  if (!row.approved_at) return isExpired(row) ? { status: "expired" } : { status: "pending" };

  const handed = (await db().query(
    // RETURNING reflects the post-update row, so read key_once in a CTE before it is cleared;
    // otherwise the key is wiped and null is handed back, and every login fails "no key".
    `WITH picked AS (
       SELECT poll_hash, key_once, user_id FROM hosted.pairings
        WHERE poll_hash = $1 AND key_once IS NOT NULL
     )
     UPDATE hosted.pairings p SET key_once = NULL
       FROM picked
      WHERE p.poll_hash = picked.poll_hash
     RETURNING picked.key_once AS key,
               (SELECT handle FROM hosted.users WHERE id = picked.user_id) AS handle`,
    [hash],
  )) as Array<{ key: string; handle: string | null }>;
  const first = handed[0];
  if (!first) return { status: "approved" };
  return { status: "approved", key: first.key, handle: first.handle };
}

/** `actuals logout`: best effort, idempotent, and silent about whether the key existed. */
export async function disconnectByKey(key: string): Promise<void> {
  await db().query(`UPDATE hosted.licences SET revoked_at = now() WHERE hash = $1 AND revoked_at IS NULL`, [hashLicence(key)]);
}

/** The bearer on `/api/runs`: a live licence, and its use is noted. */
export async function userByLicence(key: string): Promise<UserRow | null> {
  const rows = (await db().query(
    `UPDATE hosted.licences l SET last_used_at = now()
       FROM hosted.users u
      WHERE l.hash = $1 AND l.revoked_at IS NULL AND u.id = l.user_id
      RETURNING u.id, u.clerk_user_id, u.handle, u.email, u.licence_hash, u.licence_issued_at, u.free_runs`,
    [hashLicence(key)],
  )) as UserRow[];
  return rows[0] ?? null;
}

export interface LicenceRow {
  id: string;
  device: string;
  created_at: Date | string;
  last_used_at: Date | string | null;
}

/** The connected computers of one account, newest first. */
export async function licencesForUser(userId: string): Promise<LicenceRow[]> {
  return (await db().query(
    `SELECT id, device, created_at, last_used_at FROM hosted.licences
      WHERE user_id = $1 AND revoked_at IS NULL ORDER BY created_at DESC`,
    [userId],
  )) as LicenceRow[];
}

export async function revokeLicence(userId: string, licenceId: string): Promise<void> {
  await db().query(`UPDATE hosted.licences SET revoked_at = now() WHERE id = $1 AND user_id = $2 AND revoked_at IS NULL`, [
    licenceId,
    userId,
  ]);
}
