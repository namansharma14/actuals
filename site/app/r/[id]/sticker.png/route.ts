/** The sticker for a hosted run, streamed out of the private store so the link is public. */
import { readBlobBytes } from "../../../../lib/blob";
import { fail } from "../../../../lib/http";
import { dbConfigured } from "../../../../lib/db";
import { runById } from "../../../../lib/meter";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  if (!dbConfigured()) return fail(503, "not_configured", "hosted runs are not configured on this deployment");
  const { id } = await ctx.params;
  const run = await runById(id);
  if (!run?.sticker_path) return fail(404, "no_sticker", "there is no sticker for that run");
  try {
    const { bytes, contentType } = await readBlobBytes(run.sticker_path);
    return new Response(bytes, {
      headers: { "content-type": contentType, "cache-control": "public, max-age=31536000, immutable" },
    });
  } catch {
    return fail(502, "storage_failed", "the stored sticker could not be read");
  }
}
