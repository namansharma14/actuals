import http from "node:http";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { startApp, type App } from "../src/app/server.js";
import { renderSessionView, type RunFile } from "../src/app/session.js";
import { eventFrom, record } from "../src/watch/index.js";
import { latestRunId } from "../src/ledger/store.js";
import { runPipeline } from "../src/pipeline.js";
import { ReportSchema } from "../src/schema/socket.js";
import { buildTinyFixture, type TinyFixture } from "../eval/fixtures/tiny.js";
import { repoIdFor, type Scope } from "../src/config.js";
import { slugFor } from "../src/read/claude_code/index.js";

const SECOND = "22222222-3333-4444-5555-666666666666";

/** The tiny fixture plus a second, earlier session (same shape, different id and day) so scoping has something to narrow. */
function twoSessionFixture(): TinyFixture {
  const fx = buildTinyFixture();
  const proj = path.join(fx.claudeRoot, "projects", "-repo");
  const earlier = (text: string) => text.split(fx.sessionId).join(SECOND).split("2026-09-01").join("2026-08-20").replace("Build the thing", "Earlier work");
  writeFileSync(path.join(proj, `${SECOND}.jsonl`), earlier(readFileSync(path.join(proj, `${fx.sessionId}.jsonl`), "utf8")));
  const sub = path.join(proj, SECOND, "subagents"); mkdirSync(sub, { recursive: true });
  for (const f of ["agent-abc.jsonl", "agent-abc.meta.json"]) writeFileSync(path.join(sub, f), earlier(readFileSync(path.join(proj, fx.sessionId, "subagents", f), "utf8")));
  return fx;
}

const scopeFor = (fx: TinyFixture): Scope => ({ repoPath: fx.repo, repoId: "tiny", originUrl: null, allProjects: false, since: null, tools: ["claude_code"], redact: false, generous: false });
const apps: App[] = [];
afterAll(async () => { for (const a of apps) await a.close(); });

async function boot(opts: { idleExitMs?: number | null } = {}): Promise<{ fx: TinyFixture; app: App; stateDir: string; fullRunId: string }> {
  const fx = twoSessionFixture();
  const stateDir = path.join(fx.root, "state");
  const res = await runPipeline(scopeFor(fx), { claudeRoot: fx.claudeRoot, stateDir, now: new Date("2026-09-02T00:00:00Z") });
  const app = await startApp({ scope: scopeFor(fx), stateDir, claudeRoot: fx.claudeRoot, idleExitMs: opts.idleExitMs === undefined ? null : opts.idleExitMs });
  apps.push(app);
  return { fx, app, stateDir, fullRunId: res.ledger.run_id };
}
const post = (app: App, p: string, body: unknown, headers: Record<string, string> = {}) => fetch(app.url + p.replace(/^\//, ""), { method: "POST", headers: { "x-actuals-token": app.token, "content-type": "application/json", ...headers }, body: JSON.stringify(body) });
const get = (app: App, p: string) => fetch(app.url + p.replace(/^\//, ""), { headers: { "x-actuals-token": app.token } });

describe("local app (D13)", () => {
  it("binds 127.0.0.1 on a random port; the page carries the script and the token and no absolute URL; the socket validates", async () => {
    const { app } = await boot();
    expect(app.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/$/);
    expect(app.address).toBe("127.0.0.1");
    const page = await (await get(app, "/")).text();
    expect(page).toContain("<script>");
    expect(page).toContain(app.token);
    expect(page.replace(/ id="stk-x" href="[^"]*"/, "").replace(/http%3A%2F%2Fwww\.w3\.org%2F2000%2Fsvg|http:\/\/www\.w3\.org\/2000\/svg/g, "").toLowerCase()).not.toContain("http");
    expect(page).toContain('<canvas id="sticker"');
    expect(page).not.toContain("—");
    expect(page).toContain('id="wb-list"');        // the session list
    expect(page).toContain('id="wb-session-body"'); // the pane a session lands in
    expect(page).toContain('data-sheet="fixes"');
    expect(page).toContain('data-fix="f1-cap-tree"');
    const rep = await (await get(app, "/api/report")).json();
    expect(ReportSchema.safeParse(rep).success).toBe(true);
    const cat = (await (await get(app, "/api/sessions")).json()) as { sessions: unknown[]; scope: { sessionIds: null } };
    expect(cat.sessions).toHaveLength(2);
    expect(cat.scope.sessionIds).toBeNull();
  });

  it("the session view shows the runs with their fate, the tree and the label control; the tree re-renders for any session", async () => {
    const { app, fx } = await boot();
    const r = await get(app, `/api/session/${fx.sessionId}`);
    expect(r.status).toBe(200);
    const d = (await r.json()) as { files: Array<{ path: string; on_disk: boolean; tracked: boolean | null; verdict: string }>; runs: Array<{ files: RunFile[] }>; timeline: { peak: number } | null; html: string };
    expect(d.files.map((f) => f.path)).toContain("kept.md");
    expect(d.files.find((f) => f.path === "kept.md")?.on_disk).toBe(true);
    expect(d.runs).toHaveLength(1);
    expect(d.timeline?.peak).toBe(1);
    expect(d.html).toContain('id="wb-lsave"');
    expect(d.html).toContain("Did it matter?");
    expect(d.html).toContain('class="wb-tree-svg"');
    expect(d.html).toContain(">measured<");
    expect(d.html).not.toContain("—");
    const inst = await get(app, `/api/session/${SECOND}/instrument`);
    expect(inst.status).toBe(200);
    const j = (await inst.json()) as { html: string; session_id: string };
    expect(j.session_id).toBe(SECOND);
    expect(j.html).toContain("<svg");
    expect(j.html).toContain("agent run");
    expect((await get(app, "/api/session/nope")).status).toBe(404);
  });

  it("refuses a foreign Host, a POST without the token, a non-JSON body, and an oversized body", async () => {
    const { app } = await boot();
    const wrongHost = await new Promise<number>((resolve, reject) => {
      const req = http.request(app.url + "api/report", { headers: { host: "evil.example:80" } }, (res) => { res.resume(); resolve(res.statusCode ?? 0); });
      req.on("error", reject); req.end();
    });
    expect(wrongHost).toBe(421);
    expect((await fetch(app.url + "api/ping", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" })).status).toBe(403);
    expect((await fetch(app.url + "api/report")).status).toBe(403); // reads need the token too
    expect((await fetch(app.url)).status).toBe(200); // the page itself is what carries it
    expect((await fetch(app.url + "api/ping", { method: "POST", headers: { "x-actuals-token": app.token, "content-type": "text/plain" }, body: "{}" })).status).toBe(415);
    expect((await post(app, "/api/ping", { pad: "x".repeat(70 * 1024) })).status).toBe(413);
    expect((await post(app, "/api/ping", {}, { origin: "http://evil.example" })).status).toBe(403);
    expect((await post(app, "/api/ping", {})).status).toBe(200);
    expect((await fetch(app.url + "api/report", { method: "DELETE", headers: { "x-actuals-token": app.token } })).status).toBe(405);
  });

  it("re-runs scoped from the picker without moving latest, then widens back to everything", async () => {
    const { app, fx, stateDir, fullRunId } = await boot();
    expect((await post(app, "/api/run", { sessions: [] })).status).toBe(400);
    const narrow = await post(app, "/api/run", { sessions: [fx.sessionId] });
    expect(narrow.status).toBe(200);
    expect((await narrow.json()) as object).toMatchObject({ sessions: 1, scoped: true });
    const rep = (await (await get(app, "/api/report")).json()) as { sessions: Array<{ id: string }> };
    expect(rep.sessions.map((s) => s.id)).toEqual([fx.sessionId]);
    expect(latestRunId(stateDir)).toBe(fullRunId);
    const page = await (await get(app, "/")).text();
    expect(page).toContain('id="wb-rows"');
    const byDate = await post(app, "/api/run", { since: "2026-08-01", until: "2026-08-31" });
    expect((await byDate.json()) as object).toMatchObject({ sessions: 1, scoped: true });
    expect(((await (await get(app, "/api/report")).json()) as { sessions: Array<{ id: string }> }).sessions[0]?.id).toBe(SECOND);
    const wide = await post(app, "/api/run", {});
    expect((await wide.json()) as object).toMatchObject({ sessions: 2, scoped: false });
    expect(latestRunId(stateDir)).toBe(app.current().runId);
  });

  it("appends a label and the re-run shows it founder-labelled", async () => {
    const { app, fx, stateDir } = await boot();
    expect((await post(app, "/api/label", { target: "nope", target_kind: "session", state: "kept", note: "" })).status).toBe(404);
    expect((await post(app, "/api/label", { target: fx.sessionId, target_kind: "session", state: "bogus", note: "" })).status).toBe(400);
    const ok = await post(app, "/api/label", { target: fx.sessionId, target_kind: "session", state: "retired", note: "replaced the next day" });
    expect(ok.status).toBe(200);
    expect(readFileSync(path.join(stateDir, "labels.ndjson"), "utf8")).toContain("replaced the next day");
    const rep = (await (await get(app, "/api/report")).json()) as { sessions: Array<{ id: string; outcome: { state: string; mark: string } }> };
    const s = rep.sessions.find((x) => x.id === fx.sessionId)!;
    expect(s.outcome).toMatchObject({ state: "retired", mark: "founder-labelled" });
    const d = (await (await get(app, `/api/session/${fx.sessionId}`)).json()) as { label: { state: string } | null; html: string };
    expect(d.label?.state).toBe("retired");
    expect(d.html).toContain('data-label="retired" data-on="1"');
    expect(d.html).toContain("retired · your label");
  });

  it("plans the real diff, applies on the click, shows applied on the page, and undoes byte-identical; never settings.local.json", async () => {
    const { app, fx } = await boot();
    const settings = path.join(fx.repo, ".claude", "settings.json");
    const plan = await post(app, "/api/fix/plan", { id: "f1-cap-tree" });
    expect(plan.status).toBe(200);
    const pj = (await plan.json()) as { diff: string; files: Array<{ file: string; new_file: boolean }>; applied: boolean };
    expect(pj.diff).toContain("CLAUDE_CODE_MAX_CONCURRENT_SUBAGENTS");
    expect(pj.files[0]).toMatchObject({ file: settings, new_file: true });
    expect(pj.applied).toBe(false);
    expect(existsSync(settings)).toBe(false);
    const apply = await post(app, "/api/fix/apply", { id: "f1-cap-tree" });
    expect((await apply.json()) as object).toMatchObject({ applied: true });
    expect(existsSync(settings)).toBe(true);
    expect(existsSync(path.join(fx.repo, ".claude", "settings.local.json"))).toBe(false);
    expect(await (await get(app, "/")).text()).toContain('data-fix="f1-cap-tree" data-applied="1"');
    expect(((await (await post(app, "/api/fix/apply", { id: "f1-cap-tree" })).json()) as { applied: boolean }).applied).toBe(false);
    const undo = await post(app, "/api/fix/undo", { id: "f1-cap-tree" });
    expect(((await undo.json()) as { restored: string[] }).restored).toContain(settings);
    expect(existsSync(settings)).toBe(false);
    expect((await post(app, "/api/fix/plan", { id: "f4-git-ai" })).status).toBe(400);
    expect((await post(app, "/api/fix/plan", { id: "nope" })).status).toBe(404);
  });

  it("redact keeps the title, the branch and the agent type out of the session view", async () => {
    const fx = twoSessionFixture();
    const stateDir = path.join(fx.root, "state");
    const scope: Scope = { ...scopeFor(fx), redact: true };
    await runPipeline(scope, { claudeRoot: fx.claudeRoot, stateDir, now: new Date("2026-09-02T00:00:00Z") });
    const app = await startApp({ scope, stateDir, claudeRoot: fx.claudeRoot, idleExitMs: null });
    apps.push(app);
    const d = (await (await get(app, `/api/session/${fx.sessionId}`)).json()) as { html: string; runs: Array<{ agent_type: string | null }> };
    expect(d.html).not.toContain("general-purpose");
    expect(d.html).not.toContain("Build the thing");
    expect(d.html).not.toContain("kept.md");
    expect(d.html).toContain("session 11111111");
    expect(d.runs[0]?.agent_type).toBeNull();
    const plain = (await (await get(apps[0]!, `/api/session/${fx.sessionId}`)).json()) as { html: string; runs: Array<{ agent_type: string | null }> };
    expect(plain.html).toContain("Build the thing");
    expect(plain.runs[0]?.agent_type).toBe("general-purpose");
  });

  it("exits a while after the last heartbeat", async () => {
    const { app } = await boot({ idleExitMs: 150 });
    expect((await post(app, "/api/ping", {})).status).toBe(200);
    const t0 = Date.now();
    await app.idle;
    expect(Date.now() - t0).toBeGreaterThanOrEqual(100);
    expect(Date.now() - t0).toBeLessThan(5000);
  });
});

describe("project switcher", () => {
  it("opens on all projects when the launch folder has no sessions but the machine has some", async () => {
    const fx = twoSessionFixture();
    // an empty launch folder: a real git-less dir with no sessions of its own
    const empty = path.join(fx.root, "empty"); mkdirSync(empty);
    const emptyScope: Scope = { repoPath: empty, repoId: "empty", originUrl: null, allProjects: false, since: null, tools: ["claude_code"], redact: false, generous: false };
    const stateDir = path.join(fx.root, "state-empty");
    // a full run of the empty folder makes an empty report (zero sessions)
    const res = await runPipeline(emptyScope, { claudeRoot: fx.claudeRoot, stateDir, now: new Date("2026-09-02T00:00:00Z") });
    expect(res.report.sessions).toHaveLength(0);
    const app = await startApp({ scope: emptyScope, stateDir, claudeRoot: fx.claudeRoot, idleExitMs: null, stateDirFor: (id) => path.join(fx.root, "sd-" + id) });
    apps.push(app);
    // the app auto-widened to every project on the machine, so the report is no longer empty
    const cat = (await (await get(app, "/api/sessions")).json()) as { sessions: unknown[]; project: string };
    expect(cat.project).toBe("*");
    expect(cat.sessions.length).toBeGreaterThan(0);
    const page = await (await get(app, "/")).text();
    expect(page).not.toContain("No Claude Code sessions in this folder yet");
  });

  it("lists every project, switches to another project in its own state dir without moving the launch repo's latest, shows every project at once, and refuses an unknown slug", async () => {
    const fx = twoSessionFixture();
    // a second project: another folder with one session of its own, under its own slug
    const other = path.join(fx.root, "other"); mkdirSync(other);
    const THIRD = "33333333-4444-5555-6666-777777777777";
    const src = readFileSync(path.join(fx.claudeRoot, "projects", "-repo", `${fx.sessionId}.jsonl`), "utf8");
    const otherProj = path.join(fx.claudeRoot, "projects", slugFor(other)); mkdirSync(otherProj, { recursive: true });
    writeFileSync(path.join(otherProj, `${THIRD}.jsonl`), src.split(fx.repo).join(other).split(fx.sessionId).join(THIRD).split("Build the thing").join("Other project work"));
    const stateDir = path.join(fx.root, "state");
    await runPipeline(scopeFor(fx), { claudeRoot: fx.claudeRoot, stateDir, now: new Date("2026-09-02T00:00:00Z") });
    const before = latestRunId(stateDir);
    const app = await startApp({ scope: scopeFor(fx), stateDir, claudeRoot: fx.claudeRoot, idleExitMs: null, stateDirFor: (id) => path.join(fx.root, "state-" + id) });
    apps.push(app);

    type Cat = { sessions: Array<{ id: string }>; projects: Array<{ slug: string; sessions: number; label: string }>; project: string };
    const cat = (await (await get(app, "/api/sessions")).json()) as Cat;
    expect(cat.sessions).toHaveLength(2);
    expect(cat.projects.map((p) => p.slug).sort()).toEqual(["-repo", slugFor(other)].sort());
    expect(cat.projects.find((p) => p.slug === "-repo")?.sessions).toBe(2);
    expect(cat.project).toBe("-repo");
    const page = await (await get(app, "/")).text();
    // one segmented control in the top bar, never a hidden dropdown
    expect(page).toMatch(/class="wb-seg" data-project="-repo" aria-pressed="true"/);
    expect(page).toContain('data-project="*"');
    expect(page).toContain('title="2 sessions here"');
    expect(page).toContain('title="3 sessions on this machine"');

    expect((await post(app, "/api/run", { project: slugFor(other) })).status).toBe(200);
    const switched = (await (await get(app, "/api/sessions")).json()) as Cat;
    expect(switched.project).toBe(slugFor(other));
    expect(switched.sessions.map((s) => s.id)).toEqual([THIRD]);
    expect(latestRunId(stateDir)).toBe(before);
    expect(existsSync(path.join(fx.root, "state-" + repoIdFor(other).repoId))).toBe(true);
    expect(app.current().report.sessions[0]?.title).toContain("Other project work");

    expect((await post(app, "/api/run", { project: "*" })).status).toBe(200);
    const every = (await (await get(app, "/api/sessions")).json()) as Cat;
    expect(every.sessions).toHaveLength(3);
    expect(every.project).toBe("*");

    expect((await post(app, "/api/run", { project: "-nope" })).status).toBe(400);

    expect((await post(app, "/api/run", { project: "-repo" })).status).toBe(200);
    const back = (await (await get(app, "/api/sessions")).json()) as Cat;
    expect(back.sessions).toHaveLength(2);
    expect(back.project).toBe("-repo");
  });
});

describe("a redacted app names nothing on the machine", () => {
  it("the fix plan's diff and file names lose the repository path; live rows carry a count of files, never their names", async () => {
    const fx = twoSessionFixture();
    const stateDir = path.join(fx.root, "state");
    await runPipeline({ ...scopeFor(fx), redact: true }, { claudeRoot: fx.claudeRoot, stateDir, now: new Date("2026-09-02T00:00:00Z") });
    // a live run that wrote one file, as the hooks would record it
    record(eventFrom("SubagentStart", { session_id: fx.sessionId, cwd: fx.repo, agent_id: "a-live-1", agent_type: "general-purpose" })!, { stateDir });
    record(eventFrom("PostToolUse", { session_id: fx.sessionId, cwd: fx.repo, tool_name: "Write", tool_use_id: "tu-1", agent_id: "a-live-1", tool_input: { file_path: path.join(fx.repo, "secret-notes.md") } })!, { stateDir });
    const app = await startApp({ scope: { ...scopeFor(fx), redact: true }, stateDir, claudeRoot: fx.claudeRoot, idleExitMs: null });
    apps.push(app);
    const pj = (await (await post(app, "/api/fix/plan", { id: "f1-cap-tree" })).json()) as { diff: string; files: Array<{ file: string }> };
    expect(pj.diff).toContain("CLAUDE_CODE_MAX_CONCURRENT_SUBAGENTS");
    expect(pj.diff).not.toContain(fx.repo);
    expect(pj.diff).toContain("+++ .claude/settings.json");
    expect(pj.files[0]!.file).toBe(".claude/settings.json");
    const live = await (await get(app, "/api/live")).text();
    expect(live).not.toContain("secret-notes.md");
    const snap = JSON.parse(live) as { repo: string; tree: { runs: Array<{ files: string[]; files_hidden?: number }> } | null };
    expect(snap.repo).toBe("(redacted)");
    const runs = snap.tree?.runs ?? [];
    expect(runs.length).toBeGreaterThan(0);
    expect(runs.some((r) => r.files_hidden === 1)).toBe(true);
    expect(runs.every((r) => r.files.length === 0)).toBe(true);
    // the plain app still carries the path, so the switch is doing the work
    const open = await startApp({ scope: scopeFor(fx), stateDir, claudeRoot: fx.claudeRoot, idleExitMs: null });
    apps.push(open);
    expect(await (await get(open, "/api/live")).text()).toContain("secret-notes.md");
  });
});

/**
 * The session view (the Workbench, 2026-09-19): the meta line with its marks, the title, one
 * sentence, "Did it matter?", the tree, and the runs table where a run opens to the files it
 * wrote with tracked, untracked or gone beside each one.
 */
describe("the session view reads without effort", () => {
  const row = {
    id: "S1", tool: "claude_code", date: "2026-08-24", title: "Resume outreach", hours: 3.5, cost_usd: 180, cost_main_usd: 100, cost_agents_usd: 80, cost_mark: "estimated" as const,
    commits: 0, files_written: 12, files_alive: 5, files_tracked: 0, agents: 2, peak_concurrency: 2, max_depth: 1, died: 0,
    outcome: { state: "on disk", note: "5 files alive, none tracked", source: "disk", mark: "measured" as const }, claimed: null,
  };
  const session = { run_id: "r", id: "S1", tool: "claude_code" as const, project_path: "/p", repo_id: "x", source_file: "f", started_at: null, ended_at: null, tool_version: "2.1.241", entrypoint: null, first_prompt: "", title: "Resume outreach", git_branch: "main", models: {}, turns: 1046, usage: { input: 0, output: 0, cache_read: 0, cache_write_5m: 0, cache_write_1h: 0 }, cost_usd: 180, cost_mark: "estimated" as const, bad_lines: 0 };
  const file = (p: string, on_disk: boolean, tracked: boolean): RunFile => ({ path: p, on_disk, tracked });
  const LONG = "/Users/someone/Developer/actuals-v2-wt/reports/2026-09-16-session-report.md";
  const at = (m: number) => `2026-08-24T10:${String(m).padStart(2, "0")}:00.000Z`;
  const detail = {
    session_id: "S1", row, label: null, files: [],
    timeline: { session_id: "S1", date: "2026-08-24", title: "Resume outreach", start: at(0), end: at(40), peak: 2, peak_at: at(10), died: 1, spawned_by_agents: 1,
      runs: [{ id: "r1", start: at(0), end: at(30), depth: 1, fate: "landed_tracked" }, { id: "r2", start: at(10), end: at(40), depth: 2, fate: "died" }] },
    runs: [
      { id: "r1", agent_type: "general-purpose", description: "one", depth: 1, spawned_by: "user", model: "claude-opus-5", started_at: at(0), ended_at: at(30), minutes: 30, cost_usd: 12.5, cost_mark: "estimated", fate: "landed_tracked", fate_evidence: "", files_written: 3,
        files: [file("src/a.ts", true, true), file("src/b.ts", true, false), file(LONG, false, false)] },
      { id: "r2", agent_type: "general-purpose", description: "two", depth: 2, spawned_by: "agent", model: "claude-fable-5", started_at: at(10), ended_at: at(40), minutes: 30, cost_usd: 3, cost_mark: "estimated", fate: "died", fate_evidence: "", files_written: 0, files: [] },
    ],
    html: "",
  };
  const html = renderSessionView(detail as never, session, false);

  it("opens with the meta line, the title and one sentence, every number beside its mark", () => {
    expect(html).toContain('<span>$180 <span class="mark">estimated</span></span>');
    expect(html).toContain('<span class="wb-out" style="color: var(--muted)">on disk</span>');
    expect(html).toContain('<h1 class="wb-stitle">Resume outreach</h1>');
    expect(html).toContain('<p class="wb-sub">5 files on disk, none committed.</p>');
    expect(html).toContain("24 Aug");
    expect(html).toContain("3.5 h");
  });

  it("asks the one question only the user can answer, with the four states and a note", () => {
    expect(html).toContain("Did it matter?");
    for (const st of ["kept", "retired", "dead", "open"]) expect(html).toContain(`data-label="${st}" data-on="0"`);
    expect(html).toContain('placeholder="One line on why"');
    expect(html).toContain('id="wb-lsave" data-session="S1"');
  });

  it("draws the session's agents to time, with the sentence and the depth legend", () => {
    expect(html).toContain("2 agent runs over 40 minutes, 2 at once, 1 died.");
    expect(html).toContain('class="wb-tree-svg"');
    expect(html).toContain("depth 1");
    expect(html).toContain('<i style="background: var(--warn)"></i>died');
  });

  it("lists the runs with the cost column's mark, and names a spawn by its depth", () => {
    expect(html).toContain('<span>cost <span class="mark">estimated</span></span>');
    expect(html).toContain("opus-5");   // the claude- prefix is dropped
    expect(html).toContain("depth 2 · by agent");
    expect(html).toContain('<span class="wb-rn">1</span>');
  });

  it("uses the fate words a developer already knows, coloured, never the retired grey", () => {
    expect(html).toContain(">in git</span>");
    expect(html).toContain(">died</span>");
    expect(html).not.toContain("landed_tracked");
    expect(html).not.toContain("#4B5058");
  });

  it("opens a run to the files it wrote, each with tracked, untracked or gone", () => {
    expect(html).toContain("wrote 3 files · 1 in git today");
    expect(html).toContain('<span class="wb-rf-t">tracked</span>');
    expect(html).toContain('<span class="wb-rf-t">untracked</span>');
    expect(html).toContain('<span class="wb-rf-t">gone</span>');
    // a long path shows its end, never the home directory
    expect(html).toContain("…/reports/2026-09-16-session-report.md");
    expect(html).not.toContain("/Users/someone/Developer");
    expect(html).toContain("wrote no files");
  });

  it("a session with no runs says so instead of drawing an empty chart", () => {
    const bare = renderSessionView({ ...detail, runs: [], timeline: null } as never, session, false);
    expect(bare).toContain("No agents in this session. The main conversation did the work.");
    expect(bare).not.toContain("wb-tree-svg");
  });

  it("a redacted view keeps every row but names nothing on the machine", () => {
    const red = renderSessionView({ ...detail, row: { ...row, title: "session S1" }, runs: detail.runs.map((r) => ({ ...r, agent_type: null, files: r.files.map((f) => ({ ...f, path: "(redacted)" })) })) } as never, session, true);
    expect(red).not.toContain("Resume outreach");
    expect(red).not.toContain("/Users/someone");
    expect(red).toContain("(redacted)");
    expect(red).toContain('value=""'); // the label note is never echoed back
  });
});
