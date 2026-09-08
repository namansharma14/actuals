/**
 * The acceptance key, derived independently of the reader: plain counting over the
 * transcript directory, git log, and the first-party /insights session-meta files.
 * Deliberately simple and separate from src/read so a shared bug cannot hide.
 */
import { existsSync, readdirSync, readFileSync, realpathSync, statSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import type { PipelineResult } from "../src/pipeline.js";

export interface Key {
  sessions: number; runs: number; turns: number; commits_in_window: number; first_party: Record<string, { input: number; output: number; git_commits: number }>;
  per_request_output: Record<string, number>; per_line_output: Record<string, number>;
  session_ids: string[];
}

function claudeRoot(): string { return process.env.ACTUALS_CLAUDE_DIR ?? path.join(homedir(), ".claude"); }

/** The repository's worktree roots (real paths); a session belongs to it when its own cwd is
 * one of these or a subpath. Boundary-correct so actuals-v2 never swallows actuals-v2-wt, and a
 * session launched elsewhere that merely cd'd in is not miscounted. Independent of src/read. */
function scopeRoots(repo: string): string[] {
  try {
    const out = execFileSync("git", ["worktree", "list", "--porcelain"], { cwd: repo, encoding: "utf8" });
    const roots = out.split("\n").flatMap((l) => { const m = /^worktree (.+)$/.exec(l); return m && m[1] ? [m[1]] : []; });
    const real = roots.map((r) => { try { return realpathSync(r); } catch { return r; } });
    return real.length ? real : [repo];
  } catch { return [repo]; }
}
function inScope(cwd: string, roots: string[]): boolean {
  let c = cwd; try { c = realpathSync(cwd); } catch { /* a vanished cwd keeps its string */ }
  return roots.some((r) => c === r || c.startsWith(r + path.sep));
}

export async function deriveKey(repo: string): Promise<Key> {
  const projects = path.join(claudeRoot(), "projects");
  const sessionIds: string[] = []; let runs = 0; let turns = 0; let minTs: string | null = null; let maxTs: string | null = null;
  const per_request_output: Record<string, number> = {}; const per_line_output: Record<string, number> = {};
  const roots = scopeRoots(repo);
  const rootSlugs = new Set(roots.map((r) => r.replace(/\//g, "-")));
  for (const d of readdirSync(projects)) {
    const pd = path.join(projects, d);
    if (!statSync(pd).isDirectory()) continue;
    for (const f of readdirSync(pd)) {
      if (!f.endsWith(".jsonl")) continue;
      const text = readFileSync(path.join(pd, f), "utf8");
      // the session's own cwd (first one recorded) decides the repo; a file with none falls back
      // to its project-dir slug. Boundary-correct and worktree-aware, so it agrees with the reader.
      const firstCwd = /"cwd":"([^"]+)"/.exec(text)?.[1] ?? null;
      if (firstCwd ? !inScope(firstCwd, roots) : !rootSlugs.has(d)) continue;
      const id = f.replace(/\.jsonl$/, "");
      sessionIds.push(id);
      const reqs = new Set<string>();
      const outByReq = new Map<string, number>(); let outPerLine = 0;
      for (const line of text.split("\n")) {
        if (!line.includes('"type":"assistant"')) continue;
        const m = /"requestId":"([^"]+)"/.exec(line);
        const o = Number(/"output_tokens":(\d+)/.exec(line)?.[1] ?? 0);
        outPerLine += o;
        if (m && m[1]) { reqs.add(m[1]); outByReq.set(m[1], o); } else { turns += 1; outByReq.set(`line:${outByReq.size}`, o); }
        const t = /"timestamp":"([^"]+)"/.exec(line)?.[1];
        if (t) { if (!minTs || t < minTs) minTs = t; if (!maxTs || t > maxTs) maxTs = t; }
      }
      turns += reqs.size;
      per_request_output[id] = [...outByReq.values()].reduce((a, b) => a + b, 0);
      per_line_output[id] = outPerLine;
      const sub = path.join(pd, id, "subagents");
      if (existsSync(sub)) runs += readdirSync(sub).filter((x) => x.endsWith(".jsonl")).length;
    }
  }
  const first_party: Key["first_party"] = {};
  const meta = path.join(claudeRoot(), "usage-data", "session-meta");
  if (existsSync(meta)) {
    for (const id of sessionIds) {
      const p = path.join(meta, `${id}.json`);
      if (!existsSync(p)) continue;
      const j = JSON.parse(readFileSync(p, "utf8")) as Record<string, unknown>;
      first_party[id] = { input: Number(j["input_tokens"] ?? 0), output: Number(j["output_tokens"] ?? 0), git_commits: Number(j["git_commits"] ?? 0) };
    }
  }
  let commits_in_window = 0;
  if (minTs && maxTs) {
    // the reader attributes a commit within 5 minutes of a session; widen the key's window to
    // match, so "attributed <= in window" is a fair invariant at the session boundary.
    const pad = 5 * 60e3;
    const since = new Date(new Date(minTs).getTime() - pad).toISOString();
    const until = new Date(new Date(maxTs).getTime() + pad).toISOString();
    const out = execFileSync("git", ["log", "--no-merges", `--since=${since}`, `--until=${until}`, "--format=%H"], { cwd: repo, encoding: "utf8" });
    commits_in_window = out.split("\n").filter(Boolean).length;
  }
  return { sessions: sessionIds.length, runs, turns, commits_in_window, first_party, per_request_output, per_line_output, session_ids: sessionIds };
}

export function compare(res: PipelineResult, key: Key) {
  const checks: Record<string, { ours: number; key: number; ok: boolean; note?: string }> = {
    sessions: { ours: res.ledger.sessions.length, key: key.sessions, ok: res.ledger.sessions.length === key.sessions },
    runs: { ours: res.ledger.runs.length, key: key.runs, ok: res.ledger.runs.length === key.runs },
    turns: { ours: res.ledger.turns.filter((t) => t.owner_kind === "session").length, key: key.turns, ok: res.ledger.turns.filter((t) => t.owner_kind === "session").length === key.turns, note: "main sessions only" },
    commits_attributed_le_window: { ours: res.ledger.commits.filter((c) => c.attribution !== "outside").length, key: key.commits_in_window, ok: res.ledger.commits.filter((c) => c.attribution !== "outside").length <= key.commits_in_window, note: "attributed commits can never exceed the commits in the window" },
  };
  const diffs: Array<{ session: string; ours_out: number; key_out: number; rel: number }> = [];
  const firstParty: Array<{ session: string; ours_out: number; meta_out: number; per_line_out: number; meta_equals_per_line: boolean }> = [];
  for (const s of res.ledger.sessions) {
    const k = key.per_request_output[s.id];
    if (k !== undefined && k > 0) diffs.push({ session: s.id, ours_out: s.usage.output, key_out: k, rel: Math.abs(s.usage.output - k) / k });
    const fp = key.first_party[s.id];
    if (fp && fp.output > 0) firstParty.push({ session: s.id, ours_out: s.usage.output, meta_out: fp.output, per_line_out: key.per_line_output[s.id] ?? 0, meta_equals_per_line: fp.output === (key.per_line_output[s.id] ?? -1) });
  }
  diffs.sort((a, b) => b.rel - a.rel);
  const rels = diffs.map((d) => d.rel).sort((a, b) => a - b);
  return { checks, g2: { n: diffs.length, max_rel_error: rels.length ? rels[rels.length - 1]! : null, median_rel_error: rels.length ? rels[Math.floor(rels.length / 2)]! : null, worst: diffs }, first_party: { n: firstParty.length, meta_equals_per_line: firstParty.filter((f) => f.meta_equals_per_line).length, rows: firstParty } };
}
