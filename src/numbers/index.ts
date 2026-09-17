/**
 * Numbers sharing, opt in, off by default.
 *
 * The card's aggregates are the usage data. This module holds the one setting file, builds
 * the payload, prints it in full before the first send, and posts it. Nothing here runs
 * from the pipeline: the send is made by the command, after the report is written, so a
 * run with sharing off opens no socket at all.
 */
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { STATE_ROOT, cliVersion, type Scope } from "../config.js";
import { appliedFixIds } from "../fix/index.js";
import { DEFAULT_HOST, assertHttpsHost } from "../hosted/index.js";
import type { Report } from "../schema/socket.js";

/** Version 1 of the payload. Numbers and allowlisted enums only. */
export const NUMBERS_VERSION = 1;
const TIMEOUT_MS = 5000;

export interface NumbersSetting {
  install_id: string;
  share: boolean;
  asked_at: string | null;
  star_shown_at?: string | null;
}

export interface NumbersPayload {
  v: number;
  install_id: string;
  tool_version: string;
  claude_code_version: string | null;
  node: string;
  os: "darwin" | "linux" | "win32" | "other";
  arch: "arm64" | "x64" | "other";
  editor: "terminal" | "vscode";
  scope: "repo" | "all";
  period_days: number | null;
  sessions: number;
  agent_runs: number;
  cost_usd: number;
  commits: number;
  cost_per_commit: number | null;
  files_written: number;
  files_alive: number;
  runs_no_fate: number;
  runs_died: number;
  peak_concurrency: number;
  max_depth: number;
  models: Array<{ model: string; runs: number }>;
  watch_on: boolean;
  fixes_applied: string[];
  run_ms: number | null;
}

export function numbersPath(root: string = STATE_ROOT): string { return path.join(root, "numbers.json"); }

/** The host every send goes to: ACTUALS_HOST when set, the site otherwise. Read late, so a test can set it. */
export function numbersHost(): string { return process.env["ACTUALS_HOST"] ?? DEFAULT_HOST; }

/** The stored setting, or null when the file is not there yet (nobody has been asked). */
export function readNumbersSetting(root: string = STATE_ROOT): NumbersSetting | null {
  const p = numbersPath(root);
  if (!existsSync(p)) return null;
  let raw: unknown;
  try { raw = JSON.parse(readFileSync(p, "utf8")); } catch { return null; }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  const id = typeof o["install_id"] === "string" && /^[0-9a-f]{32}$/.test(o["install_id"]) ? o["install_id"] : null;
  if (!id) return null;
  return {
    install_id: id,
    share: o["share"] === true,
    asked_at: typeof o["asked_at"] === "string" ? o["asked_at"] : null,
    star_shown_at: typeof o["star_shown_at"] === "string" ? o["star_shown_at"] : null,
  };
}

/**
 * Merge a patch into the setting and write it back. The install id is random, written once,
 * and derived from nothing: not the machine, not the user, not a repository. Deleting
 * ~/.actuals deletes it.
 */
export function writeNumbersSetting(root: string = STATE_ROOT, patch: Partial<NumbersSetting> = {}): NumbersSetting {
  const current = readNumbersSetting(root);
  const next: NumbersSetting = {
    install_id: current?.install_id ?? randomBytes(16).toString("hex"),
    share: patch.share ?? current?.share ?? false,
    asked_at: patch.asked_at ?? current?.asked_at ?? null,
    star_shown_at: patch.star_shown_at ?? current?.star_shown_at ?? null,
  };
  mkdirSync(root, { recursive: true });
  writeFileSync(numbersPath(root), JSON.stringify(next, null, 2) + "\n");
  return next;
}

/** True once the question has been answered, whatever the answer was. */
export function alreadyAsked(s: NumbersSetting | null): boolean { return !!s && typeof s.asked_at === "string" && s.asked_at.length > 0; }

const round2 = (n: number): number => Math.round(n * 100) / 100;

function periodDays(report: Report, scope: Scope): number | null {
  const since = scope.since ? scope.since.toISOString() : report.window.since;
  const until = report.window.until;
  if (!since || !until) return null;
  const a = new Date(since).getTime(), b = new Date(until).getTime();
  if (!Number.isFinite(a) || !Number.isFinite(b) || b < a) return null;
  return Math.max(1, Math.round((b - a) / 86_400_000));
}

export interface NumbersContext {
  installId: string;
  scope: Scope;
  stateDir: string;
  /** the ledger's sessions, for the Claude Code version they were written by */
  sessions: Array<{ tool_version: string | null }>;
  editor: "terminal" | "vscode";
  watchOn: boolean;
  runMs: number | null;
}

/** The exact object that goes over the wire. Aggregates and allowlisted enums, nothing else. */
/** The platform as one of the endpoint's allowed words; anything else is "other". */
function osName(): NumbersPayload["os"] { const p = process.platform; return p === "darwin" || p === "linux" || p === "win32" ? p : "other"; }
function archName(): NumbersPayload["arch"] { const a = process.arch; return a === "arm64" || a === "x64" ? a : "other"; }
/** A model id as the endpoint accepts it: lower case, [a-z0-9.-:], 64 chars, or empty when nothing survives. */
function modelId(m: string): string { const s = m.toLowerCase().replace(/[^a-z0-9.\-:]/g, "").replace(/^[^a-z0-9]+/, ""); return s.slice(0, 64); }

export function buildNumbersPayload(report: Report, ctx: NumbersContext): NumbersPayload {
  const h = report.headline;
  const versions = ctx.sessions.map((s) => s.tool_version).filter((v): v is string => typeof v === "string" && v.length > 0).sort();
  const known = new Set(report.fixes.map((f) => f.id));
  return {
    v: NUMBERS_VERSION,
    install_id: ctx.installId,
    tool_version: cliVersion() || "0.0.0",
    claude_code_version: versions.at(-1) ?? null,
    node: process.versions.node,
    os: osName(),
    arch: archName(),
    editor: ctx.editor,
    scope: ctx.scope.allProjects ? "all" : "repo",
    period_days: periodDays(report, ctx.scope),
    sessions: report.sessions.length,
    agent_runs: report.share.agent_runs,
    cost_usd: round2(h.cost_usd.value),
    commits: h.commits.value,
    cost_per_commit: h.cost_per_commit.value === null ? null : round2(h.cost_per_commit.value),
    files_written: h.files_alive.written,
    files_alive: h.files_alive.alive,
    runs_no_fate: h.runs_no_fate.count,
    runs_died: report.burn.tree.died.count,
    peak_concurrency: report.sessions.reduce((a, s) => Math.max(a, s.peak_concurrency), 0),
    max_depth: report.sessions.reduce((a, s) => Math.max(a, s.max_depth), 0),
    models: report.models.map((m) => ({ model: modelId(m.model), runs: m.runs })).filter((m) => m.model.length > 0).slice(0, 40),
    watch_on: ctx.watchOn,
    fixes_applied: appliedFixIds(ctx.stateDir).filter((id) => known.has(id)),
    run_ms: ctx.runMs,
  };
}

/** How many values are in one payload, counted once and used by every line that says N. */
export function countNumbers(p: NumbersPayload): number {
  let n = 0;
  const walk = (v: unknown): void => {
    if (Array.isArray(v)) { for (const x of v) walk(x); return; }
    if (v && typeof v === "object") { for (const x of Object.values(v)) walk(x); return; }
    n += 1;
  };
  walk(p);
  return n;
}

/** The payload itself, printed, plus the one line that says what is never in it. */
export function describeNumbers(payload: NumbersPayload, host: string): string[] {
  return [
    `to: ${host.replace(/\/$/, "")}/api/numbers, after every run, until you turn it off`,
    ...JSON.stringify(payload, null, 2).split("\n"),
    `never: a prompt, a path, a file name, a title, a label note, a commit message, a repository name or remote, a branch, a hostname, a username.`,
  ];
}

/** The one POST. Five seconds, no redirects, https unless the host is loopback. */
export async function sendNumbers(opts: { host: string; payload: NumbersPayload; fetchImpl?: typeof fetch }): Promise<{ ok: true }> {
  const f = opts.fetchImpl ?? fetch;
  assertHttpsHost(opts.host);
  const res = await f(`${opts.host.replace(/\/$/, "")}/api/numbers`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(opts.payload),
    redirect: "error",
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`the numbers were refused (${res.status})`);
  return { ok: true };
}

export interface ShareResult {
  sent: boolean;
  count: number;
  at: string | null;
  payload: NumbersPayload | null;
  error?: unknown;
}

/**
 * Called by the command after the report is written, never by the pipeline. Sharing off is
 * the default and returns before anything is built, so no socket is opened. A send that
 * fails comes back as an error for the caller to print in one sentence; it never throws.
 */
export async function shareAfterRun(opts: {
  report: Report;
  scope: Scope;
  stateDir: string;
  sessions: Array<{ tool_version: string | null }>;
  editor: "terminal" | "vscode";
  watchOn: boolean;
  runMs: number | null;
  root?: string;
  host?: string;
  fetchImpl?: typeof fetch;
}): Promise<ShareResult> {
  const root = opts.root ?? STATE_ROOT;
  const setting = readNumbersSetting(root);
  if (!setting || setting.share !== true) return { sent: false, count: 0, at: null, payload: null };
  const payload = buildNumbersPayload(opts.report, {
    installId: setting.install_id, scope: opts.scope, stateDir: opts.stateDir, sessions: opts.sessions,
    editor: opts.editor, watchOn: opts.watchOn, runMs: opts.runMs,
  });
  const count = countNumbers(payload);
  try {
    await sendNumbers({ host: opts.host ?? numbersHost(), payload, fetchImpl: opts.fetchImpl });
    return { sent: true, count, at: new Date().toISOString(), payload };
  } catch (e) {
    return { sent: false, count, at: null, payload, error: e };
  }
}
