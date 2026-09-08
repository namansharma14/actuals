/**
 * POST /api/runs, the one endpoint the CLI calls.
 *
 * Body: the redacted socket, and the sticker PNG the browser already drew. JSON or
 * multipart, both accepted. Auth: `Authorization: Bearer <licence key>`.
 *
 * Refuses anything that is not redacted (lib/socket.ts), so an unredacted report cannot be
 * hosted by accident. Meters five free runs for the life of the account, then credits.
 */
import { fail, json, siteOrigin } from "../../../lib/http";
import { bearer, newRunId } from "../../../lib/licence";
import { attachFiles, meterAndRecord, unrecord } from "../../../lib/meter";
import { blobConfigured, putRunFiles } from "../../../lib/blob";
import { dbConfigured } from "../../../lib/db";
import { userByLicence } from "../../../lib/pairing";
import { MAX_SOCKET_BYTES, MAX_STICKER_BYTES, checkRedactedSocket } from "../../../lib/socket";
import { hostedGate } from "../../../lib/hosted";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function isPng(bytes: Uint8Array): boolean {
  return PNG.every((b, i) => bytes[i] === b);
}

async function readBody(req: Request): Promise<{ socket: unknown; sticker: Uint8Array | null } | string> {
  const type = req.headers.get("content-type") ?? "";
  if (type.includes("multipart/form-data")) {
    const form = await req.formData();
    const reportField = form.get("report");
    if (reportField === null) return "the request has no `report` part";
    const text = typeof reportField === "string" ? reportField : await reportField.text();
    if (text.length > MAX_SOCKET_BYTES) return "report.json is larger than 2 MB";
    const stickerField = form.get("sticker");
    let sticker: Uint8Array | null = null;
    if (stickerField && typeof stickerField !== "string") {
      const buf = new Uint8Array(await stickerField.arrayBuffer());
      if (buf.byteLength > MAX_STICKER_BYTES) return "the sticker is larger than 2 MB";
      sticker = buf;
    }
    try {
      return { socket: JSON.parse(text), sticker };
    } catch {
      return "the `report` part is not JSON";
    }
  }
  const text = await req.text();
  if (text.length > MAX_SOCKET_BYTES + MAX_STICKER_BYTES * 2) return "the request body is too large";
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return "the request body is not JSON";
  }
  if (typeof body !== "object" || body === null) return "the request body is not an object";
  const asRecord = body as Record<string, unknown>;
  const socket = "report" in asRecord ? asRecord["report"] : body;
  let sticker: Uint8Array | null = null;
  const encoded = asRecord["sticker_png_base64"];
  if (typeof encoded === "string" && encoded.length > 0) {
    const buf = new Uint8Array(Buffer.from(encoded, "base64"));
    if (buf.byteLength > MAX_STICKER_BYTES) return "the sticker is larger than 2 MB";
    sticker = buf;
  }
  return { socket, sticker };
}

export async function POST(req: Request): Promise<Response> {
  const parked = hostedGate();
  if (parked) return parked;
  if (!dbConfigured() || !blobConfigured()) {
    return fail(503, "not_configured", "hosted runs are not configured on this deployment");
  }
  const key = bearer(req);
  if (!key) {
    return fail(401, "no_licence", "this computer is not connected to an account. Run `actuals login` and approve the code.");
  }
  const user = await userByLicence(key);
  if (!user) return fail(401, "unknown_licence", "this computer's licence is not one of ours or was disconnected. Run `actuals login` again.");

  const read = await readBody(req);
  if (typeof read === "string") return fail(400, "bad_request", read);

  const checked = checkRedactedSocket(read.socket);
  if (!checked.ok) return fail(422, "not_redacted", checked.error);
  if (read.sticker && !isPng(read.sticker)) return fail(400, "bad_sticker", "the sticker is not a PNG");

  const id = newRunId();
  const meter = await meterAndRecord(user.id, id, checked.report);
  if (!meter.charged) {
    return fail(402, "no_runs_left", `you have used all ${meter.free_runs} free hosted runs and have no credits left. A run is $1, or Go is $9 a month.`, {
      free_runs: meter.free_runs,
      lifetime_runs: meter.lifetime,
      credits: meter.credits,
      pricing: `${siteOrigin(req)}/pricing`,
    });
  }

  try {
    const stored = await putRunFiles(id, JSON.stringify(checked.report), read.sticker);
    await attachFiles(id, stored.report, stored.sticker);
  } catch (err) {
    await unrecord(user.id, id, meter.charged);
    return fail(502, "storage_failed", `the files could not be stored: ${err instanceof Error ? err.message : "unknown error"}`);
  }

  const url = `${siteOrigin(req)}/r/${id}`;
  const freeLeft = Math.max(0, meter.free_runs - meter.lifetime - 1);
  return json(
    {
      id,
      url,
      charged: meter.charged,
      free_runs_left: meter.charged === "free" ? freeLeft : 0,
      credits_left: meter.charged === "credit" ? meter.credits - 1 : meter.credits,
      left_the_machine: "this redacted report and one PNG",
    },
    201,
  );
}
