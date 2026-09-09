/**
 * `actuals watch` (D14): the always-on meter. Installs, into the user's Claude Code
 * settings, one statusline command (the HUD line, and one usage snapshot per update) and
 * a few hooks (session start and end, compaction, agent start and stop, file writes, stop)
 * that each append one JSON line to `~/.actuals/<repo-id>/live/events.ndjson`. No daemon,
 * no network. `actuals unwatch` restores the settings file byte-identical from the same
 * undo store the fixer uses. The report merges the live ledger with the transcripts and
 * marks which is which.
 */
import { execSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, appendFileSync, writeFileSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { CLAUDE_ROOT, STATE_ROOT, repoIdFor, repoRoot, stateDirFor } from "../config.js";
import { applyPlan, appliedFixIds, diffOf, undoFix, type FileChange } from "../fix/index.js";
import { installShim, type Shim } from "./shim.js";

export const WATCH_STORE = path.join(STATE_ROOT, "watch");
const WATCH_ID = "watch";
export const EVENT_VERSION = 1;
const RED = "\u001b[31m", RESET = "\u001b[0m";

/** One line of the live ledger. Numbers where they can be; a path only for a file write. */
export const LiveEvent = z.object({
  v: z.literal(EVENT_VERSION),
  ts: z.string(),
  kind: z.enum(["statusline", "session_start", "pre_compact", "tool", "agent_start", "agent_stop", "stop", "session_end"]),
  session_id: z.string(),
  repo_id: z.string(),
  cwd: z.string(),
  model: z.string().nullable().optional(),
  cost_usd: z.number().nullable().optional(),
  context: z.object({ input: z.number(), output: z.number(), cache_read: z.number(), cache_write: z.number(), size: z.number(), used_pct: z.number().nullable() }).nullable().optional(),
  rate_limits: z.object({ five_hour: z.number().nullable(), seven_day: z.number().nullable() }).nullable().optional(),
  source: z.string().nullable().optional(),
  trigger: z.string().nullable().optional(),
  reason: z.string().nullable().optional(),
  agent_id: z.string().nullable().optional(),
  agent_type: z.string().nullable().optional(),
  parent_agent_id: z.string().nullable().optional(),
  tool_name: z.string().nullable().optional(),
  tool_use_id: z.string().nullable().optional(),
  path: z.string().nullable().optional(),
  command: z.string().nullable().optional(),
});
export type LiveEvent = z.infer<typeof LiveEvent>;

/** Per-session derived state, rewritten on every event so the HUD reads one small file. */
export interface LiveRun { agent_type: string | null; parent: string | null; started_at: string; ended_at: string | null; depth: number; fate: string; files: string[] }
export interface LiveSessionState { session_id: string; repo_id: string; cwd: string; started_at: string; last_at: string; agents_open: Record<string, { agent_type: string | null; started_at: string }>; agents_started: number; agents_stopped: number; died: number; compactions: number; cost_usd: number | null; context_pct: number | null; model: string | null; five_hour_pct: number | null; writes: number; ended: boolean; runs: Record<string, LiveRun> }

const HOOK_EVENTS: Array<{ event: string; matcher?: string }> = [
  { event: "SessionStart" }, { event: "PreCompact" }, { event: "PostToolUse", matcher: "Write|Edit|MultiEdit|NotebookEdit|Bash|Agent" },
  { event: "SubagentStart" }, { event: "SubagentStop" }, { event: "Stop" }, { event: "SessionEnd" },
];

/**
 * The command watch installs into the settings: the stable copy under `~/.actuals/bin/current`
 * when there is a bundle to copy there (every published install), else this process, for a
 * source checkout with no build. Refreshes the copy to the version being run.
 */
export function watchCommand(root?: string): { command: string; shim: Shim | null } {
  const shim = installShim(root === undefined ? {} : { root });
  return { command: shim ? shim.command : selfCommand(), shim };
}

/** The command that reaches this CLI fastest: the built bundle when it exists, else the source through tsx. */
export function selfCommand(): string {
  const entry = process.argv[1] ? path.resolve(process.argv[1]) : "";
  if (entry.endsWith(".ts")) {
    const root = path.resolve(path.dirname(entry), "..");
    const dist = path.join(root, "dist", "cli.js");
    if (existsSync(dist)) return `node ${JSON.stringify(dist)}`;
    return `npx --prefix ${JSON.stringify(root)} tsx ${JSON.stringify(entry)}`;
  }
  if (entry) return `node ${JSON.stringify(entry)}`;
  return `node ${JSON.stringify(fileURLToPath(import.meta.url))}`;
}

function readJson(p: string): Record<string, unknown> {
  if (!existsSync(p)) return {};
  try { return JSON.parse(readFileSync(p, "utf8")) as Record<string, unknown>; } catch { throw new Error(`${p} is not valid JSON; fix it by hand first`); }
}

export interface WatchPlan { changes: FileChange[]; previousStatusLine: unknown | null; settingsPath: string; command: string }

/** Plan the settings change: statusline (optional) and hooks, merged, never overwritten. */
export function planWatch(opts: { hud: boolean; claudeRoot?: string; command?: string }): WatchPlan {
  const settingsPath = path.join(opts.claudeRoot ?? CLAUDE_ROOT, "settings.json");
  const cur = readJson(settingsPath);
  const cmd = opts.command ?? selfCommand();
  const next: Record<string, unknown> = { ...cur };
  let previousStatusLine: unknown | null = null;
  if (opts.hud) {
    const existing = cur["statusLine"];
    const ours = typeof existing === "object" && existing !== null && String((existing as Record<string, unknown>)["command"] ?? "").endsWith(" hud");
    if (existing && !ours) previousStatusLine = existing; // kept on disk, and chained after our line
    next["statusLine"] = { type: "command", command: `${cmd} hud`, padding: 0 };
  }
  const hooks = { ...((cur["hooks"] as Record<string, unknown[]> | undefined) ?? {}) };
  for (const h of HOOK_EVENTS) {
    // ours is any entry whose command ends in " event <Event>", whatever path it was installed
    // from; it is replaced, never duplicated, so a re-run from the bundle updates the path
    const ours = (e: Record<string, unknown>) => ((e["hooks"] as Array<Record<string, unknown>> | undefined) ?? []).some((x) => typeof x["command"] === "string" && (x["command"] as string).endsWith(` event ${h.event}`));
    const list = [...((hooks[h.event] as Array<Record<string, unknown>> | undefined) ?? [])].filter((e) => !ours(e));
    list.push({ ...(h.matcher ? { matcher: h.matcher } : {}), hooks: [{ type: "command", command: `${cmd} event ${h.event}`, timeout: 10 }] });
    hooks[h.event] = list;
  }
  next["hooks"] = hooks;
  const after = JSON.stringify(next, null, 2) + "\n";
  const before = existsSync(settingsPath) ? readFileSync(settingsPath, "utf8") : null;
  return { changes: before === after ? [] : [{ file: settingsPath, before, after }], previousStatusLine, settingsPath, command: cmd };
}

export function describeWatch(plan: WatchPlan): string { return plan.changes.map(diffOf).join("\n"); }

export function applyWatch(plan: WatchPlan, store = WATCH_STORE): string | null {
  if (plan.changes.length === 0) return null;
  mkdirSync(store, { recursive: true });
  if (plan.previousStatusLine) writeFileSync(path.join(store, "previous-statusline.json"), JSON.stringify(plan.previousStatusLine, null, 2) + "\n");
  return applyPlan(WATCH_ID, plan.changes, store);
}

export async function unwatch(store = WATCH_STORE, opts: { force?: boolean } = {}): Promise<{ restored: string[]; notes: string[]; drifted: string[] }> {
  const r = await undoFix(WATCH_ID, process.cwd(), store, opts);
  if (r.restored.length) rmSync(path.join(store, "previous-statusline.json"), { force: true });
  return r;
}

export function isWatching(store = WATCH_STORE): boolean { return appliedFixIds(store).includes(WATCH_ID); }

// ---------------------------------------------------------------------------
// the live ledger
// ---------------------------------------------------------------------------
function relFile(cwd: string, abs: string): string { const r = path.relative(cwd, abs); return r && !r.startsWith("..") && !path.isAbsolute(r) ? r : path.basename(abs); }
export function liveDir(stateDir: string): string { return path.join(stateDir, "live"); }
export function liveEventsPath(stateDir: string): string { return path.join(liveDir(stateDir), "events.ndjson"); }
function statePath(stateDir: string, sessionId: string): string { return path.join(liveDir(stateDir), "state", `${sessionId.replace(/[^A-Za-z0-9_-]/g, "_")}.json`); }

function num(v: unknown): number { return typeof v === "number" && Number.isFinite(v) ? v : 0; }
function numOrNull(v: unknown): number | null { return typeof v === "number" && Number.isFinite(v) ? v : null; }
function str(v: unknown): string | null { return typeof v === "string" ? v : null; }
function rec(v: unknown): Record<string, unknown> | null { return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null; }

/** Which repository a payload belongs to: the git toplevel of its cwd, else the cwd itself. */
export function repoFor(cwd: string): { repoPath: string; repoId: string } {
  const root = repoRoot(cwd) ?? cwd;
  return { repoPath: root, repoId: repoIdFor(root).repoId };
}

/** Turn a hook or statusline payload into one live event. Null for payloads we cannot place. */
export function eventFrom(kind: string, payload: Record<string, unknown>, now = new Date()): LiveEvent | null {
  const cwd = str(payload["cwd"]) ?? str(rec(payload["workspace"])?.["current_dir"]) ?? process.cwd();
  const session_id = str(payload["session_id"]);
  if (!session_id) return null;
  const { repoId } = repoFor(cwd);
  const base = { v: EVENT_VERSION as 1, ts: now.toISOString(), session_id, repo_id: repoId, cwd };
  switch (kind) {
    case "statusline": {
      const cost = rec(payload["cost"]); const cw = rec(payload["context_window"]); const cu = rec(cw?.["current_usage"]); const rl = rec(payload["rate_limits"]);
      return LiveEvent.parse({ ...base, kind: "statusline", model: str(rec(payload["model"])?.["id"]) ?? str(rec(payload["model"])?.["display_name"]), cost_usd: numOrNull(cost?.["total_cost_usd"]),
        context: cw ? { input: num(cu?.["input_tokens"]), output: num(cu?.["output_tokens"]), cache_read: num(cu?.["cache_read_input_tokens"]), cache_write: num(cu?.["cache_creation_input_tokens"]), size: num(cw["context_window_size"]), used_pct: numOrNull(cw["used_percentage"]) } : null,
        rate_limits: rl ? { five_hour: numOrNull(rec(rl["five_hour"])?.["used_percentage"]), seven_day: numOrNull(rec(rl["seven_day"])?.["used_percentage"]) } : null });
    }
    case "SessionStart": return LiveEvent.parse({ ...base, kind: "session_start", source: str(payload["source"]), model: str(payload["model"]) });
    case "PreCompact": return LiveEvent.parse({ ...base, kind: "pre_compact", trigger: str(payload["trigger"]) });
    case "PostToolUse": {
      const input = rec(payload["tool_input"]);
      const name = str(payload["tool_name"]);
      return LiveEvent.parse({ ...base, kind: "tool", tool_name: name, tool_use_id: str(payload["tool_use_id"]), agent_id: str(payload["agent_id"]), path: str(input?.["file_path"]) ?? str(input?.["notebook_path"]), command: name === "Bash" ? (str(input?.["command"]) ?? "").slice(0, 400) || null : null });
    }
    case "SubagentStart": return LiveEvent.parse({ ...base, kind: "agent_start", agent_id: str(payload["agent_id"]), agent_type: str(payload["agent_type"]), parent_agent_id: str(payload["parent_agent_id"]) ?? str(payload["parent_id"]) });
    case "SubagentStop": return LiveEvent.parse({ ...base, kind: "agent_stop", agent_id: str(payload["agent_id"]), agent_type: str(payload["agent_type"]) });
    case "Stop": return LiveEvent.parse({ ...base, kind: "stop" });
    case "SessionEnd": return LiveEvent.parse({ ...base, kind: "session_end", reason: str(payload["reason"]) });
    default: return null;
  }
}

export function readState(stateDir: string, sessionId: string): LiveSessionState | null {
  const p = statePath(stateDir, sessionId);
  if (!existsSync(p)) return null;
  try { return JSON.parse(readFileSync(p, "utf8")) as LiveSessionState; } catch { return null; }
}

/** Append the event and fold it into the session's state file. */
export function record(ev: LiveEvent, opts: { stateDir?: string } = {}): LiveSessionState {
  const stateDir = opts.stateDir ?? stateDirFor(ev.repo_id);
  mkdirSync(path.join(liveDir(stateDir), "state"), { recursive: true });
  const st: LiveSessionState = readState(stateDir, ev.session_id) ?? { session_id: ev.session_id, repo_id: ev.repo_id, cwd: ev.cwd, started_at: ev.ts, last_at: ev.ts, agents_open: {}, agents_started: 0, agents_stopped: 0, died: 0, compactions: 0, cost_usd: null, context_pct: null, model: null, five_hour_pct: null, writes: 0, ended: false, runs: {} };
  if (!st.runs) st.runs = {};
  if (st.ended === undefined) st.ended = false;
  let append = true;
  switch (ev.kind) {
    case "statusline":
      // one snapshot per change: the statusline redraws far more often than usage moves
      if (st.cost_usd === (ev.cost_usd ?? null) && st.context_pct === (ev.context?.used_pct ?? null) && st.model === (ev.model ?? null)) append = false;
      st.cost_usd = ev.cost_usd ?? st.cost_usd; st.context_pct = ev.context?.used_pct ?? st.context_pct; st.model = ev.model ?? st.model; st.five_hour_pct = ev.rate_limits?.five_hour ?? st.five_hour_pct;
      break;
    case "pre_compact": st.compactions += 1; break;
    case "agent_start": if (ev.agent_id) {
      const parent = ev.parent_agent_id ? st.runs[ev.parent_agent_id] : undefined;
      st.runs[ev.agent_id] = { agent_type: ev.agent_type ?? null, parent: ev.parent_agent_id ?? null, started_at: ev.ts, ended_at: null, depth: parent ? parent.depth + 1 : 1, fate: "still_running", files: [] };
      st.agents_open[ev.agent_id] = { agent_type: ev.agent_type ?? null, started_at: ev.ts }; st.agents_started += 1;
    } break;
    case "agent_stop": if (ev.agent_id) {
      const r = st.runs[ev.agent_id]; if (r && r.ended_at === null) { r.ended_at = ev.ts; r.fate = "finished_unlanded"; }
      delete st.agents_open[ev.agent_id]; st.agents_stopped += 1;
    } break;
    case "tool": if (ev.path) {
      st.writes += 1;
      const r = ev.agent_id ? st.runs[ev.agent_id] : undefined;
      if (r) { const f = relFile(st.cwd, ev.path); if (!r.files.includes(f) && r.files.length < 40) r.files.push(f); }
    } break;
    case "stop": break; // a background agent may outlive the turn; nothing is decided here
    case "session_end": {
      // an agent still open when the session ends never reported back: counted as died, live
      for (const r of Object.values(st.runs)) { if (r.ended_at === null) { r.ended_at = ev.ts; r.fate = "died"; } }
      st.died += Object.keys(st.agents_open).length; st.agents_open = {}; st.ended = true;
      break;
    }
    default: break;
  }
  st.last_at = ev.ts;
  if (append) appendFileSync(liveEventsPath(stateDir), JSON.stringify(ev) + "\n");
  writeFileSync(statePath(stateDir, ev.session_id), JSON.stringify(st));
  return st;
}

/** The cap the tree is allowed on this machine: the project's env, then the user's, then Claude Code's default. */
export function concurrencyCap(cwd: string, claudeRoot = CLAUDE_ROOT): { cap: number; source: "project" | "user" | "default" } {
  const read = (p: string): number | null => { try { const env = rec(readJson(p)["env"]); const n = Number(env?.["CLAUDE_CODE_MAX_CONCURRENT_SUBAGENTS"]); return Number.isInteger(n) && n > 0 ? n : null; } catch { return null; } };
  const root = repoRoot(cwd) ?? cwd;
  const project = read(path.join(root, ".claude", "settings.json")); if (project) return { cap: project, source: "project" };
  const user = read(path.join(claudeRoot, "settings.json")); if (user) return { cap: user, source: "user" };
  return { cap: 20, source: "default" };
}

function money(n: number): string { return n >= 100 ? `$${Math.round(n)}` : `$${n.toFixed(2)}`; }

/** The HUD line for Claude Code's statusline. One line, list rates, the cap beside the count. */
export function hudLine(st: LiveSessionState | null, cap: { cap: number }, payload: Record<string, unknown>): string {
  const cost = st?.cost_usd ?? numOrNull(rec(payload["cost"])?.["total_cost_usd"]);
  const ctx = st?.context_pct ?? numOrNull(rec(payload["context_window"])?.["used_percentage"]);
  const open = st ? Object.keys(st.agents_open).length : 0;
  // the cost is Claude Code's own client-side figure at list price: an estimate, labelled as one
  const parts = ["actuals", cost === null ? "cost n/a" : `${money(cost)} est`];
  if (ctx !== null) parts.push(`ctx ${Math.round(ctx)}%`);
  parts.push(`agents ${open}/${cap.cap}`);
  if (st && st.died > 0) parts.push(`${RED}${st.died} died${RESET}`);
  if (st && st.compactions > 0) parts.push(`${st.compactions} compaction${st.compactions === 1 ? "" : "s"}`);
  const fh = st?.five_hour_pct ?? numOrNull(rec(rec(payload["rate_limits"])?.["five_hour"])?.["used_percentage"]);
  if (fh !== null) parts.push(`5h ${Math.round(fh)}%`);
  return parts.join(" · ");
}

/** Run the statusline the user had before watch, with the same payload, and return its lines. */
export function previousStatusLineOutput(raw: string, store = WATCH_STORE): string {
  const p = path.join(store, "previous-statusline.json");
  if (!existsSync(p)) return "";
  try {
    const cmd = str((JSON.parse(readFileSync(p, "utf8")) as Record<string, unknown>)["command"]);
    if (!cmd) return "";
    return execSync(cmd, { input: raw, encoding: "utf8", timeout: 3000, stdio: ["pipe", "pipe", "ignore"] }).replace(/\s+$/, "");
  } catch { return ""; }
}

/** The live ledger, parsed line by line against the event schema; lines of another shape or version are counted, never trusted. */
export function readLiveLedger(stateDir: string): { events: LiveEvent[]; skipped: number } {
  const p = liveEventsPath(stateDir);
  if (!existsSync(p)) return { events: [], skipped: 0 };
  const events: LiveEvent[] = []; let skipped = 0;
  for (const line of readFileSync(p, "utf8").split("\n")) {
    if (!line.trim()) continue;
    try { const r = LiveEvent.safeParse(JSON.parse(line)); if (r.success) events.push(r.data); else skipped += 1; } catch { skipped += 1; }
  }
  return { events, skipped };
}

export function liveSummary(stateDir: string): { events: number; sessions: number; compactions: number; first: string | null; skipped: number } {
  const { events, skipped } = readLiveLedger(stateDir);
  const sessions = new Set<string>(); let compactions = 0, first: string | null = null;
  for (const e of events) { sessions.add(e.session_id); if (e.kind === "pre_compact") compactions += 1; if (!first || e.ts < first) first = e.ts; }
  return { events: events.length, sessions: sessions.size, compactions, first, skipped };
}

export function listStates(stateDir: string): LiveSessionState[] {
  const dir = path.join(liveDir(stateDir), "state");
  if (!existsSync(dir)) return [];
  const out: LiveSessionState[] = [];
  for (const f of readdirSync(dir)) { try { out.push(JSON.parse(readFileSync(path.join(dir, f), "utf8")) as LiveSessionState); } catch { /* skip */ } }
  return out;
}
