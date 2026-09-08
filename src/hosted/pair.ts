/**
 * Pairing a computer to an account (2026-09-06; replaces copying a key from
 * a web page). `actuals login` opens the browser, the user approves a short code, and the
 * licence key travels to the CLI over one poll and is never shown. The shape matches the
 * the site's pairing contract as amended by the site session:
 *
 *   POST {host}/api/pair/start   {device, cli}     -> {code, url, poll, expires_in}
 *   POST {host}/api/pair/poll    {poll}            -> {status, key?, handle?}
 *   POST {host}/api/pair/disconnect {key}          -> (best effort, idempotent)
 *
 * These, and the hosted upload, are the only network calls the CLI ever makes, and both are
 * named in the report's method list. Everything here takes an injectable fetch, clock, sleep
 * and browser opener so the whole flow is tested against a loopback mock with no real waiting.
 */
import { saveLicence } from "./index.js";
import { STATE_ROOT } from "../config.js";

export interface PairStart {
  code: string;
  url: string;
  poll: string;
  expires_in: number;
}

export type PairStatus = "pending" | "approved" | "expired" | "denied";

export interface PairPoll {
  status: PairStatus;
  key?: string;
  handle?: string;
}


/**
 * Refuse to send anything over plain http to a non-loopback host: an eavesdropper or a
 * downgrade must never see the licence key or a redacted report. Loopback is allowed so the
 * local pairing test works. Redirects are refused (`redirect: "error"`) so a 30x cannot move
 * the credential to another origin.
 */
function assertSafeUrl(u: string): void {
  let parsed: URL;
  try { parsed = new URL(u); } catch { throw new Error(`could not parse the host: ${u}`); }
  const loopback = parsed.hostname === "127.0.0.1" || parsed.hostname === "localhost" || parsed.hostname === "::1";
  if (parsed.protocol !== "https:" && !loopback) throw new Error(`${parsed.host} is not https; refusing to send anything over plain http (only 127.0.0.1 is allowed, for local testing)`);
}

async function postJson(url: string, body: unknown, fetchImpl: typeof fetch): Promise<{ status: number; json: unknown }> {
  assertSafeUrl(url);
  const res = await fetchImpl(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    redirect: "error",
  });
  let json: unknown = null;
  try { json = await res.json(); } catch { json = null; }
  return { status: res.status, json };
}

function rec(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" ? (v as Record<string, unknown>) : {};
}

export async function startPairing(host: string, device: string, cli: string, fetchImpl: typeof fetch = fetch): Promise<PairStart> {
  const { status, json } = await postJson(`${host}/api/pair/start`, { device, cli }, fetchImpl);
  const j = rec(json);
  // the site's pairing endpoints may not exist yet (before the hosted layer ships); say so
  // plainly instead of a bare status, so `actuals login` reads as "not yet", never "broken".
  if (status === 404 || status === 501) throw new Error(`sign-in is not available on ${host.replace(/^https?:\/\//, "")} yet. Hosted sign-in is still being set up; try again soon, or use \`actuals licence <key>\` if you have one.`);
  if (status !== 200 && status !== 201) throw new Error(typeof j["message"] === "string" ? (j["message"] as string) : `pairing could not start (${status})`);
  const code = String(j["code"] ?? ""), url = String(j["url"] ?? ""), poll = String(j["poll"] ?? "");
  const expires_in = Number(j["expires_in"] ?? 0);
  if (!code || !url || !poll) throw new Error("the server did not return a pairing code");
  return { code, url, poll, expires_in: Number.isFinite(expires_in) && expires_in > 0 ? expires_in : 600 };
}

const STATUSES: PairStatus[] = ["pending", "approved", "expired", "denied"];

export async function pollPairing(host: string, poll: string, fetchImpl: typeof fetch = fetch): Promise<PairPoll> {
  const { status, json } = await postJson(`${host}/api/pair/poll`, { poll }, fetchImpl);
  // a rate-limit answer is not a decision; treat it as "keep waiting"
  if (status === 429) return { status: "pending" };
  const j = rec(json);
  const s = STATUSES.find((x) => x === j["status"]) ?? "pending";
  const key = typeof j["key"] === "string" ? (j["key"] as string) : undefined;
  const handle = typeof j["handle"] === "string" ? (j["handle"] as string) : undefined;
  return { status: s, key, handle };
}

export async function disconnectPairing(host: string, key: string, fetchImpl: typeof fetch = fetch): Promise<boolean> {
  try {
    const { status } = await postJson(`${host}/api/pair/disconnect`, { key }, fetchImpl);
    return status >= 200 && status < 300;
  } catch {
    return false; // logout removes the local key regardless
  }
}

export interface LoginDeps {
  host: string;
  device: string;
  cli: string;
  fetchImpl?: typeof fetch;
  /** shown the code and URL as soon as pairing starts */
  onStart?: (s: PairStart) => void;
  /** open the approval page; a no-op with --no-open */
  open?: (url: string) => void;
  /** poll cadence; never below the server's one-per-second floor */
  intervalMs?: number;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  /** where the licence is stored (tests point this at a temp dir) */
  saveRoot?: string;
}

export interface LoginResult {
  handle: string;
  key: string;
}

/**
 * Drive one login to completion: start, show the code, open the browser, then poll until the
 * user approves (key saved, handle returned), the request expires or is denied, or the
 * window closes. Throws with a plain message on every non-approval outcome.
 */
export async function runLogin(deps: LoginDeps): Promise<LoginResult> {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const interval = Math.max(1000, deps.intervalMs ?? 2000);
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const now = deps.now ?? Date.now;

  const start = await startPairing(deps.host, deps.device, deps.cli, fetchImpl);
  deps.onStart?.(start);
  deps.open?.(start.url);

  const deadline = now() + start.expires_in * 1000;
  // one grace poll after the stated expiry, so an approval on the last second is not lost
  while (now() <= deadline) {
    await sleep(interval);
    const p = await pollPairing(deps.host, start.poll, fetchImpl);
    if (p.status === "approved") {
      if (!p.key) throw new Error("the server approved the pairing but sent no key; try `actuals login` again");
      saveLicence(p.key, deps.saveRoot ?? STATE_ROOT);
      return { handle: p.handle ?? "your account", key: p.key };
    }
    if (p.status === "denied") throw new Error("the pairing was declined in the browser");
    if (p.status === "expired") throw new Error("the pairing code expired before it was approved; run `actuals login` again");
  }
  throw new Error("timed out waiting for approval; run `actuals login` again");
}
