import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

export interface Scope {
  repoPath: string;
  /** the path as the caller gave it, before real-path normalisation (slug fallback matches either) */
  repoPathGiven?: string;
  repoId: string;
  originUrl: string | null;
  allProjects: boolean;
  since: Date | null;
  tools: Array<"claude_code" | "codex">;
  redact: boolean;
  generous: boolean;
  /** app picker: only these session ids are read (null or absent = every session in scope) */
  sessionIds?: string[] | null;
}

export const HOME = process.env.ACTUALS_HOME_OVERRIDE ?? homedir();
export const STATE_ROOT = process.env.ACTUALS_STATE_DIR ?? path.join(HOME, ".actuals");
export const CLAUDE_ROOT = process.env.ACTUALS_CLAUDE_DIR ?? path.join(HOME, ".claude");
export const CODEX_ROOT = process.env.ACTUALS_CODEX_DIR ?? path.join(HOME, ".codex");

export function git(args: string[], cwd: string): string | null {
  try {
    return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], maxBuffer: 64 * 1024 * 1024 }).trim();
  } catch {
    return null;
  }
}

export function repoRoot(cwd: string): string | null {
  const top = git(["rev-parse", "--show-toplevel"], cwd);
  return top ? realpathSync(top) : null;
}

/** The shared git directory of a repository, identical across all its worktrees. */
export function gitCommonDir(cwd: string): string | null {
  const d = git(["rev-parse", "--git-common-dir"], cwd);
  if (!d) return null;
  const abs = path.isAbsolute(d) ? d : path.join(cwd, d);
  try { return realpathSync(abs); } catch { return abs; }
}

/** Every worktree of the repository at `repoPath` (real paths), so a session in any of them
 * counts for the repository. Falls back to the path itself when git is unavailable. */
export function worktreeRoots(repoPath: string): string[] {
  const out = git(["worktree", "list", "--porcelain"], repoPath);
  const fallback = (): string[] => { try { return [realpathSync(repoPath)]; } catch { return [repoPath]; } };
  if (!out) return fallback();
  const roots: string[] = [];
  for (const line of out.split("\n")) { const m = /^worktree (.+)$/.exec(line); if (m && m[1]) { try { roots.push(realpathSync(m[1])); } catch { roots.push(m[1]); } } }
  return roots.length ? roots : fallback();
}

export function repoIdFor(repoPath: string): { repoId: string; originUrl: string | null } {
  const originUrl = git(["remote", "get-url", "origin"], repoPath);
  let real = repoPath; try { real = realpathSync(repoPath); } catch { /* a cwd that no longer exists still gets a stable id */ }
  // the git common dir is shared by every worktree, so worktrees of one remote-less repo share an id
  const basis = originUrl ?? gitCommonDir(repoPath) ?? real;
  return { repoId: createHash("sha256").update(basis).digest("hex").slice(0, 16), originUrl };
}

export function parseSince(s: string | undefined): Date | null {
  if (!s) return null;
  const m = /^(\d+)([dhw])$/.exec(s);
  if (m) {
    const n = Number(m[1]);
    const unit = m[2];
    const ms = unit === "h" ? 3600e3 : unit === "w" ? 7 * 86400e3 : 86400e3;
    return new Date(Date.now() - n * ms);
  }
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function stateDirFor(repoId: string): string {
  return path.join(STATE_ROOT, repoId);
}

export function isInside(child: string, parent: string): boolean {
  const rel = path.relative(parent, child);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

export function exists(p: string): boolean {
  return existsSync(p);
}

/** Baked in by the build (tsup define); undefined when run from source. */
declare const __ACTUALS_VERSION__: string | undefined;

/**
 * The package's own version. The build bakes it in; from source it is read from the
 * package.json one level above this file. Never from process.argv, which under npx is a
 * symlink in another package's .bin.
 */
export function cliVersion(): string {
  if (typeof __ACTUALS_VERSION__ === "string" && __ACTUALS_VERSION__) return __ACTUALS_VERSION__;
  try {
    const v = (JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { version?: unknown }).version;
    return typeof v === "string" ? v : "";
  } catch { return ""; }
}
