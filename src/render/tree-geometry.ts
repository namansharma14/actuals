/**
 * Pure geometry for the agent tree, shared by the report/app 2D SVG (`html.ts`) and the
 * landing's 3D object. No rendering, no CSS, no DOM: given the runs (each with a start, end,
 * depth and fate) it says where each run sits in time and depth, so every surface draws the
 * same shape and a bar in the app and a limb on the landing agree.
 *
 * Lifted out of `html.ts`'s `timelineSvg`, which still calls `timeScale`, `concurrencyCurve`
 * and `fateColour` and renders byte-identically (tests/tree-geometry.test.ts). `laneRuns` is
 * the general first-fit packing the 3D object and the compact live view use; the tall static
 * report gives each run its own row instead, so it does not call `laneRuns`.
 */

/** The one run shape the geometry needs; the socket's Timeline run is assignable to it. */
export interface GeoRun {
  id: string;
  /** ISO instant the run began. */
  start: string;
  /** ISO instant the run ended. */
  end: string;
  depth: number;
  fate: string;
}

const ms = (at: number | string): number => (typeof at === "number" ? at : new Date(at).getTime());

/**
 * A time-to-x scale. `left` is the plot's left margin and `width` the drawable width after
 * it, so x runs from `left` at `t0` to `left + width` at `t1`. The span is clamped to at
 * least one millisecond, matching the renderer, so a zero-length window never divides by zero.
 */
export function timeScale(t0: number, t1: number, width: number, left = 0): (at: number | string) => number {
  const span = Math.max(1, t1 - t0);
  return (at) => left + ((ms(at) - t0) / span) * width;
}

/**
 * The concurrency curve: the number of runs alive at each moment, as a step function of
 * `[ms, level]` points. One event per run start (+1) and end (-1); at a tie an end is applied
 * before a start (so a hand-off does not read as a phantom extra agent). Bracketed by
 * `[t0, 0]` and `[t1, 0]`. This is the exact series the report's area curve draws.
 */
export function concurrencyCurve(runs: readonly GeoRun[], t0: number, t1: number): Array<[number, number]> {
  const ev: Array<[number, number]> = [];
  for (const r of runs) {
    ev.push([ms(r.start), 1]);
    ev.push([ms(r.end), -1]);
  }
  ev.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  let level = 0;
  const pts: Array<[number, number]> = [[t0, 0]];
  for (const [at, d] of ev) {
    pts.push([at, level]);
    level += d;
    pts.push([at, level]);
  }
  pts.push([t1, 0]);
  return pts;
}

/** The highest concurrency the curve reaches, and the first instant it reaches it. */
export function peakOf(runs: readonly GeoRun[]): { peak: number; at: number | null } {
  let level = 0;
  let peak = 0;
  let at: number | null = null;
  const ev: Array<[number, number]> = [];
  for (const r of runs) {
    ev.push([ms(r.start), 1]);
    ev.push([ms(r.end), -1]);
  }
  ev.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  for (const [t, d] of ev) {
    level += d;
    if (level > peak) {
      peak = level;
      at = t;
    }
  }
  return { peak, at };
}

/** The semantic tone of a run: a death first, otherwise its depth band (1, 2, or 3+). */
export function fateTone(r: Pick<GeoRun, "fate" | "depth">): "died" | "d1" | "d2" | "d3" {
  if (r.fate === "died") return "died";
  return r.depth <= 1 ? "d1" : r.depth === 2 ? "d2" : "d3";
}

/**
 * The CSS custom property the 2D SVG fills a run's bar with, exactly as `html.ts` always
 * has: `var(--warn)` for a death, else `var(--d1|--d2|--d3)`. A 3D consumer that cannot use a
 * CSS variable should read {@link fateTone} and resolve its own colour from the shared tokens.
 */
export function fateColour(r: Pick<GeoRun, "fate" | "depth">): string {
  const tone = fateTone(r);
  return tone === "died" ? "var(--warn)" : `var(--${tone})`;
}

/**
 * First-fit lane packing: runs sorted by start (then depth), each placed in the first lane
 * whose last run has already ended by the time this one starts, otherwise a new lane. Returns
 * each run with its `lane` index and the total `lanes`. Runs that never overlap collapse onto
 * one lane, so the 3D object and the compact live view stay short instead of one row per run.
 * A touching pair (one ends exactly when the next starts) shares a lane.
 */
export function laneRuns(runs: readonly GeoRun[]): { placed: Array<{ run: GeoRun; lane: number }>; lanes: number } {
  const sorted = [...runs].sort((a, b) => a.start.localeCompare(b.start) || a.depth - b.depth);
  const laneEnds: number[] = []; // the end time (ms) of the last run placed in each lane
  const placed = sorted.map((run) => {
    const s = ms(run.start);
    const e = ms(run.end);
    let lane = laneEnds.findIndex((end) => end <= s);
    if (lane === -1) {
      lane = laneEnds.length;
      laneEnds.push(e);
    } else {
      laneEnds[lane] = e;
    }
    return { run, lane };
  });
  return { placed, lanes: laneEnds.length };
}
