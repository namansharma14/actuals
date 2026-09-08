/**
 * The always-on HUD window (2026-09-06): the statusline HUD only ever draws
 * in the terminal, and the VS Code extension renders no statusline at all. So the same live
 * ledger `actuals watch` fills is served here as a tiny loopback page a user can pin beside
 * the editor or open in VS Code's Simple Browser. It reads the live state files and nothing
 * else, makes no network call, and spawns nothing.
 *
 * Security mirrors the app server: bound to 127.0.0.1 (numeric, no DNS), a per-launch token
 * on the one data endpoint, a foreign Host refused, a `connect-src 'self'` CSP. The page
 * polls `/hud.json` on the same origin every couple of seconds; there is no write path.
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { existsSync, statSync } from "node:fs";
import path from "node:path";
import { CLAUDE_ROOT } from "../config.js";
import { concurrencyCap } from "./index.js";
import type { GeoRun } from "../render/tree-geometry.js";
import { listStates, type LiveSessionState } from "./index.js";
import { costOfTranscript, slugFor } from "../read/claude_code/index.js";

/** A session is "active" in the window while its last event is within this long. */
const ACTIVE_MS = 30 * 60 * 1000;

export interface HudServer {
  url: string;
  port: number;
  address: string;
  token: string;
  idle: Promise<void>;
  close(): Promise<void>;
}

export interface HudRow {
  session_id: string;
  model: string | null;
  cost_usd: number | null;
  context_pct: number | null;
  agents_open: number;
  cap: number;
  died: number;
  compactions: number;
  five_hour_pct: number | null;
  writes: number;
  last_at: string;
  seconds_ago: number;
  source: "terminal" | "editor";
}


/**
 * A session whose statusline never ran (the VS Code extension renders none) has a null live
 * cost. Price it from its transcript instead, the same once-per-request way the report does,
 * behind an mtime cache so the 2-second poll never re-parses an unchanged file.
 */
const costCache = new Map<string, { mtimeMs: number; cost: number }>();

async function transcriptCost(claudeRoot: string, cwd: string, sessionId: string): Promise<number | null> {
  const file = path.join(claudeRoot, "projects", slugFor(cwd), `${sessionId}.jsonl`);
  let mtimeMs: number;
  try { mtimeMs = statSync(file).mtimeMs; } catch { return null; }
  const hit = costCache.get(file);
  if (hit && hit.mtimeMs === mtimeMs) return hit.cost;
  if (!existsSync(file)) return null;
  const cost = await costOfTranscript(file);
  costCache.set(file, { mtimeMs, cost });
  return cost;
}

function rowsFrom(states: LiveSessionState[], cap: number, now: number, costFallback: Map<string, number>): HudRow[] {
  return states
    .map((s) => ({
      session_id: s.session_id,
      model: s.model,
      cost_usd: s.cost_usd ?? costFallback.get(s.session_id) ?? null,
      context_pct: s.context_pct,
      agents_open: Object.keys(s.agents_open ?? {}).length,
      cap,
      died: s.died,
      compactions: s.compactions,
      five_hour_pct: s.five_hour_pct,
      writes: s.writes,
      last_at: s.last_at,
      seconds_ago: Math.max(0, Math.round((now - Date.parse(s.last_at)) / 1000)),
      source: (s.context_pct !== null || s.five_hour_pct !== null) ? "terminal" as const : "editor" as const,
    }))
    .filter((r) => now - Date.parse(r.last_at) < ACTIVE_MS)
    .sort((a, b) => b.last_at.localeCompare(a.last_at));
}

export interface LiveTreeRun extends GeoRun {
  agent_type: string | null;
  parent: string | null;
  files: string[];
}

export interface LiveTree {
  session_id: string;
  started_at: string;
  model: string | null;
  cost_usd: number | null;
  context_pct: number | null;
  cap: number;
  now: string;
  ended: boolean;
  runs: LiveTreeRun[];
}

export interface HudSnapshot {
  watching: boolean;
  repo: string;
  cap: number;
  cap_source: string;
  rows: HudRow[];
  generated_at: string;
  /** the most-recent active session drawn as a tree (M7 control centre); null when nothing is live */
  tree: LiveTree | null;
}

export async function hudSnapshot(stateDir: string, repoPath: string, watching: boolean, claudeRoot = CLAUDE_ROOT, now = Date.now()): Promise<HudSnapshot> {
  const { cap, source } = concurrencyCap(repoPath);
  const states = listStates(stateDir);
  const active = states.filter((s) => now - Date.parse(s.last_at) < ACTIVE_MS);
  const costFallback = new Map<string, number>();
  for (const s of active) {
    if (s.cost_usd === null) {
      const c = await transcriptCost(claudeRoot, s.cwd, s.session_id);
      if (c !== null) costFallback.set(s.session_id, c);
    }
  }
  const nowIso = new Date(now).toISOString();
  const recent = active.slice().sort((a, b) => Date.parse(b.last_at) - Date.parse(a.last_at))[0];
  const tree: LiveTree | null = recent
    ? {
        session_id: recent.session_id,
        started_at: recent.started_at,
        model: recent.model,
        cost_usd: recent.cost_usd ?? costFallback.get(recent.session_id) ?? null,
        context_pct: recent.context_pct,
        cap,
        now: nowIso,
        ended: recent.ended ?? false,
        runs: Object.entries(recent.runs ?? {}).map(([id, r]) => ({ id, start: r.started_at, end: r.ended_at ?? nowIso, depth: r.depth, fate: r.fate, agent_type: r.agent_type, parent: r.parent ?? null, files: r.files ?? [] })),
      }
    : null;
  return {
    watching,
    repo: repoPath,
    cap,
    cap_source: source,
    rows: rowsFrom(states, cap, now, costFallback),
    generated_at: nowIso,
    tree,
  };
}

const CSP =
  "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; font-src data:; img-src data:; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";

export interface HudOptions {
  stateDir: string;
  repoPath: string;
  watching: boolean;
  claudeRoot?: string;
  port?: number;
  now?: () => number;
  /** exit this long after the last page poll (or after launch if no page ever polls); null = never. Default 150 s. */
  idleExitMs?: number | null;
}

export async function startHudServer(opts: HudOptions): Promise<HudServer> {
  const token = randomBytes(24).toString("base64url");
  const now = opts.now ?? Date.now;
  const idleExitMs = opts.idleExitMs === undefined ? 150_000 : opts.idleExitMs;
  const launched = Date.now();
  let lastPoll: number | null = null;
  let resolveIdle: () => void = () => {};
  const idle = new Promise<void>((res) => { resolveIdle = res; });

  const server: Server = createServer((req, res) => { void handle(req, res); });
  const bound = await new Promise<{ port: number; address: string }>((resolve, reject) => {
    server.once("error", reject);
    server.listen(opts.port ?? 0, "127.0.0.1", () => {
      const a = server.address();
      resolve(typeof a === "object" && a ? { port: a.port, address: a.address } : { port: 0, address: "" });
    });
  });
  const { port, address } = bound;
  const own = `127.0.0.1:${port}`;
  const hosts = new Set(port === 80 ? [own, "127.0.0.1"] : [own]);

  function hostOk(h: string | undefined): boolean {
    return typeof h === "string" && hosts.has(h);
  }
  function tokenOk(h: string | string[] | undefined): boolean {
    const v = Array.isArray(h) ? h[0] : h;
    if (typeof v !== "string") return false;
    const a = Buffer.from(v), b = Buffer.from(token);
    return a.length === b.length && timingSafeEqual(a, b);
  }
  function send(res: ServerResponse, status: number, type: "html" | "json", payload: string | object): void {
    const text = type === "html" ? (payload as string) : JSON.stringify(payload);
    res.writeHead(status, {
      "content-type": type === "html" ? "text/html; charset=utf-8" : "application/json; charset=utf-8",
      "content-length": Buffer.byteLength(text),
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      "referrer-policy": "no-referrer",
      "content-security-policy": CSP,
    });
    res.end(text);
  }

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (!hostOk(req.headers.host)) return send(res, 403, "json", { error: "bad host" });
    const url = new URL(req.url ?? "/", `http://${own}`);
    if (req.method === "GET" && url.pathname === "/") return send(res, 200, "html", pageHtml(token));
    if (req.method === "GET" && url.pathname === "/hud.json") {
      if (!tokenOk(req.headers["x-actuals-token"])) return send(res, 401, "json", { error: "missing token" });
      lastPoll = Date.now();
      return send(res, 200, "json", await hudSnapshot(opts.stateDir, opts.repoPath, opts.watching, opts.claudeRoot ?? CLAUDE_ROOT, now()));
    }
    return send(res, 404, "json", { error: "not found" });
  }

  const close = () => new Promise<void>((resolve) => { if (timer) clearInterval(timer); server.close(() => resolve()); });
  // stop a while after the last poll, or after launch if the page never opened, so a closed tab leaves no server behind
  const timer = idleExitMs === null ? null : setInterval(() => {
    const since = lastPoll ?? launched;
    if (Date.now() - since > idleExitMs) { resolveIdle(); void close(); }
  }, Math.min(5000, Math.max(50, idleExitMs)));

  return {
    url: `http://${own}/`,
    port,
    address,
    token,
    idle,
    close,
  };
}

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

/**
 * The page. One self-contained document in the report's palette, no external fetch beyond
 * its own `/hud.json`. Small on purpose: it is meant to live in a pinned window a few hundred
 * pixels wide, or VS Code's Simple Browser, and update itself every 2 seconds.
 */
function pageHtml(token: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Actuals HUD</title>
<style>
  :root { --bg: #0A0C0F; --panel: #12151A; --rule: #23272E; --ink: #E9E6DF; --text: #C7C4BD; --faint: #6C7079; --mark: #6E8CA0; --warn: #D98A5B; }
  * { box-sizing: border-box; }
  html, body { margin: 0; background: var(--bg); color: var(--text); font-family: ui-monospace, "SF Mono", Menlo, Consolas, monospace; }
  body { padding: 14px 16px; font-size: 13px; line-height: 1.5; }
  .head { display: flex; justify-content: space-between; align-items: baseline; gap: 12px; border-bottom: 1px solid var(--rule); padding-bottom: 8px; margin-bottom: 12px; }
  .brand { color: var(--ink); letter-spacing: 0.14em; font-size: 11px; text-transform: uppercase; }
  .clock { color: var(--faint); font-size: 10.5px; font-variant-numeric: tabular-nums; }
  .row { border-bottom: 1px solid var(--rule); padding: 10px 0; }
  .row:last-child { border-bottom: 0; }
  .rid { color: var(--faint); font-size: 10px; letter-spacing: 0.06em; display: flex; justify-content: space-between; gap: 10px; }
  .chip { margin-left: 8px; padding: 1px 6px; border: 1px solid var(--rule); border-radius: 2px; color: var(--mark); text-transform: uppercase; letter-spacing: 0.08em; font-size: 8.5px; }
  .note { color: var(--faint); font-size: 10px; line-height: 1.5; padding: 10px 0 2px; border-top: 1px solid var(--rule); margin-top: 4px; }
  .line { margin-top: 6px; display: flex; flex-wrap: wrap; gap: 6px 14px; align-items: baseline; }
  .m { display: inline-flex; gap: 5px; align-items: baseline; }
  .k { color: var(--faint); font-size: 10px; text-transform: uppercase; letter-spacing: 0.08em; }
  .v { color: var(--ink); font-variant-numeric: tabular-nums; }
  .v.big { font-size: 18px; }
  .warn { color: var(--warn); }
  .accent { color: var(--mark); }
  .empty { color: var(--faint); padding: 8px 0; }
  .stale { opacity: 0.5; }
  .off { color: var(--warn); font-size: 11.5px; border: 1px solid var(--rule); background: var(--panel); padding: 10px 12px; }
</style>
</head>
<body>
  <div class="head"><span class="brand">Actuals HUD</span><span class="clock" id="clock"></span></div>
  <div id="body"><div class="empty">connecting to the live ledger…</div></div>
<script>
  var TOKEN = ${JSON.stringify(token)};
  var body = document.getElementById("body"), clock = document.getElementById("clock");
  function money(n) { if (n === null || n === undefined) return "n/a"; var a = Math.abs(n); return "$" + (a >= 100 ? Math.round(a).toLocaleString("en-US") : a.toFixed(2)); }
  function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; }
  function metric(k, v, cls) { var m = el("span", "m"); m.appendChild(el("span", "k", k)); m.appendChild(el("span", "v" + (cls ? " " + cls : ""), v)); return m; }
  function ago(s) { if (s < 60) return s + "s ago"; if (s < 3600) return Math.round(s / 60) + "m ago"; return Math.round(s / 3600) + "h ago"; }
  function render(d) {
    clock.textContent = new Date(d.generated_at).toLocaleTimeString();
    body.textContent = "";
    if (!d.watching) { var off = el("div", "off"); off.textContent = "watch is off. Run: actuals watch (in a terminal) to start the always-on status line, then reopen this window."; body.appendChild(off); return; }
    if (!d.rows.length) { body.appendChild(el("div", "empty", "no active session in this repo yet. Start Claude Code here and the live window fills in.")); return; }
    d.rows.forEach(function (r) {
      var row = el("div", "row" + (r.seconds_ago > 120 ? " stale" : ""));
      var rid = el("div", "rid");
      rid.appendChild(el("span", null, (r.model || "session") + " · " + r.session_id.slice(0, 8)));
      rid.appendChild(el("span", null, ago(r.seconds_ago)));
      row.appendChild(rid);
      var line = el("div", "line");
      line.appendChild(metric("cost est", money(r.cost_usd), "big"));
      if (r.context_pct !== null) line.appendChild(metric("ctx", Math.round(r.context_pct) + "%"));
      line.appendChild(metric("agents", r.agents_open + "/" + r.cap, r.agents_open >= r.cap ? "warn" : "accent"));
      if (r.died > 0) line.appendChild(metric("died", String(r.died), "warn"));
      if (r.compactions > 0) line.appendChild(metric("compactions", String(r.compactions)));
      if (r.five_hour_pct !== null) line.appendChild(metric("5h window", Math.round(r.five_hour_pct) + "%"));
      if (r.writes > 0) line.appendChild(metric("writes", String(r.writes)));
      row.appendChild(line);
      body.appendChild(row);
    });
    if (d.rows.some(function (r) { return r.source === "editor"; })) {
      body.appendChild(el("div", "note", "Context and rate limits are only known for terminal sessions; an editor session shows cost, agents and writes."));
    }
  }
  function poll() {
    fetch("/hud.json", { headers: { "x-actuals-token": TOKEN } })
      .then(function (r) { return r.ok ? r.json() : Promise.reject(r.status); })
      .then(render)
      .catch(function () { clock.textContent = "reconnecting…"; });
  }
  poll();
  setInterval(poll, 2000);
</script>
</body>
</html>`;
}

export { esc as _escForTest };
