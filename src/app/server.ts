/**
 * Local app mode (D13): a loopback-only HTTP server that serves the report page with the
 * picker, the drawer, and one-tap apply, plus JSON endpoints over the current run.
 *
 * Bound to 127.0.0.1 (numeric, so no DNS lookup ever happens) on a random port. Nothing
 * leaves the machine: G6 measures that no socket other than loopback is opened. Because a
 * fix writes into the user's repository and any website can POST to 127.0.0.1:<port>, the
 * server rejects a foreign Host, requires a per-launch token on every POST, accepts JSON
 * bodies only, caps them, and sends no CORS headers.
 */
import { randomBytes, timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { existsSync, mkdirSync, readFileSync, watch, type FSWatcher } from "node:fs";
import path from "node:path";
import { z } from "zod";
import { CLAUDE_ROOT, isInside, repoIdFor, stateDirFor, type Scope } from "../config.js";
import { listProjects, realPath, tilde, type ProjectRow } from "./projects.js";
import { appliedFixIds, applyPlan, diffOf, planFixes, undoFix } from "../fix/index.js";
import { appendLabel, latestRunId, readEntity, runDir } from "../ledger/store.js";
import { runPipeline } from "../pipeline.js";
import { timelineFor } from "../report/index.js";
import type { CatalogRow } from "../render/app.js";
import { instrumentBody, renderHtml } from "../render/html.js";
import { LabelState, type Run } from "../schema/ledger.js";
import { ReportSchema, type Report } from "../schema/socket.js";
import { sessionDetail } from "./session.js";
import { DEFAULT_HOST, MAX_HOSTED_BODY_BYTES, MAX_STICKER_BYTES, describeUpload, postLink, readLicence, redactedForUpload, uploadHosted } from "../hosted/index.js";
import { homedir } from "node:os";
import { hudSnapshot, type HudSnapshot } from "../watch/hud-server.js";
import { isWatching, liveDir } from "../watch/index.js";

export interface AppOptions {
  /** the base scope every run uses (repo, redact, generous, allProjects, --since) */
  scope: Scope;
  stateDir: string;
  claudeRoot?: string;
  /** serve this run first; default: the latest full run */
  runId?: string | null;
  /** where another project's runs are stored when the picker switches project (tests redirect this); default ~/.actuals/<repoId> */
  stateDirFor?: (repoId: string) => string;
  /** 0 = random (default) */
  port?: number;
  /** exit this long after the last page heartbeat; null = never (default 150 s) */
  idleExitMs?: number | null;
  /** where hosted runs go (tests point this at a loopback mock); default from ACTUALS_HOST */
  hostedOrigin?: string;
  /** the licence key to send (tests); default from ~/.actuals/licence */
  licenceKey?: string | null;
}

export interface App {
  url: string;
  port: number;
  /** the address the socket is actually bound to, read back from the server (G6 checks it) */
  address: string;
  token: string;
  /** resolves when the last page has been gone for idleExitMs (never resolves when idle exit is off) */
  idle: Promise<void>;
  current(): { runId: string; report: Report };
  close(): Promise<void>;
}

class HttpError extends Error { constructor(public status: number, message: string) { super(message); } }

const RunBody = z.object({ since: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(), until: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(), sessions: z.array(z.string()).optional(), project: z.string().max(300).optional() });
const LabelBody = z.object({ target: z.string().min(1), target_kind: z.enum(["session", "run"]), state: LabelState, note: z.string().max(500).default("") });
const FixBody = z.object({ id: z.string().min(1), force: z.boolean().optional() });
const STICKER_B64_MAX = Math.ceil((MAX_STICKER_BYTES * 4) / 3) + 16;
const HostedBody = z.object({ sticker_png_base64: z.string().max(STICKER_B64_MAX).optional(), confirm: z.boolean().optional() });
/** small JSON for every route but the upload, which carries a PNG */
const BODY_CAP = 64 * 1024;
const bodyCapFor = (pathname: string): number => (pathname === "/api/hosted" ? MAX_HOSTED_BODY_BYTES : BODY_CAP);

function loadReport(stateDir: string, runId: string): Report {
  const p = path.join(runDir(stateDir, runId), "report.json");
  if (!existsSync(p)) throw new Error(`no report.json for run ${runId}`);
  return ReportSchema.parse(JSON.parse(readFileSync(p, "utf8")));
}

function catalogOf(report: Report): CatalogRow[] {
  return report.sessions.map((s) => ({ id: s.id, date: s.date, title: s.title, cost_usd: s.cost_usd, agents: s.agents, peak_concurrency: s.peak_concurrency }));
}

function readBody(req: IncomingMessage, cap: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []; let size = 0;
    req.on("data", (c: Buffer) => {
      size += c.length;
      if (size > cap) { chunks.length = 0; req.removeAllListeners("data"); req.resume(); reject(new HttpError(413, "body too large")); return; }
      chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

export async function startApp(opts: AppOptions): Promise<App> {
  const token = randomBytes(24).toString("base64url");
  let stateDir = opts.stateDir;
  const launchStateDir = opts.stateDir;
  const dirFor = opts.stateDirFor ?? stateDirFor;
  const claudeRoot = opts.claudeRoot ?? CLAUDE_ROOT;
  const idleExitMs = opts.idleExitMs === undefined ? 150_000 : opts.idleExitMs;
  const launchScope: Scope = { ...opts.scope, sessionIds: null };
  let baseScope: Scope = launchScope;
  // the project switcher: every Claude Code project on this machine; the launch repo is the one whose recorded cwd sits inside it
  let projects: ProjectRow[] = await listProjects(claudeRoot);
  const launchSlug = launchScope.allProjects ? "*" : (projects.find((p) => p.cwd && isInside(realPath(p.cwd), realPath(launchScope.repoPath)))?.slug ?? "");
  let currentProject = launchSlug;
  const firstId = opts.runId ?? latestRunId(stateDir);
  if (!firstId) throw new Error("no report for this repository yet; run `actuals` first");
  const latestId = latestRunId(stateDir) ?? firstId;
  let current = { runId: firstId, report: loadReport(stateDir, firstId) };
  let catalog = catalogOf(latestId === firstId ? current.report : loadReport(stateDir, latestId));
  let currentScope: { since: string | null; until: string | null; sessionIds: string[] | null } = { since: null, until: null, sessionIds: null };
  let lastPing: number | null = null;
  const launched = Date.now();
  // the redacted copy shown on the share-as-a-page preview is the copy that is sent on confirm
  let pendingHosted: { runId: string; report: Report } | null = null;
  let resolveIdle: () => void = () => {};
  const idle = new Promise<void>((res) => { resolveIdle = res; });

  /** the rows the picker shows: every project, plus this folder when it has no sessions yet */
  function projectRows(): Array<{ slug: string; label: string; sessions: number; last: string | null }> {
    const rows = projects.map((p) => ({ slug: p.slug, label: p.label, sessions: p.sessions, last: p.last }));
    if (launchSlug === "") rows.unshift({ slug: "", label: `${tilde(launchScope.repoPath)} (this folder)`, sessions: 0, last: null });
    return rows;
  }

  /** The "This repository" tab: the launch folder and its session count, stable whichever tab is active. */
  function repoTab(): { slug: string; sessions: number } {
    const r = projectRows().find((x) => x.slug === launchSlug);
    return { slug: launchSlug, sessions: r?.sessions ?? 0 };
  }

  /**
   * Switch the app to another project: a full run of that project, stored in that project's
   * own state directory, so `latest` of the launch repo never moves. "*" is every project on
   * the machine, scoped to the launch repo's fixes and state.
   */
  async function switchProject(slug: string): Promise<void> {
    projects = await listProjects(claudeRoot);
    let next: Scope; let dir: string;
    if (slug === "*") { next = { ...launchScope, allProjects: true, sessionIds: null }; dir = launchStateDir; }
    else if (slug === launchSlug) { next = launchScope; dir = launchStateDir; }
    else {
      const p = projects.find((x) => x.slug === slug);
      if (!p || !p.cwd) throw new HttpError(400, "unknown project");
      const { repoId, originUrl } = repoIdFor(p.cwd);
      next = { ...launchScope, repoPath: p.cwd, repoPathGiven: p.cwd, repoId, originUrl, allProjects: false, sessionIds: null };
      dir = dirFor(repoId);
    }
    const res = await runPipeline({ ...next, sessionIds: null }, { stateDir: dir, claudeRoot: opts.claudeRoot, updateLatest: true });
    baseScope = next; stateDir = dir; currentProject = slug;
    current = { runId: res.ledger.run_id, report: res.report };
    catalog = catalogOf(res.report);
    currentScope = { since: null, until: null, sessionIds: null };
    pendingHosted = null;
  }

  async function rerun(body: z.infer<typeof RunBody>): Promise<{ run_id: string; sessions: number; scoped: boolean }> {
    if (body.project !== undefined && body.project !== currentProject) {
      await switchProject(body.project);
      return { run_id: current.runId, sessions: current.report.sessions.length, scoped: false };
    }
    const since = body.since ?? null, until = body.until ?? null;
    const ids = body.sessions ? new Set(body.sessions) : null;
    // a session with no timestamps has no date; it is always inside a date range, so the
    // picker's untouched defaults never narrow a run by accident (verifier F6.1)
    const inRange = (d: string) => !d || ((!since || d >= since) && (!until || d <= until));
    const set = catalog.filter((s) => inRange(s.date) && (!ids || ids.has(s.id)));
    if (set.length === 0) throw new HttpError(400, "no sessions in that scope");
    const scoped = set.length !== catalog.length;
    const res = await runPipeline({ ...baseScope, sessionIds: scoped ? set.map((s) => s.id) : null }, { stateDir, claudeRoot: opts.claudeRoot, updateLatest: !scoped });
    current = { runId: res.ledger.run_id, report: res.report };
    currentScope = scoped ? { since, until, sessionIds: set.map((s) => s.id) } : { since: null, until: null, sessionIds: null };
    if (!scoped) catalog = catalogOf(res.report);
    return { run_id: res.ledger.run_id, sessions: res.report.sessions.length, scoped };
  }

  /** Yesterday's kept work re-tested today: for sessions dated the day before this report was
   * generated, the files they wrote that are still on disk and tracked in git now (undercount:
   * kept means both). The report is re-run on load, so its per-file verdicts are today's check. */
  function dailyKept(): { n: number; m: number } | null {
    const gen = /^(\d{4}-\d{2}-\d{2})/.exec(current.report.generated_at)?.[1];
    if (!gen) return null;
    const y = new Date(new Date(gen + "T00:00:00Z").getTime() - 86_400_000).toISOString().slice(0, 10);
    const ySessions = current.report.sessions.filter((s) => s.date === y);
    if (!ySessions.length) return null;
    const kept = new Map<string, boolean>();
    for (const s of ySessions) {
      const d = sessionDetail(stateDir, current.runId, current.report, s.id, { repoPath: baseScope.repoPath, redact: baseScope.redact });
      if (!d) continue;
      for (const f of d.files) kept.set(f.path, (kept.get(f.path) ?? false) || (f.on_disk && f.tracked === true));
    }
    if (kept.size === 0) return null;
    let n = 0; for (const v of kept.values()) if (v) n += 1;
    return { n, m: kept.size };
  }

  function page(port: number): string {
    return renderHtml(current.report, { redact: baseScope.redact, app: { token, port, catalog, projects: projectRows(), project: currentProject, repoTab: repoTab(), scope: currentScope, applied: appliedFixIds(stateDir), staticPath: path.join(runDir(stateDir, current.runId), "report.html"), dailyKept: dailyKept() } });
  }

  function fixOrThrow(id: string): { fix: Report["fixes"][number]; changes: ReturnType<typeof planFixes> extends Map<string, infer V> ? V : never } {
    const fix = current.report.fixes.find((f) => f.id === id);
    if (!fix) throw new HttpError(404, `no fix ${id} in this report`);
    if (!fix.available) throw new HttpError(400, `${id} is not available yet`);
    const changes = planFixes(current.report, baseScope.repoPath).get(id) ?? [];
    return { fix, changes };
  }

  /** In a redacted app nothing on the wire names the machine: paths lose the repository prefix and the home directory. */
  const home = homedir();
  const redactPath = (text: string): string => baseScope.redact ? text.split(baseScope.repoPath + "/").join("").split(baseScope.repoPath).join("(redacted)").split(home).join("~") : text;
  /** In a redacted app the live rows carry how many files a run wrote, never which. */
  const redactLive = (snap: HudSnapshot): HudSnapshot => {
    if (!baseScope.redact) return snap;
    snap.repo = "(redacted)";
    for (const r of snap.tree?.runs ?? []) { (r as { files_hidden?: number }).files_hidden = r.files.length; r.files = []; }
    return snap;
  };
  async function route(req: IncomingMessage, url: URL, port: number, body: unknown): Promise<{ status: number; type: "html" | "json"; payload: string | object }> {
    const m = req.method ?? "GET";
    const seg = url.pathname.split("/").filter(Boolean);
    if (m === "GET" && url.pathname === "/") return { status: 200, type: "html", payload: page(port) };
    if (m === "GET" && url.pathname === "/api/report") return { status: 200, type: "json", payload: current.report };
    if (m === "GET" && url.pathname === "/api/sessions") return { status: 200, type: "json", payload: { sessions: catalog, projects: projectRows(), project: currentProject, scope: currentScope, run_id: current.runId } };
    if (m === "GET" && url.pathname === "/api/live") { lastPing = Date.now(); return { status: 200, type: "json", payload: redactLive(await hudSnapshot(stateDir, baseScope.repoPath, isWatching(), claudeRoot)) }; }
    if (m === "GET" && seg[0] === "api" && seg[1] === "session" && seg[2]) {
      const id = decodeURIComponent(seg[2]);
      if (seg[3] === "instrument") {
        const row = current.report.sessions.find((s) => s.id === id);
        if (!row) throw new HttpError(404, "no such session in this report");
        const runs = readEntity<Run>(stateDir, current.runId, "runs");
        const t = timelineFor({ id, date: row.date, title: row.title }, runs, baseScope.redact);
        if (!t) throw new HttpError(404, "no run in this session has both a start and an end");
        return { status: 200, type: "json", payload: { session_id: id, html: instrumentBody(t, current.report.burn.tree.mark, current.report.burn.tree.timeline?.session_id === id), timeline: t } };
      }
      const d = sessionDetail(stateDir, current.runId, current.report, id, { repoPath: baseScope.repoPath, redact: baseScope.redact });
      if (!d) throw new HttpError(404, "no such session in this report");
      return { status: 200, type: "json", payload: d };
    }
    if (m === "POST" && url.pathname === "/api/ping") { lastPing = Date.now(); return { status: 200, type: "json", payload: { ok: true } }; }
    if (m === "POST" && url.pathname === "/api/hosted") {
      // the one upload, from the app: re-run redacted in memory, describe, and only send on confirm
      const rawSticker = body && typeof body === "object" ? (body as Record<string, unknown>)["sticker_png_base64"] : undefined;
      if (typeof rawSticker === "string" && rawSticker.length > STICKER_B64_MAX) throw new HttpError(413, "the sticker is larger than 2 MB");
      const parsed = HostedBody.safeParse(body ?? {});
      if (!parsed.success) throw new HttpError(400, "bad hosted body");
      const key = opts.licenceKey === undefined ? readLicence() : opts.licenceKey;
      if (!key) throw new HttpError(402, "not connected yet: run `actuals login` in your terminal, then try again");
      const host = opts.hostedOrigin ?? DEFAULT_HOST;
      let report: Report;
      if (parsed.data.confirm && pendingHosted && pendingHosted.runId === current.runId) report = pendingHosted.report;
      else {
        const res = await runPipeline({ ...baseScope, redact: true, sessionIds: currentScope.sessionIds }, { stateDir, claudeRoot: opts.claudeRoot, updateLatest: false });
        try { report = redactedForUpload(res.report); } catch (e) { throw new HttpError(422, e instanceof Error ? e.message : String(e)); }
        pendingHosted = { runId: current.runId, report };
      }
      const sticker = parsed.data.sticker_png_base64 ? new Uint8Array(Buffer.from(parsed.data.sticker_png_base64, "base64")) : null;
      const leaves = describeUpload(report, sticker, host);
      if (!parsed.data.confirm) return { status: 200, type: "json", payload: { confirmed: false, leaves, bytes: Buffer.byteLength(JSON.stringify(report)), sticker_bytes: sticker?.byteLength ?? 0 } };
      try { const r = await uploadHosted({ host, key, report, sticker }); return { status: 200, type: "json", payload: { confirmed: true, ...r, url: postLink(r.url), leaves } }; }
      catch (e) { throw new HttpError(502, e instanceof Error ? e.message : String(e)); }
    }
    if (m === "POST" && url.pathname === "/api/run") {
      const parsed = RunBody.safeParse(body ?? {});
      if (!parsed.success) throw new HttpError(400, "bad run body");
      return { status: 200, type: "json", payload: await rerun(parsed.data) };
    }
    if (m === "POST" && url.pathname === "/api/label") {
      const parsed = LabelBody.safeParse(body);
      if (!parsed.success) throw new HttpError(400, 'label needs target, target_kind, state (kept|retired|dead|open), note');
      const l = parsed.data;
      const known = l.target_kind === "session" ? current.report.sessions.some((s) => s.id === l.target) : readEntity<Run>(stateDir, current.runId, "runs").some((r) => r.id === l.target);
      if (!known) throw new HttpError(404, `no ${l.target_kind} ${l.target} in this report`);
      appendLabel(stateDir, { ...l, ts: new Date().toISOString() });
      const again = await rerun({ since: currentScope.since, until: currentScope.until, sessions: currentScope.sessionIds ?? undefined });
      return { status: 200, type: "json", payload: { ok: true, ...again } };
    }
    if (m === "POST" && seg[0] === "api" && seg[1] === "fix" && seg[2]) {
      const parsed = FixBody.safeParse(body);
      if (!parsed.success) throw new HttpError(400, "fix body needs an id");
      const id = parsed.data.id;
      if (seg[2] === "plan") {
        const { changes } = fixOrThrow(id);
        return { status: 200, type: "json", payload: { id, files: changes.map((c) => ({ file: redactPath(c.file), new_file: c.before === null })), diff: redactPath(changes.map(diffOf).join("\n\n")), applied: appliedFixIds(stateDir).includes(id) } };
      }
      if (seg[2] === "apply") {
        const { changes } = fixOrThrow(id);
        if (changes.length === 0) return { status: 200, type: "json", payload: { id, applied: false, files: [], notes: [`${id}: already applied, nothing to change`] } };
        if (changes.some((c) => c.file.endsWith("settings.local.json"))) throw new HttpError(400, "never touches settings.local.json");
        applyPlan(id, changes, stateDir);
        return { status: 200, type: "json", payload: { id, applied: true, files: changes.map((c) => c.file), notes: [`${id}: applied; undo restores every file byte for byte`] } };
      }
      if (seg[2] === "undo") {
        const r = await undoFix(id, baseScope.repoPath, stateDir, { force: parsed.data.force === true });
        if (r.drifted.length && !r.restored.length) return { status: 409, type: "json", payload: { id, restored: [], drifted: r.drifted, notes: r.notes, error: r.notes[0] } };
        return { status: 200, type: "json", payload: { id, restored: r.restored, drifted: r.drifted, notes: r.notes } };
      }
    }
    throw new HttpError(404, "not found");
  }

  // Picker default (2026-09-06): opening the app in a folder with no
  // sessions used to show a page of zeros. When the launch project is empty and other
  // projects on the machine have sessions, start on all projects instead, so the report the
  // user came for is on screen. Reversible: the project dropdown switches back. Only the
  // initial view; a deliberate empty scope is never re-widened after a switch.
  if (current.report.sessions.length === 0 && launchSlug !== "*" && projects.some((p) => p.sessions > 0)) {
    try { await switchProject("*"); } catch { /* fall back to the empty launch view */ }
  }

  const server: Server = createServer((req, res) => { void handle(req, res); });
  const bound = await new Promise<{ port: number; address: string }>((resolve, reject) => {
    server.once("error", reject);
    server.listen(opts.port ?? 0, "127.0.0.1", () => { const a = server.address(); resolve(typeof a === "object" && a ? { port: a.port, address: a.address } : { port: 0, address: "" }); });
  });
  const { port, address } = bound;
  const own = `127.0.0.1:${port}`;
  // browsers omit a default port from Host; 443 never applies to plain http
  const hosts = new Set(port === 80 ? [own, "127.0.0.1"] : [own]);
  const tokenOk = (h: string | string[] | undefined): boolean => {
    const v = Array.isArray(h) ? h[0] : h;
    if (typeof v !== "string") return false;
    const a = Buffer.from(v), b = Buffer.from(token);
    return a.length === b.length && timingSafeEqual(a, b);
  };

  function send(res: ServerResponse, status: number, type: "html" | "json", payload: string | object): void {
    const text = type === "html" ? (payload as string) : JSON.stringify(payload);
    res.writeHead(status, {
      "content-type": type === "html" ? "text/html; charset=utf-8" : "application/json; charset=utf-8",
      "content-length": Buffer.byteLength(text),
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      "referrer-policy": "no-referrer",
      "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; font-src data:; img-src data:; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
    });
    res.end(text);
  }

  /**
   * The live feed (M7): Server-Sent Events over loopback, the tight
   * path with the /api/live poll as its floor. One fs.watch on the repo's live state dir,
   * debounced, coalesces a burst of hook writes into one frame, so a death lands within a
   * blink of being recorded. An open stream is activity, so it holds the idle-exit off; a
   * keepalive comment keeps the connection and lastPing fresh. No daemon: this lives inside
   * the app server the user already started, and closes when the tab does.
   */
  function streamLive(req: IncomingMessage, res: ServerResponse): void {
    lastPing = Date.now();
    res.writeHead(200, {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-store",
      "connection": "keep-alive",
      "x-content-type-options": "nosniff",
      "referrer-policy": "no-referrer",
    });
    let closed = false, sending = false;
    const push = async (): Promise<void> => {
      if (closed || sending) return;
      sending = true;
      try {
        const snap = redactLive(await hudSnapshot(stateDir, baseScope.repoPath, isWatching(), claudeRoot));
        if (!closed) { lastPing = Date.now(); res.write(`data: ${JSON.stringify(snap)}\n\n`); }
      } catch { /* a transient read; the next change or keepalive retries */ }
      finally { sending = false; }
    };
    let debounce: ReturnType<typeof setTimeout> | null = null;
    const onChange = (): void => { if (debounce || closed) return; debounce = setTimeout(() => { debounce = null; void push(); }, 200); };
    let watcher: FSWatcher | null = null;
    try {
      const sdir = path.join(liveDir(stateDir), "state");
      mkdirSync(sdir, { recursive: true });
      watcher = watch(sdir, onChange);
      watcher.on("error", () => { /* the poll floor covers a dropped watch */ });
    } catch { /* fs.watch unsupported here; /api/live is the floor */ }
    const keepalive = setInterval(() => { if (!closed) { lastPing = Date.now(); res.write(": keepalive\n\n"); } }, 20_000);
    keepalive.unref();
    const cleanup = (): void => {
      if (closed) return; closed = true;
      if (debounce) clearTimeout(debounce);
      clearInterval(keepalive);
      try { watcher?.close(); } catch { /* already closed */ }
      try { res.end(); } catch { /* already ended */ }
    };
    req.on("close", cleanup);
    res.on("close", cleanup);
    void push();
  }

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    try {
      if (!hosts.has(req.headers.host ?? "")) throw new HttpError(421, "this page only answers 127.0.0.1");
      const url = new URL(req.url ?? "/", `http://${own}`);
      // the SSE stream keeps the response open; its token may ride in the query because
      // EventSource cannot set a header. Handle it before the header-only /api/ token check.
      if (req.method === "GET" && url.pathname === "/api/live/stream") {
        const q = url.searchParams.get("token");
        if (!tokenOk(req.headers["x-actuals-token"]) && !tokenOk(q ?? undefined)) throw new HttpError(403, "missing or wrong token; reload the page");
        streamLive(req, res);
        return;
      }
      // every /api route needs the token, reads included: the page carries it, nothing else does
      if (url.pathname.startsWith("/api/") && !tokenOk(req.headers["x-actuals-token"])) throw new HttpError(403, "missing or wrong token; reload the page");
      let body: unknown = undefined;
      if (req.method === "POST") {
        const origin = req.headers.origin;
        if (origin && origin !== `http://${own}`) throw new HttpError(403, "wrong origin");
        if (!String(req.headers["content-type"] ?? "").startsWith("application/json")) throw new HttpError(415, "send application/json");
        const raw = await readBody(req, bodyCapFor(url.pathname));
        try { body = raw ? JSON.parse(raw) : {}; } catch { throw new HttpError(400, "bad json"); }
      } else if (req.method !== "GET") throw new HttpError(405, "method not allowed");
      const out = await route(req, url, port, body);
      send(res, out.status, out.type, out.payload);
    } catch (e) {
      const status = e instanceof HttpError ? e.status : 500;
      send(res, status, "json", { error: e instanceof Error ? e.message : String(e) });
    }
  }

  // stop after the last page heartbeat, or after launch if a page never arrives (a browser that fails to open leaves no server behind)
  const timer = idleExitMs === null ? null : setInterval(() => { const since = lastPing ?? launched; if (Date.now() - since > idleExitMs) { void close(); resolveIdle(); } }, Math.min(5000, Math.max(50, idleExitMs ?? 5000)));
  timer?.unref();
  async function close(): Promise<void> {
    if (timer) clearInterval(timer);
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
  return { url: `http://${own}/`, port, address, token, idle, current: () => current, close };
}
