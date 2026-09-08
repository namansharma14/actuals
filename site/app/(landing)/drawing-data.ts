/**
 * The object's data: the tallest session as the landing's 3D tree needs it, built once at
 * build time from the frozen fixture. The geometry itself (first-fit lanes, the concurrency
 * curve, the peak) comes from the shared module the report's own 2D tree uses, so the bar in
 * the app and the limb on the landing agree. Everything here is a pure function of the run
 * record; no number on the page is typed by hand.
 */
import { demoReport } from "../../lib/report";
import { concurrencyCurve, laneRuns, peakOf, type GeoRun } from "../../../src/render/tree-geometry.js";
import { L } from "./data";

export interface SceneRun {
  /** index in start order; the object addresses runs by it */
  id: number;
  /** start and end as fractions of the session */
  a: number;
  b: number;
  /** depth, 1 for a run you started */
  d: number;
  fate: string;
  minutes: number;
  /** HH:MM UTC */
  s: string;
  e: string;
  /** the run this one forked from, by id; null for a run you started */
  p: number | null;
  /** first-fit concurrency slot */
  l: number;
}

export interface KeptRow {
  day: string;
  written: number;
  alive: number;
  tracked: number;
  commits: number;
  cost: number;
  per: number | null;
}

export interface SceneData {
  runs: SceneRun[];
  /** the alive count as steps, [fraction of the session, level] */
  curve: Array<[number, number]>;
  peak: number;
  peakX: number;
  peakAt: string;
  died: number;
  spawned: number;
  from: string;
  to: string;
  minutes: number;
  head: { sessions: number; runs: number; cost: number; commits: number; per: number; alive: number; written: number; noFate: number; window: string };
  kept: KeptRow[];
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const hm = (iso: string): string => iso.slice(11, 16);

export function sceneData(): SceneData {
  const r = demoReport;
  const tl = r.burn.tree.timeline;
  if (!tl) throw new Error("the landing needs the tallest session's timeline");
  const t0 = Date.parse(tl.start);
  const t1 = Date.parse(tl.end);
  const dur = Math.max(1, t1 - t0);
  const geo: GeoRun[] = tl.runs.map((x) => ({ id: x.id, start: x.start, end: x.end, depth: x.depth, fate: x.fate }));
  const lanes = new Map<string, number>();
  for (const { run, lane } of laneRuns(geo).placed) lanes.set(run.id, lane);

  const sorted = [...tl.runs].sort((p, q) => Date.parse(p.start) - Date.parse(q.start) || p.id.localeCompare(q.id));
  const runs: SceneRun[] = sorted.map((x, i) => ({
    id: i,
    a: (Date.parse(x.start) - t0) / dur,
    b: (Date.parse(x.end) - t0) / dur,
    d: x.depth,
    fate: x.fate,
    minutes: Math.max(1, Math.round((Date.parse(x.end) - Date.parse(x.start)) / 60000)),
    s: hm(x.start),
    e: hm(x.end),
    p: null,
    l: lanes.get(x.id) ?? 0,
  }));
  /* The report carries each run's depth but not the run that started it. The fork drawn is
     the containing run one level up that was alive when this one began, the latest such
     start winning: a run of depth two forks from the depth-one run it was inside. */
  for (const run of runs) {
    if (run.d <= 1) continue;
    const parent = runs.filter((o) => o.d === run.d - 1 && o.a <= run.a && o.b > run.a).sort((p, q) => q.a - p.a)[0];
    run.p = parent ? parent.id : null;
  }

  const { peak, at } = peakOf(geo);
  const curve = concurrencyCurve(geo, t0, t1).map(([ms, level]): [number, number] => [Math.round(((ms - t0) / dur) * 10000) / 10000, level]);
  const h = r.headline;
  const day = (date: string): string => {
    const d = new Date(`${date}T00:00:00Z`);
    return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
  };
  const kept: KeptRow[] = [...r.sessions]
    .sort((p, q) => q.cost_usd - p.cost_usd)
    .slice(0, 6)
    .map((sn) => ({
      day: day(sn.date),
      written: sn.files_written,
      alive: sn.files_alive,
      tracked: sn.files_tracked,
      commits: sn.commits,
      cost: sn.cost_usd,
      per: sn.commits ? Math.round((sn.cost_usd / sn.commits) * 100) / 100 : null,
    }));

  return {
    runs,
    curve,
    peak,
    peakX: at === null ? 0 : (at - t0) / dur,
    peakAt: at === null ? "" : hm(new Date(at).toISOString()),
    died: tl.died,
    spawned: tl.spawned_by_agents,
    from: hm(tl.start),
    to: hm(tl.end),
    minutes: Math.round(dur / 60000),
    head: {
      sessions: L.sessions,
      runs: L.agentRuns,
      cost: h.cost_usd.value,
      commits: h.commits.value,
      per: h.cost_per_commit.value ?? 0,
      alive: h.files_alive.alive,
      written: h.files_alive.written,
      noFate: h.runs_no_fate.count,
      window: r.share.period,
    },
    kept,
  };
}
