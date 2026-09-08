/**
 * Hosted runs (D11): the one thing that ever leaves the machine, and only
 * when the user asks for it, run by run, after seeing exactly what goes. The upload is the
 * redacted socket plus the sticker PNG; the licence key is the only credential. The report
 * itself never changes because of this module, and G6 still measures `run` and the app.
 */
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { STATE_ROOT } from "../config.js";
import { ReportSchema, type Report } from "../schema/socket.js";

export const DEFAULT_HOST = process.env.ACTUALS_HOST ?? "https://getactuals.net";
/** The upload caps, shared by the CLI, the app and the site's gate (site/lib/socket.ts carries the same numbers). */
export const MAX_SOCKET_BYTES = 2 * 1024 * 1024;
export const MAX_STICKER_BYTES = 2 * 1024 * 1024;
/** base64 grows by a third, plus the JSON around it */
export const MAX_HOSTED_BODY_BYTES = MAX_SOCKET_BYTES + Math.ceil((MAX_STICKER_BYTES * 4) / 3) + 64 * 1024;
const REDACTED = "(redacted)";
const REDACTED_TITLE = /^session [0-9a-f]{8}$/;

export function licencePath(root = STATE_ROOT): string { return path.join(root, "licence"); }
export function saveLicence(key: string, root = STATE_ROOT): string {
  const k = key.trim();
  if (!/^ak_[A-Za-z0-9_-]{16,}$/.test(k)) throw new Error("that does not look like an actuals licence key (ak_...); get one at /account");
  mkdirSync(root, { recursive: true });
  const p = licencePath(root); writeFileSync(p, k + "\n", { mode: 0o600 }); chmodSync(p, 0o600);
  return p;
}
export function readLicence(root = STATE_ROOT): string | null {
  const p = licencePath(root);
  if (!existsSync(p)) return null;
  const k = readFileSync(p, "utf8").trim();
  return k.length ? k : null;
}
export function clearLicence(root = STATE_ROOT): boolean { const p = licencePath(root); if (!existsSync(p)) return false; rmSync(p); return true; }

/**
 * The upload copy of a socket. Refuses anything the CLI did not redact (the server refuses
 * it too), then strips the free text the page hides but the JSON keeps: fix targets and
 * snippets, the /insights goal. Same rule as the site's lib/socket.ts, applied first here
 * so the bytes the user is shown are the bytes that leave.
 */
export function redactedForUpload(report: Report): Report {
  if (report.repo_path !== REDACTED) throw new Error("this report is not redacted: run `actuals run --redact --no-open` first, or use `actuals share --hosted` which re-runs redacted for you");
  const named = report.sessions.find((s) => !REDACTED_TITLE.test(s.title) && !/^session [0-9a-f]{8} \(live ledger only/.test(s.title));
  if (named) throw new Error(`this report is not redacted: session ${named.id.slice(0, 8)} carries a title`);
  const t = report.burn.tree.timeline;
  if (t && !REDACTED_TITLE.test(t.title)) throw new Error("this report is not redacted: the drawn session carries a title");
  if (report.burn.rereads.top.some((x) => x.path !== REDACTED)) throw new Error("this report is not redacted: the re-read table carries file paths");
  const copy: Report = {
    ...report,
    // the repo id is a hash of the origin URL, so a public repo could be linked by hashing its clone URL
    repo_id: REDACTED,
    // a label note is the user's own words; the outcome state stays, the note does not
    sessions: report.sessions.map((s) => ({ ...s, title: REDACTED_TITLE.test(s.title) ? s.title : `session ${s.id.slice(0, 8)}`, claimed: s.claimed ? { ...s.claimed, goal: "" } : null, outcome: s.outcome.mark === "founder-labelled" ? { ...s.outcome, note: "" } : s.outcome })),
    fixes: report.fixes.map((f) => ({ ...f, target_file: REDACTED, snippet: REDACTED })),
  };
  return ReportSchema.parse(copy);
}

/** What leaves, in words a person can check before saying yes. */
export function describeUpload(report: Report, sticker: Uint8Array | null, host: string): string[] {
  const bytes = Buffer.byteLength(JSON.stringify(report));
  return [
    `to: ${host}/api/runs, with your licence key`,
    `report.json, redacted: ${(bytes / 1024).toFixed(1)} KB. ${report.sessions.length} sessions as "session <8 chars>", the headline numbers, fates, models, the tallest tree's run times, the fixes' titles and reasons with targets and snippets removed, method and limitations text.`,
    `never: a prompt, a path, a file name, a commit message, a line of code, a session title, an /insights goal, a label note, or the repository id.`,
    sticker ? `sticker.png: ${(sticker.byteLength / 1024).toFixed(1)} KB, drawn from aggregates only.` : `no sticker attached.`,
    `the page will say: "What left the machine: this redacted report and one PNG."`,
  ];
}

export interface UploadResult { id: string; url: string; charged: string; free_runs_left: number; credits_left: number }

/**
 * The link as it is handed to the person for posting: the hosted page's URL with `ref=post`,
 * so the site can tell a click from a posted sticker apart from any other. Nothing else about
 * the link changes and nothing is sent to make it.
 */
export function postLink(url: string): string {
  try { const u = new URL(url); u.searchParams.set("ref", "post"); return u.toString(); } catch { return url; }
}

/** POST the redacted socket and the sticker. The only network call this CLI makes, and only from here. */

/** Same rule as the pairing calls: no plain-http host except loopback, and no redirects. */
function assertHttpsHost(host: string): void {
  let parsed: URL;
  try { parsed = new URL(host); } catch { throw new Error(`could not parse the host: ${host}`); }
  const loopback = parsed.hostname === "127.0.0.1" || parsed.hostname === "localhost" || parsed.hostname === "::1";
  if (parsed.protocol !== "https:" && !loopback) throw new Error(`${parsed.host} is not https; refusing to upload over plain http (only 127.0.0.1 is allowed, for local testing)`);
}

export async function uploadHosted(opts: { host: string; key: string; report: Report; sticker: Uint8Array | null; fetchImpl?: typeof fetch }): Promise<UploadResult> {
  const f = opts.fetchImpl ?? fetch;
  assertHttpsHost(opts.host);
  const body = JSON.stringify({ report: opts.report, sticker_png_base64: opts.sticker ? Buffer.from(opts.sticker).toString("base64") : undefined });
  const res = await f(`${opts.host.replace(/\/$/, "")}/api/runs`, { method: "POST", headers: { authorization: `Bearer ${opts.key}`, "content-type": "application/json" }, body, redirect: "error" });
  const text = await res.text();
  let j: Record<string, unknown> = {};
  try { j = JSON.parse(text) as Record<string, unknown>; } catch { /* non-JSON error page */ }
  if (!res.ok) {
    const msg = typeof j["message"] === "string" ? (j["message"] as string) : typeof j["error"] === "string" ? (j["error"] as string) : `${res.status} ${res.statusText}`;
    throw new Error(`hosted run refused (${res.status}): ${msg}`);
  }
  if (typeof j["url"] !== "string" || typeof j["id"] !== "string") throw new Error("the server answered without a share URL");
  return { id: j["id"] as string, url: j["url"] as string, charged: String(j["charged"] ?? ""), free_runs_left: Number(j["free_runs_left"] ?? 0), credits_left: Number(j["credits_left"] ?? 0) };
}
