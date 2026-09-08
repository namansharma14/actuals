import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { runPipeline } from "../src/pipeline.js";
import { applyWatch, concurrencyCap, eventFrom, hudLine, isWatching, liveEventsPath, planWatch, previousStatusLineOutput, readState, record, unwatch } from "../src/watch/index.js";
import { buildTinyFixture } from "../eval/fixtures/tiny.js";

const CMD = 'node "/opt/actuals/dist/cli.js"';
function tmp(): string { return realpathSync(mkdtempSync(path.join(tmpdir(), "actuals-watch-"))); }

describe("actuals watch: install and remove", () => {
  it("merges the statusline and hooks into the user's settings, keeps the previous statusline, is idempotent, and unwatch restores byte-identical", async () => {
    const claudeRoot = tmp(); const store = path.join(tmp(), "store");
    const settings = path.join(claudeRoot, "settings.json");
    const original = JSON.stringify({ model: "opus", statusLine: { type: "command", command: "echo prev-line" }, hooks: { Stop: [{ hooks: [{ type: "command", command: "echo mine" }] }] } }, null, 2) + "\n";
    writeFileSync(settings, original);
    const plan = planWatch({ hud: true, claudeRoot, command: CMD });
    expect(plan.changes).toHaveLength(1);
    expect(plan.previousStatusLine).toEqual({ type: "command", command: "echo prev-line" });
    applyWatch(plan, store);
    expect(isWatching(store)).toBe(true);
    const next = JSON.parse(readFileSync(settings, "utf8")) as { model: string; statusLine: { command: string }; hooks: Record<string, Array<{ matcher?: string; hooks: Array<{ command: string }> }>> };
    expect(next.model).toBe("opus");
    expect(next.statusLine.command).toBe(`${CMD} hud`);
    expect(next.hooks.Stop![0]!.hooks[0]!.command).toBe("echo mine"); // the user's own hook survives
    expect(next.hooks.Stop![1]!.hooks[0]!.command).toBe(`${CMD} event Stop`);
    expect(next.hooks.PostToolUse![0]!.matcher).toBe("Write|Edit|MultiEdit|NotebookEdit|Bash|Agent");
    for (const ev of ["SessionStart", "PreCompact", "SubagentStart", "SubagentStop", "SessionEnd"]) expect(next.hooks[ev]!.some((e) => e.hooks.some((h) => h.command === `${CMD} event ${ev}`))).toBe(true);
    expect(planWatch({ hud: true, claudeRoot, command: CMD }).changes).toHaveLength(0); // idempotent
    expect(previousStatusLineOutput("{}", store)).toBe("prev-line"); // chained under ours
    const r = await unwatch(store);
    expect(r.restored).toContain(settings);
    expect(readFileSync(settings, "utf8")).toBe(original);
    expect(isWatching(store)).toBe(false);
    expect(existsSync(path.join(store, "previous-statusline.json"))).toBe(false);
  });

  it("re-running watch from a different install path replaces our entries instead of doubling them, and unwatch refuses to discard later edits unless forced", async () => {
    const claudeRoot = tmp(); const store = path.join(tmp(), "store");
    const settings = path.join(claudeRoot, "settings.json");
    writeFileSync(settings, JSON.stringify({ hooks: { Stop: [{ hooks: [{ type: "command", command: "echo mine" }] }] } }, null, 2) + "\n");
    applyWatch(planWatch({ hud: true, claudeRoot, command: CMD }), store);
    const OTHER = 'node "/other/place/dist/cli.js"';
    const again = planWatch({ hud: true, claudeRoot, command: OTHER });
    expect(again.previousStatusLine).toBeNull(); // ours is not "previous"
    const after = JSON.parse(again.changes[0]!.after) as { statusLine: { command: string }; hooks: Record<string, Array<{ hooks: Array<{ command: string }> }>> };
    expect(after.statusLine.command).toBe(`${OTHER} hud`);
    for (const ev of Object.keys(after.hooks)) {
      const ours = after.hooks[ev]!.filter((e) => e.hooks.some((h) => / event \w+$/.test(h.command)));
      expect(ours).toHaveLength(1); expect(ours[0]!.hooks[0]!.command).toBe(`${OTHER} event ${ev}`);
    }
    expect(after.hooks.Stop![0]!.hooks[0]!.command).toBe("echo mine");
    // the user edits settings after watch: unwatch must not throw that away silently
    const edited = JSON.parse(readFileSync(settings, "utf8")) as Record<string, unknown>; edited["permissions"] = { allow: ["Bash(ls)"] };
    writeFileSync(settings, JSON.stringify(edited, null, 2) + "\n");
    const refused = await unwatch(store);
    expect(refused.restored).toHaveLength(0); expect(refused.drifted).toEqual([settings]); expect(refused.notes[0]).toContain("--force");
    expect(JSON.parse(readFileSync(settings, "utf8"))).toHaveProperty("permissions");
    const forced = await unwatch(store, { force: true });
    expect(forced.restored).toEqual([settings]);
    expect(JSON.parse(readFileSync(settings, "utf8"))).not.toHaveProperty("permissions");
  });

  it("--no-hud installs hooks only and leaves an existing statusline untouched", () => {
    const claudeRoot = tmp();
    writeFileSync(path.join(claudeRoot, "settings.json"), JSON.stringify({ statusLine: { type: "command", command: "echo keep" } }) + "\n");
    const plan = planWatch({ hud: false, claudeRoot, command: CMD });
    const after = JSON.parse(plan.changes[0]!.after) as { statusLine: { command: string }; hooks: Record<string, unknown[]> };
    expect(after.statusLine.command).toBe("echo keep");
    expect(Object.keys(after.hooks).sort()).toEqual(["PostToolUse", "PreCompact", "SessionEnd", "SessionStart", "Stop", "SubagentStart", "SubagentStop"]);
  });
});

describe("the live ledger", () => {
  it("records hook and statusline payloads, dedupes unchanged snapshots, counts open agents as died at stop, and the HUD line reads it", () => {
    const stateDir = path.join(tmp(), "state"); const cwd = tmp();
    const base = { session_id: "s-1", cwd, transcript_path: "/x.jsonl", hook_event_name: "x" };
    const t = (m: number) => new Date(Date.UTC(2026, 8, 4, 10, m));
    const ev = (kind: string, extra: Record<string, unknown>, m: number) => { const e = eventFrom(kind, { ...base, ...extra }, t(m)); expect(e).not.toBeNull(); return record(e!, { stateDir }); };
    ev("SessionStart", { source: "startup", model: "claude-opus-5" }, 0);
    ev("SubagentStart", { agent_id: "a1", agent_type: "Explore" }, 1);
    ev("SubagentStart", { agent_id: "a2", agent_type: "general-purpose" }, 1);
    ev("PostToolUse", { tool_name: "Write", tool_use_id: "tu-9", tool_input: { file_path: `${cwd}/new.md`, content: "x" }, tool_response: "ok" }, 2);
    ev("PostToolUse", { tool_name: "Bash", tool_use_id: "tu-10", tool_input: { command: "git commit -m x" }, tool_response: "ok" }, 2);
    ev("PreCompact", { trigger: "auto" }, 3);
    const snap = { model: { id: "claude-opus-5", display_name: "Opus" }, cost: { total_cost_usd: 1.234, total_duration_ms: 1 }, context_window: { total_input_tokens: 10, total_output_tokens: 2, context_window_size: 200000, used_percentage: 40, remaining_percentage: 60, current_usage: { input_tokens: 5, output_tokens: 2, cache_creation_input_tokens: 3, cache_read_input_tokens: 2 } }, rate_limits: { five_hour: { used_percentage: 23.5, resets_at: 1 } } };
    let st = ev("statusline", snap, 4);
    expect(hudLine(st, { cap: 4 }, snap)).toBe("actuals · $1.23 est · ctx 40% · agents 2/4 · 1 compaction · 5h 24%");
    ev("statusline", snap, 4); // unchanged: no second line
    ev("SubagentStop", { agent_id: "a1", agent_type: "Explore" }, 5);
    st = ev("Stop", { stop_hook_active: false }, 6);
    expect(st.died).toBe(0); expect(Object.keys(st.agents_open)).toEqual(["a2"]); // a background agent may outlive the turn
    st = ev("SessionEnd", { reason: "other" }, 7);
    expect(st.died).toBe(1); expect(st.agents_open).toEqual({}); expect(st.agents_started).toBe(2); expect(st.agents_stopped).toBe(1);
    expect(st.compactions).toBe(1); expect(st.writes).toBe(1); expect(st.cost_usd).toBe(1.234); expect(st.context_pct).toBe(40);
    expect(hudLine(st, { cap: 4 }, {})).toContain("1 died");
    expect(hudLine(st, { cap: 4 }, {})).toContain("agents 0/4");
    const lines = readFileSync(liveEventsPath(stateDir), "utf8").trim().split("\n");
    expect(lines).toHaveLength(10); // 6 hooks + 1 snapshot + agent_stop + stop + session_end, the duplicate snapshot dropped
    expect(lines.every((l) => JSON.parse(l).v === 1)).toBe(true);
    expect(readState(stateDir, "s-1")?.died).toBe(1);
    expect(eventFrom("PostToolUse", { cwd, tool_name: "Write" })).toBeNull(); // no session id, nothing to place
    expect(eventFrom("Stop", { session_id: "gone", cwd: "/no/such/dir/anywhere" })?.kind).toBe("stop"); // a vanished cwd still gets an id
  });

  it("reads the concurrency cap from the project, then the user, then the default", () => {
    const repo = tmp(); const claudeRoot = tmp();
    expect(concurrencyCap(repo, claudeRoot)).toEqual({ cap: 20, source: "default" });
    writeFileSync(path.join(claudeRoot, "settings.json"), JSON.stringify({ env: { CLAUDE_CODE_MAX_CONCURRENT_SUBAGENTS: "6" } }));
    expect(concurrencyCap(repo, claudeRoot)).toEqual({ cap: 6, source: "user" });
    mkdirSync(path.join(repo, ".claude")); writeFileSync(path.join(repo, ".claude", "settings.json"), JSON.stringify({ env: { CLAUDE_CODE_MAX_CONCURRENT_SUBAGENTS: "4" } }));
    expect(concurrencyCap(repo, claudeRoot)).toEqual({ cap: 4, source: "project" });
  });

  it("the report merges the live ledger: compaction points on a known session, a live-only session, a live-only write, and the limitations say so", async () => {
    const fx = buildTinyFixture();
    const stateDir = path.join(fx.root, "state");
    const t = (m: number) => new Date(Date.UTC(2026, 8, 1, 10, m));
    const rec = (kind: string, p: Record<string, unknown>, m: number) => record(eventFrom(kind, { cwd: fx.repo, ...p }, t(m))!, { stateDir });
    rec("PreCompact", { session_id: fx.sessionId, trigger: "auto" }, 30);
    rec("PostToolUse", { session_id: fx.sessionId, tool_name: "Write", tool_use_id: "tu_live_only", tool_input: { file_path: path.join(fx.repo, "kept.md") } }, 31);
    rec("PostToolUse", { session_id: fx.sessionId, tool_name: "Write", tool_use_id: "tu_write", tool_input: { file_path: path.join(fx.repo, "kept.md") } }, 32); // already in the transcript: deduped
    rec("SessionStart", { session_id: "gone-0000-1111", source: "startup" }, 40);
    rec("statusline", { session_id: "gone-0000-1111", cost: { total_cost_usd: 2.5 }, model: { id: "claude-sonnet-5" } }, 41);
    rec("SessionEnd", { session_id: "gone-0000-1111", reason: "other" }, 42);
    // the machine running the tests may have watch installed; the test controls that
    const res = await runPipeline({ repoPath: fx.repo, repoId: "tiny", originUrl: null, allProjects: false, since: null, tools: ["claude_code"], redact: false, generous: false }, { claudeRoot: fx.claudeRoot, stateDir, now: new Date("2026-09-02T00:00:00Z"), watchStore: path.join(fx.root, "no-watch-here") });
    expect(res.report.live).toMatchObject({ events: 6, compactions: 1, sessions_live_only: 1 });
    expect(res.report.sessions).toHaveLength(2);
    const known = res.report.sessions.find((s) => s.id === fx.sessionId)!; const gone = res.report.sessions.find((s) => s.id === "gone-0000-1111")!;
    expect(known.source).toBe("transcript"); expect(known.compactions).toBe(1);
    expect(gone.source).toBe("live"); expect(gone.title).toContain("live ledger only"); expect(gone.cost_usd).toBe(2.5);
    expect(res.ledger.claims.filter((c) => c.source === "live").map((c) => c.id)).toEqual(["fw:live:tu_live_only"]);
    expect(res.report.limitations.find((l) => l.startsWith("Compaction:"))).toContain("1 compaction point recorded live");
    expect(res.report.limitations.find((l) => l.startsWith("Transcripts the tool has cleaned up"))).toContain("1 session in this report exist only in the live ledger");
    expect(res.report.method.at(-1)).toContain("actuals watch is off (a live ledger exists from before)");
    const html = readFileSync(res.htmlPath, "utf8");
    expect(html).toContain("6 live events"); expect(html).toContain("1 compaction recorded live");
    expect(html).not.toContain("—");
  });

  it("the hud and event commands work from the command line on stdin and never fail", () => {
    const stateRoot = path.join(tmp(), "actuals-state"); const cwd = tmp();
    const env = { ...process.env, ACTUALS_STATE_DIR: stateRoot, ACTUALS_CLAUDE_DIR: tmp() };
    const cli = [path.join(process.cwd(), "src/cli.ts")];
    const payload = JSON.stringify({ session_id: "cli-1", cwd, model: { id: "claude-opus-5" }, cost: { total_cost_usd: 0.5 }, context_window: { used_percentage: 12, context_window_size: 200000 } });
    execFileSync("npx", ["tsx", ...cli, "event", "SubagentStart"], { cwd, env, input: JSON.stringify({ session_id: "cli-1", cwd, agent_id: "z", agent_type: "Plan" }), encoding: "utf8" });
    const out = execFileSync("npx", ["tsx", ...cli, "hud"], { cwd, env, input: payload, encoding: "utf8" });
    expect(out.trim()).toBe("actuals · $0.50 est · ctx 12% · agents 1/20");
    expect(execFileSync("npx", ["tsx", ...cli, "event", "Nonsense"], { cwd, env, input: "not json", encoding: "utf8" })).toBe("");
    expect(execFileSync("npx", ["tsx", ...cli, "hud"], { cwd, env, input: "", encoding: "utf8" }).trim()).toBe("actuals · cost n/a · agents 0/20");
  });
});

describe("the HUD window", () => {
  it("binds loopback, serves the page and the live snapshot with a token, refuses a foreign host and a missing token", async () => {
    const { startHudServer, hudSnapshot } = await import("../src/watch/hud-server.js");
    const { record } = await import("../src/watch/index.js");
    const { mkdtempSync } = await import("node:fs");
    const os = await import("node:os");
    const pathm = await import("node:path");
    const stateDir = mkdtempSync(pathm.join(os.tmpdir(), "actuals-hud-"));
    const { eventFrom } = await import("../src/watch/index.js");
    const nowIso = new Date().toISOString();
    // one live session with an open agent, written through the real event path
    const e1 = eventFrom("SessionStart", { session_id: "hud-sess-1", cwd: "/tmp/r1", model: "claude-opus-5" }, new Date(nowIso));
    if (e1) record(e1, { stateDir });
    const e2 = eventFrom("SubagentStart", { session_id: "hud-sess-1", cwd: "/tmp/r1", agent_id: "a1", agent_type: "general-purpose" }, new Date(nowIso));
    if (e2) record(e2, { stateDir });

    const snap = await hudSnapshot(stateDir, "/tmp/r1", true, stateDir, Date.parse(nowIso) + 1000);
    expect(snap.watching).toBe(true);
    expect(snap.rows.length).toBe(1);
    expect(snap.rows[0]!.session_id).toBe("hud-sess-1");
    expect(snap.rows[0]!.agents_open).toBe(1);
    expect(snap.rows[0]!.cap).toBeGreaterThan(0);

    const server = await startHudServer({ stateDir, repoPath: "/tmp/r1", watching: true });
    try {
      expect(server.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/$/);
      expect(server.address).toBe("127.0.0.1");
      const page = await (await fetch(server.url)).text();
      expect(page).toContain("Actuals HUD");
      expect(page).toContain(server.token);
      expect(page).not.toContain("—");

      const good = await fetch(server.url + "hud.json", { headers: { "x-actuals-token": server.token } });
      expect(good.status).toBe(200);
      const body = (await good.json()) as { watching: boolean; rows: unknown[] };
      expect(body.watching).toBe(true);
      expect(body.rows.length).toBe(1);

      const noToken = await fetch(server.url + "hud.json");
      expect(noToken.status).toBe(401);

      // fetch refuses to set a spoofed Host, so use raw http to actually send a foreign one
      const http = await import("node:http");
      const foreignStatus = await new Promise<number>((resolve, reject) => {
        const rq = http.request({ host: "127.0.0.1", port: server.port, path: "/hud.json", method: "GET", headers: { host: "evil.example.com", "x-actuals-token": server.token } }, (r) => { r.resume(); resolve(r.statusCode ?? 0); });
        rq.on("error", reject); rq.end();
      });
      expect(foreignStatus).toBe(403);
    } finally {
      await server.close();
    }
  });
});

describe("transcript pricing for the HUD", () => {
  it("prices a transcript once per request (dedupes repeated requestIds) and the HUD fills a null live cost from it", async () => {
    const { costOfTranscript, slugFor } = await import("../src/read/claude_code/index.js");
    const { startHudServer } = await import("../src/watch/hud-server.js");
    const { record, eventFrom } = await import("../src/watch/index.js");
    const { mkdtempSync, mkdirSync, writeFileSync } = await import("node:fs");
    const os = await import("node:os");
    const pathm = await import("node:path");

    const root = mkdtempSync(pathm.join(os.tmpdir(), "actuals-tcost-"));
    const cwd = pathm.join(root, "repo");
    const claudeRoot = pathm.join(root, "claude");
    const proj = pathm.join(claudeRoot, "projects", slugFor(cwd));
    mkdirSync(proj, { recursive: true });
    const sid = "cost-sess-1";
    const asst = (req: string) => JSON.stringify({ type: "assistant", requestId: req, timestamp: "2026-09-01T10:00:00.000Z", message: { id: "m_" + req, model: "claude-opus-5", usage: { input_tokens: 0, output_tokens: 1_000_000, cache_read_input_tokens: 0 }, content: [{ type: "text", text: "x" }] } });
    // req1 twice (must count once) + req2 once => two priced requests
    writeFileSync(pathm.join(proj, `${sid}.jsonl`), [asst("req1"), asst("req1"), asst("req2")].join("\n") + "\n");

    const one = await costOfTranscript(pathm.join(proj, `${sid}.jsonl`));
    expect(one).toBeGreaterThan(0);
    // dedupe: three lines, two distinct requests, so cost is exactly twice a single request
    writeFileSync(pathm.join(proj, "single.jsonl"), asst("only") + "\n");
    const single = await costOfTranscript(pathm.join(proj, "single.jsonl"));
    expect(Math.abs(one - 2 * single)).toBeLessThan(1e-9);

    // the HUD fills the null live cost from the transcript
    const stateDir = pathm.join(root, "state");
    const e = eventFrom("SessionStart", { session_id: sid, cwd }, new Date());
    if (e) record(e, { stateDir });
    const server = await startHudServer({ stateDir, repoPath: cwd, watching: true, claudeRoot });
    try {
      const snap = (await (await fetch(server.url + "hud.json", { headers: { "x-actuals-token": server.token } })).json()) as { rows: Array<{ session_id: string; cost_usd: number | null }> };
      const row = snap.rows.find((r) => r.session_id === sid);
      expect(row?.cost_usd).toBeCloseTo(one, 6);
    } finally {
      await server.close();
    }
  });
});
