/**
 * The report renderer, instrument direction. Renders report.json unmodified:
 * every number shown comes from the socket and carries its mark. One self-contained file,
 * embedded fonts, no script, no network. With `app` set, the page gains the picker, the
 * drawer, fix actions, and one inline script (D13); the static export never does.
 */
import { APP_CSS, CLIENT_JS, EMBED_JS, appData, embedData, fixActions, sDrawerShell, sPicker, sSticker, type AppRender, type EmbedRender } from "./app.js";
import { FONT_FACES } from "./fonts.js";
import { TOKENS_CSS } from "./tokens.js";
import { renderStickerSvg, SIZE } from "./sticker.js";
import type { Report } from "../schema/socket.js";

export interface RenderOpts {
  redact: boolean;
  app?: AppRender;
  embed?: EmbedRender;
  /** a hosted copy: the page exists because this redacted report was uploaded, and it says so in the rail and the closing line */
  hosted?: boolean;
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------
export function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}
const plain = (s: string): string => s.replace(/—|–/g, ",");
export function money(n: number | null): string {
  if (n === null) return "n/a";
  const abs = Math.abs(n);
  return (n < 0 ? "-$" : "$") + (abs >= 100 ? Math.round(abs).toLocaleString("en-US") : abs.toFixed(2));
}
export const int = (n: number): string => n.toLocaleString("en-US");
function pct(part: number, whole: number): string { return whole > 0 ? `${Math.round((part / whole) * 100)}%` : "n/a"; }
function dateOnly(iso: string): string { const m = /^(\d{4}-\d{2}-\d{2})/.exec(iso); return m && m[1] ? m[1] : iso; }
export function dateTime(iso: string): string { const m = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/.exec(iso); return m && m[1] && m[2] ? `${m[1]} ${m[2]} UTC` : iso; }
export function hm(iso: string): string { const m = /T(\d{2}:\d{2})/.exec(iso); return m && m[1] ? m[1] : iso; }
export function dayLabel(iso: string): string {
  const d = new Date(iso); if (Number.isNaN(d.getTime())) return iso;
  return `${d.getUTCDate()} ${["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"][d.getUTCMonth()]}`;
}
/** The marks as a reader sees them: the schema keeps "founder-labelled", the page says whose label it is. */
const MARK_TEXT: Record<string, string> = { "founder-labelled": "your label" };
/** Fate states as a reader sees them; the schema keeps the snake_case values. */
import { concurrencyCurve, fateColour, timeScale } from "./tree-geometry.js";

const FATE_TEXT: Record<string, string> = { still_running: "still running", died: "died", founder_labelled: "labelled by you", landed_tracked: "landed, tracked", landed_untracked: "landed, untracked", finished_unlanded: "finished, nothing survives", unknown: "unknown" };
/** The marks a render has used so far, so the legend line names only those. Reset per render. */
const usedMarks = new Set<string>();
export const mark = (m: string): string => { usedMarks.add(m); return `<span class="mark">${esc(MARK_TEXT[m] ?? m)}</span>`; };
export const lab = (s: string): string => `<div class="lab">${esc(s)}</div>`;

// ---------------------------------------------------------------------------
// sections
// ---------------------------------------------------------------------------
function sRail(r: Report, o: RenderOpts): string {
  const repo = o.redact ? "redacted" : r.repo_path;
  const since = r.window.since ? dateOnly(r.window.since) : "the earliest session";
  const until = r.window.until ? dateOnly(r.window.until) : "now";
  return `<header class="rail">
  <div class="rail-l"><span class="wordmark">ACTUALS</span><span>${esc(repo)}</span><span>${esc(since)} to ${esc(until)}</span></div>
  <div class="rail-r"><span>rates ${esc(r.rates_version)}</span><span>generated ${esc(dateTime(r.generated_at))}</span><span class="rail-strong">${o.hosted ? "hosted copy · read locally · 0 tokens spent" : "local · 0 bytes uploaded · 0 tokens spent"}</span></div>
</header>`;
}

/** The five figures with their marks. The words that explained each one live in the foot. */
function sReadouts(r: Report, o: RenderOpts): string {
  const h = r.headline;
  const live = r.live && (r.live.watching || r.live.events > 0)
    ? `<div class="fine">${mark("measured")} watch ${r.live.watching ? "on" : "off"} · ${int(r.live.events)} live events${r.live.first_event ? ` since ${esc(dateOnly(r.live.first_event))}` : ""} · ${int(r.live.compactions)} compaction${r.live.compactions === 1 ? "" : "s"} · ${int(r.live.sessions_live_only)} session${r.live.sessions_live_only === 1 ? "" : "s"} seen only live</div>`
    : "";
  const next = o.app || o.embed ? "Click a session to see what its agents did." : "Run actuals app to click into any session.";
  return `<div class="top-block"><section class="readouts avoid">
  <div class="ro ro-big">${lab(h.cost_sessions && h.cost_sessions.measured > 0 ? "tokens, as Claude Code and list rates count them" : "tokens at list rates")}<div class="fig fig-xl">${esc(money(h.cost_usd.value))}</div><div class="ro-sub">${mark(h.cost_usd.mark)}<span class="fine">${int(r.sessions.length)} ${r.sessions.length === 1 ? "session" : "sessions"} · ${int(r.share.agent_runs)} agent runs${h.cost_sessions && h.cost_sessions.measured > 0 ? ` · ${int(h.cost_sessions.measured)} measured by Claude Code, ${int(h.cost_sessions.priced)} priced at list rates` : ""}</span></div></div>
  <div class="ro">${lab("commits")}<div class="fig">${int(h.commits.value)}</div><div class="ro-sub">${mark(h.commits.mark)}</div></div>
  <div class="ro">${lab("per commit")}<div class="fig">${esc(money(h.cost_per_commit.value))}</div><div class="ro-sub">${mark(h.cost_per_commit.mark)}</div></div>
  <div class="ro">${lab("files alive")}<div class="fig">${esc(pct(h.files_alive.alive, h.files_alive.written))}</div><div class="ro-sub">${mark(h.files_alive.mark)}<span class="fine">${int(h.files_alive.alive)} of ${int(h.files_alive.written)}</span></div></div>
  <div class="ro">${lab("runs, no fate")}<div class="fig">${int(h.runs_no_fate.count)}</div><div class="ro-sub">${mark(h.runs_no_fate.mark)}<span class="fine">${esc(money(h.runs_no_fate.cost_usd))}</span></div></div>
</section>
<p class="next">${next}</p>${live}</div>`;
}

export function timelineSvg(t: NonNullable<Report["burn"]["tree"]["timeline"]>): string {
  const PW = 1088, L = 64, PLOT = PW - L, CH = 150, ytop = 12;
  const t0 = new Date(t.start).getTime(), t1 = new Date(t.end).getTime(), span = Math.max(1, t1 - t0);
  const ymax = Math.max(20, Math.ceil(t.peak / 5) * 5);
  const X = timeScale(t0, t1, PLOT, L);
  const Y = (v: number) => ytop + (CH - ytop) * (1 - v / ymax);
  const pts = concurrencyCurve(t.runs, t0, t1);
  const path = "M" + pts.map(([ms, v]) => `${X(ms).toFixed(1)} ${Y(v).toFixed(1)}`).join(" L");
  const fill = `${path} L${X(t1).toFixed(1)} ${Y(0).toFixed(1)} L${X(t0).toFixed(1)} ${Y(0).toFixed(1)} Z`;
  const RH = 11, G0 = CH + 34, GH = t.runs.length * RH, AX = G0 + GH + 10, H = AX + 22;
  const runs = [...t.runs].sort((a, b) => a.start.localeCompare(b.start) || a.depth - b.depth);
  let bars = "";
  runs.forEach((r, i) => {
    const x = X(new Date(r.start).getTime()); const w = Math.max(3, ((new Date(r.end).getTime() - new Date(r.start).getTime()) / span) * PLOT); const y = G0 + i * RH;
    const col = fateColour(r);
    bars += `<rect x="${x.toFixed(1)}" y="${y}" width="${w.toFixed(1)}" height="7" fill="${col}"></rect>`;
  });
  // ticks: every 15 min under 3 h, else every 30 min
  const stepMin = span <= 3 * 3600e3 ? 15 : span <= 8 * 3600e3 ? 30 : 60;
  let grat = "";
  for (let m = 0; m * 60e3 <= span + 1; m += stepMin) {
    const x = X(t0 + m * 60e3);
    grat += `<line x1="${x.toFixed(1)}" y1="${ytop}" x2="${x.toFixed(1)}" y2="${G0 + GH}" stroke="var(--grid)" stroke-width="1"></line><text x="${x.toFixed(1)}" y="${AX + 14}" text-anchor="${x > PW - 22 ? "end" : "middle"}" class="svg-lab">${esc(hm(new Date(t0 + m * 60e3).toISOString()))}</text>`;
  }
  const ystep = ymax / 4;
  let ylab = "";
  for (let v = 0; v <= ymax; v += ystep) ylab += `<line x1="${L}" y1="${Y(v).toFixed(1)}" x2="${PW}" y2="${Y(v).toFixed(1)}" stroke="var(--grid)" stroke-width="1"></line><text x="${L - 10}" y="${(Y(v) + 3.5).toFixed(1)}" text-anchor="end" class="svg-lab">${v}</text>`;
  const px = X(new Date(t.peak_at).getTime()), py = Y(t.peak);
  const peak = `<circle cx="${px.toFixed(1)}" cy="${py.toFixed(1)}" r="4" fill="var(--mark)"></circle><line x1="${px.toFixed(1)}" y1="${py.toFixed(1)}" x2="${px.toFixed(1)}" y2="${G0 + GH}" stroke="var(--mark)" stroke-width="1" stroke-dasharray="2 3" opacity="0.7"></line>` +
    (px > PW / 2
      ? `<rect x="${(px - 200).toFixed(1)}" y="${(py - 7).toFixed(1)}" width="186" height="15" fill="var(--bg)" fill-opacity="0.85"></rect><text x="${(px - 14).toFixed(1)}" y="${(py + 4).toFixed(1)}" text-anchor="end" class="svg-lab mk">${t.peak} concurrent at ${esc(hm(t.peak_at))} UTC</text>`
      : `<rect x="${(px + 10).toFixed(1)}" y="${(py - 7).toFixed(1)}" width="186" height="15" fill="var(--bg)" fill-opacity="0.85"></rect><text x="${(px + 14).toFixed(1)}" y="${(py + 4).toFixed(1)}" class="svg-lab mk">${t.peak} concurrent at ${esc(hm(t.peak_at))} UTC</text>`);
  const died = t.died > 0 ? `<text x="${PW - 14}" y="${G0 - 10}" text-anchor="end" class="svg-lab warn">${t.died} run${t.died === 1 ? "" : "s"} died · last record ${esc(hm(t.end))} UTC</text>` : "";
  const cap = `<text x="${L + 12}" y="${(Y(20) + 20).toFixed(1)}" class="svg-lab">20 · the Claude Code default cap</text>`;
  return `<svg viewBox="0 0 ${PW} ${H}" width="${PW}" height="${H}" style="width: 100%; height: auto; display: block;"><title>${esc(t.date)}: concurrent agent runs over time, then one bar per run</title>${grat}${ylab}<path d="${fill}" fill="var(--d1)" fill-opacity="0.05"></path><path d="${path}" fill="none" stroke="var(--d1)" stroke-width="1.5"></path>${cap}${peak}${bars}${died}</svg>`;
}

/**
 * The same instrument for a narrow/phone column, drawn to its OWN viewBox so the labels stay
 * legible instead of shrinking with the page. Desktop scales one wide viewBox to fit, which
 * pushes 10px labels below readable on a phone; here the viewBox width equals a `min-width`, so
 * the chart never scales below 1:1 (labels render at a true 12px) and the wrapper scrolls
 * horizontally instead. Fewer x-ticks and taller rows suit the smaller width. A `font-size="12"`
 * floor on the root keeps legibility from depending on the stylesheet loading. The desktop
 * `timelineSvg` above is untouched (its golden holds); a media query switches `.tl-wide` /
 * `.tl-narrow`.
 */
export function timelineSvgNarrow(t: NonNullable<Report["burn"]["tree"]["timeline"]>): string {
  const PW = 600, L = 44, PLOT = PW - L, CH = 140, ytop = 14;
  const t0 = new Date(t.start).getTime(), t1 = new Date(t.end).getTime(), span = Math.max(1, t1 - t0);
  const ymax = Math.max(20, Math.ceil(t.peak / 5) * 5);
  const X = timeScale(t0, t1, PLOT, L);
  const Y = (v: number) => ytop + (CH - ytop) * (1 - v / ymax);
  const pts = concurrencyCurve(t.runs, t0, t1);
  const path = "M" + pts.map(([ms, v]) => `${X(ms).toFixed(1)} ${Y(v).toFixed(1)}`).join(" L");
  const fill = `${path} L${X(t1).toFixed(1)} ${Y(0).toFixed(1)} L${X(t0).toFixed(1)} ${Y(0).toFixed(1)} Z`;
  const RH = 16, G0 = CH + 36, GH = t.runs.length * RH, AX = G0 + GH + 12, H = AX + 26;
  const runs = [...t.runs].sort((a, b) => a.start.localeCompare(b.start) || a.depth - b.depth);
  let bars = "";
  runs.forEach((r, i) => {
    const x = X(new Date(r.start).getTime()); const w = Math.max(3, ((new Date(r.end).getTime() - new Date(r.start).getTime()) / span) * PLOT); const y = G0 + i * RH;
    bars += `<rect x="${x.toFixed(1)}" y="${y}" width="${w.toFixed(1)}" height="9" fill="${fateColour(r)}"></rect>`;
  });
  // half the desktop tick density: the narrow width cannot carry a label every 15 min at 12px.
  const stepMin = span <= 3 * 3600e3 ? 30 : span <= 8 * 3600e3 ? 60 : 120;
  let grat = "";
  for (let m = 0; m * 60e3 <= span + 1; m += stepMin) {
    const x = X(t0 + m * 60e3);
    grat += `<line x1="${x.toFixed(1)}" y1="${ytop}" x2="${x.toFixed(1)}" y2="${G0 + GH}" stroke="var(--grid)" stroke-width="1"></line><text x="${(x > PW - 22 ? PW - 26 : x).toFixed(1)}" y="${AX + 16}" text-anchor="${x > PW - 22 ? "end" : "middle"}" class="svg-lab-n">${esc(hm(new Date(t0 + m * 60e3).toISOString()))}</text>`;
  }
  const ystep = ymax / 4;
  let ylab = "";
  for (let v = 0; v <= ymax; v += ystep) ylab += `<line x1="${L}" y1="${Y(v).toFixed(1)}" x2="${PW}" y2="${Y(v).toFixed(1)}" stroke="var(--grid)" stroke-width="1"></line><text x="${L - 10}" y="${(Y(v) + 4).toFixed(1)}" text-anchor="end" class="svg-lab-n">${v}</text>`;
  const px = X(new Date(t.peak_at).getTime()), py = Y(t.peak);
  const CW = 210;
  const peak = `<circle cx="${px.toFixed(1)}" cy="${py.toFixed(1)}" r="4" fill="var(--mark)"></circle><line x1="${px.toFixed(1)}" y1="${py.toFixed(1)}" x2="${px.toFixed(1)}" y2="${G0 + GH}" stroke="var(--mark)" stroke-width="1" stroke-dasharray="2 3" opacity="0.7"></line>` +
    (px > PW / 2
      ? `<rect x="${(px - CW - 4).toFixed(1)}" y="${(py - 9).toFixed(1)}" width="${CW}" height="18" fill="var(--bg)" fill-opacity="0.85"></rect><text x="${(px - 16).toFixed(1)}" y="${(py + 5).toFixed(1)}" text-anchor="end" class="svg-lab-n mk">${t.peak} concurrent at ${esc(hm(t.peak_at))} UTC</text>`
      : `<rect x="${(px + 10).toFixed(1)}" y="${(py - 9).toFixed(1)}" width="${CW}" height="18" fill="var(--bg)" fill-opacity="0.85"></rect><text x="${(px + 16).toFixed(1)}" y="${(py + 5).toFixed(1)}" class="svg-lab-n mk">${t.peak} concurrent at ${esc(hm(t.peak_at))} UTC</text>`);
  const died = t.died > 0 ? `<text x="${PW - 30}" y="${G0 - 12}" text-anchor="end" class="svg-lab-n warn">${t.died} run${t.died === 1 ? "" : "s"} died · last record ${esc(hm(t.end))} UTC</text>` : "";
  const cap = `<text x="${L + 12}" y="${(Y(20) + 22).toFixed(1)}" class="svg-lab-n">20 · the Claude Code default cap</text>`;
  return `<svg viewBox="0 0 ${PW} ${H}" width="${PW}" height="${H}" font-size="12" style="width: 100%; min-width: ${PW}px; height: auto; display: block;"><title>${esc(t.date)}: concurrent agent runs over time, then one bar per run (narrow)</title>${grat}${ylab}<path d="${fill}" fill="var(--d1)" fill-opacity="0.05"></path><path d="${path}" fill="none" stroke="var(--d1)" stroke-width="1.5"></path>${cap}${peak}${bars}${died}</svg>`;
}

/** Both instruments: the wide one for desktop, the legible narrow one for phones; CSS shows one. */
function plotBoth(t: NonNullable<Report["burn"]["tree"]["timeline"]>): string {
  return `<div class="tl-wide">${timelineSvg(t)}</div><div class="tl-narrow">${timelineSvgNarrow(t)}</div>`;
}

type Timeline = NonNullable<Report["burn"]["tree"]["timeline"]>;

const LEGEND = `<div class="legend"><span><i class="sw line"></i>concurrent</span><span><i class="sw" style="background: var(--d1)"></i>depth 1</span><span><i class="sw" style="background: var(--d2)"></i>depth 2</span><span><i class="sw" style="background: var(--d3)"></i>depth 3</span><span><i class="sw" style="background: var(--warn)"></i>died</span></div>`;

/**
 * The instrument for one session: heading, the curve with one bar per run, the mark line,
 * and the five measured insights folded under it. The static report draws the tallest tree;
 * the app re-renders this for any session with timed runs (same code, never a browser copy).
 */
export function instrumentBody(t: Timeline, treeMark: string, tallest: boolean): string {
  return `<div class="block-head">
    <div>${lab(tallest ? "the session with the tallest tree" : "another session, drawn to time")}<h2>${esc(dayLabel(t.date))}, ${esc(hm(t.start))} to ${esc(hm(t.end))} UTC. ${esc(cap(numberWord(t.runs.length)))} runs, ${esc(numberWord(t.peak))} at once${t.died > 0 ? `, ${esc(numberWord(t.died))} dead` : ""}.</h2></div>
    ${LEGEND}
  </div>
  <div class="plot">${plotBoth(t)}</div>
  <div class="fine">${mark(treeMark)} session: ${esc(t.title)}</div>
  <details class="fold"><summary>what the curve says</summary><div class="insights">${treeInsights(t).map((x) => `<div class="insight"><i></i><span>${esc(x)}</span></div>`).join("")}</div><div class="fine">the curve is the number of agent runs alive at each moment; each bar under it is one run, drawn to its start and end</div></details>`;
}

function sInstrument(r: Report, o: RenderOpts): string {
  const t = r.burn.tree.timeline;
  const tree = r.burn.tree;
  const hist = Object.entries(tree.depth_histogram).sort((a, b) => Number(a[0]) - Number(b[0])).map(([d, n]) => `${int(n)} at depth ${d}`).join(", ");
  if (!t) {
    return `<section class="block break">
  <div class="block-head"><div>${lab("agent trees")}<h2>No agent tree with timestamps in this window.</h2></div></div>
  <div class="fine">${esc(hist || "no agent runs")}</div>
</section>`;
  }
  const maxPeak = Math.max(1, tree.peaks[0]?.peak ?? 1);
  const cells = (p: Report["burn"]["tree"]["peaks"][number]) => `<span class="fine">${esc(dayLabel(p.date))}</span><span class="peak-bar"><i style="width: ${Math.max(2, Math.round((p.peak / maxPeak) * 100))}%"></i></span><span class="num">${p.peak}</span><span class="fine">depth ${p.max_depth}</span>`;
  // static: the other peaks, listed. app: every peak is a button that draws that session.
  const peaks = o.app
    ? tree.peaks.slice(0, 8).map((p) => `<button type="button" class="peak-row" data-session="${esc(p.session_id)}" aria-current="${p.session_id === t.session_id ? "true" : "false"}">${cells(p)}</button>`).join("")
    : tree.peaks.filter((p) => p.session_id !== t.session_id).slice(0, 4).map((p) => `<div class="peak-row">${cells(p)}</div>`).join("");
  const peaksLab = o.app ? "sessions with trees, click to draw" : "other peaks";
  return `<section class="block break" id="instrument">
  <div class="instrument-body" id="instrument-body">${instrumentBody(t, tree.mark, true)}</div>
  ${peaks ? `<div class="peaks"><div class="lab">${peaksLab}</div>${peaks}<div class="fine">${esc(hist)} across every session</div></div>` : ""}
</section>`;
}

const cap = (w: string): string => w.charAt(0).toUpperCase() + w.slice(1);

/** Measured statements about the tallest tree, derived from its runs; never adjectives. */
function treeInsights(t: NonNullable<Report["burn"]["tree"]["timeline"]>): string[] {
  const out: string[] = [];
  const t0 = new Date(t.start).getTime(), t1 = new Date(t.end).getTime();
  const minutes = Math.round((t1 - t0) / 60e3);
  const peakMin = Math.round((new Date(t.peak_at).getTime() - t0) / 60e3);
  out.push(`${int(t.runs.length)} runs over ${int(minutes)} minutes; the peak of ${int(t.peak)} came ${int(peakMin)} minutes in, ${Math.round((peakMin / Math.max(1, minutes)) * 100)}% of the way through.`);
  out.push(`${int(t.spawned_by_agents)} of the ${int(t.runs.length)} were spawned by other agents, not by you${t.spawned_by_agents > t.runs.length / 2 ? "; the tree grew itself" : ""}.`);
  const byDepth = new Map<number, number>();
  for (const r of t.runs) byDepth.set(r.depth, (byDepth.get(r.depth) ?? 0) + 1);
  const deepest = Math.max(...t.runs.map((r) => r.depth));
  out.push(`Depth ${deepest} was the deepest level, with ${int(byDepth.get(deepest) ?? 0)} runs there; ${[...byDepth.entries()].sort((a, b) => a[0] - b[0]).map(([d, n]) => `${int(n)} at depth ${d}`).join(", ")}.`);
  const died = t.runs.filter((r) => r.fate === "died");
  if (died.length) {
    const deadDepths = [...new Set(died.map((r) => r.depth))].sort();
    const lastDeath = died.map((r) => r.end).sort().at(-1)!;
    out.push(`${cap(numberWord(died.length))} run${died.length === 1 ? "" : "s"} died, ${deadDepths.length === 1 ? `all at depth ${deadDepths[0]}` : `at depths ${deadDepths.join(" and ")}`}; the last record of any of them is ${hm(lastDeath)} UTC, ${Math.round((t1 - new Date(lastDeath).getTime()) / 60e3)} minutes before the session's own last record.`);
  } else {
    out.push("No run died; every bar has a start and an end.");
  }
  const longest = [...t.runs].sort((a, b) => (new Date(b.end).getTime() - new Date(b.start).getTime()) - (new Date(a.end).getTime() - new Date(a.start).getTime()))[0];
  if (longest) out.push(`The longest run lasted ${int(Math.round((new Date(longest.end).getTime() - new Date(longest.start).getTime()) / 60e3))} minutes at depth ${longest.depth}.`);
  return out;
}
const WORDS = ["zero","one","two","three","four","five","six","seven","eight","nine","ten","eleven","twelve","thirteen","fourteen","fifteen","sixteen","seventeen","eighteen","nineteen","twenty"];
function numberWord(n: number): string {
  if (n >= 0 && n <= 20) return WORDS[n]!;
  if (n < 100 && n % 10 === 0) return ["","","twenty","thirty","forty","fifty","sixty","seventy","eighty","ninety"][n / 10]!;
  if (n < 100) return `${["","","twenty","thirty","forty","fifty","sixty","seventy","eighty","ninety"][Math.floor(n / 10)]}-${WORDS[n % 10]}`;
  return int(n);
}

function sFateAndRereads(r: Report, o: RenderOpts): string {
  const f = r.burn.fate; const count = Object.values(f.by_state).reduce((a, b) => a + b, 0); const total = count || 1;
  const order: Array<[string, string, string]> = [["landed_tracked", "var(--d1)", "landed, tracked"], ["landed_untracked", "var(--d2)", "landed, untracked"], ["finished_unlanded", "var(--dim)", "finished, nothing survives"], ["unknown", "var(--dimmer)", "unknown"], ["died", "var(--warn)", "died"], ["founder_labelled", "var(--mark)", "your label"], ["still_running", "var(--grid)", "still running"]];
  const segs = order.filter(([k]) => (f.by_state[k] ?? 0) > 0).map(([k, c]) => `<i style="width: ${((f.by_state[k] ?? 0) / total) * 100}%; background: ${c}"></i>`).join("");
  const rows = order.filter(([k]) => (f.by_state[k] ?? 0) > 0).map(([k, c, l]) => `<div class="num" style="color: ${k === "died" ? "var(--warn)" : "var(--ink)"}">${int(f.by_state[k] ?? 0)}</div><div class="muted">${esc(l)}<i class="dot" style="background: ${c}"></i></div>`).join("");
  const rr = r.burn.rereads;
  const top = rr.top.slice(0, 5).map((x) => `<div class="num">${int(x.n)}</div><div class="muted mono-sm">${esc(o.redact ? "(redacted)" : x.path)}</div>`).join("");
  return `<section class="two avoid">
  <div class="col">${lab(`fate of ${int(count)} ${count === 1 ? "run" : "runs"}`)}<div class="segbar">${segs}</div><div class="kv">${rows}</div><div class="fine">${mark(f.mark)} ${int(f.unlandable_count)} with no traceable fate, ${esc(money(f.unlandable_cost_usd))}</div></div>
  <div class="col">${lab("the same file, read again")}<div class="fig fig-md">${int(rr.rereads)}<span class="unit"> of ${int(rr.reads)} reads</span></div><div class="kv">${top || '<div class="muted">no re-reads</div>'}</div><div class="fine">${mark(rr.mark)}</div></div>
</section>`;
}

function sModels(r: Report): string {
  const maxK = Math.max(0, ...r.models.map((m) => m.kept_per_usd ?? 0));
  // a model that spent and landed nothing is 0.000; null only when it spent nothing
  const kept = (m: Report["models"][number]): number | null => m.kept_per_usd ?? (m.cost_usd > 0 ? 0 : null);
  const rows = r.models.map((m) => { const k = kept(m); return `<div class="mono-sm">${esc(m.model)}</div><div class="num">${int(m.runs)}</div><div class="num">${m.per_run_usd.toFixed(2)}</div><div class="num">${int(m.finished)}</div><div class="num">${int(m.landed)}</div><div>${k === null ? '<span class="muted">no spend</span>' : `<span class="kbar"><i style="width: ${maxK > 0 ? Math.round((k / maxK) * 100) : 0}%"></i></span><span class="num">${k.toFixed(3)}</span>`}</div>`; }).join("");
  return `<section class="block avoid">
  <div class="block-head"><div>${lab("kept work per dollar, by model")}</div></div>
  <div class="table models"><div class="th">model</div><div class="th r">runs</div><div class="th r">$ / run</div><div class="th r">finished</div><div class="th r">landed</div><div class="th">kept / $</div>${rows}</div>
  <div class="fine">kept work per dollar; 0 means nothing landed · ${r.models.map((m) => mark(m.rate_mark)).filter((v, i, a) => a.indexOf(v) === i).join(" ")}</div>
</section>`;
}

function sSessions(r: Report, o: RenderOpts): string {
  const max = Math.max(1, ...r.sessions.map((s) => s.cost_usd));
  const rows = r.sessions.map((s) => {
    const title = o.redact ? `session ${s.id.slice(0, 8)}` : s.title;
    const goal = s.claimed && s.claimed.goal && !o.redact ? plain(s.claimed.goal) : "";
    const goalShort = goal.length > 96 ? goal.slice(0, 95).replace(/\s+\S*$/, "") + "…" : goal;
    const claimed = s.claimed ? `<div class="claimed" title="${esc(goal)}">claimed by /insights: ${esc(plain(s.claimed.outcome))}${goalShort ? ` · ${esc(goalShort)}` : ""} ${mark(s.claimed.mark)}</div>` : "";
    const oc = s.outcome.state === "died" ? "warn" : ""; // warm means died: colour the outcome only when the outcome itself is a death, not when any run in it died
    return `<div class="tr"${o.app || o.embed ? ` data-session="${esc(s.id)}" title="open this session"` : ""}>
      <div class="fine">${esc(dayLabel(s.date))}</div>
      <div><div class="title">${esc(title)}</div>${claimed}${s.compactions ? `<div class="claimed">${int(s.compactions)} compaction${s.compactions === 1 ? "" : "s"} recorded live ${mark("measured")}</div>` : ""}</div>
      <div class="costcell"><span class="cbar"><i style="width: ${Math.round((s.cost_usd / max) * 100)}%"></i></span><span class="num">${esc(money(s.cost_usd))}</span>${s.cost_mark === "measured" ? mark("measured") : ""}</div>
      <div class="num r">${int(s.commits)}</div>
      <div class="num r">${int(s.files_alive)} / ${int(s.files_written)}</div>
      <div class="num r ${s.died > 0 ? "warn" : ""}" style="white-space: nowrap;">${s.agents ? `${int(s.agents)} · peak ${s.peak_concurrency} · d${s.max_depth}` : "0"}</div>
      <div class="outcome ${oc}"><span class="state">${esc(s.outcome.state)}</span>${mark(s.outcome.mark)}<div class="fine">${esc(plain(s.outcome.note))}</div></div>
    </div>`;
  }).join("");
  return `<section class="block break" id="sessions">
  <div class="block-head"><div>${lab("what you got, session by session")}<h2>${int(r.sessions.length)} ${r.sessions.length === 1 ? "session" : "sessions"}.</h2></div></div>
  <div class="table sessions"><div class="th-row"><div class="th">date</div><div class="th">session</div><div class="th">cost</div><div class="th r">commits</div><div class="th r">files alive</div><div class="th r">agents</div><div class="th">outcome</div></div>${rows}</div>
</section>`;
}

function sFixes(r: Report, o: RenderOpts): string {
  const cards = r.fixes.map((f, i) => `<div class="fix ${f.available ? "" : "off"} avoid">
    <div class="fixno">F${i + 1}</div>
    <div class="fixbody"><div class="fixtitle">${esc(f.title)}${f.available ? "" : ' <span class="muted">(not available yet)</span>'}</div><div class="fine">target: ${esc(o.redact ? "[redacted]" : f.target_file)}</div><details class="fold"><summary>why</summary><p>${esc(plain(f.why))}</p>${f.would_have_blocked ? `<div class="fine">${esc(f.would_have_blocked)}</div>` : ""}</details>${o.app ? fixActions(f.id, f.available, o.app.applied.includes(f.id)) : ""}</div>
    <pre>${esc(o.redact ? "[redacted]" : f.snippet)}</pre>
  </div>`).join("");
  return `<section class="block break" id="fixes">
  <div class="block-head"><div>${lab("the fixes, derived from the numbers above")}<h2>${int(r.fixes.length)} ${r.fixes.length === 1 ? "fix" : "fixes"}, written for this repository.</h2></div></div>
  <div class="fixes">${cards}</div>
  <div class="fine mono-sm">${o.app ? "or from the terminal: " : ""}actuals fix · actuals undo &lt;fix-id&gt;</div>
</section>`;
}

function sShare(r: Report): string {
  const svg = renderStickerSvg(r).replace(/ xmlns="[^"]*"/, "").replace(new RegExp(` width="${SIZE}" height="${SIZE}"`), ' style="width: 100%; height: auto; display: block;"');
  return `<section class="block avoid">
  <div class="block-head"><div>${lab("share it, or don't")}<h2>Aggregates only.</h2></div></div>
  <div class="share-wrap">${svg}</div>
  <div class="fine mono-sm">actuals share · writes share.svg and share.txt next to this report</div>
</section>`;
}

/** One gloss per mark, short enough for one line; an unknown mark falls back to the socket's own sentence. */
const GLOSS: Record<string, string> = {
  measured: "read from transcripts and git",
  estimated: "priced at list rates",
  "founder-labelled": "as you said it",
  illustrative: "a mock",
  assumed: "rate not published",
};

/**
 * The foot: the marks legend as one line, once, and one closed disclosure that holds every
 * explainer the sections used to carry, then the method, the limitations, the fate states
 * and the tools. Numbers first, words second; the words are all still here.
 */
function sMethod(r: Report, o: RenderOpts): string {
  const li = (xs: string[]) => xs.map((x) => `<li>${esc(plain(x))}</li>`).join("");
  const used = new Set(usedMarks);
  const legend = Object.entries(r.marks_legend).filter(([k]) => used.has(k)).map(([k, v]) => `<span>${mark(k)} ${esc(GLOSS[k] ?? plain(v))}</span>`).join("");
  const row = (label: string, text: string) => `<div class="lab">${esc(label)}</div><div class="muted">${text}</div>`;
  const app = Boolean(o.app || o.embed);
  const notes = [
    row("the numbers", "Tokens at list rates count every request once. Commits are the ones made inside sessions. Files alive is how many of the files agents wrote are still on disk. Runs with no fate are the ones whose work cannot be traced, and what they cost."),
    row("the curve", "The number of agent runs alive at each moment; each bar under it is one run, drawn to its start and end."),
    row("fate", "landed and tracked in git · landed, untracked · finished, nothing survives on disk · unknown, never counted as kept · died mid-run · labelled by you · still running"),
    row("re-reads", esc(plain(r.burn.rereads.note))),
    row("kept per dollar", "Cost per run is real. Kept work per dollar is the column that matters: runs whose written files are tracked in git, per dollar at list rates."),
    row("sessions", `Cost is the size of the work at list rates; outcome is measured from disk and git, or labelled by you.${app ? " Click a session for its files, commits, runs and label." : ""}`),
    row("fixes", "Each one is written for this repository. Apply with one confirm; undo restores the file byte for byte."),
    row(o.app ? "the sticker" : "the card", `Aggregates only: never a prompt, a path, a file name, or a line of code.${o.app ? " Share hands the PNG to Instagram or X on a phone; the X button opens a post with the text card, attach the copied sticker." : ""}`),
  ].join("");
  return `<section class="disclosures avoid">
  <div class="fine legend-line">${legend}</div>
  <details><summary>${lab("method")}<span class="sum-title">How this was measured</span></summary>
    <div class="kv notes">${notes}</div>
    <ul>${li(r.method)}</ul>
    <div class="lab">what this report cannot see</div><ul>${li(r.limitations)}</ul>
    <div class="fine mono-sm">fate states: ${r.fate_states.map((f) => esc(FATE_TEXT[f] ?? f.replace(/_/g, " "))).join(" · ")}</div>
    <div class="fine">tools: ${r.tools.map(esc).join(", ")} · versions seen: ${Object.values(r.tool_versions).flat().map(esc).join(", ") || "none"} · schema ${esc(r.schema_version)}</div>
  </details>
</section>`;
}

function sClosing(r: Report, o: RenderOpts): string {
  const left = o.hosted ? "What left the machine: this redacted report and one PNG" : `What left your machine: ${esc(r.left_machine)}`;
  return `<footer class="closing"><span>${left}. Tokens spent making this: ${r.tokens_spent_making_this}.</span><span class="rail-strong">measured by actuals</span></footer>`;
}

// ---------------------------------------------------------------------------
// css
// ---------------------------------------------------------------------------
export const CSS = `
html { background: var(--bg); }
body { margin: 0; background: var(--bg); color: var(--text); font-family: var(--sans); font-size: 14px; line-height: 1.5; -webkit-font-smoothing: antialiased; }
.page { width: min(1200px, 100%); margin: 0 auto; padding: 44px 56px 52px; box-sizing: border-box; display: flex; flex-direction: column; gap: 44px; }
.mono, .fine, .lab, .mark, .num, .th, .fig, .rail, .closing, .legend, .mono-sm, .svg-lab, pre { font-family: var(--mono); }
.lab { font-size: 13px; letter-spacing: 0.12em; text-transform: uppercase; color: var(--muted); }
.fine { font-size: 13px; letter-spacing: 0.02em; color: var(--muted); line-height: 1.55; }
.mark { font-size: 12px; letter-spacing: 0.08em; text-transform: uppercase; color: var(--mark); white-space: nowrap; }
.muted { color: var(--muted); }
.top-block { display: flex; flex-direction: column; gap: 14px; }
.next { margin: 0; font-size: 15px; color: var(--ink); }
details.fold { border-top: 1px solid var(--grid); padding-top: 10px; }
.fold > summary { cursor: pointer; list-style: none; font-family: var(--mono); font-size: 12px; letter-spacing: 0.08em; text-transform: uppercase; color: var(--muted); }
.fold > summary::-webkit-details-marker { display: none; }
.fold > summary::after { content: " +"; }
.fold[open] > summary::after { content: " \u2212"; }
.fold > *:not(summary) { margin-top: 10px; }
.legend-line { display: flex; gap: 18px; flex-wrap: wrap; padding: 0 0 14px; font-size: 12px; }
.legend-line span { white-space: nowrap; }
.kv.notes { grid-template-columns: 130px minmax(0, 1fr); gap: 10px 14px; }
.kv.notes .muted { font-family: var(--sans); font-size: 13px; line-height: 1.55; }
.warn { color: var(--warn) !important; }
.num { font-variant-numeric: tabular-nums; font-size: 12px; color: var(--text); }
.r { text-align: right; }
.mono-sm { font-size: 12px; }
h2 { font-family: var(--sans); font-size: 26px; font-weight: 500; line-height: 1.18; letter-spacing: -0.015em; color: var(--ink); margin: 6px 0 0; text-wrap: pretty; max-width: 62ch; }
.rail { display: flex; justify-content: space-between; align-items: baseline; gap: 24px; flex-wrap: wrap; border-bottom: 1px solid var(--rule); padding-bottom: 14px; font-size: 11px; letter-spacing: 0.06em; color: var(--muted); }
.rail-l, .rail-r { display: flex; gap: 28px; align-items: baseline; flex-wrap: wrap; min-width: 0; }
.rail span { min-width: 0; overflow-wrap: anywhere; }
.wordmark { font-size: 14px; font-weight: 500; letter-spacing: 0.22em; color: var(--ink); }
.rail-strong { color: var(--text); }
.readouts { display: grid; grid-template-columns: 1.7fr 1fr 1fr 1fr 1fr; align-items: start; }
.ro { display: flex; flex-direction: column; gap: 10px; padding: 0 0 6px 28px; border-right: 1px solid var(--rule); }
.ro:last-child { border-right: 0; }
.ro-big { padding-left: 0; padding-right: 28px; }
.fig { font-weight: 300; font-size: 48px; line-height: 1; letter-spacing: -0.04em; color: var(--ink); font-variant-numeric: tabular-nums; }
.fig-xl { font-size: 104px; line-height: 0.95; letter-spacing: -0.05em; }
.fig-md { font-size: 40px; }
.unit { font-size: 0.55em; color: var(--muted); letter-spacing: 0; }
.ro-sub { display: flex; gap: 12px; align-items: baseline; flex-wrap: wrap; }
.block { display: flex; flex-direction: column; gap: 18px; }
.block-head { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 32px; align-items: end; }
.legend { display: flex; gap: 18px; justify-content: flex-end; font-size: 12px; letter-spacing: 0.06em; color: var(--muted); padding-bottom: 6px; flex-wrap: wrap; }
.legend span { display: inline-flex; align-items: center; gap: 6px; }
.sw { width: 10px; height: 7px; display: inline-block; }
.sw.line { width: 14px; height: 2px; background: var(--d1); }
.plot { border-top: 1px solid var(--rule); border-bottom: 1px solid var(--rule); padding: 18px 0 8px; }
.svg-lab { font-family: var(--mono); font-size: 14px; fill: var(--muted); }
.svg-lab.warn { fill: var(--warn); font-size: 14px; }
.svg-lab.mk { fill: var(--mark); }
.tl-wide { display: block; }
.tl-narrow { display: none; }
.svg-lab-n { font-family: var(--mono); font-size: 12px; fill: var(--muted); }
.svg-lab-n.warn { fill: var(--warn); }
.svg-lab-n.mk { fill: var(--mark); }
.peaks { display: flex; flex-direction: column; gap: 8px; margin-top: 8px; max-width: 560px; }
.peak-row { display: grid; grid-template-columns: 56px minmax(0, 1fr) 36px 70px; gap: 12px; align-items: center; }
.peak-bar { height: 6px; background: var(--grid); display: block; } .peak-bar i { display: block; height: 6px; background: var(--d2); }
.two { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 56px; }
.col { display: flex; flex-direction: column; gap: 14px; min-width: 0; }
.segbar { display: flex; height: 14px; gap: 2px; } .segbar i { display: block; height: 14px; }
.kv { display: grid; grid-template-columns: 56px minmax(0, 1fr); gap: 6px 14px; align-items: baseline; }
.kv .num { text-align: right; color: var(--ink); }
.dot { display: inline-block; width: 8px; height: 8px; margin-left: 8px; vertical-align: middle; }
.kv.legend { grid-template-columns: 130px minmax(0, 1fr); }
.table { display: grid; gap: 0 16px; align-items: center; border-top: 1px solid var(--rule); }
.table .th { font-size: 12px; letter-spacing: 0.08em; text-transform: uppercase; color: var(--muted); padding: 10px 0; border-bottom: 1px solid var(--rule); }
.models { grid-template-columns: minmax(0, 1fr) 64px 84px 84px 84px 230px; align-items: baseline; }
.models > div { padding: 10px 0; border-bottom: 1px solid var(--grid); line-height: 1.2; }
.models > .th { padding: 10px 0 8px; line-height: 1.2; }
.models .kbar { vertical-align: baseline; position: relative; top: -1px; }
.kbar { display: inline-block; width: 110px; height: 4px; background: var(--grid); vertical-align: middle; margin-right: 10px; } .kbar i { display: block; height: 4px; background: var(--d1); }
.sessions { display: block; }
.sessions .th-row { display: grid; grid-template-columns: 56px minmax(0, 1fr) 150px 70px 90px 160px 160px; gap: 16px; }
.sessions .th-row .th { border-bottom: 1px solid var(--rule); }
.sessions .tr { display: grid; grid-template-columns: 56px minmax(0, 1fr) 150px 70px 90px 160px 160px; gap: 16px; padding: 12px 0; border-bottom: 1px solid var(--grid); align-items: start; }
/* interactive rows (app/embed only carry data-session): make the click that opens files, commits, runs and the label control visibly discoverable */
.sessions .tr[data-session] { cursor: pointer; margin: 0 -12px; padding-left: 12px; padding-right: 12px; border-radius: 3px; transition: background 0.1s ease; }
.sessions .tr[data-session]:hover { background: var(--panel); }
.sessions .tr[data-session]:hover .title { color: var(--ink); }
.sessions .title { font-size: 15px; color: var(--text); }
.claimed { font-family: var(--mono); font-size: 13px; color: var(--muted); margin-top: 4px; letter-spacing: 0.02em; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.costcell { display: flex; align-items: center; gap: 10px; padding-top: 5px; }
.cbar { flex: 1; height: 4px; background: var(--grid); } .cbar i { display: block; height: 4px; background: var(--d1); }
.costcell .num { width: 56px; text-align: right; }
.outcome { display: flex; flex-direction: column; gap: 3px; }
.outcome .state { font-family: var(--mono); font-size: 11px; letter-spacing: 0.06em; color: var(--text); }
.outcome.warn .state { color: var(--warn); }
.fixes { display: flex; flex-direction: column; }
.fix { display: grid; grid-template-columns: 56px minmax(0, 1fr) 470px; gap: 24px; border-top: 1px solid var(--rule); padding: 22px 0; align-items: start; }
.fix:last-child { border-bottom: 1px solid var(--rule); }
.fix.off { opacity: 0.55; }
.fixno { font-family: var(--mono); font-size: 22px; font-weight: 300; color: var(--mark); line-height: 1; }
.fixbody { display: flex; flex-direction: column; gap: 8px; }
.fixtitle { font-size: 20px; font-weight: 500; letter-spacing: -0.01em; color: var(--ink); }
.fixbody p { margin: 10px 0 0; font-size: 14px; line-height: 1.55; color: var(--muted); text-wrap: pretty; max-width: 60ch; }
pre { margin: 0; font-size: 11px; line-height: 1.7; color: var(--text); background: var(--panel); border: 1px solid var(--rule); padding: 14px 16px; white-space: pre-wrap; overflow-wrap: anywhere; }
.share-wrap { border: 1px solid var(--rule); max-width: 760px; }
ul { margin: 0; padding-left: 18px; color: var(--muted); font-size: 13px; line-height: 1.55; display: flex; flex-direction: column; gap: 6px; }
.insights { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px 40px; padding: 6px 0 2px; }
.insight { display: grid; grid-template-columns: 10px minmax(0, 1fr); gap: 12px; align-items: start; font-size: 13.5px; line-height: 1.5; color: var(--muted); }
.insight i { display: block; width: 6px; height: 6px; margin-top: 7px; background: var(--mark); }
.disclosures { display: flex; flex-direction: column; border-top: 1px solid var(--rule); padding-top: 14px; }
.disclosures details { border-bottom: 1px solid var(--grid); padding: 14px 0; }
.disclosures summary { cursor: pointer; list-style: none; display: flex; gap: 18px; align-items: baseline; }
.disclosures summary::-webkit-details-marker { display: none; }
.disclosures summary::after { content: "+"; margin-left: auto; font-family: var(--mono); color: var(--muted); }
.disclosures details[open] summary::after { content: "−"; }
.sum-title { font-size: 15px; color: var(--text); }
.disclosures ul, .disclosures .kv, .disclosures .lab { margin-top: 12px; max-width: 72ch; }
@media print { .disclosures details, details.fold { display: block; } .disclosures details > *:not(summary), details.fold > *:not(summary) { display: block; } }
.closing { margin-top: auto; display: flex; justify-content: space-between; gap: 24px; flex-wrap: wrap; font-size: 10.5px; letter-spacing: 0.06em; color: var(--muted); border-top: 1px solid var(--rule); padding-top: 16px; }
@media (max-width: 1120px) {
  .readouts { grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); }
  .ro { border-right: 0; padding-left: 0; }
  .ro-big { grid-column: 1 / -1; padding-right: 0; }
}
@media (max-width: 900px) {
  .page { padding: 24px 20px 40px; gap: 32px; }
  .readouts { grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); }
  .ro { border-right: 0; padding-left: 0; min-width: 0; }
  .ro-big { grid-column: 1 / -1; padding-right: 0; }
  .fig-xl { font-size: 72px; }
  .two { grid-template-columns: 1fr; gap: 32px; }
  .block-head { grid-template-columns: 1fr; }
  .legend { justify-content: flex-start; }
  .tl-wide { display: none; }
  .tl-narrow { display: block; overflow-x: auto; -webkit-overflow-scrolling: touch; }
  .sessions .th-row { display: none; }
  .sessions .tr { grid-template-columns: 56px minmax(0, 1fr); }
  .claimed { white-space: normal; }
  .fix { grid-template-columns: 40px minmax(0, 1fr); }
  .fix pre { grid-column: 2; }
  .models { grid-template-columns: minmax(0, 1fr) 50px 70px 70px 70px 140px; }
}
@media (max-width: 600px) {
  .models { grid-template-columns: minmax(0, 1fr) 34px 50px 50px 50px minmax(0, 1fr); gap: 0 6px; font-size: 11px; }
  .kbar { width: 36px; margin-right: 6px; }
  .sessions .th-row { display: none; }
  .sessions .tr > :nth-child(n+3) { grid-column: 2; }
  .claimed { white-space: normal; }
}
/* Print keeps the wide instrument (it scales to the page and never needs a horizontal scroll);
   the narrow SVG's min-width would clip on a page box narrower than it. Same layout prints. */
@media print { .tl-wide { display: block; } .tl-narrow { display: none; } }
`;

/** The two views: the classic report (default) and the live control centre. App page only. */
function sTabs(): string {
  return `<nav class="tabs noprint" aria-label="views">
  <button class="tab" id="tab-report" type="button" aria-selected="true" data-panel="report">Report</button>
  <button class="tab" id="tab-live" type="button" aria-selected="false" data-panel="live">Live</button>
</nav>`;
}

/**
 * The control centre (M7): the session running now, drawn to time and growing as the SSE
 * stream arrives. The strip carries the clock, the cost at list rates, and yesterday's kept
 * line. The plot starts as the static tree (the no-JS and pre-connect floor) and the client
 * redraws it live. The empty state speaks when watch is off or nothing is running.
 */
function sLive(r: Report, app: AppRender | undefined): string {
  const daily = app?.dailyKept ?? null;
  const t = r.burn.tree.timeline;
  const floor = t ? plotBoth(t) : `<p class="fine">No session is drawn yet.</p>`;
  return `<section id="panel-live" class="panel-live noprint" hidden aria-label="the session running now">
  <div class="live-strip">
    <div class="ls-left"><span class="ls-live">live</span><span class="ls-clock" id="ls-clock">not connected</span><span class="fine" id="ls-model"></span></div>
    <div class="ls-right"><span class="ls-cost" id="ls-cost"></span>${daily ? `<span class="ls-daily">${mark("measured")} Yesterday's kept work: ${daily.n} of ${daily.m} still kept</span>` : ""}</div>
  </div>
  <p class="live-empty fine" id="live-empty" hidden></p>
  <div class="live-plot" id="live-tree">${floor}</div>
  <div class="live-cols">
    <ul class="live-runs" id="live-runs" role="listbox" aria-label="agent runs"></ul>
    <div class="live-detail" id="live-detail" aria-live="polite"></div>
  </div>
  <div class="live-hover" id="live-hover" role="status" hidden></div>
</section>`;
}

export function renderHtml(report: Report, opts: RenderOpts): string {
  const r = report;
  usedMarks.clear();
  const repoName = opts.redact ? "redacted" : r.repo_path.split("/").filter(Boolean).at(-1) ?? r.repo_path;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Actuals report: ${esc(repoName)}</title>
<style>
${FONT_FACES}
${TOKENS_CSS}
${CSS}${opts.app || opts.embed ? APP_CSS : ""}
</style>
</head>
<body>
<div class="page">
${sRail(r, opts)}
${opts.app ? sPicker(r, opts.app) : ""}
${opts.app ? sTabs() : ""}
${opts.app ? sLive(r, opts.app) : ""}
${opts.app ? '<div id="panel-report">' : ""}
${sReadouts(r, opts)}
${sInstrument(r, opts)}
${sFateAndRereads(r, opts)}
${sModels(r)}
${sSessions(r, opts)}
${sFixes(r, opts)}
${opts.app ? sSticker(r) : sShare(r)}
${sMethod(r, opts)}
${sClosing(r, opts)}
${opts.app ? "</div>" : ""}
</div>
${opts.app ? `${sDrawerShell()}\n<script>window.__actuals = ${appData(opts.app, r)};${CLIENT_JS}</script>` : opts.embed ? `${sDrawerShell()}\n<script>window.__actualsEmbed = ${embedData(opts.embed)};${EMBED_JS}</script>` : ""}
</body>
</html>
`;
}
