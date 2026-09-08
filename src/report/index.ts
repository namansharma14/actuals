/**
 * Report stage: the socket, built from the ledger. Every number carries a mark.
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { CLAUDE_ROOT, isInside, type Scope } from "../config.js";
import { resolveRate, loadRates } from "../rates/index.js";
import { Fate, type Ledger, type Mark, type Run } from "../schema/ledger.js";
import { ReportSchema, type Report } from "../schema/socket.js";

export const LIMITATIONS = [
  "Compaction: a compacted session keeps its usage but loses the turn-by-turn record before the compaction point.",
  "Resumed sessions continue the same transcript; a resume after a long gap stretches the session window.",
  "Sidechains inside a main transcript are counted with the session, not as separate runs.",
  "Worktrees: a session whose cwd is a worktree joins to that worktree's git history only.",
  "A cwd change mid-session attributes the whole session to the repository of its first recorded cwd.",
  "Plan users pay a flat fee; dollars here are list rates and show the size of the work, not the bill.",
  "Unknown model ids are priced at a family rate and marked assumed.",
  "Clock skew between the transcript writer and git can move a commit across the 5-minute attribution window.",
  "Transcripts the tool has cleaned up are gone; this report only sees what is on disk today.",
  "Codex sessions are not read yet (first pass is Claude Code only).",
  "Transcript formats are internal to each tool and can change on any release; readers are pinned to versions with fixtures.",
  "This report cannot see whether a run changed a decision. That is the label, and only you can give it.",
];

export const METHOD = [
  "Sessions and agent runs are read from the local transcript files; nothing is uploaded and no model is called.",
  "Usage is counted once per API request (every content block of a response is its own transcript line with the same usage).",
  "Tokens are priced at list rates from rates.json; 5-minute and 1-hour cache writes are priced separately.",
  "A commit counts as made inside a session only when its author time is inside the session window, the session ran inside this repository, and the session issued a git commit within 5 minutes.",
  "A file counts as alive when the path the agent wrote still exists; tracked when git ls-files lists it.",
  "Fate is decided by fixed rules, first match wins; an unknown fate is never counted as kept.",
  "Peak concurrency is the largest number of agent runs whose start and end times overlap inside one session.",
  "The only network calls are actuals login, logout and share --hosted, each made only when you run it; the only host they reach is getactuals.net (or the ACTUALS_HOST you set), over a secure TLS connection, and each names what it sends before it sends it.",
];

export const MARKS_LEGEND: Record<string, string> = {
  measured: "read from the local transcripts and this repository's git history today",
  estimated: "token counts priced at list rates",
  "founder-labelled": "an outcome only you can state; taken from your label, not inferred",
  illustrative: "a mock of a surface that does not exist yet",
  assumed: "a rate or parameter that is not on a public price page",
};

interface SessionAgg {
  id: string; source_file: string; date: string; title: string; hours: number | null; cost_main: number; cost_agents: number; commits: number;
  written: Set<string>; alive: Set<string>; tracked: Set<string>; runs: Run[]; peak: number; depth: number; died: number; mark: Mark;
  /** the session's cost as Claude Code reported it, when watch recorded one; the estimate then stays in cost_main and cost_agents for the breakdown only */
  cost_live: number | null;
}

function peakOf(runs: Run[]): number {
  const ev: Array<[number, number]> = [];
  for (const r of runs) if (r.started_at && r.ended_at) { ev.push([new Date(r.started_at).getTime(), 1]); ev.push([new Date(r.ended_at).getTime(), -1]); }
  ev.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  let cur = 0, mx = 0;
  for (const [, d] of ev) { cur += d; if (cur > mx) mx = cur; }
  return mx;
}

function insightsClaim(sessionId: string, claudeRoot: string): Report["sessions"][number]["claimed"] {
  const p = path.join(claudeRoot, "usage-data", "facets", `${sessionId}.json`);
  if (!existsSync(p)) return null;
  try {
    const j = JSON.parse(readFileSync(p, "utf8")) as Record<string, unknown>;
    const outcome = typeof j["outcome"] === "string" ? (j["outcome"] as string) : "";
    const goal = typeof j["underlying_goal"] === "string" ? (j["underlying_goal"] as string) : "";
    if (!outcome && !goal) return null;
    const clean = (t: string) => t.replace(/\u2014|\u2013/g, ",").replace(/\s+/g, " ").trim();
    return { outcome: clean(outcome.replace(/_/g, " ")), goal: clean(goal).slice(0, 200), source: "claimed by /insights", mark: "estimated" };
  } catch { return null; }
}

function money(n: number): number { return Math.round(n * 100) / 100; }

export type Timeline = NonNullable<Report["burn"]["tree"]["timeline"]>;

/**
 * One session drawn to time: every run with a start and an end, the concurrency peak and
 * when it came. Used for the tallest tree in the socket and, in the app, for any session.
 */
export function timelineFor(s: { id: string; date: string; title: string }, runs: Run[], redact: boolean): Timeline | null {
  const rs = runs.filter((r) => r.session_id === s.id && r.started_at && r.ended_at).map((r) => ({ id: r.id, start: r.started_at!, end: r.ended_at!, depth: r.depth, fate: r.fate })).sort((a, b) => a.start.localeCompare(b.start) || a.depth - b.depth);
  if (rs.length === 0) return null;
  const ev: Array<[number, number]> = [];
  for (const r of rs) { ev.push([new Date(r.start).getTime(), 1]); ev.push([new Date(r.end).getTime(), -1]); }
  ev.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  let cur = 0, mx = 0, at = ev[0]?.[0] ?? 0;
  for (const [t, d] of ev) { cur += d; if (cur > mx) { mx = cur; at = t; } }
  const all = runs.filter((r) => r.session_id === s.id);
  return { session_id: s.id, date: s.date, title: redact ? `session ${s.id.slice(0, 8)}` : s.title, start: rs.map((r) => r.start).sort()[0]!, end: rs.map((r) => r.end).sort().at(-1)!, peak: mx, peak_at: new Date(at).toISOString(), died: all.filter((r) => r.fate === "died").length, spawned_by_agents: all.filter((r) => r.spawned_by === "agent").length, runs: rs };
}

export interface LiveMeta { watching: boolean; events: number; sessions_live_only: number; compactions: Record<string, number>; first_event: string | null }

export function buildReport(ledger: Ledger, scope: Scope, meta: { generatedAt: Date; versions: string[]; claudeRoot?: string; redact: boolean; live?: LiveMeta }): Report {
  const claudeRoot = meta.claudeRoot ?? CLAUDE_ROOT;
  const rates = loadRates();
  const onDisk = new Map<string, boolean>(); const trackedC = new Map<string, boolean>();
  for (const t of ledger.truths) { if (t.kind === "file_on_disk") onDisk.set(t.claim_id, t.value === "yes"); if (t.kind === "file_tracked") trackedC.set(t.claim_id, t.value === "yes"); }
  const runsBySession = new Map<string, Run[]>();
  for (const r of ledger.runs) { if (!runsBySession.has(r.session_id)) runsBySession.set(r.session_id, []); runsBySession.get(r.session_id)!.push(r); }
  const commitsBySession = new Map<string, number>();
  for (const c of ledger.commits) if (c.attribution === "inside_session" && c.session_id) commitsBySession.set(c.session_id, (commitsBySession.get(c.session_id) ?? 0) + 1);
  const generousBySession = new Map<string, number>();
  for (const c of ledger.commits) if (c.attribution === "during_session_unattributed" && c.session_id) generousBySession.set(c.session_id, (generousBySession.get(c.session_id) ?? 0) + 1);
  const labelFor = (id: string) => ledger.labels.filter((l) => l.target === id).at(-1) ?? null;

  const aggs: SessionAgg[] = ledger.sessions.map((s) => {
    const runs = runsBySession.get(s.id) ?? [];
    const owners = new Set([s.id, ...runs.map((r) => r.id)]);
    const written = new Set<string>(), alive = new Set<string>(), tracked = new Set<string>();
    for (const c of ledger.claims) {
      if (c.kind !== "file_written" || !owners.has(c.owner)) continue;
      written.add(c.subject);
      if (onDisk.get(c.id)) alive.add(c.subject);
      if (trackedC.get(c.id)) tracked.add(c.subject);
    }
    const hours = s.started_at && s.ended_at ? Math.round(((new Date(s.ended_at).getTime() - new Date(s.started_at).getTime()) / 36e5) * 10) / 10 : null;
    const cost_live = typeof s.cost_live_usd === "number" ? s.cost_live_usd : null;
    const mark: Mark = cost_live !== null ? "measured" : s.cost_mark === "assumed" || runs.some((r) => r.cost_mark === "assumed") ? "assumed" : "estimated";
    return { id: s.id, source_file: s.source_file, date: (s.started_at ?? "").slice(0, 10), title: s.title, hours, cost_live, cost_main: s.cost_usd, cost_agents: runs.reduce((a, r) => a + r.cost_usd, 0), commits: (commitsBySession.get(s.id) ?? 0) + (scope.generous ? generousBySession.get(s.id) ?? 0 : 0), written, alive, tracked, runs, peak: peakOf(runs), depth: runs.reduce((m, r) => Math.max(m, r.depth), 0), died: runs.filter((r) => r.fate === "died").length, mark };
  });

  const costOfSession = (s: SessionAgg): number => s.cost_live ?? s.cost_main + s.cost_agents;
  const totalCost = aggs.reduce((a, s) => a + costOfSession(s), 0);
  const totalCommits = aggs.reduce((a, s) => a + s.commits, 0);
  const allWritten = new Set<string>(), allAlive = new Set<string>();
  for (const s of aggs) { s.written.forEach((f) => allWritten.add(f)); s.alive.forEach((f) => allAlive.add(f)); }
  const noFate = ledger.runs.filter((r) => r.fate === "unknown" || r.fate === "finished_unlanded");
  const anyAssumed = aggs.some((s) => s.mark === "assumed");
  const measuredSessions = aggs.filter((s) => s.mark === "measured").length;
  // measured only when every session's cost is Claude Code's own; one priced session keeps the total an estimate
  const costMark: Mark = aggs.length > 0 && measuredSessions === aggs.length ? "measured" : anyAssumed ? "assumed" : "estimated";

  const sessions: Report["sessions"] = aggs.sort((a, b) => costOfSession(b) - costOfSession(a)).map((s) => {
    const label = labelFor(s.id);
    const outcome = label
      ? { state: label.state, note: meta.redact ? "" : label.note, source: "your label", mark: "founder-labelled" as Mark }
      : s.tracked.size > 0 || s.commits > 0
        ? { state: "kept", note: `${s.tracked.size} files tracked in git, ${s.commits} commits`, source: "git and disk", mark: "measured" as Mark }
        : s.alive.size > 0
          ? { state: "on disk", note: `${s.alive.size} files alive, none tracked`, source: "disk", mark: "measured" as Mark }
          : s.died > 0
            ? { state: "died", note: `${s.died} agent runs died`, source: "transcripts", mark: "measured" as Mark }
            : { state: "no trace", note: "no file survives, no commit", source: "git and disk", mark: "measured" as Mark };
    return {
      id: s.id, tool: "claude_code", date: s.date, title: meta.redact ? `session ${s.id.slice(0, 8)}` : s.title, hours: s.hours,
      cost_usd: money(costOfSession(s)), cost_main_usd: money(s.cost_main), cost_agents_usd: money(s.cost_agents), cost_mark: s.mark, commits: s.commits,
      files_written: s.written.size, files_alive: s.alive.size, files_tracked: s.tracked.size, agents: s.runs.length, peak_concurrency: s.peak, max_depth: s.depth, died: s.died,
      // the /insights goal is the user's own prompt text; --redact must strip it from the report file, not only the page
      outcome, claimed: (() => { const c = insightsClaim(s.id, claudeRoot); return c && meta.redact ? { ...c, goal: "" } : c; })(),
      ...(meta.live ? { source: (s.source_file === "live" ? "live" : "transcript") as "live" | "transcript", ...(meta.live.compactions[s.id] ? { compactions: meta.live.compactions[s.id] } : {}) } : {}),
    };
  });

  // tree + fate + rereads
  const peaks = aggs.filter((s) => s.runs.length > 0).sort((a, b) => b.peak - a.peak).slice(0, 8).map((s) => ({ date: s.date, session_id: s.id, peak: s.peak, max_depth: s.depth }));
  // the session with the tallest tree, drawn to time: every run with a start and an end
  const tallest = aggs.filter((s) => s.runs.some((r) => r.started_at && r.ended_at)).sort((a, b) => b.peak - a.peak || b.runs.length - a.runs.length)[0];
  const timeline: Report["burn"]["tree"]["timeline"] = tallest ? timelineFor(tallest, tallest.runs, meta.redact) : null;
  const depthHist: Record<string, number> = {};
  for (const r of ledger.runs) depthHist[String(r.depth)] = (depthHist[String(r.depth)] ?? 0) + 1;
  const died = ledger.runs.filter((r) => r.fate === "died");
  const byState: Record<string, number> = {};
  for (const r of ledger.runs) byState[r.fate] = (byState[r.fate] ?? 0) + 1;
  const readCounts = new Map<string, Map<string, number>>();
  let reads = 0, rereads = 0;
  for (const t of ledger.tool_calls) {
    if (t.kind !== "read" || !t.path) continue;
    reads += 1;
    if (!readCounts.has(t.owner)) readCounts.set(t.owner, new Map());
    const m = readCounts.get(t.owner)!;
    const n = (m.get(t.path) ?? 0) + 1; m.set(t.path, n);
    if (n > 1) rereads += 1;
  }
  const topReads = new Map<string, number>();
  for (const m of readCounts.values()) for (const [p, n] of m) if (n > 1) topReads.set(p, (topReads.get(p) ?? 0) + (n - 1));
  const top = [...topReads.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([p, n]) => ({ path: meta.redact ? "(redacted)" : isInside(p, scope.repoPath) ? path.relative(scope.repoPath, p) : p, n }));

  // models
  const byModel = new Map<string, { runs: Run[]; key: string }>();
  for (const r of ledger.runs) { const key = r.model ? resolveRate(r.model, rates).key : "unknown"; if (!byModel.has(key)) byModel.set(key, { runs: [], key }); byModel.get(key)!.runs.push(r); }
  const models: Report["models"] = [...byModel.values()].map(({ runs, key }) => {
    const cost = runs.reduce((a, r) => a + r.cost_usd, 0);
    const landedTracked = runs.filter((r) => r.fate === "landed_tracked").length;
    return { model: key, runs: runs.length, cost_usd: money(cost), per_run_usd: runs.length ? money(cost / runs.length) : 0, finished: runs.filter((r) => r.final_text_chars >= 300).length, landed: runs.filter((r) => r.fate === "landed_tracked" || r.fate === "landed_untracked").length, kept_per_usd: cost > 0 ? Math.round((landedTracked / cost) * 1000) / 1000 : null, rate_mark: (runs.some((r) => r.cost_mark === "assumed") ? "assumed" : "estimated") as Mark };
  }).sort((a, b) => b.cost_usd - a.cost_usd);

  // fixes derived from the numbers. F1 takes BOTH numbers from the single clean session
  // with the highest peak: a peak from one session and a depth from another would describe
  // a tree that never ran (undercount rule).
  const clean = aggs.filter((s) => s.runs.length > 0 && s.died === 0);
  const anchor = clean.sort((a, b) => b.peak - a.peak || a.depth - b.depth)[0];
  const capPeak = anchor ? Math.max(2, anchor.peak) : 2;
  const capDepth = anchor ? Math.max(1, anchor.depth) : 1;
  const worst = aggs.filter((s) => s.died > 0).sort((a, b) => b.peak - a.peak)[0];
  const fixes: Report["fixes"] = [];
  if (ledger.runs.length > 0) fixes.push({
    id: "f1-cap-tree", kind: "settings_env", title: "Cap the agent tree at what your machine survived",
    why: `${anchor ? `On ${anchor.date}, ${anchor.peak} concurrent runs at depth ${anchor.depth} finished with nothing dying; that one session sets both numbers.` : "No session with agent runs finished without a death, so the caps fall back to 2 concurrent at depth 1."}${worst ? ` On ${worst.date}, ${worst.runs.length} runs peaked at ${worst.peak} concurrent at depth ${worst.depth} and ${worst.died} died.` : ""} Claude Code defaults are 20 concurrent and depth 3.`,
    target_file: ".claude/settings.json",
    snippet: JSON.stringify({ env: { CLAUDE_CODE_MAX_CONCURRENT_SUBAGENTS: String(capPeak), CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH: String(capDepth) } }, null, 2),
    would_have_blocked: worst && worst.peak > capPeak ? `would have held ${worst.peak - capPeak} of the ${worst.peak} concurrent spawns on ${worst.date}` : null, available: true,
  });
  if (noFate.length > 0) fixes.push({
    id: "f2-reports-land", kind: "claude_md_rule_and_hook", title: "Have every agent leave a report on disk",
    why: `${noFate.length} finished runs left no trace on disk (about $${Math.round(noFate.reduce((a, r) => a + r.cost_usd, 0))} at list rates). If you want those runs to be measurable, this asks your agents to write a short report file per run so their work survives the session. Opt in when you have a folder for them: run \`actuals fix f2-reports-land\`.`,
    target_file: "CLAUDE.md", snippet: "- Subagents write their final report to reports/<date>-<slug>.md before returning. No file, no report.\n# plus a SubagentStop hook in .claude/settings.json that blocks a return with no new file under reports/",
    would_have_blocked: null, available: true, opt_in: true,
  });
  fixes.push({ id: "f4-git-ai", kind: "suggestion", title: "Line-level survival across rebases", why: "Files alive is file-level. Git AI notes add line-level attribution; Actuals reads them when present.", target_file: "(none)", snippet: "# not available yet", would_have_blocked: null, available: false });

  // the meter's presence changes what the report can see, and says so
  const liveOn = !!meta.live && (meta.live.watching || meta.live.events > 0);
  const liveCompactions = meta.live ? Object.values(meta.live.compactions).reduce((a, b) => a + b, 0) : 0;
  const limitations = LIMITATIONS.map((l) => {
    if (!liveOn) return l;
    if (l.startsWith("Compaction:")) return `${l} Reduced when watch is on: ${liveCompactions} compaction point${liveCompactions === 1 ? "" : "s"} recorded live so far.`;
    if (l.startsWith("Transcripts the tool has cleaned up")) return `${l} Reduced when watch is on: ${meta.live!.sessions_live_only} session${meta.live!.sessions_live_only === 1 ? "" : "s"} in this report exist only in the live ledger.`;
    return l;
  });
  const method = liveOn ? [...METHOD, `actuals watch is ${meta.live!.watching ? "on" : "off (a live ledger exists from before)"}: Claude Code's statusline and hooks append one line per event to a local live ledger; rows that exist only there are marked live.`] : METHOD;
  const dates = aggs.map((s) => s.date).filter(Boolean).sort();
  const period = dates.length ? `${dates[0]} to ${dates.at(-1)}` : "no sessions";
  const report: Report = {
    schema_version: "actuals.report/2.0", repo_id: ledger.sessions[0]?.repo_id ?? "", repo_path: meta.redact ? "(redacted)" : scope.repoPath, generated_at: meta.generatedAt.toISOString(), run_id: ledger.run_id,
    window: { since: scope.since ? scope.since.toISOString() : (ledger.sessions.map((s) => s.started_at).filter((x): x is string => !!x).sort()[0] ?? null), until: meta.generatedAt.toISOString() }, tools: ["claude_code"], tool_versions: { claude_code: meta.versions }, rates_version: rates.rates_version,
    provenance_note: "Read from the local transcripts and this repository's git history; token counts priced at list rates; nothing uploaded; no model called.",
    headline: {
      cost_usd: { value: money(totalCost), mark: costMark }, commits: { value: totalCommits, mark: "measured" }, cost_per_commit: { value: totalCommits > 0 ? money(totalCost / totalCommits) : null, mark: costMark },
      files_alive: { alive: allAlive.size, written: allWritten.size, mark: "measured" }, runs_no_fate: { count: noFate.length, cost_usd: money(noFate.reduce((a, r) => a + r.cost_usd, 0)), mark: "measured" },
      cost_sessions: { measured: measuredSessions, priced: aggs.length - measuredSessions },
    },
    sessions,
    burn: {
      tree: { peaks, timeline, depth_histogram: depthHist, spawned_by_agents: ledger.runs.filter((r) => r.spawned_by === "agent").length, died: { count: died.length, cost_usd: money(died.reduce((a, r) => a + r.cost_usd, 0)) }, mark: "measured" },
      fate: { by_state: byState, unlandable_count: noFate.length, unlandable_cost_usd: money(noFate.reduce((a, r) => a + r.cost_usd, 0)), mark: "measured" },
      rereads: { reads, rereads, top, mark: "measured", note: "Counted across sessions from the transcripts. Claude Code's /usage shows the in-session cache view; this is the same habit seen across every session." },
    },
    models, fixes,
    share: { period, agent_runs: ledger.runs.length, commits: totalCommits, cost_per_commit: totalCommits > 0 ? money(totalCost / totalCommits) : null, files_alive_pct: allWritten.size ? Math.round((allAlive.size / allWritten.size) * 100) : null, biggest_tree: Math.max(0, ...aggs.map((s) => s.peak)), runs_no_fate: noFate.length },
    method, limitations, marks_legend: MARKS_LEGEND, fate_states: Fate.options, tokens_spent_making_this: 0, left_machine: "nothing",
    ...(meta.live ? { live: { watching: meta.live.watching, events: meta.live.events, sessions_live_only: meta.live.sessions_live_only, compactions: liveCompactions, first_event: meta.live.first_event } } : {}),
  };
  return ReportSchema.parse(report);
}
