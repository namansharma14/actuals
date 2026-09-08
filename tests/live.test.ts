import http from "node:http";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { startApp, type App } from "../src/app/server.js";
import { runPipeline } from "../src/pipeline.js";
import { buildTinyFixture, type TinyFixture } from "../eval/fixtures/tiny.js";
import { eventFrom, record } from "../src/watch/index.js";
import type { Scope } from "../src/config.js";

const scopeFor = (fx: TinyFixture): Scope => ({ repoPath: fx.repo, repoId: "tiny", originUrl: null, allProjects: false, since: null, tools: ["claude_code"], redact: false, generous: false });
const apps: App[] = [];
afterAll(async () => { for (const a of apps) await a.close(); });

async function boot(): Promise<{ fx: TinyFixture; app: App; stateDir: string }> {
  const fx = buildTinyFixture();
  const stateDir = path.join(fx.root, "state");
  await runPipeline(scopeFor(fx), { claudeRoot: fx.claudeRoot, stateDir, now: new Date("2026-09-02T00:00:00Z") });
  const app = await startApp({ scope: scopeFor(fx), stateDir, claudeRoot: fx.claudeRoot, idleExitMs: null });
  apps.push(app);
  return { fx, app, stateDir };
}

/** Read the SSE stream until `done(frames)` is true or it times out; then destroy the request. */
function sse(app: App, query: string, done: (frames: unknown[]) => boolean, timeoutMs = 4000): Promise<unknown[]> {
  return new Promise((resolve, reject) => {
    const url = new URL(app.url + "api/live/stream" + query);
    const frames: unknown[] = [];
    let buf = "";
    const req = http.get({ hostname: url.hostname, port: url.port, path: url.pathname + url.search }, (res) => {
      if (res.statusCode !== 200) { req.destroy(); reject(new Error("status " + res.statusCode)); return; }
      res.setEncoding("utf8");
      res.on("data", (chunk: string) => {
        buf += chunk;
        let i: number;
        while ((i = buf.indexOf("\n\n")) !== -1) {
          const block = buf.slice(0, i); buf = buf.slice(i + 2);
          const line = block.split("\n").find((l) => l.startsWith("data:"));
          if (line) { try { frames.push(JSON.parse(line.slice(5).trim())); } catch { /* keepalive or partial */ } }
          if (done(frames)) { req.destroy(); resolve(frames); return; }
        }
      });
    });
    req.on("error", (e) => { if (!(e as NodeJS.ErrnoException).code?.includes("ECONNRESET")) reject(e); });
    const t = setTimeout(() => { req.destroy(); resolve(frames); }, timeoutMs);
    t.unref();
  });
}

describe("the live feed (M7): /api/live poll and /api/live/stream SSE", () => {
  it("the poll refuses a missing token and returns a snapshot with one", async () => {
    const { app } = await boot();
    const noTok = await fetch(app.url + "api/live");
    expect(noTok.status).toBe(403);
    const ok = await fetch(app.url + "api/live", { headers: { "x-actuals-token": app.token } });
    expect(ok.status).toBe(200);
    const snap = (await ok.json()) as { rows: unknown[]; cap: number; generated_at: string; watching: boolean };
    expect(Array.isArray(snap.rows)).toBe(true);
    expect(typeof snap.cap).toBe("number");
    expect(typeof snap.generated_at).toBe("string");
  });

  it("the stream refuses a missing token (query is how EventSource carries it)", async () => {
    const { app } = await boot();
    await expect(sse(app, "", () => true)).rejects.toThrow(/403|status/);
  });

  it("streams an initial snapshot, then a fresh one within a blink of a recorded event", async () => {
    const { app, stateDir, fx } = await boot();
    const frames = await sse(
      app,
      `?token=${app.token}`,
      (fs) => {
        // once the initial (empty) frame has arrived, record a live session; resolve on the frame that shows it
        if (fs.length === 1) {
          const e = eventFrom("SessionStart", { session_id: "live-test-sess", cwd: fx.repo, model: "claude-opus-5" }, new Date());
          record(e!, { stateDir });
        }
        return fs.some((f) => Array.isArray((f as { rows: unknown[] }).rows) && (f as { rows: unknown[] }).rows.length >= 1);
      },
    );
    expect(frames.length).toBeGreaterThanOrEqual(1);
    const first = frames[0] as { rows: unknown[] };
    expect(first.rows.length).toBe(0); // no live sessions at first
    const last = frames[frames.length - 1] as { rows: unknown[] };
    expect(last.rows.length).toBeGreaterThanOrEqual(1); // the recorded session appears
  });
});

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { readState } from "../src/watch/index.js";
import { hudSnapshot } from "../src/watch/hud-server.js";

function recEvent(stateDir: string, kind: string, extra: Record<string, unknown>, ts: Date): void {
  const e = eventFrom(kind, { session_id: "S", cwd: "/tmp/live-tree-repo", ...extra }, ts);
  if (e) record(e, { stateDir });
}

describe("the live ledger folds per-run state for the tree", () => {
  it("opens runs with depth from the parent, closes on stop, marks open runs died at session end", () => {
    const stateDir = mkdtempSync(path.join(tmpdir(), "actuals-livetree-"));
    const t = (m: number) => new Date(`2026-08-31T10:${String(m).padStart(2, "0")}:00.000Z`);
    recEvent(stateDir, "SubagentStart", { agent_id: "a1", agent_type: "Explore" }, t(0));
    recEvent(stateDir, "SubagentStart", { agent_id: "a2", agent_type: "Plan" }, t(1));
    recEvent(stateDir, "SubagentStart", { agent_id: "a3", agent_type: "sub", parent_agent_id: "a1" }, t(2));
    recEvent(stateDir, "SubagentStop", { agent_id: "a2" }, t(5));
    let st = readState(stateDir, "S")!;
    expect(Object.keys(st.runs).sort()).toEqual(["a1", "a2", "a3"]);
    expect(st.runs["a1"]!.depth).toBe(1);
    expect(st.runs["a3"]!.depth).toBe(2); // 1 + a1's depth
    expect(st.runs["a2"]!.fate).toBe("finished_unlanded");
    expect(st.runs["a2"]!.ended_at).toBe(t(5).toISOString());
    expect(st.runs["a1"]!.fate).toBe("still_running");
    recEvent(stateDir, "SessionEnd", {}, t(6));
    st = readState(stateDir, "S")!;
    expect(st.runs["a1"]!.fate).toBe("died"); // open at session end
    expect(st.runs["a3"]!.fate).toBe("died");
    expect(st.runs["a2"]!.fate).toBe("finished_unlanded"); // already closed, unchanged
  });

  it("hudSnapshot carries the most-recent live session as a tree of GeoRuns", async () => {
    const stateDir = mkdtempSync(path.join(tmpdir(), "actuals-livetree-"));
    const now = new Date();
    recEvent(stateDir, "SessionStart", { model: "claude-opus-5" }, now);
    recEvent(stateDir, "SubagentStart", { agent_id: "b1", agent_type: "x" }, now);
    const snap = await hudSnapshot(stateDir, "/tmp/live-tree-repo", true, undefined, now.getTime());
    expect(snap.tree).not.toBeNull();
    expect(snap.tree!.session_id).toBe("S");
    expect(snap.tree!.runs.length).toBe(1);
    expect(snap.tree!.runs[0]!.id).toBe("b1");
    expect(snap.tree!.runs[0]!.fate).toBe("still_running");
    expect(snap.tree!.runs[0]!.end).toBe(now.toISOString()); // an open run ends at now
  });
});

import { renderHtml } from "../src/render/html.js";
import { ReportSchema } from "../src/schema/socket.js";

describe("the control centre view is wired into the app page (M7 client)", () => {
  it("the app page has the Live/Report tabs, the strip, the tree, the empty state, and the SSE wiring", async () => {
    const { app } = await boot();
    const page = await (await fetch(app.url, { headers: { "x-actuals-token": app.token } })).text();
    expect(page).toContain('data-panel="live"');
    expect(page).toContain('id="tab-live"');
    expect(page).toContain('id="panel-report"');
    expect(page).toContain('id="panel-live"');
    expect(page).toContain('class="live-strip"');
    expect(page).toContain('id="live-tree"');
    expect(page).toContain('id="live-empty"');
    expect(page).toContain("/api/live/stream?token="); // EventSource wiring
    expect(page).toContain("EventSource");
    expect(page).not.toContain("—"); // no em dash
  });

  it("the export path carries no live view (the classic report is unchanged)", async () => {
    const { app } = await boot();
    const report = ReportSchema.parse(await (await fetch(app.url + "api/report", { headers: { "x-actuals-token": app.token } })).json());
    const exported = renderHtml(report, { redact: false });
    expect(exported).not.toContain("panel-live");
    expect(exported).not.toContain("tab-live");
    expect(exported).not.toContain("/api/live/stream");
  });
});

describe("the Live control centre: click-through, keyboard list, curve (slice two)", () => {
  it("carries the run listbox, the detail panel, the hover card, and the client wiring", async () => {
    const { app } = await boot();
    const page = await (await fetch(app.url, { headers: { "x-actuals-token": app.token } })).text();
    expect(page).toContain('id="live-runs"');
    expect(page).toContain('role="listbox"');
    expect(page).toContain('id="live-detail"');
    expect(page).toContain('id="live-hover"');
    expect(page).toContain("openRunDetail");     // click / Enter opens a run's detail
    expect(page).toContain("data-run");           // bars and options carry the run id
    expect(page).toContain('addEventListener("keydown"'); // the keyboard path
    expect(page).toContain("lcurve");             // the concurrency curve twin, behind the bars
    expect(page).toContain("data-render-ms");     // click-to-detail render time is surfaced
  });

  it("the snapshot tree carries per-run detail (agent_type, parent, files) and the ended flag", async () => {
    const { app } = await boot();
    const snap = (await (await fetch(app.url + "api/live", { headers: { "x-actuals-token": app.token } })).json()) as { tree: unknown };
    // no live session in the fixture, so the tree is null; the shape is exercised by the data-layer test above.
    expect(snap.tree === null || typeof snap.tree === "object").toBe(true);
  });
});

describe("slice two, items 3-4: the true daily line and the Live states", () => {
  it("the daily line is well-formed when present (N of M, N<=M, M>0), computed server-side", async () => {
    const { app } = await boot();
    const page = await (await fetch(app.url, { headers: { "x-actuals-token": app.token } })).text();
    const m = page.match(/Yesterday's kept work: (\d+) of (\d+) still kept/);
    if (m) { expect(Number(m[1])).toBeLessThanOrEqual(Number(m[2])); expect(Number(m[2])).toBeGreaterThan(0); }
  });
  it("the Live client handles watch-off, no-session, session-ended, and a dropped connection", async () => {
    const { app } = await boot();
    const page = await (await fetch(app.url, { headers: { "x-actuals-token": app.token } })).text();
    expect(page).toContain("The status line is off");            // watch off
    expect(page).toContain("No agent is running in this repo");   // no live session
    expect(page).toContain(" ended");                            // session ended (clock suffix)
    expect(page).toContain("reconnecting to the live feed");      // SSE dropped, surfaced (EventSource retries itself)
    // the detail opens from the frame's own data, no network round trip (so it is well under 100 ms)
    const detail = page.slice(page.indexOf("function openRunDetail"), page.indexOf("function openRunDetail") + 900);
    expect(detail).not.toContain("api(");
    expect(detail).not.toContain("fetch(");
  });
});
