import { describe, it, expect, afterAll } from "vitest";
import { mkdtempSync, rmSync, readdirSync, statSync, readFileSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { execFileSync } from "node:child_process";
import { generate, type GroundTruth } from "../eval/generate.js";

const tmpDirs: string[] = [];
function mkTmp(): string {
  const d = mkdtempSync(path.join(os.tmpdir(), "actuals-v2-gen-"));
  tmpDirs.push(d);
  return d;
}
afterAll(() => {
  for (const d of tmpDirs) rmSync(d, { recursive: true, force: true });
});

/** Recursively snapshot every file under `dir`, skipping `.git` (its index/reflog embed
 * real filesystem stat time and are not a function of generator inputs alone; the git
 * *content* — commit shas, dates, subjects, tree — is asserted separately via `git log`). */
function snapshot(dir: string): Map<string, Buffer> {
  const out = new Map<string, Buffer>();
  const walk = (d: string) => {
    for (const entry of readdirSync(d)) {
      if (entry === ".git") continue;
      const p = path.join(d, entry);
      const st = statSync(p);
      if (st.isDirectory()) walk(p);
      else out.set(path.relative(dir, p), readFileSync(p));
    }
  };
  walk(dir);
  return out;
}

const EXPECTED_CASES = [
  "tree_depth3", "spawn_depth2", "spawn_depth3", "peak_concurrency",
  "died_run", "still_running",
  "landed_tracked", "landed_untracked", "finished_unlanded", "unknown_fate",
  "sidechain", "cwd_change",
  "unknown_model", "bedrock_model",
  "usage_split_present", "usage_split_absent",
  "zero_turns", "re_reads", "first_message_tool_result",
  "malformed_lines", "malformed_lines_subagent", "is_meta_line", "non_message_line_types",
  "commit_inside_attributed", "commit_inside_unattributed", "commit_outside", "commit_revert",
];

describe("eval/generate.ts", () => {
  it("is deterministic: two runs into the same directory produce identical bytes", async () => {
    const dir = mkTmp();
    const gt1 = await generate({ out: dir, seed: 1, sessions: 12 });
    const snap1 = snapshot(dir);
    const gt2 = await generate({ out: dir, seed: 1, sessions: 12 });
    const snap2 = snapshot(dir);

    expect(gt2).toEqual(gt1);
    expect(snap2.size).toBe(snap1.size);
    for (const [file, buf1] of snap1) {
      const buf2 = snap2.get(file);
      expect(buf2, `missing on second run: ${file}`).toBeDefined();
      expect(buf2!.equals(buf1), `byte mismatch: ${file}`).toBe(true);
    }
  });

  it("is deterministic across two separate output directories, modulo the embedded out-path", async () => {
    const dirA = mkTmp();
    const dirB = mkTmp();
    const gtA = await generate({ out: dirA, seed: 1, sessions: 12 });
    const gtB = await generate({ out: dirB, seed: 1, sessions: 12 });
    // Same seed -> same structure: same session/run/commit counts, same cases, same fates.
    // `files_written` embeds the (different) out-dir absolute path, so compare runs without it.
    const stripRuns = (runs: GroundTruth["runs"]) => runs.map(({ files_written: _fw, ...rest }) => rest);
    expect(gtB.sessions.length).toBe(gtA.sessions.length);
    expect(stripRuns(gtB.runs)).toEqual(stripRuns(gtA.runs));
    expect(Object.keys(gtB.cases).sort()).toEqual(Object.keys(gtA.cases).sort());
    // git commit shas are a function of tree/message/dates only, not of the checkout path.
    const shasA = gtA.commits.map((c) => c.sha).sort();
    const shasB = gtB.commits.map((c) => c.sha).sort();
    expect(shasB).toEqual(shasA);
  });

  it("covers every required case, each pointing at a real session (and run, where named)", async () => {
    const dir = mkTmp();
    const gt = await generate({ out: dir, seed: 1, sessions: 12 });
    const sessionIds = new Set(gt.sessions.map((s) => s.id));
    const runIds = new Set(gt.runs.map((r) => r.id));

    for (const key of EXPECTED_CASES) {
      expect(gt.cases, `missing case: ${key}`).toHaveProperty(key);
      const c = gt.cases[key]!;
      expect(sessionIds.has(c.session_id), `case ${key} points at unknown session ${c.session_id}`).toBe(true);
      if (c.run_id !== undefined) {
        expect(runIds.has(c.run_id), `case ${key} points at unknown run ${c.run_id}`).toBe(true);
      }
    }
  });

  it("builds a git repo with the expected commit count and exactly one revert", async () => {
    const dir = mkTmp();
    const gt = await generate({ out: dir, seed: 1, sessions: 12 });
    const repoDir = gt.repo_path;

    const log = execFileSync("git", ["log", "--format=%H"], { cwd: repoDir }).toString().trim().split("\n");
    expect(log.length).toBe(gt.commits.length);
    expect(gt.commits.length).toBe(5);

    const revertBodies = execFileSync("git", ["log", "--format=%B"], { cwd: repoDir }).toString();
    const revertCount = (revertBodies.match(/This reverts commit/g) ?? []).length;
    expect(revertCount).toBe(1);

    const reverted = gt.commits.filter((c) => c.reverted_by !== null);
    expect(reverted.length).toBe(1);
    const target = reverted[0]!;
    const revertCommit = gt.commits.find((c) => c.sha === target.reverted_by);
    expect(revertCommit).toBeDefined();
    const gapDays = (Date.parse(revertCommit!.author_time) - Date.parse(target.author_time)) / 86_400_000;
    expect(gapDays).toBeGreaterThan(0);
    expect(gapDays).toBeLessThanOrEqual(30);

    // attribution sanity, per SPEC §4.3's commit-attribution rule
    const inside = gt.commits.filter((c) => c.attribution === "inside_session");
    const unattributed = gt.commits.filter((c) => c.attribution === "during_session_unattributed");
    const outside = gt.commits.filter((c) => c.attribution === "outside");
    expect(inside.length).toBeGreaterThanOrEqual(1);
    expect(unattributed.length).toBeGreaterThanOrEqual(1);
    expect(outside.length).toBeGreaterThanOrEqual(1);
  });

  it("shapes malformed lines exactly as recorded (truncated, empty, array) and nothing else breaks", async () => {
    const dir = mkTmp();
    const gt = await generate({ out: dir, seed: 1, sessions: 12 });
    for (const session of gt.sessions) {
      for (const bad of session.bad_lines) {
        const full = path.join(gt.claude_projects_dir, bad.file);
        const lines = readFileSync(full, "utf8").split("\n");
        // drop the single trailing newline's empty element
        if (lines[lines.length - 1] === "") lines.pop();
        let badCount = 0;
        lines.forEach((line, idx) => {
          if (!bad.indices.includes(idx)) {
            expect(() => JSON.parse(line), `line ${idx} of ${bad.file} should parse`).not.toThrow();
            return;
          }
          badCount++;
          let parsedOk = false;
          try {
            const v = JSON.parse(line);
            parsedOk = typeof v === "object" && v !== null && !Array.isArray(v);
          } catch {
            parsedOk = false;
          }
          expect(parsedOk, `line ${idx} of ${bad.file} should be malformed (unparsable or non-object)`).toBe(false);
        });
        expect(badCount).toBe(bad.indices.length);
        expect(bad.indices.length).toBeGreaterThanOrEqual(3);
      }
    }
  });

  it("reconstructs the depth-3 tree with the expected peak concurrency", async () => {
    const dir = mkTmp();
    const gt = await generate({ out: dir, seed: 1, sessions: 12 });
    const treeCase = gt.cases.tree_depth3!;
    const session = gt.sessions.find((s) => s.id === treeCase.session_id)!;
    expect(session.max_depth).toBe(3);
    expect(session.peak_concurrency).toBe(4);

    const runsInSession = gt.runs.filter((r) => r.session_id === treeCase.session_id);
    expect(runsInSession.some((r) => r.depth === 1 && r.parent_run_id === null)).toBe(true);
    expect(runsInSession.some((r) => r.depth === 2 && r.parent_run_id !== null)).toBe(true);
    expect(runsInSession.some((r) => r.depth === 3 && r.parent_run_id !== null)).toBe(true);
  });

  it("marks the died run and the still_running run with the documented rules", async () => {
    const dir = mkTmp();
    const gt = await generate({ out: dir, seed: 1, sessions: 12 });
    const died = gt.runs.find((r) => r.id === gt.cases.died_run!.run_id)!;
    expect(died.expected_fate).toBe("died");
    expect(died.last_tool_call_unanswered).toBe(true);

    const running = gt.runs.find((r) => r.id === gt.cases.still_running!.run_id)!;
    expect(running.expected_fate).toBe("still_running");
  });

  it("covers all four terminal fates once each in the fates session", async () => {
    const dir = mkTmp();
    const gt = await generate({ out: dir, seed: 1, sessions: 12 });
    const fates = ["landed_tracked", "landed_untracked", "finished_unlanded", "unknown_fate"] as const;
    for (const key of fates) {
      const c = gt.cases[key]!;
      const run = gt.runs.find((r) => r.id === c.run_id)!;
      const wantFate = key === "unknown_fate" ? "unknown" : key;
      expect(run.expected_fate).toBe(wantFate);
    }
  });

  it("computes re_reads and zero-turn sessions correctly", async () => {
    const dir = mkTmp();
    const gt = await generate({ out: dir, seed: 1, sessions: 12 });
    const rereadSession = gt.sessions.find((s) => s.id === gt.cases.re_reads!.session_id)!;
    expect(rereadSession.re_reads).toBe(1);

    const zeroSession = gt.sessions.find((s) => s.id === gt.cases.zero_turns!.session_id)!;
    expect(zeroSession.turns).toBe(0);
    expect(zeroSession.cost_usd).toBe(0);
  });

  it("pads with filler sessions when --sessions exceeds the case-session count", async () => {
    const dir = mkTmp();
    const gt = await generate({ out: dir, seed: 1, sessions: 20 });
    expect(gt.sessions.length).toBe(20);
  });
});
