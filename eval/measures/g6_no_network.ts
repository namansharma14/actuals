/**
 * G6, redefined with the local app (D13, 2026-09-03): no sockets except loopback. Runs the
 * whole pipeline on the tiny fixture, then starts the app and talks to it over 127.0.0.1,
 * with net patched to allow loopback targets only and dns blocked outright. The value is
 * the number of non-loopback connection attempts plus any bind that is not 127.0.0.1.
 */
import dns from "node:dns";
import http from "node:http";
import net from "node:net";
import path from "node:path";
import { startApp } from "../../src/app/server.js";
import { runPipeline } from "../../src/pipeline.js";
import { ReportSchema } from "../../src/schema/socket.js";
import { buildTinyFixture } from "../fixtures/tiny.js";
import type { Measurement } from "../harness.js";

const LOOPBACK = new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1", "0:0:0:0:0:0:0:1", "localhost"]);

/** The host a connect() call is aimed at: options object, positional (port, host), or a unix path. */
export function connectTarget(args: unknown[]): string {
  const a = args[0];
  if (a && typeof a === "object") { const o = a as Record<string, unknown>; if (typeof o["path"] === "string") return `unix:${o["path"]}`; return typeof o["host"] === "string" ? o["host"] : "localhost"; }
  if (typeof a === "number") return typeof args[1] === "string" ? args[1] : "localhost";
  if (typeof a === "string") return `unix:${a}`;
  return "unknown";
}
export function isLoopback(host: string): boolean { return LOOPBACK.has(host) || host.startsWith("127.") || host.startsWith("unix:"); }

function request(url: string, init: { method?: string; headers?: Record<string, string>; body?: string } = {}): Promise<{ status: number; text: string }> {
  return new Promise((resolve, reject) => {
    const req = http.request(url, { method: init.method ?? "GET", headers: init.headers ?? {} }, (res) => { let t = ""; res.setEncoding("utf8"); res.on("data", (c) => { t += c; }); res.on("end", () => resolve({ status: res.statusCode ?? 0, text: t })); });
    req.on("error", reject);
    if (init.body) req.write(init.body);
    req.end();
  });
}

export async function measure(): Promise<Measurement> {
  const fx = buildTinyFixture();
  let outside = 0, loopback = 0; const targets: string[] = [];
  const origConnect = net.Socket.prototype.connect;
  const origLookup = dns.lookup;
  (net.Socket.prototype as unknown as { connect: unknown }).connect = function (this: net.Socket, ...args: unknown[]) {
    const target = connectTarget(args);
    if (isLoopback(target)) { loopback += 1; return (origConnect as unknown as (...a: unknown[]) => net.Socket).apply(this, args); }
    outside += 1; targets.push(target); throw new Error(`network blocked by G6: ${target}`);
  };
  // server.listen(port, host) always goes through dns.lookup, even for a numeric host; a
  // loopback literal resolves without leaving the machine, anything else is an attempt
  let loopbackLookups = 0;
  (dns as unknown as { lookup: unknown }).lookup = function (this: unknown, ...args: unknown[]) {
    const host = typeof args[0] === "string" ? args[0] : "";
    if (isLoopback(host)) { loopbackLookups += 1; return (origLookup as unknown as (...a: unknown[]) => unknown).apply(this, args); }
    outside += 1; targets.push(`dns:${host}`); throw new Error(`dns blocked by G6: ${host}`);
  };
  let appRequests = 0; let badBind = 0;
  try {
    const scope = { repoPath: fx.repo, repoId: "tiny", originUrl: null, allProjects: false, since: null, tools: ["claude_code" as const], redact: false, generous: false };
    const stateDir = path.join(fx.root, "state");
    await runPipeline(scope, { claudeRoot: fx.claudeRoot, stateDir });
    const app = await startApp({ scope, stateDir, claudeRoot: fx.claudeRoot, idleExitMs: null });
    try {
      if (app.address !== "127.0.0.1") badBind += 1; // read back from the socket, not from the URL string
      const auth = { "x-actuals-token": app.token };
      const rep = await request(`${app.url}api/report`, { headers: auth });
      if (rep.status !== 200 || !ReportSchema.safeParse(JSON.parse(rep.text)).success) throw new Error(`GET /api/report failed: ${rep.status}`);
      appRequests += 1;
      const run = await request(`${app.url}api/run`, { method: "POST", headers: { "x-actuals-token": app.token, "content-type": "application/json" }, body: JSON.stringify({ sessions: [fx.sessionId] }) });
      if (run.status !== 200) throw new Error(`POST /api/run failed: ${run.status} ${run.text}`);
      appRequests += 1;
      const page = await request(app.url);
      if (page.status !== 200 || !page.text.includes("<script>")) throw new Error(`GET / failed: ${page.status}`);
      appRequests += 1;
    } finally { await app.close(); }
  } finally {
    (net.Socket.prototype as unknown as { connect: unknown }).connect = origConnect;
    (dns as unknown as { lookup: unknown }).lookup = origLookup;
  }
  const value = outside + badBind;
  return { gate: "g6_no_network", value, n: 1, note: value === 0 ? `pipeline and the local app ran with net.Socket.connect limited to loopback and dns.lookup blocked; ${appRequests} requests served over 127.0.0.1 (${loopback} loopback connections, bound to ${"127.0.0.1"}), 0 elsewhere; not patched: dgram, dns.Resolver, child processes` : `${outside} non-loopback attempts (${targets.join(", ")}), ${badBind} non-loopback binds`, details: { outside, loopback, loopback_lookups: loopbackLookups, app_requests: appRequests, bad_bind: badBind } };
}
