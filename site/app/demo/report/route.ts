/**
 * The sample report itself, exactly as the command writes it, with the interactive drawers
 * the command rendered from the same redacted run: `renderHtml(report, { redact: true,
 * embed: { drawers } })`, for the frames on / and /demo to load. The renderer is never
 * forked and this route never adds a line to it. `?session=<id>` and `?panel=` are read by
 * the document itself.
 */
import { reportEmbedDocument, reportHeaders } from "../../../lib/page";
import { demoReport } from "../../../lib/report";

export const dynamic = "force-static";

export function GET(): Response {
  return new Response(reportEmbedDocument(demoReport), { headers: reportHeaders(3600, { script: true }) });
}
