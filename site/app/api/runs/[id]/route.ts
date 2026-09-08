/** GET /api/runs/:id, the socket behind a share page. Public, and redacted by construction. */
import { readBlobText } from "../../../../lib/blob";
import { fail, json, siteOrigin } from "../../../../lib/http";
import { dbConfigured } from "../../../../lib/db";
import { runById } from "../../../../lib/meter";
import { checkRedactedSocket } from "../../../../lib/socket";
import { hostedGate } from "../../../../lib/hosted";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  const parked = hostedGate();
  if (parked) return parked;
  if (!dbConfigured()) return fail(503, "not_configured", "hosted runs are not configured on this deployment");
  const { id } = await ctx.params;
  const run = await runById(id);
  if (!run || !run.report_path) return fail(404, "no_such_run", "there is no hosted run with that id");
  let stored: unknown;
  try {
    stored = JSON.parse(await readBlobText(run.report_path));
  } catch {
    return fail(502, "storage_failed", "the stored report could not be read");
  }
  const checked = checkRedactedSocket(stored);
  if (!checked.ok) return fail(500, "not_redacted", "the stored report did not pass the redaction check");
  return json({
    id: run.id,
    created_at: run.created_at,
    page: `${siteOrigin(req)}/r/${run.id}`,
    sticker: run.sticker_path ? `${siteOrigin(req)}/r/${run.id}/sticker.png` : null,
    report: checked.report,
  });
}
