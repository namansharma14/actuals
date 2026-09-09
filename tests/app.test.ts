import http from "node:http";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { startApp, type App } from "../src/app/server.js";
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
    expect(page.replace(/<a class="btn" id="stk-x" href="[^"]*"/, "").replace(/http%3A%2F%2Fwww\.w3\.org%2F2000%2Fsvg|http:\/\/www\.w3\.org\/2000\/svg/g, "").toLowerCase()).not.toContain("http");
    expect(page).toContain('<canvas id="sticker"');
    expect(page).not.toContain("—");
    expect(page).toContain('id="picker"');
    expect(page).toContain('id="drawer"');
    expect(page).toContain('data-fix="f1-cap-tree"');
    const rep = await (await get(app, "/api/report")).json();
    expect(ReportSchema.safeParse(rep).success).toBe(true);
    const cat = (await (await get(app, "/api/sessions")).json()) as { sessions: unknown[]; scope: { sessionIds: null } };
    expect(cat.sessions).toHaveLength(2);
    expect(cat.scope.sessionIds).toBeNull();
  });

  it("the drawer shows files with fate, runs, the timeline, and the label control; the instrument re-renders for any session", async () => {
    const { app, fx } = await boot();
    const r = await get(app, `/api/session/${fx.sessionId}`);
    expect(r.status).toBe(200);
    const d = (await r.json()) as { files: Array<{ path: string; on_disk: boolean; tracked: boolean | null; verdict: string }>; runs: unknown[]; commits: unknown[]; timeline: { peak: number } | null; html: string };
    expect(d.files.map((f) => f.path)).toContain("kept.md");
    expect(d.files.find((f) => f.path === "kept.md")?.on_disk).toBe(true);
    expect(d.runs).toHaveLength(1);
    expect(d.timeline?.peak).toBe(1);
    expect(d.html).toContain('id="lbl-save"');
    expect(d.html).toContain("kept.md");
    expect(d.html).toContain(">measured<");
    expect(d.html).not.toContain("—");
    const inst = await get(app, `/api/session/${SECOND}/instrument`);
    expect(inst.status).toBe(200);
    const j = (await inst.json()) as { html: string; session_id: string };
    expect(j.session_id).toBe(SECOND);
    expect(j.html).toContain("<svg");
    expect(j.html).toContain("another session, drawn to time");
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
    expect(page).toContain("scoped to 1 of 2 sessions");
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

  it("redact keeps the branch and the agent type out of the drawer", async () => {
    const fx = twoSessionFixture();
    const stateDir = path.join(fx.root, "state");
    const scope: Scope = { ...scopeFor(fx), redact: true };
    await runPipeline(scope, { claudeRoot: fx.claudeRoot, stateDir, now: new Date("2026-09-02T00:00:00Z") });
    const app = await startApp({ scope, stateDir, claudeRoot: fx.claudeRoot, idleExitMs: null });
    apps.push(app);
    const d = (await (await get(app, `/api/session/${fx.sessionId}`)).json()) as { html: string; runs: Array<{ agent_type: string | null }> };
    expect(d.html).not.toContain("general-purpose");
    expect(d.html).not.toContain("· main");
    expect(d.html).not.toContain("kept.md");
    expect(d.runs[0]?.agent_type).toBeNull();
    const plain = (await (await get(apps[0]!, `/api/session/${fx.sessionId}`)).json()) as { html: string };
    expect(plain.html).toContain("general-purpose");
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
    // two plain visible tabs, never a hidden dropdown
    expect(page).toContain('class="pk-tab"');
    expect(page).toContain("This repository · 2 sessions");
    expect(page).toContain("Every project · 3 sessions");

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
