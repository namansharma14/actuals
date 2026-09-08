/**
 * The licence key. Generated here, shown once on /account, and never stored: the database
 * keeps sha256(key) so a copy of the table cannot be used to upload as anyone.
 */
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

export const LICENCE_PREFIX = "ak_";

export function newLicenceKey(): string {
  return LICENCE_PREFIX + randomBytes(24).toString("base64url");
}

export function hashLicence(key: string): string {
  return createHash("sha256").update(key.trim(), "utf8").digest("hex");
}

export function sameHash(a: string, b: string): boolean {
  const x = Buffer.from(a, "utf8");
  const y = Buffer.from(b, "utf8");
  return x.length === y.length && timingSafeEqual(x, y);
}

/** `Authorization: Bearer ak_...` is the only credential the CLI ever sends. */
export function bearer(req: Request): string | null {
  const header = req.headers.get("authorization");
  if (!header) return null;
  const match = /^Bearer\s+(\S+)$/i.exec(header.trim());
  return match && match[1] ? match[1] : null;
}

/** A short, URL-safe id for a hosted run: 12 characters, from 9 random bytes. */
export function newRunId(): string {
  return randomBytes(9).toString("base64url");
}
