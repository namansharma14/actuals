import Link from "next/link";
import type { Report } from "../lib/socket";
import "./components.css";

/**
 * The square a run becomes: the card the command already draws, aggregates only. A hosted
 * run has its own PNG and is shown as one; the sample run is drawn here from the report so
 * the page carries no capture and no stored image.
 */
export function Sticker({
  src,
  size = 300,
  href,
  alt,
  children,
}: {
  src?: string;
  size?: number;
  href?: string;
  alt?: string;
  children?: React.ReactNode;
}) {
  const inner = children ?? (src ? <img src={src} alt={alt ?? ""} loading="lazy" decoding="async" width={1080} height={1080} /> : null);
  /* The size is a custom property, not an inline width, so a narrow screen can still say
     otherwise in the sheet. */
  const style = { "--ac-sticker-w": `${size}px` } as React.CSSProperties;
  if (href) {
    return (
      <Link className="ac-sticker" style={style} href={href}>
        {inner}
      </Link>
    );
  }
  return (
    <div className="ac-sticker" style={style}>
      {inner}
    </div>
  );
}

/* ------------------------------------------------------------------ the drawing */

const S = 1080;
const SL = 72;
const SR = S - 72;
const TOP = 620;
const BOTTOM = 830;
const INK = "#E8E4DA";
const FAINT = "#9DA3AB";
const WARN = "#FF6A3D";
const MONO = "var(--mono), ui-monospace, SFMono-Regular, Menlo, monospace";

const money = (n: number | null): string =>
  n === null ? "n/a" : n >= 100 ? `$${Math.round(n).toLocaleString("en-US")}` : `$${n.toFixed(2)}`;

/** The concurrency curve, stepped, the way the command draws it. */
function curve(runs: Array<{ start: string; end: string }>, t0: number, span: number): Array<[number, number]> {
  const ev: Array<[number, number]> = [];
  for (const r of runs) {
    ev.push([Date.parse(r.start), 1]);
    ev.push([Date.parse(r.end), -1]);
  }
  ev.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const points: Array<[number, number]> = [[0, 0]];
  let level = 0;
  for (const [ms, d] of ev) {
    const f = (ms - t0) / span;
    points.push([f, level]);
    level += d;
    points.push([f, level]);
  }
  points.push([1, 0]);
  return points;
}

/**
 * The sample run's square, inline, so it wears the page's own embedded faces. An SVG loaded
 * through `<img>` cannot reach them, which is why this is not a route.
 */
export function StickerDrawing({ report }: { report: Report }) {
  const s = report.share;
  const tl = report.burn.tree.timeline;
  const alive = s.files_alive_pct === null ? "N/A" : `${s.files_alive_pct}%`;

  let path = "";
  let peak = { x: 0, y: 0, on: false };
  let axis = "";
  if (tl && tl.runs.length > 0) {
    const t0 = Date.parse(tl.start);
    const span = Math.max(1, Date.parse(tl.end) - t0);
    const ymax = Math.max(4, tl.peak);
    const X = (f: number) => +(SL + Math.min(1, Math.max(0, f)) * (SR - SL)).toFixed(2);
    const Y = (v: number) => +(BOTTOM - (v / ymax) * (BOTTOM - TOP)).toFixed(2);
    path = curve(tl.runs, t0, span)
      .map(([f, v], i) => `${i === 0 ? "M" : "L"}${X(f)},${Y(v)}`)
      .join("");
    const pf = (Date.parse(tl.peak_at) - t0) / span;
    peak = { x: X(pf), y: Y(tl.peak), on: true };
    const minutes = Math.round(span / 60000);
    axis = `${tl.peak} AT ONCE · ${tl.runs.length} RUNS IN ${minutes} MIN · ${tl.died} DIED`;
  }

  return (
    <svg
      className="ac-sticker-svg"
      viewBox={`0 0 ${S} ${S}`}
      role="img"
      aria-label={`The card for this run: ${s.agent_runs} agent runs, ${s.commits} commits, ${money(s.cost_per_commit)} a commit, ${alive} of the files agents wrote still on disk.`}
    >
      <text x={SL} y="118" fill={INK} fontFamily={MONO} fontWeight="500" fontSize="34" letterSpacing="8">
        ACTUALS
      </text>
      <text x={SR} y="118" textAnchor="end" fill={FAINT} fontFamily={MONO} fontSize="23">
        {s.period}
      </text>

      <text x={SL} y="280" fill={INK} fontFamily={MONO} fontWeight="300" fontSize="88">
        {s.agent_runs}
      </text>
      <text x={SL} y="318" fill={FAINT} fontFamily={MONO} fontSize="23" letterSpacing="2.5">
        AGENT RUNS
      </text>
      <text x={SL + 468} y="280" fill={INK} fontFamily={MONO} fontWeight="300" fontSize="88">
        {s.commits}
      </text>
      <text x={SL + 468} y="318" fill={FAINT} fontFamily={MONO} fontSize="23" letterSpacing="2.5">
        COMMITS
      </text>

      <text x={SL} y="500" fill={INK} fontFamily={MONO} fontWeight="300" fontSize="136">
        {money(s.cost_per_commit)}
      </text>
      <text x={SL} y="540" fill={FAINT} fontFamily={MONO} fontSize="23" letterSpacing="2.5">
        PER COMMIT, AT LIST RATES
      </text>

      <line x1={SL} y1={BOTTOM} x2={SR} y2={BOTTOM} stroke={FAINT} strokeWidth="1" />
      {path ? <path d={path} fill="none" stroke={INK} strokeWidth="4" strokeLinejoin="round" /> : null}
      {peak.on ? <circle cx={peak.x} cy={peak.y} r="9" fill={WARN} /> : null}
      {axis ? (
        <text x={SL} y={BOTTOM + 40} fill={FAINT} fontFamily={MONO} fontSize="23" letterSpacing="1.5">
          {axis}
        </text>
      ) : null}
      {/* the two long lines keep 23 units and a tighter tracking, so they end inside the artboard */}
      <text x={SL} y="940" fill={FAINT} fontFamily={MONO} fontSize="23" letterSpacing="1.5">
        {`FILES ALIVE ${alive} · RUNS WITH NO FATE ${s.runs_no_fate} · BIGGEST TREE ${s.biggest_tree}`}
      </text>
      <text x={SL} y="1000" fill={INK} fontFamily={MONO} fontWeight="500" fontSize="23" letterSpacing="4">
        MEASURED BY ACTUALS
      </text>
    </svg>
  );
}
