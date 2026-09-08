/**
 * The 31 August session drawn as data: the report's own chart, as SVG rendered on the server.
 * Lanes along y by concurrency slot, time along x, the concurrency curve above, the axis below.
 * In the night it stands large in the page's ink with its four annotations (the readout, your
 * session, the first agent it started, the deaths); in the chapter it sits small on paper.
 */
import type { SceneData } from "./drawing-data";
import { placeRuns, addMin } from "./drawing-geometry";

export function FlatDrawing({ data, w = 560, palette = "paper", notes = false }: { data: SceneData; w?: number; palette?: "paper" | "dark"; notes?: boolean }) {
  const runs = placeRuns(data.runs);
  const dark = palette === "dark";
  const ink = dark ? "#c9d3e0" : "#14171c";
  const barInk = dark ? "#c9c2b3" : "#3c424b";
  const unkInk = dark ? "#6e737a" : "#9aa0a8";
  const FW = w;
  const L = 26;
  const narrow = w < 480;
  const R = notes && !narrow ? 150 : narrow ? 10 : 26;
  const top = notes ? 44 : 26;
  const laneH = notes && !narrow ? Math.max(8, Math.min(18, Math.floor(400 / (data.peak + 2)))) : Math.max(6, Math.min(12, Math.floor(250 / (data.peak + 2))));
  const axisY = top + (data.peak + 1) * laneH + 14;
  const curveH = notes && !narrow ? 90 : 70;
  /* the four annotations: the readout at the peak; the trunk of the session; the first agent it started (of the
     first three, the one standing farthest out); the deaths, above the crown */
  const firstChild = runs.filter((r) => r.p === null).sort((p, q) => p.a - q.a).slice(0, 3).sort((p, q) => q.rad - p.rad)[0];
  const firstDeath = runs.filter((r) => r.fate === "died").sort((p, q) => p.b - q.b)[0];
  const px = (t: number): number => Math.round((L + t * (FW - L - R)) * 10) / 10;
  const laneY = (l: number): number => axisY - 14 - (l + 1) * laneH;
  const ticks: Array<{ t: number; label: string | null }> = [];
  for (let mnt = 0; mnt <= data.minutes; mnt += 15) ticks.push({ t: mnt / data.minutes, label: mnt % 15 === 0 ? addMin(data.from, mnt) : null });
  const FH = axisY + (notes ? (narrow ? 84 : 64) : 26);
  const noteCls = dark ? "sc-svg-note" : "sc-svg-note-d";
  const curve = data.curve.map(([f, n], i) => `${i === 0 ? "M" : "L"}${px(f)} ${(top + curveH - (n / data.peak) * curveH).toFixed(1)}`).join(" ");
  return (
    <svg className={`sc-flat${dark ? " sc-flat-dark" : ""}`} viewBox={`0 0 ${FW} ${FH + curveH}`} role="img" aria-label={`the ${data.runs.length} agent runs of one session drawn to time, ${data.peak} alive at once at ${data.peakAt}, ${data.died} that died`}>
      <g transform={`translate(0 ${curveH})`}>
        <g className="sc-flat-grow">
        {runs.map((r) => {
          const y = laneY(r.l);
          const w = Math.max(2, px(r.b) - px(r.a));
          return (
            <g key={r.id}>
              <rect x={px(r.a)} y={y - laneH * 0.32} width={w.toFixed(1)} height={(laneH * 0.64).toFixed(1)} rx={1} fill={r.fate === "unknown" ? unkInk : barInk} />
              {r.fate === "died" ? <rect x={(px(r.b) - 5).toFixed(1)} y={y - laneH * 0.32} width={5} height={(laneH * 0.64).toFixed(1)} fill="#e0714a" /> : null}
            </g>
          );
        })}
        <line x1={px(0)} y1={axisY} x2={px(1)} y2={axisY} stroke={ink} strokeWidth={2} />
        </g>
        {ticks.map(({ t, label }) => (
          /* each clock label appears whole once the growth has passed it, never cut by the mask */
          <g key={t} className="sc-flat-tick" style={{ "--t": t } as React.CSSProperties}>
            <line x1={px(t)} y1={axisY} x2={px(t)} y2={axisY + 5} stroke={ink} strokeWidth={1} />
            {label && (!narrow || Math.round(t * data.minutes) % 30 === 0) ? (
              <text x={px(t)} y={axisY + 18} textAnchor="middle" className={dark ? "sc-svg-mono" : "sc-svg-mono-d"}>
                {label}
              </text>
            ) : null}
          </g>
        ))}
      </g>
      <path className="sc-flat-curve" d={curve} fill="none" stroke={ink} strokeOpacity={0.8} strokeWidth={1.2} transform={`translate(0 ${curveH * 0.02})`} />
      <g className="sc-svg-readout">
        <text x={narrow && data.peakX > 0.6 ? px(1) : px(data.peakX)} y={12} textAnchor={narrow && data.peakX > 0.6 ? "end" : "middle"} className={dark ? "sc-svg-peak" : "sc-svg-peak-d"}>
          {data.peak} alive at {data.peakAt}
        </text>
      </g>
      {notes ? (
        <g className="sc-svg-notes" transform={`translate(0 ${curveH})`}>
          {/* your session: the axis is the session; named under its start, below the clock */}
          <line x1={px(0)} y1={axisY + 6} x2={px(0)} y2={axisY + 34} stroke={ink} strokeOpacity={0.9} strokeWidth={1} />
          <text x={px(0)} y={axisY + 48} className={noteCls}>
            your session
          </text>
          {firstChild ? (
            <>
              {/* the first agent it started: named above its own bar, with a leader down onto it */}
              <line x1={px((firstChild.a + firstChild.b) / 2)} y1={laneY(firstChild.l) - laneH * 0.4} x2={px((firstChild.a + firstChild.b) / 2)} y2={laneY(firstChild.l) - laneH * 0.4 - 18} stroke={ink} strokeOpacity={0.9} strokeWidth={1} />
              <text x={px((firstChild.a + firstChild.b) / 2)} y={laneY(firstChild.l) - laneH * 0.4 - 24} textAnchor="start" className={noteCls}>
                an agent it started
              </text>
            </>
          ) : null}
          {firstDeath && !narrow ? (
            <>
              <line x1={px(firstDeath.b) + 2} y1={laneY(firstDeath.l)} x2={px(firstDeath.b) + 16} y2={laneY(firstDeath.l)} stroke={ink} strokeOpacity={0.9} strokeWidth={1} />
              <text x={px(firstDeath.b) + 20} y={laneY(firstDeath.l)} dominantBaseline="middle" className={noteCls}>
                {data.died} never came back
              </text>
            </>
          ) : firstDeath ? (
            <>
              {/* on a narrow drawing the deaths are named under the axis, at the session's end, with a leader up to the last one */}
              <line x1={px(firstDeath.b)} y1={laneY(firstDeath.l) + laneH * 0.4} x2={px(firstDeath.b)} y2={axisY + 58} stroke={ink} strokeOpacity={0.9} strokeWidth={1} />
              <text x={px(firstDeath.b)} y={axisY + 72} textAnchor="end" className={noteCls}>
                {data.died} never came back
              </text>
            </>
          ) : null}
        </g>
      ) : null}
    </svg>
  );
}
