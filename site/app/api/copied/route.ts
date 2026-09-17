/**
 * POST /api/copied: counts one copy of the install command on the landing (SPEC.md
 * §7.10). No body, no cookie, nothing returned but `{ ok: true }`.
 */
import { db, dbConfigured, ensureUsage } from "../../../lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function fail(status: number, error: string): Response {
  return new Response(JSON.stringify({ error }), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

export async function POST(): Promise<Response> {
  if (!dbConfigured()) return fail(503, "not_configured");

  try {
    await ensureUsage();
    await db().query(`INSERT INTO usage.events (name) VALUES ('copied')`);
  } catch {
    return fail(500, "db");
  }

  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

export async function GET(): Promise<Response> {
  return new Response(JSON.stringify({ error: "method" }), {
    status: 405,
    headers: { "content-type": "application/json; charset=utf-8", allow: "POST" },
  });
}
