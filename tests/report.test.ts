import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { buildTinyFixture } from "../eval/fixtures/tiny.js";
import { buildReport } from "../src/report/index.js";
import { emptyLedger, type Run, type Session } from "../src/schema/ledger.js";
import type { Scope } from "../src/config.js";

const scope: Scope = { repoPath: "/tmp/nowhere-actuals-test", repoId: "t", originUrl: null, allProjects: false, since: null, tools: ["claude_code"], redact: true, generous: false };
const usage = { input: 1, output: 1, cache_read: 0, cache_write_5m: 0, cache_write_1h: 0 };
function session(id: string, day: string): Session {
  return { run_id: "r", id, tool: "claude_code", project_path: scope.repoPath, repo_id: "t", source_file: "", started_at: `${day}T10:00:00.000Z`, ended_at: `${day}T12:00:00.000Z`, tool_version: "2.1.241", entrypoint: null, first_prompt: "", title: id, git_branch: null, models: {}, turns: 1, usage, cost_usd: 1, cost_mark: "estimated", bad_lines: 0 };
}
function run(id: string, sid: string, day: string, startMin: number, endMin: number, depth: number, fate: Run["fate"]): Run {
  const t = (m: number) => `${day}T10:${String(m).padStart(2, "0")}:00.000Z`;
  return { run_id: "r", id, session_id: sid, parent_run_id: null, depth, spawned_by: "user", agent_type: "x", description: id, model: "claude-opus-5", source_file: null, started_at: t(startMin), ended_at: t(endMin), turns: 1, usage, cost_usd: 1, cost_mark: "estimated", final_text_chars: 400, final_text_sample: "", files_written: [], spawned: 0, last_tool_call_unanswered: fate === "died", fate, fate_evidence: "" };
}

describe("--redact reaches the socket, not only the page", () => {
  it("strips the /insights goal text from report.json while keeping the outcome category", () => {
    const fx = buildTinyFixture();
    const facets = path.join(fx.claudeRoot, "usage-data", "facets"); mkdirSync(facets, { recursive: true });
    writeFileSync(path.join(facets, `${fx.sessionId}.json`), JSON.stringify({ outcome: "mostly_achieved", underlying_goal: "Ship the secret Acme billing rewrite before the board meeting" }));
    const led = emptyLedger("r");
    led.sessions = [{ ...session(fx.sessionId, "2026-09-01"), title: "Ship the secret Acme billing rewrite" }];
    led.labels = [{ target: fx.sessionId, target_kind: "session", state: "kept", note: "see /Users/demo/secret/apikeys.ts and the Acme deal", ts: "2026-09-02T00:00:00.000Z" }];
    const plain = buildReport(led, { ...scope, redact: false }, { generatedAt: new Date("2026-09-03T00:00:00Z"), versions: [], claudeRoot: fx.claudeRoot, redact: false });
    const redacted = buildReport(led, { ...scope, redact: true }, { generatedAt: new Date("2026-09-03T00:00:00Z"), versions: [], claudeRoot: fx.claudeRoot, redact: true });
    expect(plain.sessions[0]!.claimed?.goal).toContain("Acme");
    expect(redacted.sessions[0]!.claimed?.goal).toBe("");
    expect(redacted.sessions[0]!.claimed?.outcome).toBe("mostly achieved");
    expect(plain.sessions[0]!.outcome.note).toContain("apikeys");
    expect(redacted.sessions[0]!.outcome).toMatchObject({ state: "kept", note: "", mark: "founder-labelled" });
    expect(JSON.stringify(redacted)).not.toContain("apikeys");
    expect(JSON.stringify(redacted)).not.toContain("Acme");
    expect(JSON.stringify(redacted)).not.toContain(scope.repoPath);
  });
});

describe("F1 derives both caps from one clean session", () => {
  it("does not pair a peak from one session with a depth from another", () => {
    const led = emptyLedger("r");
    led.sessions = [session("A", "2026-08-09"), session("B", "2026-08-10"), session("C", "2026-08-31")];
    // A: 8 overlapping runs at depth 2, none died. B: 6 overlapping runs, one at depth 3, none died. C: 20 overlapping, 3 died.
    for (let i = 0; i < 8; i++) led.runs.push(run(`a${i}`, "A", "2026-08-09", 0, 30, i === 0 ? 2 : 1, "finished_unlanded"));
    for (let i = 0; i < 6; i++) led.runs.push(run(`b${i}`, "B", "2026-08-10", 0, 30, i === 0 ? 3 : 1, "finished_unlanded"));
    for (let i = 0; i < 20; i++) led.runs.push(run(`c${i}`, "C", "2026-08-31", 0, 30, 3, i < 3 ? "died" : "finished_unlanded"));
    const rep = buildReport(led, scope, { generatedAt: new Date("2026-09-03T00:00:00Z"), versions: ["2.1.241"], claudeRoot: "/tmp/nowhere-claude", redact: true });
    const f1 = rep.fixes.find((f) => f.id === "f1-cap-tree")!;
    const env = (JSON.parse(f1.snippet) as { env: Record<string, string> }).env;
    expect(env.CLAUDE_CODE_MAX_CONCURRENT_SUBAGENTS).toBe("8");
    expect(env.CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH).toBe("2"); // A's depth, not B's 3
    expect(f1.why).toContain("2026-08-09");
    expect(f1.would_have_blocked).toBe("would have held 12 of the 20 concurrent spawns on 2026-08-31");
  });
});

describe("a session's cost measured by Claude Code (the statusline's total_cost_usd through watch)", () => {
  const led = emptyLedger("r");
  led.sessions = [{ ...session("s-live", "2026-09-01"), cost_live_usd: 4.2 }, session("s-priced", "2026-09-01")];
  led.runs = [run("a1", "s-live", "2026-09-01", 0, 10, 1, "finished_unlanded"), run("a2", "s-priced", "2026-09-01", 0, 10, 1, "finished_unlanded")];
  const rep = buildReport(led, scope, { generatedAt: new Date("2026-09-03T00:00:00Z"), versions: [], claudeRoot: "/tmp/nowhere-claude", redact: true });
  it("takes the live figure as the session's cost, marked measured, and keeps the estimate for the breakdown", () => {
    const live = rep.sessions.find((s) => s.id === "s-live")!;
    expect(live.cost_usd).toBe(4.2);
    expect(live.cost_mark).toBe("measured");
    expect(live.cost_main_usd + live.cost_agents_usd).toBe(2);
    const priced = rep.sessions.find((s) => s.id === "s-priced")!;
    expect(priced.cost_usd).toBe(2);
    expect(priced.cost_mark).toBe("estimated");
  });
  it("the headline sums the two kinds, stays estimated while any session is priced, and says how many were measured", () => {
    expect(rep.headline.cost_usd.value).toBe(6.2);
    expect(rep.headline.cost_usd.mark).toBe("estimated");
    expect(rep.headline.cost_sessions).toEqual({ measured: 1, priced: 1 });
  });
  it("is measured only when every session is", () => {
    const all = emptyLedger("r");
    all.sessions = [{ ...session("s1", "2026-09-01"), cost_live_usd: 1.5 }, { ...session("s2", "2026-09-01"), cost_live_usd: 2 }];
    const r2 = buildReport(all, scope, { generatedAt: new Date("2026-09-03T00:00:00Z"), versions: [], claudeRoot: "/tmp/nowhere-claude", redact: true });
    expect(r2.headline.cost_usd.mark).toBe("measured");
    expect(r2.headline.cost_usd.value).toBe(3.5);
    expect(r2.headline.cost_sessions).toEqual({ measured: 2, priced: 0 });
  });
  it("a model that spent and landed nothing reads 0 kept per dollar, not null", () => {
    const m = rep.models.find((x) => x.model === "claude-opus-5")!;
    expect(m.kept_per_usd).toBe(0);
  });
});
