/**
 * POST /api/pair/poll, the terminal's wait. Body: `{ poll }`. Answer:
 * `{ status: pending | approved | expired | denied, key?, handle? }`, with `key` and
 * `handle` on the single approved answer after the person's click, and `429` when it is
 * asked more than once a second.
 */
import { fail, json } from "../../../../lib/http";
import { dbConfigured } from "../../../../lib/db";
import { pollPairing } from "../../../../lib/pairing";
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
  const poll = typeof rec["poll"] === "string" ? rec["poll"] : "";
  if (!poll) return fail(400, "bad_request", "send the poll secret as `{ poll }`");
  const result = await pollPairing(poll);
  if (result.slow_down) return json({ status: result.status, error: "slow_down", message: "poll no faster than once a second" }, 429);
  return json(
    result.key ? { status: result.status, key: result.key, handle: result.handle ?? null } : { status: result.status },
    200,
  );
}
