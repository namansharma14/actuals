/**
 * POST /api/pair/start, the terminal's first call when it runs `actuals login`.
 * Body: `{ device, cli }`. Answer: `{ code, url, poll, expires_in }`. The person opens
 * `url`, matches `code` against the terminal, and approves; the terminal polls with `poll`.
 */
import { fail, json, siteOrigin } from "../../../../lib/http";
import { dbConfigured } from "../../../../lib/db";
import { startPairing } from "../../../../lib/pairing";
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
  const device = typeof rec["device"] === "string" && rec["device"].trim() ? rec["device"].trim() : "a computer";
  const cli = typeof rec["cli"] === "string" ? rec["cli"].trim() : "";
  const started = await startPairing(device, cli);
  return json(
    {
      code: started.code,
      url: `${siteOrigin(req)}/pair?code=${encodeURIComponent(started.code)}`,
      poll: started.poll,
      expires_in: started.expires_in,
    },
    201,
  );
}
