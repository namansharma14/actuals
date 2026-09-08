import path from "node:path";
import { describe, expect, it } from "vitest";
import { buildTinyFixture } from "../eval/fixtures/tiny.js";
import { runPipeline } from "../src/pipeline.js";
import { eventFrom, record } from "../src/watch/index.js";
import type { Scope } from "../src/config.js";

/**
 * Claude Code hands us one cost figure: cost.total_cost_usd on the statusline payload, which
 * watch records into the live state. When a session has one, the report uses it as that
 * session's cost and marks it measured; the token estimate stays for the breakdown.
 */
describe("the statusline's cost reaches the report through watch", () => {
  it("a session with a recorded total_cost_usd is measured; the rest stay priced at list rates", async () => {
    const fx = buildTinyFixture();
    const scope: Scope = { repoPath: fx.repo, repoId: "tiny", originUrl: null, allProjects: false, since: null, tools: ["claude_code"], redact: false, generous: false };
    const stateDir = path.join(fx.root, "state");
    const ev = eventFrom("statusline", { session_id: fx.sessionId, cwd: fx.repo, model: { id: "claude-opus-5" }, cost: { total_cost_usd: 3.5 } }, new Date("2026-09-01T10:00:00Z"));
    expect(ev).not.toBeNull();
    record(ev!, { stateDir });
    const { report } = await runPipeline(scope, { claudeRoot: fx.claudeRoot, stateDir, now: new Date("2026-09-02T00:00:00Z") });
    const s = report.sessions.find((x) => x.id === fx.sessionId)!;
    expect(s.cost_usd).toBe(3.5);
    expect(s.cost_mark).toBe("measured");
    expect(report.headline.cost_sessions!.measured).toBe(1);
    expect(report.headline.cost_sessions!.priced).toBe(report.sessions.length - 1);
  });
});
