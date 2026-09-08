/**
 * POST /api/pair/disconnect, `actuals logout`. Body: `{ key }`. Revokes that computer's
 * licence. Best effort and idempotent: the answer is the same whether the key existed.
 */
import { fail, json } from "../../../../lib/http";
import { dbConfigured } from "../../../../lib/db";
import { disconnectByKey } from "../../../../lib/pairing";
import { hostedGate } from "../../../../lib/hosted";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request): Promise<Response> {
  const parked = hostedGate();
  if (parked) return parked;
  if (!dbConfigured()) return fail(503, "not_configured", "connecting a computer is not available on this deployment");
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return fail(400, "bad_request", "the request body is not JSON");
  }
  const rec = typeof body === "object" && body !== null ? (body as Record<string, unknown>) : {};
  const key = typeof rec["key"] === "string" ? rec["key"] : "";
  if (key) await disconnectByKey(key);
  return json({ ok: true });
}
