import { describe, expect, it } from "vitest";
import { read } from "../src/read/claude_code/index.js";
import { grade } from "../src/grade/index.js";
import { emptyLedger } from "../src/schema/ledger.js";
import type { Scope } from "../src/config.js";

import { buildTinyFixture as buildFixture } from "../eval/fixtures/tiny.js";

describe("claude code reader", () => {
  it("counts usage once per request, joins subagents, detects died, warns on drift", async () => {
    const { claudeRoot, repo, sessionId } = buildFixture({ subagentVersion: "9.9.9" });
    const scope: Scope = { repoPath: repo, repoId: "test", originUrl: null, allProjects: false, since: null, tools: ["claude_code"], redact: false, generous: false };
    const out = await read(scope, "run1", "test", claudeRoot);
    expect(out.sessions).toHaveLength(1);
    const s = out.sessions[0]!;
    expect(s.id).toBe(sessionId);
    expect(s.turns).toBe(5); // 5 requests, not 7 lines
    expect(s.usage.output).toBe(500);
    expect(s.usage.cache_write_5m).toBe(200 * 5);
    expect(s.usage.cache_write_1h).toBe(300 * 5);
    expect(s.title).toBe("Build the thing (title)");
    expect(s.first_prompt).toBe("Build the thing");
    expect(s.bad_lines).toBe(1);
    expect(s.cost_mark).toBe("assumed"); // claude-zeta-9 fell back to a family rate
    expect(out.runs).toHaveLength(1);
    const r = out.runs[0]!;
    expect(r.parent_run_id).toBeNull();
    expect(r.depth).toBe(1);
    expect(r.description).toBe("Research X");
    expect(r.model).toBe("claude-sonnet-5");
    expect(r.last_tool_call_unanswered).toBe(true);
    expect(out.claims.filter((c) => c.kind === "file_written")).toHaveLength(1);
    expect(out.claims.filter((c) => c.kind === "commit_made")).toHaveLength(1);
    expect(out.tool_calls.filter((t) => t.kind === "read")).toHaveLength(2);
    expect(out.warnings.some((w) => w.includes("schema drift") && w.includes("9.9.9"))).toBe(true);
    // grade: the subagent died
    const ledger = emptyLedger("run1");
    ledger.sessions = out.sessions; ledger.runs = out.runs; ledger.claims = out.claims; ledger.tool_calls = out.tool_calls;
    const g = grade(ledger, new Date("2026-09-02T00:00:00Z"));
    expect(g.runs[0]!.fate).toBe("died");
  });

  it("scopes by cwd, not by directory name", async () => {
    const { claudeRoot } = buildFixture();
    const scope: Scope = { repoPath: "/somewhere/else", repoId: "x", originUrl: null, allProjects: false, since: null, tools: ["claude_code"], redact: false, generous: false };
    const out = await read(scope, "run2", "x", claudeRoot);
    expect(out.sessions).toHaveLength(0);
    const all = await read({ ...scope, allProjects: true }, "run3", "x", claudeRoot);
    expect(all.sessions).toHaveLength(1);
  });
});
