/**
 * eval/generate.ts — deterministic synthetic fixture generator.
 *
 * Encodes the Claude Code transcript format from real
 * transcript shapes learned read-only from ~/.claude/projects/ (no real content
 * copied — every prompt, path, and body of text here is synthetic). Written blind
 * to src/read/ per the v1 integrity rule: this file must never import from, or be
 * informed by, the reader implementation.
 *
 * `generate()` is pure given (seed, sessions, now): no Date.now(), no Math.random().
 * It writes a Claude Code project directory, a real git repo (via execFileSync),
 * and a ground_truth.json answer key.
 */
import { mkdirSync, writeFileSync, rmSync, unlinkSync } from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { emptyUsage, addUsage, type Usage, type Fate } from "../src/schema/ledger.js";
import { resolveRate, costOf, loadRates } from "../src/rates/index.js";

// ---------------------------------------------------------------------------
// Constants & time
// ---------------------------------------------------------------------------

const MIN_MS = 60_000;
const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;
const BASE_MS = Date.parse("2026-08-01T09:00:00.000Z");
const DEFAULT_NOW = "2026-09-03T12:00:00.000Z";
const VERSION = "2.1.241";
const ENTRYPOINT = "cli";

function iso(ms: number): string {
  return new Date(ms).toISOString();
}

// ---------------------------------------------------------------------------
// Seeded PRNG (mulberry32) — no Math.random, no Date-derived entropy.
// ---------------------------------------------------------------------------

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pick<T>(rng: () => number, arr: readonly T[]): T {
  return arr[Math.floor(rng() * arr.length)] as T;
}

function hex(rng: () => number, n: number): string {
  let s = "";
  for (let i = 0; i < n; i++) s += Math.floor(rng() * 16).toString(16);
  return s;
}

function uuid(rng: () => number): string {
  const h = hex(rng, 32);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
}

function agentIdOf(rng: () => number): string {
  return "a" + hex(rng, 17);
}

const WORDS = [
  "synthetic", "transcript", "fixture", "module", "widget", "parser", "ledger", "report",
  "gate", "matcher", "engine", "session", "branch", "commit", "token", "cache", "depth",
  "tree", "spawn", "agent", "harness", "grader", "reader", "claim", "verdict", "window",
] as const;

function fillerText(rng: () => number, minChars: number): string {
  let s = "";
  while (s.length < minChars) s += pick(rng, WORDS) + " ";
  return s.trim() + ".";
}

function mkUsage(input: number, output: number, cacheRead: number, write5m: number, write1h: number): Usage {
  return { input, output, cache_read: cacheRead, cache_write_5m: write5m, cache_write_1h: write1h };
}

// ---------------------------------------------------------------------------
// Content-block factories (matching real Claude Code tool_use/tool_result shapes)
// ---------------------------------------------------------------------------

const textBlock = (text: string) => ({ type: "text", text });
const toolUseBlock = (id: string, name: string, input: Record<string, unknown>) => ({ type: "tool_use", id, name, input });
const toolResultBlock = (toolUseId: string, content: unknown, isError = false) => ({
  type: "tool_result",
  tool_use_id: toolUseId,
  content,
  is_error: isError,
});
const readInput = (file_path: string) => ({ file_path });
const writeInput = (file_path: string, content: string) => ({ file_path, content });
const bashInput = (command: string) => ({ command });
const agentInput = (subagent_type: string, description: string, prompt: string, model?: string) =>
  model ? { subagent_type, description, prompt, model } : { subagent_type, description, prompt };

function usageJson(u: Usage, splitPresent: boolean): Record<string, unknown> {
  const cache_creation_input_tokens = u.cache_write_5m + u.cache_write_1h;
  const rec: Record<string, unknown> = {
    input_tokens: u.input,
    output_tokens: u.output,
    cache_read_input_tokens: u.cache_read,
    cache_creation_input_tokens,
  };
  if (splitPresent) {
    rec.cache_creation = { ephemeral_5m_input_tokens: u.cache_write_5m, ephemeral_1h_input_tokens: u.cache_write_1h };
  }
  return rec;
}

// ---------------------------------------------------------------------------
// Transcript: one JSONL file's worth of lines (a session or a run/subagent file)
// ---------------------------------------------------------------------------

class Transcript {
  lines: string[] = [];
  badIndices: number[] = [];
  turns: { model: string; usage: Usage }[] = [];
  readPaths = new Set<string>();
  reReads = 0;
  /** First/last timestamp actually emitted (any line carrying one) — the only honest
   * source for a session's/run's started_at/ended_at; never a hand-picked constant. */
  firstTs: string | null = null;
  lastTs: string | null = null;
  private lastUuid: string | null = null;

  private markTs(ts: string): void {
    if (this.firstTs === null) this.firstTs = ts;
    this.lastTs = ts;
  }

  constructor(
    private sessionId: string,
    private agentId: string | null,
    private cwdRef: { value: string },
    private gitBranch: string,
    private rng: () => number,
  ) {}

  private nextUuid(): string {
    return uuid(this.rng);
  }

  private envelope(ts: string, type: string, extra: Record<string, unknown>): string {
    const u = this.nextUuid();
    const rec: Record<string, unknown> = {
      type,
      timestamp: ts,
      sessionId: this.sessionId,
      cwd: this.cwdRef.value,
      gitBranch: this.gitBranch,
      version: VERSION,
      uuid: u,
      parentUuid: this.lastUuid,
      userType: "external",
      isSidechain: false,
      entrypoint: ENTRYPOINT,
      ...(this.agentId ? { agentId: this.agentId } : {}),
      ...extra,
    };
    this.lastUuid = u;
    this.lines.push(JSON.stringify(rec));
    this.markTs(ts);
    return u;
  }

  user(ts: string, content: unknown, extra: Record<string, unknown> = {}): string {
    return this.envelope(ts, "user", { message: { role: "user", content }, promptId: this.nextUuid(), ...extra });
  }

  assistant(
    ts: string,
    content: Record<string, unknown>[],
    usage: Usage,
    model: string,
    opts: { splitPresent?: boolean; extra?: Record<string, unknown> } = {},
  ): string {
    const splitPresent = opts.splitPresent ?? true;
    const hasToolUse = content.some((c) => c.type === "tool_use");
    const rec = this.envelope(ts, "assistant", {
      message: {
        id: "msg_" + hex(this.rng, 24),
        type: "message",
        role: "assistant",
        model,
        content,
        stop_reason: hasToolUse ? "tool_use" : "end_turn",
        stop_sequence: null,
        usage: usageJson(usage, splitPresent),
      },
      requestId: "req_" + hex(this.rng, 24),
      ...opts.extra,
    });
    this.turns.push({ model, usage });
    for (const c of content) {
      const input = c.input as { file_path?: string } | undefined;
      if (c.type === "tool_use" && c.name === "Read" && input?.file_path) {
        const p = input.file_path;
        if (this.readPaths.has(p)) this.reReads++;
        this.readPaths.add(p);
      }
    }
    return rec;
  }

  nonMessage(obj: Record<string, unknown>): void {
    this.lines.push(JSON.stringify(obj));
    if (typeof obj.timestamp === "string") this.markTs(obj.timestamp);
  }

  malformed(kind: "truncated" | "empty" | "array"): void {
    this.badIndices.push(this.lines.length);
    if (kind === "empty") this.lines.push("");
    else if (kind === "array") this.lines.push(JSON.stringify([1, 2, "not-an-object"]));
    else this.lines.push('{"type":"user","message":{"role":"user","content":"unterminated line cut off mid-w');
  }
}

function newRunTranscript(sessionId: string, agentId: string, cwd: string, rng: () => number): Transcript {
  return new Transcript(sessionId, agentId, { value: cwd }, "main", rng);
}

// ---------------------------------------------------------------------------
// git repo construction — deterministic commit hashes (fixed author/committer date+identity)
// ---------------------------------------------------------------------------

function gitEnv(iso_: string): NodeJS.ProcessEnv {
  return {
    ...process.env,
    GIT_AUTHOR_DATE: iso_,
    GIT_COMMITTER_DATE: iso_,
    GIT_AUTHOR_NAME: "Gen",
    GIT_AUTHOR_EMAIL: "a@b",
    GIT_COMMITTER_NAME: "Gen",
    GIT_COMMITTER_EMAIL: "a@b",
  };
}

function initRepo(repoDir: string): void {
  mkdirSync(repoDir, { recursive: true });
  execFileSync("git", ["init", "-q", "-b", "main"], { cwd: repoDir, stdio: "pipe" });
}

function commitFile(repoDir: string, relPath: string, content: string, subject: string, ts: string): string {
  const abs = path.join(repoDir, relPath);
  mkdirSync(path.dirname(abs), { recursive: true });
  writeFileSync(abs, content);
  execFileSync("git", ["add", relPath], { cwd: repoDir, stdio: "pipe" });
  execFileSync(
    "git",
    ["-c", "user.email=a@b", "-c", "user.name=Gen", "commit", "--date", ts, "-m", subject],
    { cwd: repoDir, env: gitEnv(ts), stdio: "pipe" },
  );
  return execFileSync("git", ["rev-parse", "HEAD"], { cwd: repoDir }).toString().trim();
}

function revertCommit(repoDir: string, targetSha: string, ts: string): string {
  execFileSync(
    "git",
    ["-c", "user.email=a@b", "-c", "user.name=Gen", "revert", "--no-edit", targetSha],
    { cwd: repoDir, env: gitEnv(ts), stdio: "pipe" },
  );
  return execFileSync("git", ["rev-parse", "HEAD"], { cwd: repoDir }).toString().trim();
}

function subjectOf(repoDir: string, sha: string): string {
  return execFileSync("git", ["log", "-1", "--format=%s", sha], { cwd: repoDir }).toString().trim();
}

function writeUntracked(repoDir: string, relPath: string, content: string): string {
  const abs = path.join(repoDir, relPath);
  mkdirSync(path.dirname(abs), { recursive: true });
  writeFileSync(abs, content);
  return abs;
}

function writeThenDelete(repoDir: string, relPath: string, content: string): string {
  const abs = writeUntracked(repoDir, relPath, content);
  unlinkSync(abs);
  return abs;
}

function slugify(p: string): string {
  return p.replace(/\//g, "-");
}

// ---------------------------------------------------------------------------
// Ground truth types
// ---------------------------------------------------------------------------

export interface GTCommit {
  sha: string;
  subject: string;
  author_time: string;
  session_id: string | null;
  attribution: "inside_session" | "during_session_unattributed" | "outside";
  reverted_by: string | null;
  reverted_at: string | null;
}
export interface GTRun {
  id: string;
  session_id: string;
  parent_run_id: string | null;
  depth: number;
  spawned_by: "user" | "agent";
  expected_fate: Fate;
  fate_rule: string;
  files_written: string[];
  last_tool_call_unanswered: boolean;
}
export interface GTBadLines {
  file: string;
  indices: number[];
}
export interface GTSession {
  id: string;
  started_at: string;
  ended_at: string;
  turns: number;
  usage_by_model: Record<string, Usage>;
  cost_usd_by_model: Record<string, number>;
  cost_usd: number;
  cost_mark: "estimated" | "assumed";
  commits_attributed: string[];
  re_reads: number;
  peak_concurrency: number;
  max_depth: number;
  bad_lines: GTBadLines[];
}
export interface GTCase {
  session_id: string;
  run_id?: string;
  note: string;
}
export interface GroundTruth {
  seed: number;
  now: string;
  repo_path: string;
  secondary_path: string;
  claude_projects_dir: string;
  rates_version: string;
  sessions: GTSession[];
  runs: GTRun[];
  commits: GTCommit[];
  cases: Record<string, GTCase>;
  /** D16: expected claim verdicts (owner+kind+subject -> verdict), filled by the blind author. */
  expected_verdicts: Array<{ owner: string; kind: string; subject: string; verdict: "kept" | "gone" | "unknown" | "absent"; where: string }>;
}

interface GenCtx {
  repoDir: string;
  secondaryDir: string;
  projectsDir: string;
  claudeRoot: string;
  rng: () => number;
  sessions: GTSession[];
  runs: GTRun[];
  commits: GTCommit[];
  cases: Record<string, GTCase>;
  expected_verdicts: Array<{ owner: string; kind: string; subject: string; verdict: "kept" | "gone" | "unknown" | "absent"; where: string }>;
  commitAforRevert?: string;
}

/** Writes the optional /insights facets file a session may carry (the claim design,
 * session_outcome): `<claudeRoot>/usage-data/facets/<sessionId>.json`. Present only if the
 * user ran /insights; the generator emits it only for the two session_outcome cases. */
function writeFacets(ctx: GenCtx, sessionId: string, outcome: string, underlyingGoal: string): void {
  const dir = path.join(ctx.claudeRoot, "usage-data", "facets");
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, `${sessionId}.json`), JSON.stringify({ outcome, underlying_goal: underlyingGoal }) + "\n");
}

function writeSubagent(ctx: GenCtx, sessionId: string, agentId: string, t: Transcript, meta: Record<string, unknown>): void {
  const dir = path.join(ctx.projectsDir, sessionId, "subagents");
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, `agent-${agentId}.jsonl`), t.lines.join("\n") + "\n");
  writeFileSync(path.join(dir, `agent-${agentId}.meta.json`), JSON.stringify(meta));
}

/** Write a run's subagent file + meta.json and record its GTRun entry in one call. */
function landRun(
  ctx: GenCtx, sessionId: string, id: string, parentRunId: string | null, depth: number,
  spawnedBy: "user" | "agent", t: Transcript, meta: Record<string, unknown>,
  fate: Fate, fateRule: string, filesWritten: string[] = [], unanswered = false,
): void {
  writeSubagent(ctx, sessionId, id, t, meta);
  ctx.runs.push({ id, session_id: sessionId, parent_run_id: parentRunId, depth, spawned_by: spawnedBy, expected_fate: fate, fate_rule: fateRule, files_written: filesWritten, last_tool_call_unanswered: unanswered });
}

function usageByModel(turns: { model: string; usage: Usage }[]): Record<string, Usage> {
  const m: Record<string, Usage> = {};
  for (const tn of turns) m[tn.model] = addUsage(m[tn.model] ?? emptyUsage(), tn.usage);
  return m;
}

function costsByModel(u: Record<string, Usage>): { byModel: Record<string, number>; total: number; anyAssumed: boolean } {
  let total = 0;
  let anyAssumed = false;
  const byModel: Record<string, number> = {};
  for (const [model, usage] of Object.entries(u)) {
    const r = resolveRate(model);
    const c = costOf(usage, r.rate);
    byModel[model] = c;
    total += c;
    if (r.mark === "assumed") anyAssumed = true;
  }
  return { byModel, total, anyAssumed };
}

function finalizeSession(ctx: GenCtx, sessionId: string, t: Transcript, extraBadLines: GTBadLines[] = []): GTSession {
  writeFileSync(path.join(ctx.projectsDir, `${sessionId}.jsonl`), t.lines.join("\n") + "\n");
  // started_at/ended_at come only from the main transcript's own first/last timestamped
  // line — never a hand-picked constant, and never rolled up from subagent files (a
  // session's turns are owned by the session XOR by a run; see ledger.ts's owner_kind).
  if (t.firstTs === null || t.lastTs === null) throw new Error(`session ${sessionId} emitted no timestamped line`);
  const usage_by_model = usageByModel(t.turns);
  const { byModel, total, anyAssumed } = costsByModel(usage_by_model);
  const commits_attributed = ctx.commits
    .filter((c) => c.session_id === sessionId && c.attribution === "inside_session")
    .map((c) => c.subject);
  const bad_lines: GTBadLines[] = [];
  if (t.badIndices.length > 0) bad_lines.push({ file: `${sessionId}.jsonl`, indices: [...t.badIndices] });
  bad_lines.push(...extraBadLines);
  const gts: GTSession = {
    id: sessionId,
    started_at: t.firstTs,
    ended_at: t.lastTs,
    turns: t.turns.length,
    usage_by_model,
    cost_usd_by_model: byModel,
    cost_usd: total,
    cost_mark: anyAssumed ? "assumed" : "estimated",
    commits_attributed,
    re_reads: t.reReads,
    peak_concurrency: 0,
    max_depth: 0,
    bad_lines,
  };
  ctx.sessions.push(gts);
  return gts;
}

function computeTreeStats(intervals: { start: number; end: number; depth: number }[]): { peak: number; maxDepth: number } {
  if (intervals.length === 0) return { peak: 0, maxDepth: 0 };
  const events: [number, number][] = [];
  for (const iv of intervals) {
    events.push([iv.start, 1]);
    events.push([iv.end, -1]);
  }
  events.sort((a, b) => a[0] - b[0] || b[1] - a[1]);
  let cur = 0;
  let peak = 0;
  for (const [, d] of events) {
    cur += d;
    if (cur > peak) peak = cur;
  }
  let maxDepth = 0;
  for (const iv of intervals) if (iv.depth > maxDepth) maxDepth = iv.depth;
  return { peak, maxDepth };
}

// ---------------------------------------------------------------------------
// Case-session builders
// ---------------------------------------------------------------------------

function buildCommitsSession(ctx: GenCtx): void {
  const preMs = BASE_MS - 10 * DAY_MS;
  const preSha = commitFile(ctx.repoDir, "README.md", "# synthetic fixture repo\n", "chore: bootstrap repo", iso(preMs));
  ctx.commits.push({ sha: preSha, subject: "chore: bootstrap repo", author_time: iso(preMs), session_id: null, attribution: "outside", reverted_by: null, reverted_at: null });

  const sessionId = uuid(ctx.rng);
  const startMs = BASE_MS;
  const t = new Transcript(sessionId, null, { value: ctx.repoDir }, "main", ctx.rng);
  const model = "claude-sonnet-5";
  t.user(iso(startMs), "Add the parser module, and separately push a quick fix.");

  // the Bash call precedes the commit it creates (the tool_use fires first; `git commit`
  // stamps the author time a moment later, once the process actually runs).
  const bashMs = startMs + 10 * MIN_MS;
  const commitAMs = bashMs + 30_000;
  t.assistant(iso(startMs + 1 * MIN_MS), [textBlock("Adding the parser module now.")], mkUsage(200, 900, 0, 500, 0), model);
  const callId1 = "toolu_" + hex(ctx.rng, 24);
  t.assistant(iso(bashMs), [toolUseBlock(callId1, "Bash", bashInput('git commit -m "feat: add parser module"'))], mkUsage(100, 300, 1000, 0, 0), model);
  const shaA = commitFile(ctx.repoDir, "src/parser.txt", "parser v1\n", "feat: add parser module", iso(commitAMs));
  t.user(iso(bashMs + 5000), [toolResultBlock(callId1, "[main] feat: add parser module", false)]);
  ctx.commits.push({ sha: shaA, subject: "feat: add parser module", author_time: iso(commitAMs), session_id: sessionId, attribution: "inside_session", reverted_by: null, reverted_at: null });
  ctx.commitAforRevert = shaA;

  const commitBMs = startMs + 30 * MIN_MS;
  const shaB = commitFile(ctx.repoDir, "src/fixed.txt", "fix content\n", "fix: correct off-by-one", iso(commitBMs));
  t.assistant(iso(startMs + 32 * MIN_MS), [textBlock("Also pushed a fix directly; no need to report back on that one.")], mkUsage(150, 400, 800, 0, 0), model);
  ctx.commits.push({ sha: shaB, subject: "fix: correct off-by-one", author_time: iso(commitBMs), session_id: sessionId, attribution: "during_session_unattributed", reverted_by: null, reverted_at: null });

  finalizeSession(ctx, sessionId, t);
  ctx.cases.commit_inside_attributed = { session_id: sessionId, note: `commit ${shaA} has a matching Bash "git commit" call within 5 minutes -> inside_session` };
  ctx.cases.commit_inside_unattributed = { session_id: sessionId, note: `commit ${shaB} falls inside the window but has no Bash git-commit call -> during_session_unattributed` };
  ctx.cases.commit_outside = { session_id: sessionId, note: `commit ${preSha} is dated 10 days before any session window -> outside` };
}

function buildFateRun(
  ctx: GenCtx,
  sessionId: string,
  parentT: Transcript,
  startMs: number,
  description: string,
  build: (t: Transcript, agentId: string, startMs: number) => { filesWritten: string[]; fate: Fate; fateRule: string; unanswered: boolean },
): { agentId: string } {
  const agentId = agentIdOf(ctx.rng);
  const callId = "toolu_" + hex(ctx.rng, 24);
  parentT.assistant(iso(startMs), [toolUseBlock(callId, "Agent", agentInput("general-purpose", description, "synthetic delegated task"))], mkUsage(50, 120, 0, 0, 0), "claude-fable-5-1");
  const t = newRunTranscript(sessionId, agentId, ctx.repoDir, ctx.rng);
  const { filesWritten, fate, fateRule, unanswered } = build(t, agentId, startMs);
  writeSubagent(ctx, sessionId, agentId, t, { agentType: "general-purpose", description, toolUseId: callId, spawnDepth: 1 });
  parentT.user(iso(startMs + 3 * MIN_MS), [toolResultBlock(callId, "done", false)]);
  ctx.runs.push({ id: agentId, session_id: sessionId, parent_run_id: null, depth: 1, spawned_by: "user", expected_fate: fate, fate_rule: fateRule, files_written: filesWritten, last_tool_call_unanswered: unanswered });
  return { agentId };
}

function buildFatesSession(ctx: GenCtx): void {
  const sessionId = uuid(ctx.rng);
  const startMs = BASE_MS + 2 * HOUR_MS;
  const t = new Transcript(sessionId, null, { value: ctx.repoDir }, "main", ctx.rng);
  t.user(iso(startMs), "Run four small delegated checks, one after another.");

  let cursor = startMs + MIN_MS;
  const rTracked = buildFateRun(ctx, sessionId, t, cursor, "Land a tracked file", (rt, _id, s) => {
    const abs = path.join(ctx.repoDir, "reports/landed-tracked.txt");
    rt.user(iso(s), "Land a small tracked file.");
    const wc = "toolu_" + hex(ctx.rng, 24);
    rt.assistant(iso(s + 20_000), [toolUseBlock(wc, "Write", writeInput(abs, "tracked output\n"))], mkUsage(80, 200, 0, 300, 0), "claude-sonnet-5");
    rt.user(iso(s + 25_000), [toolResultBlock(wc, "File written", false)]);
    rt.assistant(iso(s + 30_000), [textBlock(fillerText(ctx.rng, 320))], mkUsage(20, 300, 200, 0, 0), "claude-sonnet-5");
    const sha = commitFile(ctx.repoDir, "reports/landed-tracked.txt", "tracked output\n", "chore: land tracked output", iso(s + 60_000));
    ctx.commits.push({ sha, subject: "chore: land tracked output", author_time: iso(s + 60_000), session_id: sessionId, attribution: "during_session_unattributed", reverted_by: null, reverted_at: null });
    return { filesWritten: [abs], fate: "landed_tracked" as Fate, fateRule: "a file the run wrote exists on disk and is tracked", unanswered: false };
  });
  cursor += 5 * MIN_MS;

  const rUntracked = buildFateRun(ctx, sessionId, t, cursor, "Land an untracked file", (rt, _id, s) => {
    const abs = path.join(ctx.repoDir, "scratch/untracked-note.txt");
    rt.user(iso(s), "Land a file, no need to commit it.");
    const wc = "toolu_" + hex(ctx.rng, 24);
    rt.assistant(iso(s + 20_000), [toolUseBlock(wc, "Write", writeInput(abs, "untracked output\n"))], mkUsage(70, 180, 0, 280, 0), "claude-sonnet-5");
    rt.user(iso(s + 25_000), [toolResultBlock(wc, "File written", false)]);
    rt.assistant(iso(s + 30_000), [textBlock(fillerText(ctx.rng, 320))], mkUsage(20, 300, 180, 0, 0), "claude-sonnet-5");
    writeUntracked(ctx.repoDir, "scratch/untracked-note.txt", "untracked output\n");
    return { filesWritten: [abs], fate: "landed_untracked" as Fate, fateRule: "a file the run wrote exists on disk, none tracked", unanswered: false };
  });
  cursor += 5 * MIN_MS;

  const rUnlanded = buildFateRun(ctx, sessionId, t, cursor, "Draft then discard a file", (rt, _id, s) => {
    const abs = path.join(ctx.repoDir, "scratch/temp-draft.txt");
    rt.user(iso(s), "Draft a note, it will be cleaned up after.");
    const wc = "toolu_" + hex(ctx.rng, 24);
    rt.assistant(iso(s + 20_000), [toolUseBlock(wc, "Write", writeInput(abs, "temp draft\n"))], mkUsage(60, 150, 0, 260, 0), "claude-sonnet-5");
    rt.user(iso(s + 25_000), [toolResultBlock(wc, "File written", false)]);
    rt.assistant(iso(s + 30_000), [textBlock(fillerText(ctx.rng, 320))], mkUsage(20, 300, 150, 0, 0), "claude-sonnet-5");
    writeThenDelete(ctx.repoDir, "scratch/temp-draft.txt", "temp draft\n");
    // files_written reflects the transcript's Write claim, not disk survival — the run
    // did write this path; it just did not survive, which is exactly what finished_unlanded means.
    return { filesWritten: [abs], fate: "finished_unlanded" as Fate, fateRule: "final text >= 300 chars exists, no written file survives", unanswered: false };
  });
  cursor += 5 * MIN_MS;

  const rUnknown = buildFateRun(ctx, sessionId, t, cursor, "Check the config, no changes", (rt, _id, s) => {
    rt.user(iso(s), "Just check the config, no changes needed.");
    const rCallId = "toolu_" + hex(ctx.rng, 24);
    rt.assistant(iso(s + 30_000), [toolUseBlock(rCallId, "Read", readInput(path.join(ctx.repoDir, "README.md")))], mkUsage(40, 90, 0, 0, 0), "claude-haiku-4-5");
    rt.user(iso(s + 35_000), [toolResultBlock(rCallId, "# synthetic fixture repo", false)]);
    rt.assistant(iso(s + 40_000), [textBlock("Config looks fine, nothing else needed.")], mkUsage(15, 60, 50, 0, 0), "claude-haiku-4-5");
    return { filesWritten: [], fate: "unknown" as Fate, fateRule: "no write claim, no >=300-char final text, not died, not still_running", unanswered: false };
  });

  const gts = finalizeSession(ctx, sessionId, t);
  gts.peak_concurrency = 1;
  gts.max_depth = 1;
  ctx.cases.landed_tracked = { session_id: sessionId, run_id: rTracked.agentId, note: "run writes a file that gets committed and tracked" };
  ctx.cases.landed_untracked = { session_id: sessionId, run_id: rUntracked.agentId, note: "run writes a file that survives on disk but is never tracked" };
  ctx.cases.finished_unlanded = { session_id: sessionId, run_id: rUnlanded.agentId, note: "run produces a >=300-char final message but its written file is deleted before disk survey" };
  ctx.cases.unknown_fate = { session_id: sessionId, run_id: rUnknown.agentId, note: "run writes nothing and its final text is short: none of the fate rules match" };
}

function buildTreeSession(ctx: GenCtx): void {
  const sessionId = uuid(ctx.rng);
  const startMs = BASE_MS + 4 * HOUR_MS;
  const t = new Transcript(sessionId, null, { value: ctx.repoDir }, "main", ctx.rng);
  t.user(iso(startMs), "Run two independent research branches in parallel.");

  const idR1 = agentIdOf(ctx.rng);
  const idR4 = agentIdOf(ctx.rng);
  const callR1 = "toolu_" + hex(ctx.rng, 24);
  const callR4 = "toolu_" + hex(ctx.rng, 24);
  t.assistant(
    iso(startMs + MIN_MS),
    [
      toolUseBlock(callR1, "Agent", agentInput("general-purpose", "Branch A: recurse to depth 3", "synthetic task prompt", "opus")),
      toolUseBlock(callR4, "Agent", agentInput("general-purpose", "Branch B: single-depth check", "synthetic task prompt")),
    ],
    mkUsage(90, 200, 0, 0, 0),
    "claude-fable-5-1",
  );

  // Every *End below is derived from the run's own last emitted line (t.lastTs), never
  // guessed ahead of time — computeTreeStats must reflect what the transcripts actually say.
  const r1Start = startMs + MIN_MS;
  const r4Start = startMs + 5 * MIN_MS;

  const idR2 = agentIdOf(ctx.rng);
  const idR3 = agentIdOf(ctx.rng);
  const r1t = newRunTranscript(sessionId, idR1, ctx.repoDir, ctx.rng);
  r1t.user(iso(r1Start), "Branch A: recurse to depth 3.");
  const callR2 = "toolu_" + hex(ctx.rng, 24);
  r1t.assistant(iso(r1Start + MIN_MS), [toolUseBlock(callR2, "Agent", agentInput("general-purpose", "Depth-2 probe", "synthetic task prompt"))], mkUsage(50, 100, 0, 0, 0), "claude-opus-5");

  const r2Start = r1Start + 2 * MIN_MS;
  const r2t = newRunTranscript(sessionId, idR2, ctx.repoDir, ctx.rng);
  r2t.user(iso(r2Start), "Depth-2 probe.");
  const callR3 = "toolu_" + hex(ctx.rng, 24);
  r2t.assistant(iso(r2Start + MIN_MS), [toolUseBlock(callR3, "Agent", agentInput("general-purpose", "Depth-3 leaf", "synthetic task prompt"))], mkUsage(40, 90, 0, 0, 0), "claude-opus-5");

  const r3Start = r2Start + 2 * MIN_MS;
  const r3t = newRunTranscript(sessionId, idR3, ctx.repoDir, ctx.rng);
  r3t.user(iso(r3Start), "Depth-3 leaf.");
  r3t.assistant(iso(r3Start + MIN_MS), [textBlock(fillerText(ctx.rng, 320))], mkUsage(30, 500, 100, 0, 0), "claude-opus-5");
  const finishedRule = "final text >= 300 chars, no written file";
  landRun(ctx, sessionId, idR3, idR2, 3, "agent", r3t, { agentType: "general-purpose", description: "Depth-3 leaf", toolUseId: callR3, spawnDepth: 3, parentAgentId: idR2 }, "finished_unlanded", finishedRule);
  const r3End = Date.parse(r3t.lastTs!);

  r2t.user(iso(r3End + 10_000), [toolResultBlock(callR3, fillerText(ctx.rng, 60), false)]);
  r2t.assistant(iso(r3End + 20_000), [textBlock(fillerText(ctx.rng, 320))], mkUsage(20, 400, 200, 0, 0), "claude-opus-5");
  landRun(ctx, sessionId, idR2, idR1, 2, "agent", r2t, { agentType: "general-purpose", description: "Depth-2 probe", toolUseId: callR2, spawnDepth: 2, parentAgentId: idR1 }, "finished_unlanded", finishedRule);
  const r2End = Date.parse(r2t.lastTs!);

  r1t.user(iso(r2End + 10_000), [toolResultBlock(callR2, fillerText(ctx.rng, 60), false)]);
  r1t.assistant(iso(r2End + 20_000), [textBlock(fillerText(ctx.rng, 320))], mkUsage(20, 400, 200, 0, 0), "claude-opus-5");
  landRun(ctx, sessionId, idR1, null, 1, "user", r1t, { agentType: "general-purpose", description: "Branch A: recurse to depth 3", toolUseId: callR1, spawnDepth: 1, model: "opus" }, "finished_unlanded", finishedRule);
  const r1End = Date.parse(r1t.lastTs!);

  const r4t = newRunTranscript(sessionId, idR4, ctx.repoDir, ctx.rng);
  r4t.user(iso(r4Start), "Branch B: single-depth check.");
  r4t.assistant(iso(r4Start + MIN_MS), [textBlock(fillerText(ctx.rng, 320))], mkUsage(25, 300, 80, 0, 0), "claude-sonnet-5");
  // meta.json omits `model` on purpose, to exercise the documented recovery-from-parent-tool-call path.
  landRun(ctx, sessionId, idR4, null, 1, "user", r4t, { agentType: "general-purpose", description: "Branch B: single-depth check", toolUseId: callR4, spawnDepth: 1 }, "finished_unlanded", finishedRule);
  const r4End = Date.parse(r4t.lastTs!);

  t.user(iso(Math.max(r1End, r4End) + 10_000), [toolResultBlock(callR1, "done", false), toolResultBlock(callR4, "done", false)]);

  const gts = finalizeSession(ctx, sessionId, t);
  const stats = computeTreeStats([
    { start: r1Start, end: r1End, depth: 1 },
    { start: r4Start, end: r4End, depth: 1 },
    { start: r2Start, end: r2End, depth: 2 },
    { start: r3Start, end: r3End, depth: 3 },
  ]);
  gts.peak_concurrency = stats.peak;
  gts.max_depth = stats.maxDepth;
  ctx.cases.tree_depth3 = { session_id: sessionId, run_id: idR3, note: "R1(depth1) -> R2(depth2) -> R3(depth3) chain reaches max depth 3" };
  ctx.cases.spawn_depth2 = { session_id: sessionId, run_id: idR2, note: "spawned by a depth-1 run" };
  ctx.cases.spawn_depth3 = { session_id: sessionId, run_id: idR3, note: "spawned by a depth-2 run" };
  ctx.cases.peak_concurrency = { session_id: sessionId, note: `four runs overlap in time; expected peak concurrency ${stats.peak}` };
}

function buildDiedSession(ctx: GenCtx): void {
  const sessionId = uuid(ctx.rng);
  const startMs = BASE_MS + 6 * HOUR_MS;
  const t = new Transcript(sessionId, null, { value: ctx.repoDir }, "main", ctx.rng);
  t.user(iso(startMs), "Kick off a background verification pass.");
  const agentId = agentIdOf(ctx.rng);
  const callId = "toolu_" + hex(ctx.rng, 24);
  t.assistant(iso(startMs + MIN_MS), [toolUseBlock(callId, "Agent", agentInput("general-purpose", "Verify build output", "synthetic task prompt"))], mkUsage(50, 120, 0, 0, 0), "claude-fable-5-1");

  const rt = newRunTranscript(sessionId, agentId, ctx.repoDir, ctx.rng);
  rt.user(iso(startMs + MIN_MS), "Verify the build output.");
  const bashCallId = "toolu_" + hex(ctx.rng, 24);
  rt.assistant(iso(startMs + 2 * MIN_MS), [toolUseBlock(bashCallId, "Bash", bashInput("npm run build"))], mkUsage(60, 150, 0, 0, 0), "claude-sonnet-5");
  // file ends here — no tool_result for bashCallId. That is the "died" signal.
  landRun(ctx, sessionId, agentId, null, 1, "user", rt, { agentType: "general-purpose", description: "Verify build output", toolUseId: callId, spawnDepth: 1 }, "died", "last record is a tool call (Bash) with no result", [], true);

  // the parent session continues past the spawn point, without ever resolving the Agent call either.
  t.user(iso(startMs + 10 * MIN_MS), "While that runs, also check the changelog.");
  t.assistant(iso(startMs + 11 * MIN_MS), [textBlock("Checked the changelog; looks fine.")], mkUsage(30, 200, 100, 0, 0), "claude-fable-5-1");

  const gts = finalizeSession(ctx, sessionId, t);
  gts.peak_concurrency = 1;
  gts.max_depth = 1;
  ctx.cases.died_run = { session_id: sessionId, run_id: agentId, note: "subagent file ends on an unanswered Bash tool_use while the parent session continues past the spawn" };
}

function buildSidechainSession(ctx: GenCtx): void {
  const sessionId = uuid(ctx.rng);
  const startMs = BASE_MS + 8 * HOUR_MS;
  const t = new Transcript(sessionId, null, { value: ctx.repoDir }, "main", ctx.rng);
  t.user(iso(startMs), "Summarize the current state.");
  t.assistant(iso(startMs + MIN_MS), [textBlock(fillerText(ctx.rng, 120))], mkUsage(40, 300, 0, 0, 0), "claude-fable-5-1");

  t.user(iso(startMs + 2 * MIN_MS), "Side note while we wait.", { isSidechain: true });
  t.assistant(iso(startMs + 3 * MIN_MS), [textBlock(fillerText(ctx.rng, 80))], mkUsage(20, 150, 0, 0, 0), "claude-fable-5-1", { extra: { isSidechain: true } });

  t.user(iso(startMs + 4 * MIN_MS), "Back to the main thread: continue.");
  t.assistant(iso(startMs + 5 * MIN_MS), [textBlock(fillerText(ctx.rng, 120))], mkUsage(30, 250, 100, 0, 0), "claude-fable-5-1");

  finalizeSession(ctx, sessionId, t);
  ctx.cases.sidechain = { session_id: sessionId, note: "two isSidechain:true lines sandwiched between normal main-line turns" };
}

function buildCwdChangeSession(ctx: GenCtx): void {
  const sessionId = uuid(ctx.rng);
  const startMs = BASE_MS + 10 * HOUR_MS;
  const cwdRef = { value: ctx.repoDir };
  const t = new Transcript(sessionId, null, cwdRef, "main", ctx.rng);
  t.user(iso(startMs), "Work in the main repo first.");
  t.assistant(iso(startMs + MIN_MS), [textBlock(fillerText(ctx.rng, 100))], mkUsage(30, 200, 0, 0, 0), "claude-fable-5-1");

  cwdRef.value = ctx.secondaryDir;
  t.user(iso(startMs + 2 * MIN_MS), "Now switch to the secondary checkout.");
  t.assistant(iso(startMs + 3 * MIN_MS), [textBlock(fillerText(ctx.rng, 100))], mkUsage(25, 180, 50, 0, 0), "claude-fable-5-1");

  finalizeSession(ctx, sessionId, t);
  ctx.cases.cwd_change = { session_id: sessionId, note: `cwd switches from ${ctx.repoDir} to ${ctx.secondaryDir} partway through the session` };
}

function buildModelsSession(ctx: GenCtx): void {
  const sessionId = uuid(ctx.rng);
  const startMs = BASE_MS + 12 * HOUR_MS;
  const t = new Transcript(sessionId, null, { value: ctx.repoDir }, "main", ctx.rng);
  t.user(iso(startMs), "Compare outputs across a few model routes.");

  t.assistant(iso(startMs + MIN_MS), [textBlock(fillerText(ctx.rng, 100))], mkUsage(40, 300, 1000, 400, 200), "claude-zeta-9", { splitPresent: true });
  t.assistant(iso(startMs + 2 * MIN_MS), [textBlock(fillerText(ctx.rng, 100))], mkUsage(35, 280, 900, 350, 0), "us.anthropic.claude-opus-5-20260301-v1:0", { splitPresent: true });
  t.assistant(iso(startMs + 3 * MIN_MS), [textBlock(fillerText(ctx.rng, 100))], mkUsage(30, 260, 800, 500, 300), "claude-sonnet-5", { splitPresent: true });
  t.assistant(iso(startMs + 4 * MIN_MS), [textBlock(fillerText(ctx.rng, 100))], mkUsage(28, 240, 700, 600, 0), "claude-sonnet-5", { splitPresent: false });

  finalizeSession(ctx, sessionId, t);
  ctx.cases.unknown_model = { session_id: sessionId, note: "assistant line uses model id claude-zeta-9, unresolved by rates.json -> family fallback, marked assumed" };
  ctx.cases.bedrock_model = { session_id: sessionId, note: "assistant line uses Bedrock-style id us.anthropic.claude-opus-5-20260301-v1:0 -> normalises to claude-opus-5" };
  ctx.cases.usage_split_present = { session_id: sessionId, note: "assistant usage carries cache_creation.ephemeral_5m/1h_input_tokens explicitly" };
  ctx.cases.usage_split_absent = { session_id: sessionId, note: "assistant usage omits cache_creation; the whole creation count must price at the 5m rate" };
}

function buildZeroTurnSession(ctx: GenCtx): void {
  const sessionId = uuid(ctx.rng);
  const startMs = BASE_MS + 14 * HOUR_MS;
  const t = new Transcript(sessionId, null, { value: ctx.repoDir }, "main", ctx.rng);
  t.nonMessage({ type: "queue-operation", sessionId, timestamp: iso(startMs), operation: "add", reason: "user-queued", content: "synthetic queued note" });
  t.nonMessage({ type: "queue-operation", sessionId, timestamp: iso(startMs + 1000), operation: "remove", reason: "resolved", content: "synthetic queued note" });
  t.nonMessage({ type: "last-prompt", sessionId, lastPrompt: "synthetic placeholder prompt", leafUuid: uuid(ctx.rng) });
  t.nonMessage({ type: "ai-title", sessionId, aiTitle: "Synthetic session title" });
  t.nonMessage({ type: "file-history-snapshot", isSnapshotUpdate: false, messageId: uuid(ctx.rng), snapshot: {} });

  finalizeSession(ctx, sessionId, t);
  // NOTE (ambiguity): started_at/ended_at here come from the queue-operation
  // lines' timestamps, since last-prompt/ai-title/file-history-snapshot carry none in real
  // files either. Session.started_at/ended_at are nullable in the ledger schema for
  // exactly this reason; a reader may reasonably choose null instead. Flagged, not guessed past.
  ctx.cases.zero_turns = { session_id: sessionId, note: "only non-message line types; no user/assistant lines, turns=0" };
  ctx.cases.non_message_line_types = { session_id: sessionId, note: "queue-operation, last-prompt, ai-title, file-history-snapshot here; attachment and file-history-delta in the malformed-lines session" };
}

function buildRereadSession(ctx: GenCtx): void {
  const sessionId = uuid(ctx.rng);
  const startMs = BASE_MS + 16 * HOUR_MS;
  const t = new Transcript(sessionId, null, { value: ctx.repoDir }, "main", ctx.rng);
  const target = path.join(ctx.repoDir, "README.md");
  t.user(iso(startMs), "Read the README twice, once before and once after an unrelated turn.");
  const c1 = "toolu_" + hex(ctx.rng, 24);
  t.assistant(iso(startMs + MIN_MS), [toolUseBlock(c1, "Read", readInput(target))], mkUsage(20, 60, 0, 0, 0), "claude-sonnet-5");
  t.user(iso(startMs + MIN_MS + 5000), [toolResultBlock(c1, "# synthetic fixture repo", false)]);
  t.assistant(iso(startMs + 2 * MIN_MS), [textBlock(fillerText(ctx.rng, 60))], mkUsage(15, 100, 200, 0, 0), "claude-sonnet-5");
  const c2 = "toolu_" + hex(ctx.rng, 24);
  t.assistant(iso(startMs + 3 * MIN_MS), [toolUseBlock(c2, "Read", readInput(target))], mkUsage(18, 55, 0, 0, 0), "claude-sonnet-5");
  t.user(iso(startMs + 3 * MIN_MS + 5000), [toolResultBlock(c2, "# synthetic fixture repo", false)]);

  const gts = finalizeSession(ctx, sessionId, t);
  ctx.cases.re_reads = { session_id: sessionId, note: `Read called twice on ${target}; expected re_reads=${gts.re_reads}` };
}

function buildFirstToolResultSession(ctx: GenCtx): void {
  const sessionId = uuid(ctx.rng);
  const startMs = BASE_MS + 18 * HOUR_MS;
  const t = new Transcript(sessionId, null, { value: ctx.repoDir }, "main", ctx.rng);
  const danglingCallId = "toolu_" + hex(ctx.rng, 24);
  t.user(iso(startMs), [toolResultBlock(danglingCallId, "resumed from a prior compacted turn", false)]);
  t.assistant(iso(startMs + MIN_MS), [textBlock(fillerText(ctx.rng, 100))], mkUsage(25, 200, 500, 0, 0), "claude-fable-5-1");

  finalizeSession(ctx, sessionId, t);
  ctx.cases.first_message_tool_result = { session_id: sessionId, note: "the session's first user-type line carries a tool_result block, not a plain-string prompt (resumed/compacted session)" };
}

function buildMalformedSession(ctx: GenCtx): void {
  const sessionId = uuid(ctx.rng);
  const startMs = BASE_MS + 20 * HOUR_MS;
  const cwdRef = { value: ctx.repoDir };
  const t = new Transcript(sessionId, null, cwdRef, "main", ctx.rng);
  t.user(iso(startMs), "Normal turn before the corruption.");
  t.assistant(iso(startMs + MIN_MS), [textBlock(fillerText(ctx.rng, 60))], mkUsage(20, 150, 0, 0, 0), "claude-fable-5-1");
  t.nonMessage({
    type: "attachment", timestamp: iso(startMs + 90_000), sessionId, cwd: cwdRef.value, gitBranch: "main",
    isSidechain: false, parentUuid: null, uuid: uuid(ctx.rng), userType: "external", version: VERSION,
    attachment: { kind: "synthetic", note: "placeholder attachment" },
  });
  t.user(iso(startMs + 2 * MIN_MS), "Meta note.", { isMeta: true });
  t.malformed("truncated");
  t.malformed("empty");
  t.malformed("array");
  t.nonMessage({ type: "file-history-delta", timestamp: iso(startMs + 3 * MIN_MS), messageId: uuid(ctx.rng), snapshotMessageId: uuid(ctx.rng), trackingPath: "synthetic/tracked/path.txt", backup: "synthetic-backup-id" });
  t.assistant(iso(startMs + 4 * MIN_MS), [textBlock(fillerText(ctx.rng, 60))], mkUsage(18, 140, 50, 0, 0), "claude-fable-5-1");

  const agentId = agentIdOf(ctx.rng);
  const callId = "toolu_" + hex(ctx.rng, 24);
  t.assistant(iso(startMs + 5 * MIN_MS), [toolUseBlock(callId, "Agent", agentInput("general-purpose", "Trivial delegated check", "synthetic task prompt"))], mkUsage(30, 90, 0, 0, 0), "claude-fable-5-1");
  const rt = newRunTranscript(sessionId, agentId, ctx.repoDir, ctx.rng);
  rt.user(iso(startMs + 5 * MIN_MS), "Trivial delegated check.");
  rt.malformed("truncated");
  rt.malformed("empty");
  rt.malformed("array");
  rt.assistant(iso(startMs + 6 * MIN_MS), [textBlock(fillerText(ctx.rng, 60))], mkUsage(15, 90, 0, 0, 0), "claude-fable-5-1");
  landRun(ctx, sessionId, agentId, null, 1, "user", rt, { agentType: "general-purpose", description: "Trivial delegated check", toolUseId: callId, spawnDepth: 1 }, "unknown", "no write, no >=300-char final text");
  t.user(iso(startMs + 7 * MIN_MS), [toolResultBlock(callId, "done", false)]);

  const gts = finalizeSession(ctx, sessionId, t, [{ file: `${sessionId}/subagents/agent-${agentId}.jsonl`, indices: [...rt.badIndices] }]);
  // 2026-09-03 (label provenance note): this session has exactly one depth-1 run,
  // so its tree is peak 1 / depth 1 (max depth over all runs). The first cut
  // left both at the zero default; corrected here, not in the reader.
  gts.peak_concurrency = 1;
  gts.max_depth = 1;
  ctx.cases.malformed_lines = { session_id: sessionId, note: `main file has ${t.badIndices.length} malformed lines (truncated, empty, array) at indices ${t.badIndices.join(",")}` };
  ctx.cases.malformed_lines_subagent = { session_id: sessionId, run_id: agentId, note: `subagent file has ${rt.badIndices.length} malformed lines at indices ${rt.badIndices.join(",")}` };
  ctx.cases.is_meta_line = { session_id: sessionId, note: "a user line with isMeta:true" };
}

function buildStillRunningSession(ctx: GenCtx, now: string): void {
  const nowMs = Date.parse(now);
  const sessionId = uuid(ctx.rng);
  const startMs = nowMs - 6 * MIN_MS;
  const t = new Transcript(sessionId, null, { value: ctx.repoDir }, "main", ctx.rng);
  t.user(iso(startMs), "Kick off one more check right before wrap-up.");
  const agentId = agentIdOf(ctx.rng);
  const callId = "toolu_" + hex(ctx.rng, 24);
  t.assistant(iso(startMs + MIN_MS), [toolUseBlock(callId, "Agent", agentInput("general-purpose", "Still-running probe", "synthetic task prompt"))], mkUsage(40, 100, 0, 0, 0), "claude-fable-5-1");

  const runStartMs = startMs + MIN_MS;
  const runLastMs = nowMs - 3 * MIN_MS;
  const rt = newRunTranscript(sessionId, agentId, ctx.repoDir, ctx.rng);
  rt.user(iso(runStartMs), "Still-running probe.");
  const bashCallId = "toolu_" + hex(ctx.rng, 24);
  rt.assistant(iso(runStartMs + MIN_MS), [toolUseBlock(bashCallId, "Bash", bashInput("npm test"))], mkUsage(50, 120, 0, 0, 0), "claude-sonnet-5");
  rt.user(iso(runStartMs + MIN_MS + 5000), [toolResultBlock(bashCallId, "running...", false)]);
  const lastCallId = "toolu_" + hex(ctx.rng, 24);
  rt.assistant(iso(runLastMs), [toolUseBlock(lastCallId, "Bash", bashInput("npm test -- --watch"))], mkUsage(30, 80, 100, 0, 0), "claude-sonnet-5");
  // last record: an in-flight tool_use, timestamped within minutes of `now`, no final text.
  landRun(ctx, sessionId, agentId, null, 1, "user", rt, { agentType: "general-purpose", description: "Still-running probe", toolUseId: callId, spawnDepth: 1 }, "still_running", "last record < 10 minutes old (relative to now) and no final text; first-match beats the died heuristic", [], true);

  // The main session's own ended_at is its own last line (the Agent spawn) — well before
  // runLastMs, which belongs to the child run's transcript, not the parent's.
  const gts = finalizeSession(ctx, sessionId, t);
  gts.peak_concurrency = 1;
  gts.max_depth = 1;
  ctx.cases.still_running = { session_id: sessionId, run_id: agentId, note: `run's last event at ${iso(runLastMs)}, within minutes of now=${now}; the parent session's own last line is earlier` };
}

function buildRevert(ctx: GenCtx): void {
  if (!ctx.commitAforRevert) throw new Error("commit A missing for revert");
  const targetSha = ctx.commitAforRevert;
  const targetCommit = ctx.commits.find((c) => c.sha === targetSha);
  if (!targetCommit) throw new Error("target commit not tracked");
  const revertMs = Date.parse(targetCommit.author_time) + 10 * DAY_MS;
  const sha = revertCommit(ctx.repoDir, targetSha, iso(revertMs));
  const subject = subjectOf(ctx.repoDir, sha);
  targetCommit.reverted_by = sha;
  targetCommit.reverted_at = iso(revertMs);
  ctx.commits.push({ sha, subject, author_time: iso(revertMs), session_id: null, attribution: "outside", reverted_by: null, reverted_at: null });
  ctx.cases.commit_revert = {
    session_id: targetCommit.session_id ?? "",
    note: `commit ${sha} reverts ${targetSha} ("${targetCommit.subject}") 10 days later, within the 30-day window`,
  };
}

// Well after the revert (BASE_MS + 10 + 10 days) and every other fixed timestamp above,
// so filler sessions can never collide with the commit/revert schedule at any --sessions size.
const FILLER_BASE_MS = BASE_MS + 60 * DAY_MS;

// ---------------------------------------------------------------------------
// Claim/truth case sessions (the claim design, blind fixtures):
// report_delivered, session_outcome, report_cited -- one positive + one negative
// each. Written blind to src/read/ and src/grade/: expectations come only from
// the claim design and the fate rules, encoded in GTRun.expected_fate where the
// ground-truth schema has a field for it, and spelled out in the case `note`
// otherwise (claim kind, subject, and verdict), per the fixture generator's own
// case interface -- there is no dedicated claim/verdict field on GTCase or GTRun.
// ---------------------------------------------------------------------------

function buildClaimsReportDeliveredSession(ctx: GenCtx): void {
  const sessionId = uuid(ctx.rng);
  const startMs = BASE_MS + 22 * HOUR_MS;
  const t = new Transcript(sessionId, null, { value: ctx.repoDir }, "main", ctx.rng);
  t.user(iso(startMs), "Two small delegated tasks: write an audit, then patch the parser.");

  let cursor = startMs + MIN_MS;

  // POSITIVE: final text names a path with no backing Write/Edit/NotebookEdit in this
  // run's own turns, and the path exists on disk -> report_delivered claim, subject
  // "docs/audit.md", report_on_disk = yes -> verdict kept (the claim design).
  const posPath = path.join(ctx.repoDir, "docs/audit.md");
  const rPos = buildFateRun(ctx, sessionId, t, cursor, "Write an audit report", (rt, _id, s) => {
    rt.user(iso(s), "Write up an audit of the current config and save it.");
    rt.assistant(iso(s + 30_000), [textBlock("I wrote the audit to docs/audit.md.")], mkUsage(60, 200, 0, 0, 0), "claude-sonnet-5");
    // The file exists on disk (report_on_disk = yes) but no Write/Edit/NotebookEdit tool
    // call backs it in this run's own turns -- exactly the shape report_delivered exists
    // to catch (the claim design: "an agent that says ... it delivered something ... when
    // there is no Write/Edit/NotebookEdit tool call in that owner's own turns to back it").
    writeUntracked(ctx.repoDir, "docs/audit.md", "# Audit\n\nSynthetic audit body.\n");
    return {
      filesWritten: [] as string[],
      fate: "landed_untracked" as Fate,
      fateRule: "no Write/Edit/NotebookEdit claim for this run, but the report_delivered subject (docs/audit.md) exists on disk untracked -> report_delivered feeds the run's fate the way file_written does (the claim design)",
      unanswered: false,
    };
  });
  cursor += 5 * MIN_MS;

  // NEGATIVE: final text names a path that a Write call in this SAME run's own turns
  // backs -> that is file_written, not report_delivered (the undercount rule: no double
  // counting). Expect NO report_delivered claim for this run.
  const negPath = path.join(ctx.repoDir, "src/parser.ts");
  const rNeg = buildFateRun(ctx, sessionId, t, cursor, "Add the parser module", (rt, _id, s) => {
    rt.user(iso(s), "Add a small parser module.");
    const wc = "toolu_" + hex(ctx.rng, 24);
    rt.assistant(iso(s + 20_000), [toolUseBlock(wc, "Write", writeInput(negPath, "export function parse() {}\n"))], mkUsage(70, 180, 0, 260, 0), "claude-sonnet-5");
    rt.user(iso(s + 25_000), [toolResultBlock(wc, "File written", false)]);
    rt.assistant(iso(s + 30_000), [textBlock("I created src/parser.ts and left it uncommitted. " + fillerText(ctx.rng, 260))], mkUsage(20, 300, 180, 0, 0), "claude-sonnet-5");
    writeUntracked(ctx.repoDir, "src/parser.ts", "export function parse() {}\n");
    return {
      filesWritten: [negPath] as string[],
      fate: "landed_untracked" as Fate,
      fateRule: "a file the run wrote exists on disk, none tracked",
      unanswered: false,
    };
  });

  const gts = finalizeSession(ctx, sessionId, t);
  gts.peak_concurrency = 1;
  gts.max_depth = 1;
  ctx.cases.report_delivered_positive = {
    session_id: sessionId,
    run_id: rPos.agentId,
    note: `POSITIVE: claim kind=report_delivered, subject="docs/audit.md" (path ${posPath}), source=final_text, mark=estimated. No Write/Edit/NotebookEdit for that path in run ${rPos.agentId}'s own turns; the path exists on disk -> truth report_on_disk=yes -> verdict KEPT (the claim design: "path, report_on_disk = yes -> kept"). Feeds the run's expected_fate=landed_untracked (report survives on disk, untracked) "the way file_written does".`,
  };
  // Owner is the subagent run rPos: its final text names the path; the parent session ends
  // on the Agent tool_use/result pair, not text. Path on disk -> kept (CLAIMS.md L36).
  ctx.expected_verdicts.push({ owner: rPos.agentId, kind: "report_delivered", subject: "docs/audit.md", verdict: "kept", where: "report_delivered_positive" });
  ctx.cases.report_delivered_negative = {
    session_id: sessionId,
    run_id: rNeg.agentId,
    note: `NEGATIVE: final text of run ${rNeg.agentId} names src/parser.ts, which this run's own Write tool_use backs (${negPath}) -> that is a file_written claim, NOT report_delivered (the claim design undercount rule: "A path that matches an actual Write/Edit/NotebookEdit in the same owner is file_written, not report_delivered; it is skipped here so nothing is double-counted"). Expect NO report_delivered claim for this run. Fate is driven by file_written as usual: expected_fate=landed_untracked (file survives on disk, untracked).`,
  };
  // The path in rNeg's final text matches its own Write in the same owner -> file_written,
  // not report_delivered; no report_delivered claim is produced -> absent (CLAIMS.md L29-30).
  ctx.expected_verdicts.push({ owner: rNeg.agentId, kind: "report_delivered", subject: "src/parser.ts", verdict: "absent", where: "report_delivered_negative" });
}

function buildSessionOutcomePositiveSession(ctx: GenCtx): void {
  const sessionId = uuid(ctx.rng);
  const startMs = BASE_MS + 24 * HOUR_MS;
  const t = new Transcript(sessionId, null, { value: ctx.repoDir }, "main", ctx.rng);
  t.user(iso(startMs), "Finish the last touch-up and wrap the session.");

  // README.md was committed and tracked in buildCommitsSession's bootstrap commit; it is
  // already on disk and in the git index, so a run that (re-)writes it lands as
  // landed_tracked without this case needing to mint a new commit of its own.
  const landedPath = path.join(ctx.repoDir, "README.md");
  const rLanded = buildFateRun(ctx, sessionId, t, startMs + MIN_MS, "Touch up the README", (rt, _id, s) => {
    rt.user(iso(s), "Touch up the README; it's already tracked in git.");
    const wc = "toolu_" + hex(ctx.rng, 24);
    rt.assistant(iso(s + 20_000), [toolUseBlock(wc, "Write", writeInput(landedPath, "# synthetic fixture repo\n"))], mkUsage(50, 150, 0, 220, 0), "claude-sonnet-5");
    rt.user(iso(s + 25_000), [toolResultBlock(wc, "File written", false)]);
    rt.assistant(iso(s + 30_000), [textBlock(fillerText(ctx.rng, 320))], mkUsage(20, 300, 150, 0, 0), "claude-sonnet-5");
    return {
      filesWritten: [landedPath] as string[],
      fate: "landed_tracked" as Fate,
      fateRule: "a file the run wrote exists on disk and is tracked",
      unanswered: false,
    };
  });

  const gts = finalizeSession(ctx, sessionId, t);
  gts.peak_concurrency = 1;
  gts.max_depth = 1;
  writeFacets(ctx, sessionId, "achieved", "Wrap up the last touch-up and confirm the session's work is done.");
  ctx.cases.session_outcome_positive = {
    session_id: sessionId,
    run_id: rLanded.agentId,
    note: `POSITIVE: claim kind=session_outcome, subject="achieved", source=insights_facet, mark=claimed (from usage-data/facets/${sessionId}.json: {"outcome":"achieved", ...}). This session has one run (${rLanded.agentId}) with expected_fate=landed_tracked -> "any run in the session landed" is true -> verdict KEPT (the claim design: "achieved / mostly_achieved -> kept if any run in the session landed"). Graded against fate, never the claim's own word.`,
  };
  // session_outcome is owned by the session; /insights outcome "achieved" and a run landed
  // (landed_tracked) -> kept (CLAIMS.md L56).
  ctx.expected_verdicts.push({ owner: sessionId, kind: "session_outcome", subject: "achieved", verdict: "kept", where: "session_outcome_positive" });
}

function buildSessionOutcomeNegativeSession(ctx: GenCtx): void {
  const sessionId = uuid(ctx.rng);
  const startMs = BASE_MS + 26 * HOUR_MS;
  const t = new Transcript(sessionId, null, { value: ctx.repoDir }, "main", ctx.rng);
  t.user(iso(startMs), "Kick off one delegated check and wrap up.");
  const agentId = agentIdOf(ctx.rng);
  const callId = "toolu_" + hex(ctx.rng, 24);
  t.assistant(iso(startMs + MIN_MS), [toolUseBlock(callId, "Agent", agentInput("general-purpose", "Run the release check", "synthetic task prompt"))], mkUsage(45, 110, 0, 0, 0), "claude-fable-5-1");

  const rt = newRunTranscript(sessionId, agentId, ctx.repoDir, ctx.rng);
  rt.user(iso(startMs + MIN_MS), "Run the release check.");
  const bashCallId = "toolu_" + hex(ctx.rng, 24);
  rt.assistant(iso(startMs + 2 * MIN_MS), [toolUseBlock(bashCallId, "Bash", bashInput("npm run release:check"))], mkUsage(55, 130, 0, 0, 0), "claude-sonnet-5");
  // file ends here -- no tool_result for bashCallId. That is the "died" signal, same as
  // buildDiedSession's case; this session's only run dies and the parent never resolves
  // the Agent call either.
  landRun(ctx, sessionId, agentId, null, 1, "user", rt, { agentType: "general-purpose", description: "Run the release check", toolUseId: callId, spawnDepth: 1 }, "died", "last record is a tool call (Bash) with no result", [], true);

  const gts = finalizeSession(ctx, sessionId, t);
  gts.peak_concurrency = 1;
  gts.max_depth = 1;
  writeFacets(ctx, sessionId, "achieved", "Ship the release check cleanly before signing off.");
  ctx.cases.session_outcome_negative = {
    session_id: sessionId,
    run_id: agentId,
    note: `NEGATIVE: claim kind=session_outcome, subject="achieved", source=insights_facet, mark=claimed (from usage-data/facets/${sessionId}.json: {"outcome":"achieved", ...}), but this session's only run (${agentId}) has expected_fate=died -> "every run died" -> verdict GONE (the claim design: "achieved / mostly_achieved -> ... gone if every run died or nothing landed"). Graded against fate, never the claim's own word: the claim says achieved, the truth says otherwise.`,
  };
  // session_outcome is owned by the session; /insights outcome "achieved" but the only run
  // died -> every run died / nothing landed -> gone (CLAIMS.md L57).
  ctx.expected_verdicts.push({ owner: sessionId, kind: "session_outcome", subject: "achieved", verdict: "gone", where: "session_outcome_negative" });
}

function buildReportCitedSessions(ctx: GenCtx): void {
  // Session A: delivers a report_delivered claim naming a path, no backing Write/Edit.
  const sessionAId = uuid(ctx.rng);
  const startAMs = BASE_MS + 28 * HOUR_MS;
  const tA = new Transcript(sessionAId, null, { value: ctx.repoDir }, "main", ctx.rng);
  tA.user(iso(startAMs), "Write up the findings and save them for later reference.");

  const citedPath = path.join(ctx.repoDir, "docs/findings.md");
  const rSource = buildFateRun(ctx, sessionAId, tA, startAMs + MIN_MS, "Write up the findings", (rt, _id, s) => {
    rt.user(iso(s), "Write up the findings and save them.");
    rt.assistant(iso(s + 30_000), [textBlock("I saved the findings to docs/findings.md.")], mkUsage(55, 190, 0, 0, 0), "claude-sonnet-5");
    writeUntracked(ctx.repoDir, "docs/findings.md", "# Findings\n\nSynthetic findings body.\n");
    return {
      filesWritten: [] as string[],
      fate: "landed_untracked" as Fate,
      fateRule: "no Write/Edit/NotebookEdit claim for this run, but the report_delivered subject (docs/findings.md) exists on disk untracked -> report_delivered feeds the run's fate the way file_written does",
      unanswered: false,
    };
  });

  const gtsA = finalizeSession(ctx, sessionAId, tA);
  gtsA.peak_concurrency = 1;
  gtsA.max_depth = 1;

  // Session B: strictly later than session A (starts after A's last emitted line), reads
  // the same path with a Read tool_use -- the report_cited join is across sessions, "in
  // the same session or a later one" (the claim design).
  const sessionBId = uuid(ctx.rng);
  const startBMs = BASE_MS + 30 * HOUR_MS;
  const tB = new Transcript(sessionBId, null, { value: ctx.repoDir }, "main", ctx.rng);
  tB.user(iso(startBMs), "Before starting, check the findings from before.");
  const readCallId = "toolu_" + hex(ctx.rng, 24);
  tB.assistant(iso(startBMs + MIN_MS), [toolUseBlock(readCallId, "Read", readInput(citedPath))], mkUsage(25, 70, 0, 0, 0), "claude-sonnet-5");
  tB.user(iso(startBMs + MIN_MS + 5000), [toolResultBlock(readCallId, "# Findings\n\nSynthetic findings body.", false)]);
  tB.assistant(iso(startBMs + 2 * MIN_MS), [textBlock(fillerText(ctx.rng, 120))], mkUsage(20, 200, 80, 0, 0), "claude-sonnet-5");

  finalizeSession(ctx, sessionBId, tB);

  ctx.cases.report_cited_positive = {
    session_id: sessionAId,
    run_id: rSource.agentId,
    note: `POSITIVE: claim kind=report_delivered, subject="docs/findings.md" (path ${citedPath}), delivered by run ${rSource.agentId} in session ${sessionAId} (final text at ${iso(startAMs + MIN_MS + 30_000)}). A LATER session ${sessionBId} (starts ${iso(startBMs)}, after session ${sessionAId} ends) issues a Read tool_use on the same path at ${iso(startBMs + MIN_MS)} -> truth kind=report_cited, value=yes (the claim design: "yes if any tool_call of kind read/edit/bash has a path ... that contains the subject path, with ts after the claim, in any session in scope"). report_delivered verdict KEPT (path, report_on_disk=yes, and cited). Delivering run's expected_fate=landed_untracked.`,
  };
  // Owner is the delivering subagent run rSource in session A. Subject path is on disk (and
  // is read later in session B) -> report_delivered verdict kept (CLAIMS.md L36).
  ctx.expected_verdicts.push({ owner: rSource.agentId, kind: "report_delivered", subject: "docs/findings.md", verdict: "kept", where: "report_cited_positive" });
}

function buildReportCitedNegativeSession(ctx: GenCtx): void {
  const sessionId = uuid(ctx.rng);
  const startMs = BASE_MS + 32 * HOUR_MS;
  const t = new Transcript(sessionId, null, { value: ctx.repoDir }, "main", ctx.rng);
  t.user(iso(startMs), "Summarize today's findings; no need to keep the file around.");

  const orphanPath = path.join(ctx.repoDir, "docs/orphan-report.md");
  const rOrphan = buildFateRun(ctx, sessionId, t, startMs + MIN_MS, "Summarize today's findings", (rt, _id, s) => {
    rt.user(iso(s), "Summarize today's findings into a report.");
    // No Write/Edit/NotebookEdit tool call at all, and the named path is never created on
    // disk either -- report_on_disk = no, so the report_delivered claim's own verdict is
    // `gone` regardless of citation. Nothing later reads, edits, or commits this path in
    // any session, so report_cited = no.
    const finalText = `I delivered the summary to docs/orphan-report.md. ${fillerText(ctx.rng, 300)}`;
    rt.assistant(iso(s + 30_000), [textBlock(finalText)], mkUsage(60, 320, 0, 0, 0), "claude-sonnet-5");
    return {
      filesWritten: [] as string[],
      fate: "finished_unlanded" as Fate,
      fateRule: "final text >= 300 chars, no written file survives, and the report_delivered subject never reaches disk (report_on_disk = no) so it cannot feed a landed fate either",
      unanswered: false,
    };
  });

  const gts = finalizeSession(ctx, sessionId, t);
  gts.peak_concurrency = 1;
  gts.max_depth = 1;
  ctx.cases.report_cited_negative = {
    session_id: sessionId,
    run_id: rOrphan.agentId,
    note: `NEGATIVE: claim kind=report_delivered, subject="docs/orphan-report.md" (path ${orphanPath}); no Write/Edit for that path, and it is never created on disk -> truth report_on_disk=no -> report_delivered verdict GONE, independent of citation (the claim design: "path, report_on_disk = no -> gone"). Nothing later reads/edits/commits this path in any session -> truth kind=report_cited, value=no. expected_fate=finished_unlanded was chosen deliberately: this run's final text is padded to >=300 chars, matching the generic terminal-fate rule ("final text >= 300 chars exists, no written file survives") that applies once neither file_written nor a kept report_delivered lands a file; had the final text been kept under 300 chars instead, the correct fate would be unknown, per the same rule that governs buildFatesSession's unknown_fate case.`,
  };
  // Owner is the delivering subagent run rOrphan. Subject path never reaches disk
  // (report_on_disk=no) -> report_delivered verdict gone, regardless of citation (CLAIMS.md L37).
  ctx.expected_verdicts.push({ owner: rOrphan.agentId, kind: "report_delivered", subject: "docs/orphan-report.md", verdict: "gone", where: "report_cited_negative" });
}

function buildReportCitedIsolatedNegativeSession(ctx: GenCtx): void {
  const sessionId = uuid(ctx.rng);
  const startMs = BASE_MS + 34 * HOUR_MS;
  const t = new Transcript(sessionId, null, { value: ctx.repoDir }, "main", ctx.rng);
  t.user(iso(startMs), "Write up an unread report; no one is waiting on it.");

  const unreadPath = path.join(ctx.repoDir, "docs/unread-report.md");
  const rUnread = buildFateRun(ctx, sessionId, t, startMs + MIN_MS, "Write up an unread report", (rt, _id, s) => {
    rt.user(iso(s), "Write up a report on the current state and save it.");
    rt.assistant(iso(s + 30_000), [textBlock("I saved the report to docs/unread-report.md.")], mkUsage(55, 190, 0, 0, 0), "claude-sonnet-5");
    // No Write/Edit/NotebookEdit tool call backs this path -> report_delivered, not
    // file_written. Unlike report_cited_negative, the file DOES reach disk here
    // (report_on_disk = yes) -- this isolates report_cited = no on its own, without also
    // forcing report_on_disk = no at the same time. Nothing anywhere (this session or any
    // other) ever reads, edits, or commits this path afterward.
    writeUntracked(ctx.repoDir, "docs/unread-report.md", "# Unread report\n\nSynthetic report body nobody reads.\n");
    return {
      filesWritten: [] as string[],
      fate: "landed_untracked" as Fate,
      fateRule: "no Write/Edit/NotebookEdit claim for this run, but the report_delivered subject (docs/unread-report.md) exists on disk untracked -> report_delivered feeds the run's fate the way file_written does",
      unanswered: false,
    };
  });

  const gts = finalizeSession(ctx, sessionId, t);
  gts.peak_concurrency = 1;
  gts.max_depth = 1;
  ctx.cases.report_cited_isolated_negative = {
    session_id: sessionId,
    run_id: rUnread.agentId,
    note: `ISOLATED NEGATIVE (decouples report_cited=no from report_on_disk=no): claim kind=report_delivered, subject="docs/unread-report.md" (path ${unreadPath}), delivered by run ${rUnread.agentId}; no Write/Edit/NotebookEdit for that path, but it DOES exist on disk (untracked) -> truth report_on_disk=yes -> report_delivered verdict KEPT on its own (the claim design: "path, report_on_disk = yes -> kept (reason names on-disk, and cited or not)"), independent of citation. Nothing anywhere ever reads, edits, or commits this path afterward -> truth kind=report_cited, value=no, tested here in isolation from report_on_disk (contrast with report_cited_negative, where report_on_disk=no and report_cited=no are conflated). expected_fate=landed_untracked: the report survives on disk untracked, so report_delivered feeds the run's fate the way file_written does, exactly as in report_delivered_positive and report_cited_positive's delivering run.`,
  };
  // Owner is the delivering subagent run rUnread. Subject path is on disk but never cited;
  // on-disk decides a path subject -> kept, "and cited or not" (CLAIMS.md L36).
  ctx.expected_verdicts.push({ owner: rUnread.agentId, kind: "report_delivered", subject: "docs/unread-report.md", verdict: "kept", where: "report_cited_isolated_negative" });
}

function buildFillerSession(ctx: GenCtx, i: number): void {
  const sessionId = uuid(ctx.rng);
  const startMs = FILLER_BASE_MS + i * HOUR_MS;
  const t = new Transcript(sessionId, null, { value: ctx.repoDir }, "main", ctx.rng);
  t.user(iso(startMs), `Ordinary filler session ${i}.`);
  t.assistant(iso(startMs + MIN_MS), [textBlock(fillerText(ctx.rng, 80))], mkUsage(20, 150, 0, 0, 0), "claude-fable-5-1");
  finalizeSession(ctx, sessionId, t);
}

// ---------------------------------------------------------------------------
// Orchestration
// ---------------------------------------------------------------------------

const NUM_CASE_SESSIONS = 19;

export async function generate(opts: { out: string; seed: number; sessions: number; now?: string }): Promise<GroundTruth> {
  const outDir = path.resolve(opts.out);
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });

  const repoDir = path.join(outDir, "repo");
  const secondaryDir = path.join(outDir, "repo-secondary");
  initRepo(repoDir);
  mkdirSync(secondaryDir, { recursive: true });

  const slug = slugify(repoDir);
  const claudeRoot = path.join(outDir, "claude");
  const projectsDir = path.join(claudeRoot, "projects", slug);
  mkdirSync(projectsDir, { recursive: true });

  const rng = mulberry32(opts.seed >>> 0);
  const now = opts.now ?? DEFAULT_NOW;
  const rates = loadRates();

  const ctx: GenCtx = { repoDir, secondaryDir, projectsDir, claudeRoot, rng, sessions: [], runs: [], commits: [], cases: {}, expected_verdicts: [] };

  buildCommitsSession(ctx);
  buildFatesSession(ctx);
  buildTreeSession(ctx);
  buildDiedSession(ctx);
  buildSidechainSession(ctx);
  buildCwdChangeSession(ctx);
  buildModelsSession(ctx);
  buildZeroTurnSession(ctx);
  buildRereadSession(ctx);
  buildFirstToolResultSession(ctx);
  buildMalformedSession(ctx);
  buildClaimsReportDeliveredSession(ctx);
  buildSessionOutcomePositiveSession(ctx);
  buildSessionOutcomeNegativeSession(ctx);
  buildReportCitedSessions(ctx);
  buildReportCitedNegativeSession(ctx);
  buildReportCitedIsolatedNegativeSession(ctx);
  buildStillRunningSession(ctx, now);
  buildRevert(ctx);

  const extra = Math.max(0, opts.sessions - NUM_CASE_SESSIONS);
  for (let i = 0; i < extra; i++) buildFillerSession(ctx, i);

  const gt: GroundTruth = {
    seed: opts.seed,
    now,
    repo_path: repoDir,
    secondary_path: secondaryDir,
    claude_projects_dir: projectsDir,
    rates_version: rates.rates_version,
    sessions: ctx.sessions,
    runs: ctx.runs,
    commits: ctx.commits,
    cases: ctx.cases,
    expected_verdicts: ctx.expected_verdicts,
  };
  writeFileSync(path.join(outDir, "ground_truth.json"), JSON.stringify(gt, null, 2) + "\n");
  return gt;
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function parseArgs(argv: string[]): { out: string; seed: number; sessions: number; now?: string } {
  const opts: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a && a.startsWith("--")) {
      opts[a.slice(2)] = argv[i + 1] ?? "";
      i++;
    }
  }
  return {
    out: opts.out ?? "eval/fixtures/generated",
    seed: Number(opts.seed ?? "1"),
    sessions: Number(opts.sessions ?? String(NUM_CASE_SESSIONS)),
    now: opts.now,
  };
}

function isMain(): boolean {
  const invoked = process.argv[1] ? path.resolve(process.argv[1]) : "";
  return invoked === fileURLToPath(import.meta.url);
}

if (isMain()) {
  const args = parseArgs(process.argv.slice(2));
  generate(args)
    .then((gt) => {
      console.log(`generated ${gt.sessions.length} sessions, ${gt.runs.length} runs, ${gt.commits.length} commits -> ${args.out}`);
    })
    .catch((err: unknown) => {
      console.error(err);
      process.exit(1);
    });
}
