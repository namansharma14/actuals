import { Mark } from "./mark";
import { dayOf } from "../lib/dates";
import type { WeekRow } from "../lib/db";
import "./components.css";

const W = 640;
const H = 132;
const PAD = 10;

const money = (n: number): string =>
  n >= 100 ? `$${Math.round(n).toLocaleString("en-US")}` : `$${n.toFixed(2)}`;

interface Point {
  week: string;
  value: number;
}

/**
 * Cost per commit by week, drawn. One point for the newest run pushed that week, never a
 * sum: two reports in one week usually cover the same sessions. No grid, no axis, no table.
 */
export function WeekLine({ weeks }: { weeks: WeekRow[] }) {
  const points: Point[] = weeks
    .map((w) => ({ week: dayOf(w.week), value: Number(w.cost_per_commit) }))
    .filter((p) => Number.isFinite(p.value))
    .reverse();

  if (points.length === 0) return null;

  const now = points[points.length - 1]!;
  const before = points.length > 1 ? points[points.length - 2] : undefined;
  const delta = before ? now.value - before.value : null;

  const values = points.map((p) => p.value);
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  const span = hi - lo || 1;
  const X = (i: number) => (points.length === 1 ? W / 2 : +((i / (points.length - 1)) * W).toFixed(2));
  const Y = (v: number) => +(H - PAD - ((v - lo) / span) * (H - PAD * 2)).toFixed(2);
  const d = points.map((p, i) => `${i === 0 ? "M" : "L"}${X(i)},${Y(p.value)}`).join("");

  return (
    <div className="ac-week">
      <div className="ac-week-now">
        <div className="ac-week-n">{money(now.value)}</div>
        <div className="ac-week-m">
          <Mark kind="estimated" />
          <span>a commit, week of {now.week}</span>
        </div>
        <p className="ac-note">
          {delta === null ? (
            "The first week on the line."
          ) : delta === 0 ? (
            "No change on the week before."
          ) : (
            <>
              {`${money(Math.abs(delta))} ${delta > 0 ? "more" : "less"} than the week before.`} <Mark kind="estimated" />
            </>
          )}
        </p>
      </div>
      {points.length > 1 ? (
        <svg
          className="ac-week-svg"
          viewBox={`0 0 ${W} ${H}`}
          role="img"
          aria-label={`Cost per commit for the last ${points.length} weeks, ending at ${money(now.value)}.`}
        >
          <path className="ac-week-path" d={d} fill="none" />
          <circle className="ac-week-dot" cx={X(points.length - 1)} cy={Y(now.value)} r="4" />
        </svg>
      ) : null}
    </div>
  );
}
