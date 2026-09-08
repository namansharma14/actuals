/**
 * One hosted run's report, exactly as the command writes it: `renderHtml(report,
 * { redact: true })`, unmodified, for the frame on /r/<id> to load. The renderer is never
 * forked and nothing is added to the document; the site's own words sit outside the frame.
 */
import { readBlobText } from "../../../../lib/blob";
import { dbConfigured } from "../../../../lib/db";
import { fail } from "../../../../lib/http";
import { reportDocument, reportHeaders } from "../../../../lib/page";
import { runById } from "../../../../lib/meter";
import { checkRedactedSocket } from "../../../../lib/socket";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  if (!dbConfigured()) return fail(503, "not_configured", "hosted runs are not configured on this deployment");
  const { id } = await ctx.params;
  const run = await runById(id);
  if (!run?.report_path) return fail(404, "no_run", "there is no hosted run with that id");

  let stored: unknown;
  try {
    stored = JSON.parse(await readBlobText(run.report_path));
  } catch {
    return fail(502, "storage_failed", "the stored report could not be read");
  }
  const checked = checkRedactedSocket(stored);
  if (!checked.ok) return fail(500, "not_redacted", "the stored report did not pass the redaction check");

  return new Response(reportDocument(checked.report), { headers: reportHeaders(60) });
}
