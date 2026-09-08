/**
 * Everything the landing says that came from a run, read from the fixture at build time.
 * Nothing on the page hardcodes a report number. Where a sentence spells a number out in
 * words, the assertions below stop the build if the run stops supporting it.
 */
import { demoReport, int, money } from "../../lib/report";

const r = demoReport;
const h = r.headline;
const tl = r.burn.tree.timeline;
if (!tl) throw new Error("the landing needs the tallest session's timeline");

const t0 = Date.parse(tl.start);
const t1 = Date.parse(tl.end);
const duration = Math.max(1, t1 - t0);

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const hm = (iso: string): string => iso.slice(11, 16);
function dayMonth(iso: string): string {
  const d = new Date(iso);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
}
function windowInWords(since: string | null, until: string | null): string {
  if (!since || !until) throw new Error("the landing needs the run's own window");
  const b = new Date(until);
  return `${dayMonth(since)} to ${dayMonth(until)} ${b.getUTCFullYear()}`;
}

const depths = Object.keys(r.burn.tree.depth_histogram).map(Number);
const deepest = depths.length ? Math.max(...depths) : 1;
const alivePct = h.files_alive.written > 0 ? Math.round((h.files_alive.alive / h.files_alive.written) * 100) : 0;
const minutes = Math.round(duration / 60000);

/* Sentences on the page spell these out. A later run that disagrees stops the build. */
const WORDS: Array<[string, number, number]> = [
  ["the peak, written as twenty", tl.peak, 20],
  ["the deaths, written as three", tl.died, 3],
  ["the depth, written as three", deepest, 3],
  ["the runs of the tallest session, written as thirty-one", tl.runs.length, 31],
];
for (const [what, got, want] of WORDS) {
  if (got !== want) throw new Error(`the landing spells out ${what}; the run now says ${got}`);
}

const tallest = r.sessions.find((s) => s.id === tl.session_id);
if (!tallest || !tallest.claimed) throw new Error("the landing needs the tallest session's own row and its claim");

/** One bar per run of the tallest session, drawn to its start and end, in start order. */
export interface Bar {
  a: number;
  b: number;
  depth: number;
  fate: string;
  minutes: number;
  start: string;
  end: string;
}
export const BARS: Bar[] = tl.runs
  .map((x) => ({
    a: (Date.parse(x.start) - t0) / duration,
    b: (Date.parse(x.end) - t0) / duration,
    depth: x.depth,
    fate: x.fate,
    minutes: Math.max(1, Math.round((Date.parse(x.end) - Date.parse(x.start)) / 60000)),
    start: hm(x.start),
    end: hm(x.end),
  }))
  .sort((p, q) => p.a - q.a);

/** The concurrency curve as steps, x in 0..1, level in runs. */
export function curvePoints(): Array<[number, number]> {
  const ev: Array<[number, number]> = [];
  for (const run of tl!.runs) {
    ev.push([Date.parse(run.start), 1]);
    ev.push([Date.parse(run.end), -1]);
  }
  ev.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const f = (ms: number) => Math.round(((ms - t0) / duration) * 10000) / 10000;
  let level = 0;
  const points: Array<[number, number]> = [[0, 0]];
  for (const [ms, d] of ev) {
    points.push([f(ms), level]);
    level += d;
    points.push([f(ms), level]);
  }
  points.push([1, 0]);
  return points;
}

/** Half-hour ticks along the session, x in 0..1. */
export function ticks(): Array<{ x: number; label: string }> {
  const out: Array<{ x: number; label: string }> = [];
  const first = new Date(t0);
  first.setUTCMinutes(0, 0, 0);
  for (let t = first.getTime(); t <= t1; t += 30 * 60000) {
    if (t < t0) continue;
    out.push({ x: (t - t0) / duration, label: hm(new Date(t).toISOString()) });
  }
  return out;
}

/** The models, most runs first: what each cost per run and how much kept work a dollar bought. */
export const MODELS = [...r.models]
  .sort((a, b) => b.runs - a.runs)
  .map((m) => ({
    model: m.model,
    runs: m.runs,
    perRun: money(m.per_run_usd),
    kept: m.kept_per_usd === null ? null : m.kept_per_usd.toFixed(3),
  }));

export const L = {
  command: "npx actuals",
  period: r.share.period,
  periodInWords: windowInWords(r.window.since, r.window.until),
  periodShort: (() => {
    if (!r.window.since || !r.window.until) throw new Error("the landing needs the run's own window");
    const a = new Date(r.window.since);
    const b = new Date(r.window.until);
    const short = (d: Date) => `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]!.slice(0, 3)}`;
    return `${short(a)} to ${short(b)} ${b.getUTCFullYear()}`;
  })(),
  sessions: r.sessions.length,
  agentRuns: r.share.agent_runs,
  measuredOn: `${dayMonth(r.generated_at)} ${new Date(r.generated_at).getUTCFullYear()}`,
  tokensSpent: r.tokens_spent_making_this,
  secondsCold: "1.3",

  cost: { text: money(h.cost_usd.value), value: Math.round(h.cost_usd.value) },
  commits: { text: int(h.commits.value), value: h.commits.value },
  perCommit: { text: money(h.cost_per_commit.value), value: h.cost_per_commit.value ?? 0 },
  alive: { pct: alivePct, alive: h.files_alive.alive, written: h.files_alive.written },
  noFate: { count: h.runs_no_fate.count, cost: money(h.runs_no_fate.cost_usd), costValue: Math.round(h.runs_no_fate.cost_usd) },

  tree: {
    id: tl.session_id,
    day: dayMonth(tl.start),
    dayShort: `${new Date(tl.start).getUTCDate()} Aug`,
    from: hm(tl.start),
    to: hm(tl.end),
    runs: tl.runs.length,
    minutes,
    spawned: tl.spawned_by_agents,
    peak: tl.peak,
    peakAt: hm(tl.peak_at),
    peakX: (Date.parse(tl.peak_at) - t0) / duration,
    died: tl.died,
    deepest,
  },

  tallest: {
    claimed: tallest.claimed.outcome,
    alive: tallest.files_alive,
    written: tallest.files_written,
    commits: tallest.commits,
    cost: money(tallest.cost_usd),
    agents: tallest.agents,
  },

  status: "actuals · $12.40 est · ctx 41% · agents 3/4 · 1 died · 5h 23%",
};

/** The command's own stdout, on this run's numbers: one thought per line at a measure that never wraps, no middle dots. */
export const STDOUT: string[] = [
  `actuals  ~/your-repo  ${L.period}`,
  `ran locally, nothing uploaded`,
  `  sessions ${L.sessions}, agent runs ${L.agentRuns}`,
  `  ${L.cost.text} of tokens at list rates [estimated]`,
  `  ${L.commits.text} commits [measured], ${L.perCommit.text} per commit`,
  `  ${L.alive.alive} of ${L.alive.written} files agents wrote are still on disk`,
  `  ${L.noFate.count} runs with no traceable fate, ${L.noFate.cost}`,
  `  report opened on 127.0.0.1, click any session`,
];

/** The receipt, one group per section it prints under. Every value is the run's own. */
export const RECEIPT: Array<{ at: string; k: string; v: string; warn?: boolean }> = [
  { at: "hero", k: "sessions", v: String(L.sessions) },
  { at: "hero", k: "agent runs", v: String(L.agentRuns) },
  { at: "month", k: "tokens, list rates", v: L.cost.text },
  { at: "month", k: "commits inside", v: L.commits.text },
  { at: "month", k: "per commit", v: L.perCommit.text },
  { at: "kept", k: "files still alive", v: `${L.alive.alive} of ${L.alive.written}` },
  { at: "money", k: "runs, no fate", v: `${L.noFate.count} · ${L.noFate.cost}` },
  { at: "agents", k: `${L.tree.dayShort.toLowerCase()}, claimed`, v: L.tallest.claimed },
  { at: "agents", k: "on disk", v: `${L.tallest.alive} of ${L.tallest.written} alive` },
  { at: "close", k: "uploaded", v: "0 bytes" },
  { at: "close", k: "models called", v: "0" },
  { at: "close", k: "What left your machine: nothing.", v: "" },
];
