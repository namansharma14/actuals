/**
 * Shared loader for the synthetic-fixture gates (G1, G3, G4, G5). Generates a fixture with
 * eval/generate.ts, runs the pipeline over it, and exposes the ground truth in one shape.
 * Field-name mapping from ground_truth.json lives here and nowhere else.
 */
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { runPipeline, type PipelineResult } from "../../src/pipeline.js";

export interface TruthRun { id: string; session_id: string; parent_run_id: string | null; depth: number; fate: string; last_tool_call_unanswered?: boolean }
export interface TruthSession { id: string; peak_concurrency: number; max_depth: number; commits_attributed: string[]; rereads?: number }
export interface TruthCommit { sha: string; subject: string; session_id: string | null; attribution: string }
export interface Truth { sessions: TruthSession[]; runs: TruthRun[]; commits: TruthCommit[]; malformed_lines: number; cases: Record<string, unknown>; expected_verdicts: Array<{ owner: string; kind: string; subject: string; verdict: string; where: string }> }

function pick<T>(o: Record<string, unknown>, ...keys: string[]): T | undefined {
  for (const k of keys) if (o[k] !== undefined) return o[k] as T;
  return undefined;
}

export function normaliseTruth(raw: Record<string, unknown>): Truth {
  const rawSessions = (pick<unknown[]>(raw, "sessions") ?? []) as Record<string, unknown>[];
  const rawRuns = (pick<unknown[]>(raw, "runs", "agent_runs") ?? []) as Record<string, unknown>[];
  const sessions: TruthSession[] = rawSessions.map((s) => ({
    id: String(pick(s, "id", "session_id", "sessionId")),
    peak_concurrency: Number(pick(s, "peak_concurrency", "expected_peak_concurrency", "peak") ?? 0),
    max_depth: Number(pick(s, "max_depth", "expected_max_depth", "depth") ?? 0),
    commits_attributed: (pick<unknown[]>(s, "commits_attributed", "commits", "expected_commits") ?? []).map((c) => (typeof c === "string" ? c : String((c as Record<string, unknown>)["subject"] ?? ""))),
    rereads: pick<number>(s, "rereads", "re_reads", "reread_count"),
  }));
  const commits: TruthCommit[] = ((pick<unknown[]>(raw, "commits") ?? []) as Record<string, unknown>[]).map((c) => ({ sha: String(c["sha"] ?? ""), subject: String(c["subject"] ?? ""), session_id: (c["session_id"] as string | null) ?? null, attribution: String(c["attribution"] ?? "") }));
  const runs: TruthRun[] = rawRuns.map((r) => ({
    id: String(pick(r, "id", "run_id", "agent_id", "agentId")),
    session_id: String(pick(r, "session_id", "sessionId", "session")),
    parent_run_id: (pick<string | null>(r, "parent_run_id", "parent", "parentRunId") ?? null) || null,
    depth: Number(pick(r, "depth", "spawn_depth", "spawnDepth") ?? 1),
    fate: String(pick(r, "fate", "expected_fate") ?? "unknown"),
    last_tool_call_unanswered: pick<boolean>(r, "last_tool_call_unanswered", "unanswered"),
  }));
  const malformed = pick<unknown>(raw, "malformed_lines", "malformed");
  let malformedCount = rawSessions.reduce((a, s) => a + ((pick<unknown[]>(s, "bad_lines", "malformed_lines") ?? []).length), 0);
  if (Array.isArray(malformed)) malformedCount = malformed.length;
  else if (malformed && typeof malformed === "object") malformedCount = Object.values(malformed as Record<string, unknown[]>).reduce((a, v) => a + (Array.isArray(v) ? v.length : 0), 0);
  else if (typeof malformed === "number") malformedCount = malformed;
  return { sessions, runs, commits, malformed_lines: malformedCount, cases: (pick<Record<string, unknown>>(raw, "cases") ?? {}), expected_verdicts: (pick<Array<{ owner: string; kind: string; subject: string; verdict: string; where: string }>>(raw, "expected_verdicts") ?? []) };
}

export interface Synthetic { out: string; truth: Truth; result: PipelineResult }

export async function synthetic(seed = 1, sessions = 12): Promise<Synthetic> {
  const genPath = path.resolve(process.cwd(), "eval", "generate.ts");
  if (!existsSync(genPath)) throw new Error("eval/generate.ts not present yet");
  const mod = (await import(genPath)) as { generate: (o: { out: string; seed: number; sessions: number; now?: string }) => Promise<unknown> };
  const out = mkdtempSync(path.join(tmpdir(), "actuals-synth-"));
  const now = "2026-09-01T12:00:00.000Z";
  await mod.generate({ out, seed, sessions, now });
  const truthPath = path.join(out, "ground_truth.json");
  const truth = normaliseTruth(JSON.parse(readFileSync(truthPath, "utf8")) as Record<string, unknown>);
  const repo = path.join(out, "repo");
  const result = await runPipeline({ repoPath: repo, repoId: "synthetic", originUrl: null, allProjects: false, since: null, tools: ["claude_code"], redact: false, generous: false }, { claudeRoot: path.join(out, "claude"), stateDir: path.join(out, "state"), now: new Date(now) });
  return { out, truth, result };
}
