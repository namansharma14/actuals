import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { discover, slugFor } from "../src/read/claude_code/index.js";
import { repoIdFor, worktreeRoots, type Scope } from "../src/config.js";

const sh = (args: string[], cwd: string) => execFileSync("git", args, { cwd, stdio: "ignore" });

describe("worktree sessions count for the repository", () => {
  it("a session whose cwd is a worktree is discovered when scoped to the main checkout, and worktrees share a repo id", async () => {
    const root = realpathSync(mkdtempSync(path.join(tmpdir(), "wt-")));
    const main = path.join(root, "repo"); mkdirSync(main);
    sh(["init", "-q", "-b", "main"], main); sh(["config", "user.email", "t@t"], main); sh(["config", "user.name", "t"], main);
    writeFileSync(path.join(main, "f.txt"), "x"); sh(["add", "."], main); sh(["commit", "-qm", "init"], main);
    const wt = path.join(root, "wt"); sh(["worktree", "add", "-q", wt, "-b", "side"], main);

    const claudeRoot = path.join(root, "claude");
    const proj = path.join(claudeRoot, "projects", slugFor(realpathSync(wt))); mkdirSync(proj, { recursive: true });
    const sid = "11111111-2222-3333-4444-555555555555";
    const line = JSON.stringify({ type: "user", cwd: realpathSync(wt), sessionId: sid, version: "2.1.241", gitBranch: "side", timestamp: "2026-09-01T10:00:00.000Z", message: { role: "user", content: "hi" } });
    writeFileSync(path.join(proj, `${sid}.jsonl`), line + "\n");

    const scope: Scope = { repoPath: main, repoId: "x", originUrl: null, allProjects: false, since: null, tools: ["claude_code"], redact: false, generous: false };
    const { files } = await discover(scope, claudeRoot);
    expect(files.some((f) => f.sessionId === sid)).toBe(true); // found via the worktree, not missed
    expect(worktreeRoots(main)).toContain(realpathSync(wt));
    expect(repoIdFor(main).repoId).toBe(repoIdFor(wt).repoId); // shared common dir -> one id (no remote)
  });
});
