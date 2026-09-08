import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { runPipeline } from "../src/pipeline.js";
import { ReportSchema } from "../src/schema/socket.js";
import { buildTinyFixture } from "../eval/fixtures/tiny.js";

describe("pipeline end to end", () => {
  it("runs on the tiny fixture, writes a valid socket, html, share, ledger, and latest pointer", async () => {
    const fx = buildTinyFixture();
    const stateDir = path.join(fx.root, "state");
    const res = await runPipeline({ repoPath: fx.repo, repoId: "tiny", originUrl: null, allProjects: false, since: null, tools: ["claude_code"], redact: false, generous: false }, { claudeRoot: fx.claudeRoot, stateDir, now: new Date("2026-09-02T00:00:00Z") });
    expect(res.ledger.sessions).toHaveLength(1);
    expect(res.ledger.runs).toHaveLength(1);
    expect(res.ledger.stages.map((s) => s.stage)).toEqual(["read", "live", "normalise", "join", "grade", "report", "render"]);
    const json = JSON.parse(readFileSync(path.join(res.dir, "report.json"), "utf8"));
    expect(ReportSchema.safeParse(json).success).toBe(true);
    expect(json.tokens_spent_making_this).toBe(0);
    expect(json.left_machine).toBe("nothing");
    const html = readFileSync(res.htmlPath, "utf8");
    expect(html).toContain("What left your machine: nothing. Tokens spent making this: 0.");
    expect(html).not.toMatch(/https?:\/\//);
    expect(html).not.toContain("@import");
    expect(html).not.toContain("—");
    for (const f of ["share.svg", "share.txt", "ledger/sessions.ndjson", "ledger/runs.ndjson", "ledger/turns.ndjson", "ledger/claims.ndjson", "ledger/truths.ndjson", "ledger/verdicts.ndjson", "ledger/commits.ndjson", "ledger/stages.ndjson"]) expect(existsSync(path.join(res.dir, f))).toBe(true);
    expect(readFileSync(path.join(stateDir, "latest"), "utf8").trim()).toBe(res.ledger.run_id);
    // share holds no session title or path
    const share = readFileSync(path.join(res.dir, "share.txt"), "utf8") + readFileSync(path.join(res.dir, "share.svg"), "utf8");
    expect(share).not.toContain("Build the thing");
    expect(share).not.toContain(fx.repo);
  });

  it("cli doctor and run work from the command line with overrides", () => {
    const fx = buildTinyFixture();
    execFileSync("git", ["init", "-q"], { cwd: fx.repo });
    const env = { ...process.env, ACTUALS_CLAUDE_DIR: fx.claudeRoot, ACTUALS_STATE_DIR: path.join(fx.root, "state") };
    const doctor = execFileSync("npx", ["tsx", path.join(process.cwd(), "src/cli.ts"), "doctor"], { cwd: fx.repo, env, encoding: "utf8" });
    expect(doctor).toContain("1 sessions match by cwd");
    expect(doctor).toContain("network: none");
    const run = execFileSync("npx", ["tsx", path.join(process.cwd(), "src/cli.ts"), "run", "--no-open"], { cwd: fx.repo, env, encoding: "utf8" });
    expect(run).toContain("ran locally, nothing uploaded");
    expect(run).toContain("report:");
    const weekly = execFileSync("npx", ["tsx", path.join(process.cwd(), "src/cli.ts"), "weekly"], { cwd: fx.repo, env, encoding: "utf8" });
    expect(weekly).toContain("This week:");
  });
});
