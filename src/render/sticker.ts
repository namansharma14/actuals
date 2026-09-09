/**
 * The share card, in one place.
 *
 * One pure function draws it: aggregates in, SVG out. The report's app, `actuals share`
 * (share.svg, and the PNG the app rasterizes from this same string) and the static report's
 * preview all call it, so the card cannot drift between surfaces. The website keeps its own
 * copy of this drawing at site/components/sticker.tsx and mirrors what changes here.
 *
 * What it may carry: the numbers in report.share and the shape of the tallest agent tree's
 * concurrency over time. Never a title, a path, a prompt, a file name or a line of code, and
 * a test proves it against the fixture.
 */
import type { Report } from "../schema/socket.js";
import { renderShareText } from "./share.js";

/** 1080 by 1080: the size a phone screenshot keeps legible. */
export const SIZE = 1080;
const BG = "#0B0E12";
const INK = "#F0EBE2";
const MUTED = "#9DA3AB";
const ACCENT = "#98B2C4";
const WARM = "#E06A3C";
const RULE = "#232A31";
const MONO = "Martian Mono, ui-monospace, SF Mono, Menlo, Consolas, monospace";
const L = 80;
const R = SIZE - 80;

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
function money(n: number | null): string {
  if (n === null) return "n/a";
  return n >= 100 ? "$" + Math.round(n).toLocaleString("en-US") : "$" + n.toFixed(2);
}

/**
 * Everything the card is drawn from: aggregates and a curve of numbers, plus the drawing
 * itself so the app rasterizes exactly what the CLI writes.
 */
export interface StickerData {
  period: string; runs: number; commits: number; per_commit: string; files_alive_pct: number | null; runs_no_fate: number; biggest_tree: number;
  curve: { points: Array<[number, number]>; peak: number; peak_x: number; died: number; runs: number; minutes: number } | null;
  text: string;
  svg: string;
}

/** The aggregates and the curve, without the drawing. */
export function stickerNumbers(r: Report): Omit<StickerData, "svg"> {
  const s = r.share; const t = r.burn.tree.timeline;
  let curve: StickerData["curve"] = null;
  if (t && t.runs.length) {
    const t0 = new Date(t.start).getTime(), t1 = new Date(t.end).getTime(), span = Math.max(1, t1 - t0);
    const ev: Array<[number, number]> = [];
    for (const run of t.runs) { ev.push([new Date(run.start).getTime(), 1]); ev.push([new Date(run.end).getTime(), -1]); }
    ev.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    let level = 0; const points: Array<[number, number]> = [[0, 0]];
    const f = (ms: number) => Math.round(((ms - t0) / span) * 1000) / 1000;
    for (const [ms, d] of ev) { points.push([f(ms), level]); level += d; points.push([f(ms), level]); }
    points.push([1, 0]);
    curve = { points, peak: t.peak, peak_x: f(new Date(t.peak_at).getTime()), died: t.died, runs: t.runs.length, minutes: Math.round(span / 60e3) };
  }
  return { period: s.period, runs: s.agent_runs, commits: s.commits, per_commit: s.cost_per_commit === null ? "n/a" : money(s.cost_per_commit), files_alive_pct: s.files_alive_pct, runs_no_fate: s.runs_no_fate, biggest_tree: s.biggest_tree, curve, text: renderShareText(r) };
}

export function stickerData(r: Report, opts: { fontFaces?: string } = {}): StickerData {
  const n = stickerNumbers(r);
  return { ...n, svg: renderSticker(n, opts) };
}

interface TextOpts { size: number; fill?: string; weight?: number; track?: number; anchor?: "start" | "end" }
function text(x: number, y: number, s: string, o: TextOpts): string {
  const attrs = [`x="${x}"`, `y="${y}"`, `font-family="${MONO}"`, `font-size="${o.size}"`, `font-weight="${o.weight ?? 400}"`, `fill="${o.fill ?? INK}"`];
  if (o.track) attrs.push(`letter-spacing="${o.track}"`);
  if (o.anchor === "end") attrs.push(`text-anchor="end"`);
  return `<text ${attrs.join(" ")}>${esc(s)}</text>`;
}
function rule(y: number): string { return `<rect x="${L}" y="${y}" width="${R - L}" height="1" fill="${RULE}"></rect>`; }
/** One figure: the number, and the word under it. Labels never go below 24 units. */
function figure(x: number, y: number, value: string, label: string, size: number): string {
  return text(x, y, value, { size, weight: 300, track: -Math.round(size / 40) }) + text(x, y + 46, label, { size: 24, fill: MUTED, track: 3 });
}

/**
 * The card. `fontFaces` embeds the report's mono face so the drawing survives being loaded
 * as an image (a browser gives an SVG in an <img> no font but the ones it carries); the file
 * written by `actuals share` is opened in a page and falls back to the system mono without it.
 */
export function renderSticker(d: Omit<StickerData, "svg">, opts: { fontFaces?: string } = {}): string {
  const style = opts.fontFaces ? `<style>${opts.fontFaces}</style>` : "";
  const top = 604, bottom = 830;
  let plot: string;
  if (d.curve && d.curve.points.length) {
    // the curve is drawn from its own levels, so a peak figure counted another way never pushes it out of the box
    const levels = d.curve.points.map((p) => p[1]);
    const ymax = Math.max(4, d.curve.peak, ...levels);
    const highest = d.curve.points[levels.indexOf(Math.max(...levels))]!;
    const X = (f: number): number => Math.round((L + f * (R - L)) * 10) / 10;
    const Y = (v: number): number => Math.round((bottom - (v / ymax) * (bottom - top)) * 10) / 10;
    const path = d.curve.points.map((p) => `${X(p[0])},${Y(p[1])}`).join(" ");
    const cap = `${d.curve.peak} AT ONCE \u00b7 ${d.curve.runs} RUNS IN ${d.curve.minutes} MIN`;
    plot = `<polyline points="${path}" fill="none" stroke="${INK}" stroke-width="4" stroke-linejoin="round" stroke-linecap="round"></polyline>`
      + `<circle cx="${X(highest[0])}" cy="${Y(highest[1])}" r="9" fill="${ACCENT}"></circle>`
      + text(L, 878, cap, { size: 24, fill: MUTED, track: 3 })
      + (d.curve.died ? text(R, 878, `${d.curve.died} DIED`, { size: 24, fill: WARM, track: 3, anchor: "end" }) : "");
  } else {
    plot = text(L, 878, "NO AGENT TREE IN THIS WINDOW", { size: 24, fill: MUTED, track: 3 });
  }
  // the biggest tree is the curve itself, so it is drawn, not repeated as a number
  const alive = d.files_alive_pct === null ? "N/A" : `${d.files_alive_pct}%`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${SIZE} ${SIZE}" width="${SIZE}" height="${SIZE}" role="img" aria-label="my actuals, ${esc(d.period)}">`
    + `<title>my actuals, ${esc(d.period)}</title>${style}`
    + `<rect width="${SIZE}" height="${SIZE}" fill="${BG}"></rect>`
    + text(L, 96, "ACTUALS", { size: 32, weight: 500, track: 10 })
    + text(R, 96, d.period, { size: 24, fill: MUTED, track: 1, anchor: "end" })
    + rule(140)
    + figure(L, 300, d.per_commit, "PER COMMIT, AT LIST RATES", 132)
    + figure(L, 470, String(d.runs), "AGENT RUNS", 80)
    + figure(560, 470, String(d.commits), "COMMITS", 80)
    + `<rect x="${L}" y="${bottom}" width="${R - L}" height="1" fill="${RULE}"></rect>`
    + plot
    + text(L, 924, `FILES ALIVE ${alive} \u00b7 NO FATE ${d.runs_no_fate} RUNS`, { size: 24, fill: MUTED, track: 3 })
    + rule(962)
    + text(L, 1024, "npx actuals", { size: 44, weight: 500, track: 1 })
    + text(R, 1024, "getactuals.net", { size: 24, fill: ACCENT, track: 1, anchor: "end" })
    + `</svg>`;
}

/** The card straight from a report, for the CLI and the static page. */
export function renderStickerSvg(report: Report, opts: { fontFaces?: string } = {}): string {
  return renderSticker(stickerNumbers(report), opts);
}
