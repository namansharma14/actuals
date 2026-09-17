/**
 * POST /api/numbers: opt-in numbers sharing (SPEC.md §7.10), the one row the CLI writes
 * when a person turns sharing on and a report finishes. JSON only, one row per send, no
 * CORS, no cookies, nothing returned but `{ ok: true }`.
 */
import { numbersPayloadV1 } from "../../../lib/numbers-schema";
import { db, dbConfigured, ensureUsage } from "../../../lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BYTES = 16 * 1024;

function fail(status: number, error: string): Response {
  return new Response(JSON.stringify({ error }), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

export async function POST(req: Request): Promise<Response> {
  const contentType = (req.headers.get("content-type") ?? "").split(";")[0]?.trim().toLowerCase();
  if (contentType !== "application/json") return fail(415, "content_type");

  if (!dbConfigured()) return fail(503, "not_configured");

  const raw = await req.text();
  if (Buffer.byteLength(raw, "utf8") > MAX_BYTES) return fail(413, "too_large");

  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return fail(400, "bad_json");
  }

  const parsed = numbersPayloadV1.safeParse(body);
  if (!parsed.success) return fail(422, "schema");

  try {
    await ensureUsage();
    await db().query(`INSERT INTO usage.numbers (install_id, v, payload) VALUES ($1, $2, $3)`, [
      parsed.data.install_id,
      parsed.data.v,
      JSON.stringify(parsed.data),
    ]);
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
