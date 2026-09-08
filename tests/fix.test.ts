import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { applyFixes, planFixes, undoFix } from "../src/fix/index.js";
import { grade } from "../src/grade/index.js";
import { join } from "../src/join/index.js";
import { read } from "../src/read/claude_code/index.js";
import { buildReport } from "../src/report/index.js";
import { emptyLedger } from "../src/schema/ledger.js";
import { buildTinyFixture } from "../eval/fixtures/tiny.js";
import type { Scope } from "../src/config.js";

async function reportFor() {
  const fx = buildTinyFixture();
  const scope: Scope = { repoPath: fx.repo, repoId: "tiny", originUrl: null, allProjects: false, since: null, tools: ["claude_code"], redact: false, generous: false };
  const led = emptyLedger("t");
  const r = await read(scope, "t", "tiny", fx.claudeRoot);
  led.sessions = r.sessions; led.runs = r.runs; led.turns = r.turns; led.tool_calls = r.tool_calls; led.claims = r.claims;
  const j = join(led, scope); led.commits = j.commits; led.truths = j.truths;
  const g = grade(led, new Date("2026-09-02T00:00:00Z")); led.runs = g.runs; led.verdicts = g.verdicts;
  return { fx, report: buildReport(led, scope, { generatedAt: new Date("2026-09-02T00:00:00Z"), versions: r.versions, claudeRoot: fx.claudeRoot, redact: false }) };
}

describe("fixer", () => {
  it("derives F1 and F2 from the numbers, applies with merge, is idempotent, and undoes byte-identical", async () => {
    const { fx, report } = await reportFor();
    expect(report.fixes.find((f) => f.id === "f1-cap-tree")?.available).toBe(true);
    const settings = path.join(fx.repo, ".claude", "settings.json");
    mkdirSync(path.dirname(settings), { recursive: true });
    const original = JSON.stringify({ model: "fable", env: { KEEP_ME: "1" } }, null, 2) + "\n";
    writeFileSync(settings, original);
    const claudeMd = path.join(fx.repo, "CLAUDE.md");
    writeFileSync(claudeMd, "# CLAUDE.md\n\nexisting rule\n");
    const stateDir = path.join(fx.root, "state");
    const plans = planFixes(report, fx.repo);
    expect(plans.get("f1-cap-tree")?.length).toBe(1);
    const r1 = await applyFixes(report, fx.repo, stateDir, { dryRun: false, yes: true });
    expect(r1.applied).toContain("f1-cap-tree");
    const merged = JSON.parse(readFileSync(settings, "utf8")) as { model: string; env: Record<string, string>; hooks?: unknown };
    expect(merged.model).toBe("fable");
    expect(merged.env.KEEP_ME).toBe("1");
    expect(merged.env.CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH).toBeDefined();
    if (r1.applied.includes("f2-reports-land")) {
      expect(readFileSync(claudeMd, "utf8")).toContain("existing rule");
      expect(readFileSync(claudeMd, "utf8")).toContain("fix f2-reports-land");
      expect(existsSync(path.join(fx.repo, ".claude/hooks/actuals-report-landed.mjs"))).toBe(true);
      expect(JSON.stringify(merged.hooks)).toContain("actuals-report-landed");
    }
    // idempotent
    const r2 = await applyFixes(report, fx.repo, stateDir, { dryRun: false, yes: true });
    expect(r2.applied).toHaveLength(0);
    // undo restores byte-identical
    const u = await undoFix("f1-cap-tree", fx.repo, stateDir);
    expect(u.restored).toContain(settings);
    // f2 may also have touched settings; undo it too, then compare
    if (r1.applied.includes("f2-reports-land")) await undoFix("f2-reports-land", fx.repo, stateDir);
    expect(readFileSync(settings, "utf8")).toBe(original);
    expect(existsSync(path.join(fx.repo, ".claude/hooks/actuals-report-landed.mjs"))).toBe(false);
    expect(readFileSync(claudeMd, "utf8")).toBe("# CLAUDE.md\n\nexisting rule\n");
  });

  it("undo refuses when the file changed after the fix, and restores when forced", async () => {
    const { fx, report } = await reportFor();
    const stateDir = path.join(fx.root, "state");
    const settings = path.join(fx.repo, ".claude", "settings.json");
    await applyFixes(report, fx.repo, stateDir, { dryRun: false, yes: true });
    const written = readFileSync(settings, "utf8");
    writeFileSync(settings, written.replace(/\}\s*$/, ',\n  "model": "haiku"\n}\n'));
    const refused = await undoFix("f1-cap-tree", fx.repo, stateDir);
    expect(refused.restored).toHaveLength(0);
    expect(refused.drifted).toEqual([settings]);
    expect(refused.notes[0]).toContain("changed since the fix wrote it");
    expect(readFileSync(settings, "utf8")).toContain("haiku"); // untouched
    const forced = await undoFix("f1-cap-tree", fx.repo, stateDir, { force: true });
    expect(forced.restored).toContain(settings);
    if (existsSync(settings)) expect(readFileSync(settings, "utf8")).not.toContain("CLAUDE_CODE_MAX_CONCURRENT_SUBAGENTS");
  });

  it("never plans a change to settings.local.json and dry-run writes nothing", async () => {
    const { fx, report } = await reportFor();
    const stateDir = path.join(fx.root, "state");
    const r = await applyFixes(report, fx.repo, stateDir, { dryRun: true, yes: true });
    expect(r.applied).toHaveLength(0);
    expect(existsSync(path.join(fx.repo, ".claude", "settings.json"))).toBe(false);
    expect(existsSync(path.join(fx.repo, ".claude", "settings.local.json"))).toBe(false);
  });
});
