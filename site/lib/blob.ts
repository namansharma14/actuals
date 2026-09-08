/**
 * Object storage for the two files a hosted run uploads.
 *
 * The blob store on this Vercel project is configured for private access (the v1 portal
 * keeps customer uploads in it), so the files are written private and read back through
 * this app: `/r/<id>` renders the report and `/r/<id>/sticker.png` streams the sticker.
 * Public to anyone with the link, and never a public bucket listing.
 */
import { get, put } from "@vercel/blob";

export const blobConfigured = (): boolean => Boolean(process.env.BLOB_READ_WRITE_TOKEN);

function token(): string {
  const value = process.env.BLOB_READ_WRITE_TOKEN;
  if (!value) throw new Error("BLOB_READ_WRITE_TOKEN is not set on this deployment");
  return value;
}

export const reportPath = (id: string): string => `v2/runs/${id}/report.json`;
export const stickerPath = (id: string): string => `v2/runs/${id}/sticker.png`;

export async function putRunFiles(id: string, report: string, sticker: Uint8Array | null): Promise<{ report: string; sticker: string | null }> {
  await put(reportPath(id), report, {
    access: "private",
    token: token(),
    addRandomSuffix: false,
    contentType: "application/json",
  });
  if (sticker) {
    await put(stickerPath(id), Buffer.from(sticker), {
      access: "private",
      token: token(),
      addRandomSuffix: false,
      contentType: "image/png",
    });
  }
  return { report: reportPath(id), sticker: sticker ? stickerPath(id) : null };
}

export async function readBlobText(pathname: string): Promise<string> {
  const found = await get(pathname, { access: "private", token: token() });
  if (!found) throw new Error(`no stored file at ${pathname}`);
  return new Response(found.stream).text();
}

export async function readBlobBytes(pathname: string): Promise<{ bytes: ArrayBuffer; contentType: string }> {
  const found = await get(pathname, { access: "private", token: token() });
  if (!found) throw new Error(`no stored file at ${pathname}`);
  const bytes = await new Response(found.stream).arrayBuffer();
  return { bytes, contentType: found.blob.contentType ?? "application/octet-stream" };
}
