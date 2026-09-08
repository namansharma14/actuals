import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { planFixes } from "../src/fix/index.js";
import type { Report } from "../src/schema/socket.js";

function hookFor(): { cwd: string; hook: string } {
  const cwd = realpathSync(mkdtempSync(path.join(tmpdir(), "actuals-hook-")));
  const report = { fixes: [{ id: "f2-reports-land", kind: "claude_md_rule_and_hook", title: "", why: "", target_file: "CLAUDE.md", snippet: "", would_have_blocked: null, available: true }] } as unknown as Report;
  const plans = planFixes(report, cwd);
  const hookChange = plans.get("f2-reports-land")!.find((c) => c.file.endsWith(".mjs"))!;
  mkdirSync(path.dirname(hookChange.file), { recursive: true });
  writeFileSync(hookChange.file, hookChange.after);
  return { cwd, hook: hookChange.file };
}

function runHook(hook: string, payload: object): { status: number | null; stderr: string } {
  const r = spawnSync(process.execPath, [hook], { input: JSON.stringify(payload), encoding: "utf8" });
  return { status: r.status, stderr: r.stderr };
}

describe("f2 SubagentStop hook", () => {
  it("parses, allows a report written by any tool, allows a Write to reports/, blocks otherwise", () => {
    const { cwd, hook } = hookFor();
    execFileSync(process.execPath, ["--check", hook]);
    const transcript = path.join(cwd, "agent.jsonl");
    writeFileSync(transcript, JSON.stringify({ type: "user", timestamp: "2026-09-01T10:00:00.000Z", message: { content: "go" } }) + "\n");
    // nothing landed → block
    expect(runHook(hook, { cwd, agent_transcript_path: transcript, stop_hook_active: false }).status).toBe(2);
    // stop_hook_active → never loop
    expect(runHook(hook, { cwd, agent_transcript_path: transcript, stop_hook_active: true }).status).toBe(0);
    // a file under reports/ written by any means (shell heredoc, Write, anything) → allow
    mkdirSync(path.join(cwd, "reports"), { recursive: true });
    writeFileSync(path.join(cwd, "reports", "2026-09-03-thing.md"), "# report\n");
    expect(runHook(hook, { cwd, agent_transcript_path: transcript, stop_hook_active: false }).status).toBe(0);
    // no file on disk, but the transcript shows a Write into reports/ → allow (secondary signal)
    const cwd2 = realpathSync(mkdtempSync(path.join(tmpdir(), "actuals-hook2-")));
    const t2 = path.join(cwd2, "agent.jsonl");
    writeFileSync(t2, JSON.stringify({ type: "assistant", timestamp: "2026-09-01T10:00:00.000Z", message: { content: [{ type: "tool_use", name: "Write", input: { file_path: `${cwd2}/reports/x.md` } }] } }) + "\n");
    expect(runHook(hook, { cwd: cwd2, agent_transcript_path: t2, stop_hook_active: false }).status).toBe(0);
    const blocked = runHook(hook, { cwd: cwd2, agent_transcript_path: transcript, stop_hook_active: false });
    expect(blocked.status).toBe(2);
    expect(blocked.stderr).toContain("No file, no report");
  });
});
