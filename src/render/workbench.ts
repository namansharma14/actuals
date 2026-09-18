/**
 * The Workbench: the report as an app.
 *
 * One template, three modes. The app mode is served by the local server and every control is
 * live; the embed mode inlines each session's view and the fix snippets so a frame needs no
 * server; the static mode carries no script at all and prints the overview. The page is one
 * self-contained file: the fonts are embedded, the styles are inline, nothing is fetched.
 *
 * A full-viewport grid: a 52px top bar over a 312px session list and a fluid main pane, each
 * pane scrolling on its own. The main pane holds three views, one at a time: the overview, one
 * session, and the live one. Sheets slide over it for the fixes and the card.
 *
 * Every number on the page comes from the report unmodified and carries its mark beside it.
 */
import { appData, embedData, xIntentUrl, type AppRender, type EmbedRender } from "./app.js";
import { FONT_FACES } from "./fonts.js";
import { TOKENS_CSS } from "./tokens.js";
import { renderStickerSvg } from "./sticker.js";
import { concurrencyCurve, laneRuns, timeScale } from "./tree-geometry.js";
import { dateOnly, dayLabel, esc, hm, int, mark, money, pct, plain } from "./text.js";
import { WB_APP_JS, WB_CORE_JS, WB_EMBED_JS } from "./workbench-client.js";
import type { Report } from "../schema/socket.js";

export interface RenderOpts {
  redact: boolean;
  app?: AppRender;
  embed?: EmbedRender;
  /** a hosted copy: the page exists because this redacted report was uploaded, and the badge says so */
  hosted?: boolean;
  /** numbers sharing is on and this run sent some: the badge says how many, the popover says when */
  numbersShared?: { count: number; at: string };
}

type Timeline = NonNullable<Report["burn"]["tree"]["timeline"]>;

// ---------------------------------------------------------------------------
// vocabulary
// ---------------------------------------------------------------------------
/** What a run's fate is called on the page. The schema keeps the snake_case values. */
export const RUN_FATE: Record<string, string> = {
  landed_tracked: "in git",
  landed_untracked: "on disk",
  finished_unlanded: "nothing left",
  unknown: "unknown",
  died: "died",
  founder_labelled: "your label",
  still_running: "still running",
};

/** The colour each fate word takes in the runs table. Never the retired 2.6:1 grey. */
export const RUN_FATE_INK: Record<string, string> = {
  landed_tracked: "var(--ink)",
  landed_untracked: "var(--muted)",
  finished_unlanded: "var(--d3)",
  unknown: "var(--faint)",
  died: "var(--warn)",
  founder_labelled: "var(--mark)",
  still_running: "var(--muted)",
};

/** The stacked bar's colours, in the order the bar stacks them. */
const FATE_ORDER: Array<[string, string]> = [
  ["landed_tracked", "var(--d1)"],
  ["landed_untracked", "var(--d2)"],
  ["finished_unlanded", "var(--dim)"],
  ["unknown", "var(--dimmer)"],
  ["died", "var(--warn)"],
  ["founder_labelled", "var(--mark)"],
  ["still_running", "var(--grid)"],
];

/** A session's outcome word, coloured by what it says. */
function outcomeInk(state: string, labelled: boolean): string {
  if (labelled) return "var(--mark)";
  if (state === "kept") return "var(--ink)";
  if (state === "on disk") return "var(--muted)";
  if (state === "died") return "var(--warn)";
  return "var(--faint)";
}

// ---------------------------------------------------------------------------
// derived from the report
// ---------------------------------------------------------------------------
/** The real window, as a reader names it: "13 Aug to 15 Sep". */
export function windowLabel(r: Report): string {
  const dates = r.sessions.map((s) => s.date).filter(Boolean).sort();
  const since = r.window.since ?? dates[0] ?? r.generated_at;
  const until = r.window.until ?? dates.at(-1) ?? r.generated_at;
  const a = dayLabel(since), b = dayLabel(until);
  return a === b ? a : `${a} to ${b}`;
}

/** The spend of every day in the window, days with no session filled with zero. */
export function spendByDay(r: Report): Array<{ key: string; v: number }> {
  const dates = r.sessions.map((s) => s.date).filter(Boolean).sort();
  const since = dateOnly(r.window.since ?? dates[0] ?? r.generated_at);
  const until = dateOnly(r.window.until ?? dates.at(-1) ?? r.generated_at);
  const byDay = new Map<string, number>();
  for (const s of r.sessions) if (s.date) byDay.set(s.date, (byDay.get(s.date) ?? 0) + s.cost_usd);
  const out: Array<{ key: string; v: number }> = [];
  const start = new Date(since + "T00:00:00Z").getTime(), end = new Date(until + "T00:00:00Z").getTime();
  if (Number.isNaN(start) || Number.isNaN(end) || end < start) {
    for (const [key, v] of [...byDay.entries()].sort()) out.push({ key, v });
    return out;
  }
  // a window longer than a year is drawn from the days that carry spend, not 400 empty columns
  const span = Math.round((end - start) / 86_400_000);
  if (span > 370) { for (const [key, v] of [...byDay.entries()].sort()) out.push({ key, v }); return out; }
  for (let t = start; t <= end; t += 86_400_000) {
    const key = new Date(t).toISOString().slice(0, 10);
    out.push({ key, v: Math.round((byDay.get(key) ?? 0) * 100) / 100 });
  }
  return out;
}

/** The title a render is allowed to print. */
const titleOf = (s: Report["sessions"][number], redact: boolean): string => (redact ? `session ${s.id.slice(0, 8)}` : s.title);

const hoursText = (h: number | null): string => (h === null ? "no clock" : `${h}h`);

const agentsText = (n: number): string => (n === 0 ? "no agents" : n === 1 ? "1 agent" : `${int(n)} agents`);

// ---------------------------------------------------------------------------
// the agent tree, drawn to time (the design's geometry)
// ---------------------------------------------------------------------------
const TREE_W = 640, TREE_TOP = 8, TREE_BASE = 110, TREE_BARS = 128, TREE_LANE = 9;

/**
 * The session's agents drawn to time: a concurrency step curve filled at 6%, the peak dot with
 * its label, one 6px bar per run packed into lanes, and time ticks. Drawn to a 640 unit
 * viewBox at 1:1, so the 11 unit labels are 11px on screen whatever the column is doing.
 */
export function treeSvg(t: Timeline): string {
  const t0 = new Date(t.start).getTime(), t1 = new Date(t.end).getTime();
  const span = Math.max(1, t1 - t0);
  const X = timeScale(t0, t1, TREE_W, 0);
  const pts = concurrencyCurve(t.runs, t0, t1);
  const ymax = Math.max(1, t.peak, ...pts.map((p) => p[1]));
  const Y = (v: number): number => TREE_BASE - (TREE_BASE - TREE_TOP) * (v / ymax);
  const path = "M" + pts.map(([at, v]) => `${X(at).toFixed(1)} ${Y(v).toFixed(1)}`).join(" L");
  const fill = `${path} L${X(t1).toFixed(1)} ${TREE_BASE} L${X(t0).toFixed(1)} ${TREE_BASE} Z`;
  const { placed, lanes } = laneRuns(t.runs);
  const bars = placed.map(({ run, lane }) => {
    const x = X(new Date(run.start).getTime());
    const w = Math.max(3, X(new Date(run.end).getTime()) - x);
    const col = run.fate === "died" ? "var(--warn)" : run.depth <= 1 ? "var(--d1)" : run.depth === 2 ? "var(--d2)" : "var(--d3)";
    return `<rect x="${x.toFixed(1)}" y="${TREE_BARS + lane * TREE_LANE}" width="${w.toFixed(1)}" height="6" fill="${col}"></rect>`;
  }).join("");
  const axisY = TREE_BARS + Math.max(1, lanes) * TREE_LANE + 4;
  const tickY = axisY + 13;
  const stepMin = span <= 3 * 3600e3 ? 15 : span <= 8 * 3600e3 ? 30 : 60;
  let ticks = "";
  for (let m = 0; m * 60e3 <= span + 1; m += stepMin) {
    const x = X(t0 + m * 60e3);
    const anchor = x > TREE_W - 24 ? "end" : x < 24 ? "start" : "middle";
    ticks += `<line x1="${x.toFixed(1)}" y1="4" x2="${x.toFixed(1)}" y2="${axisY}" stroke="var(--grid)"></line>`
      + `<text x="${x.toFixed(1)}" y="${tickY}" text-anchor="${anchor}" class="wb-svg-lab">${esc(hm(new Date(t0 + m * 60e3).toISOString()))}</text>`;
  }
  const px = X(new Date(t.peak_at).getTime()), py = Y(t.peak);
  const right = px > 400;
  const labelY = py < 16 ? py + 14 : py - 6;
  const peak = `<circle cx="${px.toFixed(1)}" cy="${py.toFixed(1)}" r="3.5" fill="var(--mark)"></circle>`
    + `<text x="${(right ? px - 8 : px + 8).toFixed(1)}" y="${labelY.toFixed(1)}" text-anchor="${right ? "end" : "start"}" class="wb-svg-lab wb-svg-mark">${int(t.peak)} at once</text>`;
  return `<svg viewBox="0 0 ${TREE_W} ${axisY + 18}" width="${TREE_W}" height="${axisY + 18}" font-size="11" class="wb-tree-svg" role="img" aria-label="${int(t.runs.length)} agent runs drawn to time, ${int(t.peak)} at once at the peak">`
    + `<title>${esc(dayLabel(t.date))}: the agent runs alive at each moment, then one bar per run</title>`
    + ticks
    + `<path d="${fill}" fill="var(--d1)" fill-opacity="0.06"></path>`
    + `<path d="${path}" fill="none" stroke="var(--d1)" stroke-width="1.5"></path>`
    + peak + bars + `</svg>`;
}

const TREE_LEGEND = `<div class="wb-legend">`
  + `<span><i style="background: var(--d1)"></i>depth 1</span>`
  + `<span><i style="background: var(--d2)"></i>2</span>`
  + `<span><i style="background: var(--d3)"></i>3</span>`
  + `<span><i style="background: var(--warn)"></i>died</span>`
  + `</div>`;

/**
 * The tree block for one session: the sentence, the depth legend and the drawing. Exported
 * through the page entry because the app asks the server to redraw it for any session.
 */
export function treeBlock(t: Timeline, treeMark: string): string {
  const minutes = Math.max(1, Math.round((new Date(t.end).getTime() - new Date(t.start).getTime()) / 60e3));
  const sentence = `${int(t.runs.length)} agent run${t.runs.length === 1 ? "" : "s"} over ${int(minutes)} minute${minutes === 1 ? "" : "s"}, ${int(t.peak)} at once${t.died > 0 ? `, ${int(t.died)} died` : ""}.`;
  return `<div class="wb-tree">
    <div class="wb-tree-head"><div class="wb-tree-line">${esc(sentence)} ${mark(treeMark)}</div>${TREE_LEGEND}</div>
    <div class="wb-tree-wrap">${treeSvg(t)}</div>
  </div>`;
}

// ---------------------------------------------------------------------------
// the top bar
// ---------------------------------------------------------------------------
/** What the badge says about what left this machine. */
function badgeText(o: RenderOpts): string {
  if (o.hosted) return "hosted copy · read locally";
  if (o.numbersShared) return `local · shared ${int(o.numbersShared.count)} numbers`;
  return "local · 0 bytes uploaded";
}

/** The fifth row of the popover: the only row whose answer can change. */
function leftMachine(o: RenderOpts): string {
  if (o.hosted) return "This redacted report and one card, uploaded on one confirm. No model call.";
  if (o.numbersShared) return `${int(o.numbersShared.count)} numbers at ${o.numbersShared.at.slice(11, 16)}, shown before they went; nothing else.`;
  return "Nothing. No account, no upload, no model call.";
}

const POPOVER_ROWS: Array<[string, string]> = [
  ["Measured", "Read from the transcripts on this machine and this repository's git history."],
  ["Estimated", "Token counts priced at list rates. Plan users pay a flat fee; dollars show the size of the work, not the bill."],
  ["Alive", "A file the agent wrote still exists. Kept means git tracks it. Unknown is never counted as kept."],
  ["Commit", "Counted only when made inside a session, in this repository, within five minutes of the session issuing git commit."],
];

function sTrust(r: Report, o: RenderOpts): string {
  const live = r.live
    ? [["Live", `Watch ${r.live.watching ? "on" : "off"}: ${int(r.live.events)} live events${r.live.first_event ? ` since ${dateOnly(r.live.first_event)}` : ""}, ${int(r.live.compactions)} compaction${r.live.compactions === 1 ? "" : "s"} recorded live, ${int(r.live.sessions_live_only)} session${r.live.sessions_live_only === 1 ? "" : "s"} seen only live. Measured.`] as [string, string]]
    : [];
  const rows = [...POPOVER_ROWS, ...live, ["Left your machine", leftMachine(o)] as [string, string]]
    .map(([k, v]) => `<div class="wb-pop-row"><span class="wb-pop-k">${esc(k)}</span><span class="wb-pop-v">${esc(v)}</span></div>`)
    .join("");
  const limits = r.limitations.map((l) => `<li>${esc(plain(l))}</li>`).join("");
  return `<details class="wb-trust" id="wb-trust">
    <summary class="wb-badge"><i class="wb-badge-dot"></i><span class="wb-badge-full">${esc(badgeText(o))}</span><span class="wb-badge-short">${esc(badgeText(o).split(" · ")[0] ?? "local")}</span></summary>
    <div class="wb-pop">
      <div class="wb-pop-head"><span>How this counts</span><span>rates ${esc(r.rates_version)} · 0 tokens spent</span></div>
      ${rows}
      <details class="wb-lim"><summary>what this report cannot see</summary><ul>${limits}</ul></details>
    </div>
  </details>`;
}

function sBar(r: Report, o: RenderOpts): string {
  const repo = o.redact ? "redacted" : (r.repo_path.split("/").filter(Boolean).at(-1) ?? r.repo_path);
  const app = o.app;
  const total = app ? app.projects.reduce((a, p) => a + p.sessions, 0) : 0;
  const everywhere = app?.project === "*";
  const scope = app
    ? `<div class="wb-scope" role="group" aria-label="which sessions to report on">
        <button type="button" class="wb-seg" data-project="${esc(app.repoTab.slug)}" aria-pressed="${everywhere ? "false" : "true"}" title="${int(app.repoTab.sessions)} sessions here">this repo</button>
        <button type="button" class="wb-seg" data-project="*" aria-pressed="${everywhere ? "true" : "false"}" title="${int(total)} sessions on this machine">everywhere</button>
      </div>`
    : "";
  const acts = o.app || o.embed
    ? `<div class="wb-acts">
        <button type="button" class="wb-btn" data-sheet="fixes"><span class="wb-pill">${int(r.fixes.length)}</span>fixes<span class="wb-key">F</span></button>
        <button type="button" class="wb-btn" data-sheet="share">share<span class="wb-key">S</span></button>
      </div>`
    : "";
  const nav = o.app || o.embed ? `<button type="button" class="wb-nav" id="wb-nav">sessions</button>` : "";
  return `<header class="wb-bar">
    <div class="wb-word">ACTUALS</div>
    ${nav}
    <div class="wb-ctx">
      <span class="wb-repo">${esc(repo)}</span>
      ${scope}
      <span class="wb-period">${esc(windowLabel(r))}</span>
    </div>
    <div class="wb-sp"></div>
    ${acts}
    ${sTrust(r, o)}
  </header>`;
}

// ---------------------------------------------------------------------------
// the session list
// ---------------------------------------------------------------------------
function listRow(s: Report["sessions"][number], o: RenderOpts, tag: "button" | "div"): string {
  const labelled = s.outcome.mark === "founder-labelled";
  const word = labelled ? `${s.outcome.state} · your label` : s.outcome.state;
  const ink = outcomeInk(s.outcome.state, labelled);
  const title = titleOf(s, o.redact);
  const attrs = tag === "button"
    ? ` type="button" class="wb-row" data-session="${esc(s.id)}" data-title="${esc(title.toLowerCase())}"`
    : ` class="wb-row" data-title="${esc(title.toLowerCase())}"`;
  return `<${tag}${attrs}>
    <span class="wb-r1"><span class="wb-rtitle">${esc(title)}</span><span class="wb-rcost">${esc(money(s.cost_usd))}</span></span>
    <span class="wb-r2"><span class="wb-rmeta">${esc(dayLabel(s.date))} · ${esc(hoursText(s.hours))} · ${esc(agentsText(s.agents))}</span><span class="wb-rout" style="color: ${ink}"><i style="background: ${ink}"></i>${esc(word)}</span></span>
  </${tag}>`;
}

function sList(r: Report, o: RenderOpts): string {
  const rows = [...r.sessions].sort((a, b) => b.date.localeCompare(a.date) || b.cost_usd - a.cost_usd);
  const spend = `${esc(money(r.headline.cost_usd.value))} ${mark(r.headline.cost_usd.mark)}`;
  const live = o.app
    ? `<button type="button" class="wb-liveline" id="tab-live" data-panel="live"><i class="wb-dot"></i>live · watching for a session<span class="wb-key">v</span></button>`
    : "";
  const hints = o.app || o.embed
    ? `<div class="wb-hints"><span><b>j k</b> move</span><span><b>l</b> label</span><span><b>f</b> fix</span><span><b>s</b> share</span>${o.app ? "<span><b>v</b> live</span>" : ""}<span><b>esc</b> back</span></div>`
    : "";
  const filter = o.app || o.embed
    ? `<div class="wb-filter"><input type="search" id="wb-q" placeholder="Filter sessions" aria-label="filter sessions by title" autocomplete="off"></div>`
    : "";
  const top = o.app || o.embed
    ? `<button type="button" class="wb-row wb-top" data-top aria-current="true"><span class="wb-r1"><span class="wb-rtitle">${esc(windowLabel(r))}</span><span class="wb-rcost">${spend}</span></span></button>`
    : `<div class="wb-row wb-top"><span class="wb-r1"><span class="wb-rtitle">${esc(windowLabel(r))}</span><span class="wb-rcost">${spend}</span></span></div>`;
  const tag = o.app || o.embed ? "button" : "div";
  return `<aside class="wb-list" id="wb-list" aria-label="sessions">
    ${filter}
    <div class="wb-lhead"><span id="wb-count">${int(r.sessions.length)} ${r.sessions.length === 1 ? "session" : "sessions"}</span><span>newest first</span></div>
    <div class="wb-rows" id="wb-rows">${top}${rows.map((s) => listRow(s, o, tag)).join("")}</div>
    ${live || hints ? `<div class="wb-lfoot">${live}${hints}</div>` : ""}
  </aside>`;
}

// ---------------------------------------------------------------------------
// the overview
// ---------------------------------------------------------------------------
function sReceipt(r: Report): string {
  const h = r.headline;
  const items: Array<{ v: string; k: string; m: string; warn?: boolean }> = [
    { v: money(h.cost_usd.value), k: "spent at list rates", m: h.cost_usd.mark },
    { v: int(h.commits.value), k: "commits", m: h.commits.mark },
    { v: money(h.cost_per_commit.value), k: "per commit", m: h.cost_per_commit.mark },
    { v: int(h.runs_no_fate.count), k: `runs that left nothing · ${money(h.runs_no_fate.cost_usd)}`, m: h.runs_no_fate.mark, warn: true },
  ];
  return `<div class="wb-receipt">${items.map((x) => `<div class="wb-rec"><div class="wb-recv${x.warn ? " warn" : ""}">${esc(x.v)}</div><div class="wb-reck">${esc(x.k)} ${mark(x.m)}</div></div>`).join("")}</div>`;
}

function sSpend(r: Report): string {
  const days = spendByDay(r);
  if (!days.length) return "";
  const max = Math.max(0, ...days.map((d) => d.v));
  const peak = days.reduce((a, b) => (b.v > a.v ? b : a), days[0]!);
  const tight = days.length > 60;
  const bars = days.map((d) => {
    const h = max > 0 ? Math.max(2, Math.round((d.v / max) * 96)) : 2;
    const on = max > 0 && d === peak;
    return `<span class="wb-day" style="height: ${h}px; background: ${on ? "var(--ink)" : "var(--track)"}" title="${esc(d.key)} · ${esc(money(d.v))}"></span>`;
  }).join("");
  const peakText = max > 0 ? `peak ${money(peak.v)} on ${dayLabel(peak.key)}` : "no spend in this window";
  return `<section class="wb-block">
    <div class="wb-bhead"><span>spend by day</span><span class="wb-bhead-r">${esc(peakText)}</span></div>
    <div class="wb-bars${tight ? " tight" : ""}">${bars}</div>
    <div class="wb-bax"><span>${esc(dayLabel(days[0]!.key))}</span><span>${esc(dayLabel(days.at(-1)!.key))}</span></div>
  </section>`;
}

function sModels(r: Report): string {
  const kept = (m: Report["models"][number]): number | null => m.kept_per_usd ?? (m.cost_usd > 0 ? 0 : null);
  const maxK = Math.max(0, ...r.models.map((m) => kept(m) ?? 0));
  const rateMark = r.models.some((m) => m.rate_mark === "assumed") ? "assumed" : "estimated";
  const rows = r.models.map((m) => {
    const k = kept(m);
    const w = k !== null && maxK > 0 ? Math.round((k / maxK) * 100) : 0;
    return `<div class="wb-mrow"><span class="wb-mname">${esc(m.model)}</span><span class="wb-mruns">${int(m.runs)}</span>`
      + `<span class="wb-mbar"><span class="wb-mtrack"><i style="width: ${w}%"></i></span><span class="wb-mval">${k === null ? "n/a" : k.toFixed(3)}</span></span></div>`;
  }).join("");
  return `<div class="wb-col">
    <div class="wb-bhead wb-bhead-1"><span>kept work per dollar ${mark(rateMark)}</span></div>
    ${rows || '<div class="wb-note">no model ran in this window</div>'}
  </div>`;
}

function sFate(r: Report): string {
  const by = r.burn.fate.by_state;
  const total = Object.values(by).reduce((a, b) => a + b, 0) || 1;
  const live = FATE_ORDER.filter(([k]) => (by[k] ?? 0) > 0);
  const segs = live.map(([k, c]) => `<i style="width: ${((by[k] ?? 0) / total) * 100}%; background: ${c}"></i>`).join("");
  const legend = live.map(([k, c]) => `<div class="wb-fl"><i style="background: ${c}"></i><span class="wb-fn">${int(by[k] ?? 0)}</span><span class="wb-fw">${esc(RUN_FATE[k] ?? k)}</span></div>`).join("");
  const runs = Object.values(by).reduce((a, b) => a + b, 0);
  return `<div class="wb-col">
    <div class="wb-bhead wb-bhead-1"><span>what ${int(runs)} agent runs left behind ${mark(r.burn.fate.mark)}</span></div>
    <div class="wb-segbar">${segs}</div>
    <div class="wb-flegend">${legend}</div>
  </div>`;
}

/** The card, drawn once and shown small: the same SVG `actuals share` writes. */
function stickerInline(r: Report, cls: string): string {
  return renderStickerSvg(r).replace(/ xmlns="[^"]*"/, "").replace(/ width="1080" height="1080"/, ` class="${cls}"`);
}

function sStickerCard(r: Report, o: RenderOpts): string {
  const clickable = Boolean(o.app || o.embed);
  const tag = clickable ? "button" : "div";
  const attrs = clickable ? ` type="button" data-sheet="share"` : "";
  return `<${tag} class="wb-card"${attrs}>
    <span class="wb-card-thumb">${stickerInline(r, "wb-thumb-svg")}</span>
    <span class="wb-card-body">
      <span class="wb-card-t">Your sticker</span>
      <span class="wb-card-p">Three numbers and the curve of your tallest tree, as a 1080 by 1080 PNG. Aggregates only: no file names, prompts or code.</span>
    </span>
    ${clickable ? `<span class="wb-card-go">share <span class="wb-key">S</span></span>` : ""}
  </${tag}>`;
}

function sOverview(r: Report, o: RenderOpts): string {
  const h = r.headline;
  const hero = pct(h.files_alive.alive, h.files_alive.written);
  const hint = o.app || o.embed
    ? `<div class="wb-hint">Pick a session on the left, or press <b>j</b>.</div>`
    : `<div class="wb-hint">Run actuals app to click into any session.</div>`;
  return `<section class="wb-pane wb-overview wb-rise" id="panel-report">
    <div class="wb-eyebrow">${esc(windowLabel(r))} · ${int(r.sessions.length)} ${r.sessions.length === 1 ? "session" : "sessions"} · ${int(r.share.agent_runs)} agent runs</div>
    <h1 class="wb-sentence">Your agents wrote ${int(h.files_alive.written)} files in this window. ${int(h.files_alive.alive)} are still on disk.</h1>
    <div class="wb-hero">
      <div class="wb-herofig" id="wb-hero" data-to="${esc(hero)}">${esc(hero)}</div>
      <div class="wb-heroside"><div class="wb-herolab">of agent work still alive</div><div class="mark">measured from disk and git</div></div>
    </div>
    ${sReceipt(r)}
    ${sSpend(r)}
    <section class="wb-two">${sModels(r)}${sFate(r)}</section>
    ${sStickerCard(r, o)}
    ${hint}
  </section>`;
}

// ---------------------------------------------------------------------------
// the session view and the live view
// ---------------------------------------------------------------------------
function sSessionPane(o: RenderOpts): string {
  if (!(o.app || o.embed)) return "";
  return `<section class="wb-pane wb-session wb-rise" id="instrument" hidden aria-label="one session">
    <div id="wb-session-body"></div>
  </section>`;
}

/**
 * The live view (the control centre) in the design's frame: the watching line, what happens
 * when a session starts, the empty band, the status line chip and yesterday's kept work. The
 * ids are the ones the live client already drives; the tree draws into the band in place.
 */
function sLive(r: Report, o: RenderOpts): string {
  if (!o.app) return "";
  const repo = o.redact ? "this repository" : (r.repo_path.split("/").filter(Boolean).at(-1) ?? "this repository");
  const daily = o.app.dailyKept ?? null;
  return `<section class="wb-pane wb-live wb-rise noprint" id="panel-live" hidden aria-label="the session running now">
    <div class="wb-live-l">
      <div class="wb-eyebrow wb-watch"><i class="wb-dot"></i>watching ${esc(repo)}</div>
      <h1 class="wb-sentence" id="ls-clock-title">Waiting for a session.</h1>
      <p class="wb-live-p" id="live-empty">Start Claude Code in this repository. Agents draw here as they start, go warm when one dies, and the cost ticks as tokens are spent.</p>
      <div class="wb-band" id="live-tree" data-empty="no agents alive"></div>
      <div class="wb-live-cols">
        <ul class="wb-live-runs" id="live-runs" role="listbox" aria-label="agent runs"></ul>
        <div class="wb-live-detail" id="live-detail" aria-live="polite"></div>
      </div>
    </div>
    <div class="wb-live-r">
      <div class="wb-block">
        <div class="wb-bhead"><span>in your status bar</span></div>
        <div class="live-strip"><span class="wb-chip-a">actuals</span><span id="ls-cost">$0.00</span><span id="ls-clock">not connected</span><span id="ls-model">0 agents</span><span class="wb-chip-d">0 died</span></div>
      </div>
      <div class="wb-block">
        <div class="wb-bhead"><span>yesterday</span></div>
        <p class="wb-live-y">${daily ? `${mark("measured")} Kept work is still kept: ${int(daily.n)} of ${int(daily.m)} files from yesterday are in git today.` : "Nothing was written yesterday, so there is nothing to re-test today."}</p>
      </div>
    </div>
    <div class="wb-hover" id="live-hover" role="status" hidden></div>
  </section>`;
}

// ---------------------------------------------------------------------------
// the sheets
// ---------------------------------------------------------------------------
/** A fix's snippet is what the fix would add, so every line of it reads as an addition. */
function snippetLines(text: string): string {
  return text.split("\n").map((line) => `<div class="wb-dl add"><span class="wb-ds">+</span><span class="wb-dt">${esc(line)}</span></div>`).join("");
}

function sFixes(r: Report, o: RenderOpts): string {
  const applied = new Set(o.app?.applied ?? []);
  const cards = r.fixes.map((f) => {
    const on = applied.has(f.id);
    const tag = !f.available ? "not ready" : on ? "applied" : f.opt_in ? "opt in" : "ready";
    const tagCls = !f.available ? " wait" : on ? "" : f.opt_in ? " soft" : "";
    const effect = f.would_have_blocked ?? (f.opt_in ? "Opt in. Nothing changes until you apply it." : "");
    const file = o.redact ? "[redacted]" : f.target_file;
    const body = o.redact ? '<div class="wb-dl"><span class="wb-ds"></span><span class="wb-dt">[redacted]</span></div>' : snippetLines(f.snippet);
    const act = o.app && f.available
      ? `<div class="wb-fixact" data-fix="${esc(f.id)}" data-applied="${on ? "1" : "0"}">
          <button type="button" class="wb-fbtn${on ? " ghost" : ""}" data-act="${on ? "undo" : "plan"}">${on ? "undo" : "apply to this repo"}</button>
          <span class="wb-fnote">${on ? "applied · undo restores byte for byte" : ""}</span>
        </div>`
      : o.embed
        ? `<div class="wb-fnote">run actuals fix to apply this on your machine</div>`
        : "";
    return `<article class="wb-fix" id="fix-${esc(f.id)}">
      <div class="wb-fix-head"><h3>${esc(plain(f.title))}</h3><span class="wb-tag${tagCls}">${esc(tag)}</span></div>
      <p class="wb-fix-why">${esc(plain(f.why))}</p>
      ${effect ? `<div class="wb-fix-eff">${esc(plain(effect))}</div>` : ""}
      <div class="wb-diff"><div class="wb-diff-f">${esc(file)}</div><div class="wb-diff-b">${body}</div></div>
      ${act}
    </article>`;
  }).join("");
  return `<div class="wb-sheet-body" id="wb-fixes" hidden>
    <p class="wb-sheet-p">Written from your numbers. Nothing is changed until you apply; undo restores every byte.</p>
    ${cards || '<p class="wb-sheet-p">No fix is derived from these numbers yet.</p>'}
    <div class="wb-sheet-cmd">or: actuals fix · actuals undo &lt;fix-id&gt;</div>
  </div>`;
}

function sShare(r: Report, o: RenderOpts): string {
  const preview = o.app
    ? `<div class="wb-stk"><canvas id="sticker" width="1080" height="1080" aria-label="the card"></canvas></div>`
    : `<div class="wb-stk">${stickerInline(r, "wb-stk-svg")}</div>`;
  const acts = o.app
    ? `<div class="wb-share-acts">
        <button type="button" class="wb-fbtn" data-stk="copy">copy sticker</button>
        <button type="button" class="wb-fbtn ghost" data-stk="download">save</button>
        <a class="wb-fbtn ghost" id="stk-x" href="${esc(xIntentUrl(r))}" target="_blank" rel="noopener noreferrer">post on X</a>
      </div>
      <div class="wb-fnote" id="stk-msg">1080 by 1080 PNG · aggregates only</div>`
    : `<div class="wb-fnote">actuals share writes this card beside your report, as share.svg and share.txt.</div>`;
  return `<div class="wb-sheet-body" id="wb-share" hidden>
    <p class="wb-sheet-p">1080 by 1080 PNG. Three numbers and the curve. No file names, prompts or code.</p>
    ${preview}
    ${acts}
  </div>`;
}

function sSheet(r: Report, o: RenderOpts): string {
  if (!(o.app || o.embed)) return "";
  return `<div class="wb-scrim noprint" id="wb-scrim" hidden></div>
<aside class="wb-sheet noprint" id="wb-sheet" hidden aria-label="sheet">
  <div class="wb-sheet-head"><h2 id="wb-sheet-title">Fixes for this repo</h2><button type="button" class="wb-esc" id="wb-sheet-close">esc</button></div>
  ${sFixes(r, o)}
  ${sShare(r, o)}
</aside>`;
}

// ---------------------------------------------------------------------------
// the static page: the overview, then every session as a plain row
// ---------------------------------------------------------------------------
function sStaticList(r: Report, o: RenderOpts): string {
  const rows = [...r.sessions].sort((a, b) => b.date.localeCompare(a.date) || b.cost_usd - a.cost_usd);
  return `<section class="wb-pane wb-staticlist noprint" aria-label="sessions">
    <div class="wb-bhead"><span>${int(r.sessions.length)} ${r.sessions.length === 1 ? "session" : "sessions"}</span><span class="wb-bhead-r">newest first</span></div>
    <div class="wb-rows">${rows.map((s) => listRow(s, o, "div")).join("")}</div>
  </section>`;
}

// ---------------------------------------------------------------------------
// the page
// ---------------------------------------------------------------------------
export function renderWorkbench(report: Report, opts: RenderOpts): string {
  const r = report;
  const o = opts;
  const mode = o.app ? "app" : o.embed ? "embed" : "static";
  const repoName = o.redact ? "redacted" : (r.repo_path.split("/").filter(Boolean).at(-1) ?? r.repo_path);
  const script = o.app
    ? `<script>window.__actuals = ${appData(o.app, r)};${WB_CORE_JS}${WB_APP_JS}</script>`
    : o.embed
      ? `<script>window.__actualsEmbed = ${embedData(o.embed)};${WB_CORE_JS}${WB_EMBED_JS}</script>`
      : "";
  const main = mode === "static"
    ? `<main class="wb-main">${sOverview(r, o)}${sStaticList(r, o)}</main>`
    : `<main class="wb-main" id="wb-main">${sOverview(r, o)}${sSessionPane(o)}${sLive(r, o)}</main>`;
  const closing = mode === "static"
    ? `<footer class="wb-closing">What left your machine: ${esc(r.left_machine)}. Tokens spent making this: ${r.tokens_spent_making_this}.</footer>`
    : "";
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Actuals report: ${esc(repoName)}</title>
<style>
${FONT_FACES}
${TOKENS_CSS}
${WB_CSS}
</style>
</head>
<body>
<div class="wb wb-${mode}" data-mode="${mode}">
${sBar(r, o)}
${mode === "static" ? "" : sList(r, o)}
${main}
${sSheet(r, o)}
${closing}
</div>
${script}
</body>
</html>
`;
}

// ---------------------------------------------------------------------------
// css
// ---------------------------------------------------------------------------
export const WB_CSS: string = `
*, *::before, *::after { box-sizing: border-box; }
html { background: var(--bg); }
body { margin: 0; background: var(--bg); color: var(--text); font-family: var(--sans); font-size: 14px; line-height: 1.5; -webkit-font-smoothing: antialiased; }
[hidden] { display: none !important; }
input, textarea, button { font: inherit; color: inherit; }
a { color: var(--mark); text-decoration: none; }
a:hover { color: var(--ink); }
.mark { font-family: var(--mono); font-size: 11px; letter-spacing: 0.1em; text-transform: uppercase; color: var(--mark); white-space: nowrap; }
.lab { font-family: var(--mono); font-size: 11px; letter-spacing: 0.1em; text-transform: uppercase; color: var(--faint); }
.warn { color: var(--warn); }
@keyframes wb-rise { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: none; } }
@keyframes wb-slide { from { opacity: 0; transform: translateX(24px); } to { opacity: 1; transform: none; } }
@keyframes wb-pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.35; } }
.wb { min-height: 100vh; background: var(--bg); color: var(--text); }
.wb-app, .wb-embed { height: 100vh; display: grid; grid-template-rows: 52px minmax(0, 1fr); grid-template-columns: 312px minmax(0, 1fr); overflow: hidden; position: relative; }

/* the top bar */
.wb-bar { grid-column: 1 / -1; display: flex; align-items: center; gap: 16px; padding: 0 20px; height: 52px; border-bottom: 1px solid var(--grid); background: var(--bg); position: relative; z-index: 6; white-space: nowrap; }
.wb-word { font-family: var(--mono); font-size: 13px; font-weight: 500; letter-spacing: 0.22em; color: var(--ink); flex: 0 1 272px; min-width: max-content; }
.wb-ctx { display: flex; align-items: center; gap: 14px; font-family: var(--mono); font-size: 12px; color: var(--muted); min-width: 0; }
.wb-repo { color: var(--text); overflow: hidden; text-overflow: ellipsis; }
.wb-scope { display: flex; background: var(--panel); border: 1px solid var(--rule); border-radius: 5px; padding: 2px; }
.wb-seg { border: 0; border-radius: 3px; padding: 3px 10px; cursor: pointer; font-family: var(--mono); font-size: 11px; letter-spacing: 0.04em; background: transparent; color: var(--faint); }
.wb-seg[aria-pressed="true"] { background: var(--rule); color: var(--ink); }
.wb-seg:hover { color: var(--text); }
.wb-sp { flex: 1; }
.wb-acts { display: flex; gap: 4px; font-family: var(--mono); font-size: 11px; letter-spacing: 0.06em; }
.wb-btn { display: flex; align-items: center; gap: 8px; background: none; border: 1px solid var(--rule); border-radius: 4px; padding: 5px 10px; cursor: pointer; color: var(--text); }
.wb-btn:hover { border-color: var(--faint); }
.wb-btn:focus-visible, .wb-row:focus-visible, .wb-seg:focus-visible, .wb-fbtn:focus-visible, .wb-esc:focus-visible, .wb-nav:focus-visible, summary:focus-visible { outline: 2px solid var(--mark); outline-offset: 2px; }
.wb-pill { min-width: 16px; height: 16px; border-radius: 8px; background: var(--mark); color: var(--bg); font-size: 11px; display: inline-flex; align-items: center; justify-content: center; padding: 0 4px; }
.wb-key { color: var(--faint); }
.wb-nav { display: none; background: none; border: 1px solid var(--rule); border-radius: 4px; padding: 5px 10px; cursor: pointer; font-family: var(--mono); font-size: 11px; letter-spacing: 0.06em; color: var(--text); }

/* the trust badge and its popover */
.wb-trust { position: static; }
.wb-badge { list-style: none; display: inline-flex; align-items: center; gap: 8px; cursor: pointer; padding: 5px 4px; font-family: var(--mono); font-size: 11px; letter-spacing: 0.04em; color: var(--faint); }
.wb-badge::-webkit-details-marker { display: none; }
.wb-badge:hover { color: var(--ink); }
.wb-badge-dot { width: 7px; height: 7px; border-radius: 50%; background: var(--mark); flex: none; }
.wb-badge-short { display: none; }
.wb-pop { position: absolute; top: 52px; right: 20px; width: min(520px, calc(100vw - 32px)); background: var(--panel); border: 1px solid var(--rule); border-radius: 6px; padding: 20px 22px; box-shadow: 0 20px 50px rgba(0, 0, 0, 0.5); display: flex; flex-direction: column; gap: 12px; z-index: 20; animation: wb-rise 0.2s ease both; }
.wb-pop-head { display: flex; justify-content: space-between; gap: 12px; font-family: var(--mono); font-size: 11px; letter-spacing: 0.12em; text-transform: uppercase; color: var(--faint); }
.wb-pop-row { display: grid; grid-template-columns: 130px minmax(0, 1fr); gap: 12px; font-size: 13px; line-height: 1.5; }
.wb-pop-k { font-family: var(--mono); font-size: 11px; letter-spacing: 0.1em; text-transform: uppercase; color: var(--mark); padding-top: 2px; }
.wb-pop-v { color: var(--muted); }
.wb-lim > summary { list-style: none; cursor: pointer; font-family: var(--mono); font-size: 11px; letter-spacing: 0.08em; text-transform: uppercase; color: var(--faint); border-top: 1px solid var(--rule); padding-top: 12px; }
.wb-lim > summary::-webkit-details-marker { display: none; }
.wb-lim > summary::after { content: " +"; }
.wb-lim[open] > summary::after { content: " −"; }
.wb-lim ul { margin: 10px 0 0; padding-left: 18px; color: var(--muted); font-size: 13px; line-height: 1.55; display: flex; flex-direction: column; gap: 5px; max-height: 240px; overflow: auto; }

/* the session list */
.wb-list { border-right: 1px solid var(--grid); display: flex; flex-direction: column; min-height: 0; background: var(--bg); }
.wb-filter { padding: 12px 12px 8px; }
.wb-filter input { width: 100%; background: var(--panel); border: 1px solid var(--rule); border-radius: 4px; padding: 7px 10px; font-size: 13px; outline: none; color: var(--ink); }
.wb-filter input:focus { border-color: var(--mark); }
.wb-lhead { display: flex; justify-content: space-between; padding: 6px 20px 8px; font-family: var(--mono); font-size: 11px; letter-spacing: 0.1em; text-transform: uppercase; color: var(--faint); }
.wb-rows { flex: 1; overflow: auto; min-height: 0; }
.wb-row { display: block; width: 100%; text-align: left; background: none; border: 0; border-left: 2px solid transparent; border-bottom: 1px solid var(--panel); padding: 11px 16px 10px 18px; cursor: pointer; color: inherit; font: inherit; }
.wb-row:hover { background: var(--panel); }
.wb-row[aria-current="true"] { border-left-color: var(--mark); background: var(--selected); }
.wb-row[aria-current="true"] .wb-rtitle { color: var(--ink); }
.wb-top { display: flex; align-items: center; padding-top: 11px; padding-bottom: 11px; }
.wb-top .wb-rtitle { color: var(--ink); }
.wb-r1 { display: flex; justify-content: space-between; gap: 10px; align-items: baseline; }
.wb-r2 { display: flex; justify-content: space-between; gap: 6px; margin-top: 3px; font-family: var(--mono); font-size: 11px; color: var(--faint); align-items: center; }
.wb-rtitle { font-size: 13px; color: var(--text); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-width: 0; }
.wb-rcost { font-family: var(--mono); font-size: 11px; color: var(--muted); font-variant-numeric: tabular-nums; display: inline-flex; gap: 8px; align-items: baseline; white-space: nowrap; }
.wb-rmeta { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; }
.wb-rout { display: inline-flex; align-items: center; gap: 5px; letter-spacing: 0.04em; text-transform: uppercase; white-space: nowrap; flex: none; max-width: 50%; overflow: hidden; }
.wb-rout i { width: 5px; height: 5px; border-radius: 50%; flex: none; }
.wb-lfoot { border-top: 1px solid var(--grid); padding: 10px 20px; display: flex; flex-direction: column; gap: 8px; font-family: var(--mono); font-size: 11px; color: var(--faint); }
.wb-liveline { display: flex; align-items: center; gap: 8px; width: 100%; background: none; border: 0; padding: 0; cursor: pointer; font: inherit; color: var(--faint); text-align: left; }
.wb-liveline:hover { color: var(--ink); }
.wb-liveline .wb-key { margin-left: auto; }
.wb-dot { width: 6px; height: 6px; border-radius: 50%; background: var(--mark); flex: none; animation: wb-pulse 2s infinite; }
.wb-hints { display: flex; gap: 12px; flex-wrap: wrap; color: var(--faint); }
.wb-hints b { color: var(--muted); font-weight: 400; }

/* the main pane */
.wb-main { overflow: auto; min-height: 0; position: relative; }
.wb-pane { padding: 72px 64px 64px; max-width: 960px; }
.wb-session { padding-top: 44px; }
.wb-rise { animation: wb-rise 0.4s ease both; }
.wb-eyebrow { font-family: var(--mono); font-size: 12px; letter-spacing: 0.06em; color: var(--faint); }
.wb-sentence { margin: 16px 0 0; font-size: 30px; font-weight: 500; line-height: 1.2; letter-spacing: -0.015em; color: var(--ink); max-width: 24ch; text-wrap: pretty; }
.wb-hero { margin-top: 36px; display: flex; align-items: flex-end; gap: 24px; flex-wrap: wrap; }
.wb-herofig { font-family: var(--mono); font-weight: 300; font-size: 136px; line-height: 0.9; letter-spacing: -0.06em; color: var(--ink); font-variant-numeric: tabular-nums; }
.wb-heroside { padding-bottom: 10px; display: flex; flex-direction: column; gap: 4px; }
.wb-herolab { font-size: 15px; }

/* the receipt */
.wb-receipt { margin-top: 44px; padding-top: 18px; border-top: 1px solid var(--rule); display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 20px; }
.wb-recv { font-family: var(--mono); font-size: 22px; font-weight: 300; letter-spacing: -0.03em; color: var(--text); font-variant-numeric: tabular-nums; }
.wb-recv.warn { color: var(--warn); }
.wb-reck { font-size: 12px; color: var(--faint); margin-top: 4px; display: flex; flex-wrap: wrap; gap: 4px 8px; align-items: baseline; }

/* blocks */
.wb-block { margin-top: 52px; }
.wb-bhead { display: flex; justify-content: space-between; align-items: baseline; gap: 16px; font-family: var(--mono); font-size: 11px; letter-spacing: 0.1em; text-transform: uppercase; color: var(--faint); }
.wb-bhead-r { text-transform: none; letter-spacing: 0.04em; }
.wb-bhead-1 { padding-bottom: 8px; border-bottom: 1px solid var(--rule); }
.wb-bhead .mark { letter-spacing: 0.1em; }
.wb-bars { margin-top: 12px; height: 96px; display: flex; align-items: flex-end; gap: 3px; border-bottom: 1px solid var(--rule); }
.wb-bars.tight { gap: 1px; }
.wb-day { flex: 1 1 0; min-width: 0; min-height: 2px; border-radius: 1px 1px 0 0; }
.wb-bax { display: flex; justify-content: space-between; margin-top: 6px; font-family: var(--mono); font-size: 11px; color: var(--faint); }
.wb-two { margin-top: 44px; display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 40px; }
.wb-col { min-width: 0; }
.wb-note { font-size: 13px; color: var(--faint); padding-top: 10px; }
.wb-mrow { display: grid; grid-template-columns: minmax(0, 1fr) 44px 108px; gap: 12px; align-items: center; padding: 8px 0; border-bottom: 1px solid var(--grid); font-family: var(--mono); font-size: 12px; font-variant-numeric: tabular-nums; }
.wb-mname { color: var(--text); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.wb-mruns { text-align: right; color: var(--faint); }
.wb-mbar { display: flex; align-items: center; gap: 8px; }
.wb-mtrack { flex: 1; height: 3px; background: var(--grid); }
.wb-mtrack i { display: block; height: 3px; background: var(--d1); }
.wb-mval { width: 38px; text-align: right; color: var(--muted); }
.wb-segbar { display: flex; height: 10px; gap: 2px; margin-top: 14px; overflow: hidden; }
.wb-segbar i { display: block; }
.wb-flegend { display: flex; flex-direction: column; gap: 6px; margin-top: 14px; }
.wb-fl { display: flex; gap: 10px; align-items: baseline; font-family: var(--mono); font-size: 12px; }
.wb-fl i { width: 8px; height: 8px; flex: none; align-self: center; }
.wb-fn { width: 34px; text-align: right; color: var(--ink); font-variant-numeric: tabular-nums; }
.wb-fw { color: var(--muted); }

/* the card */
.wb-card { display: grid; grid-template-columns: 120px minmax(0, 1fr) auto; gap: 22px; align-items: center; width: 100%; text-align: left; margin-top: 44px; padding: 18px 20px; border: 1px solid var(--rule); border-radius: 6px; background: none; color: inherit; font: inherit; cursor: pointer; }
.wb-card:hover { border-color: var(--faint); background: var(--panel); }
.wb-card-thumb { width: 120px; height: 120px; display: block; overflow: hidden; }
.wb-thumb-svg, .wb-stk-svg { width: 100%; height: auto; display: block; }
.wb-card-body { display: block; min-width: 0; }
.wb-card-t { display: block; font-size: 15px; color: var(--ink); }
.wb-card-p { display: block; margin-top: 4px; font-size: 13px; color: var(--muted); text-wrap: pretty; }
.wb-card-go { font-family: var(--mono); font-size: 11px; letter-spacing: 0.06em; color: var(--muted); white-space: nowrap; }
.wb-hint { margin-top: 36px; font-family: var(--mono); font-size: 11px; color: var(--faint); }
.wb-hint b { color: var(--muted); font-weight: 400; }

/* one session */
.wb-meta { display: flex; gap: 14px; flex-wrap: wrap; font-family: var(--mono); font-size: 12px; color: var(--faint); align-items: baseline; }
.wb-meta .wb-out { letter-spacing: 0.06em; text-transform: uppercase; }
.wb-stitle { margin: 10px 0 0; font-size: 28px; font-weight: 500; line-height: 1.2; letter-spacing: -0.015em; color: var(--ink); text-wrap: pretty; }
.wb-sub { margin: 8px 0 0; font-size: 15px; color: var(--muted); }
.wb-labelbar { margin-top: 28px; padding: 14px 16px; background: var(--panel); border: 1px solid var(--rule); border-radius: 6px; display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
.wb-labelq { font-size: 14px; color: var(--ink); margin-right: 6px; }
.wb-lstates { display: flex; gap: 4px; flex-wrap: wrap; }
.wb-lbtn { padding: 6px 12px; border: 1px solid var(--rule); background: transparent; color: var(--muted); border-radius: 4px; cursor: pointer; font-family: var(--mono); font-size: 11px; letter-spacing: 0.06em; }
.wb-lbtn:hover { border-color: var(--faint); }
.wb-lbtn[data-on="1"] { background: var(--ink); color: var(--bg); border-color: var(--ink); }
.wb-lnote { flex: 1 1 160px; min-width: 0; background: var(--bg); border: 1px solid var(--rule); border-radius: 4px; padding: 7px 10px; font-size: 13px; outline: none; color: var(--ink); }
.wb-lnote:focus { border-color: var(--mark); }
.wb-lsave { padding: 7px 12px; border: 0; border-radius: 4px; background: var(--grid); color: var(--faint); cursor: pointer; font-family: var(--mono); font-size: 11px; letter-spacing: 0.08em; text-transform: uppercase; }
.wb-lsave[data-ready="1"] { background: var(--ink); color: var(--bg); }
.wb-lmsg { font-family: var(--mono); font-size: 11px; color: var(--faint); flex-basis: 100%; }
.wb-tree { margin-top: 36px; }
.wb-tree-head { display: flex; justify-content: space-between; align-items: baseline; gap: 16px; margin-bottom: 10px; flex-wrap: wrap; }
.wb-tree-line { font-size: 14px; color: var(--text); display: flex; gap: 10px; align-items: baseline; flex-wrap: wrap; }
.wb-legend { display: flex; gap: 14px; font-family: var(--mono); font-size: 11px; letter-spacing: 0.06em; color: var(--faint); white-space: nowrap; flex-wrap: wrap; }
.wb-legend span { display: inline-flex; align-items: center; gap: 5px; }
.wb-legend i { width: 10px; height: 6px; display: inline-block; }
.wb-tree-wrap { overflow-x: auto; }
.wb-tree-svg { width: 640px; height: auto; display: block; }
.wb-svg-lab { font-family: var(--mono); fill: var(--faint); }
.wb-svg-mark { fill: var(--mark); }
.wb-runs { margin-top: 32px; }
.wb-th, .wb-run-head { display: grid; grid-template-columns: 28px minmax(0, 1fr) 60px 74px 118px; gap: 12px; }
.wb-th { align-items: end; padding: 6px 0; border-bottom: 1px solid var(--rule); font-family: var(--mono); font-size: 11px; letter-spacing: 0.1em; text-transform: uppercase; color: var(--faint); }
.wb-th > span:nth-child(n+3), .wb-run-head > span:nth-child(n+3) { text-align: right; }
.wb-th .mark { text-transform: uppercase; letter-spacing: 0.08em; }
.wb-run { border-bottom: 1px solid var(--grid); }
.wb-run-head { width: 100%; align-items: center; padding: 8px 6px; margin: 0 -6px; border: 0; border-radius: 4px; background: none; color: inherit; cursor: pointer; font-family: var(--mono); font-size: 12px; font-variant-numeric: tabular-nums; text-align: left; }
.wb-run-head:hover { background: var(--panel); }
.wb-run-head:focus-visible { outline: 2px solid var(--mark); outline-offset: 2px; }
.wb-rn { color: var(--faint); }
.wb-rmodel { display: flex; gap: 10px; align-items: baseline; min-width: 0; }
.wb-rmodel > span:first-child { color: var(--text); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.wb-rspawn { color: var(--faint); font-size: 11px; white-space: nowrap; }
.wb-rmin, .wb-rcostc { color: var(--muted); }
.wb-run-files { padding: 4px 0 12px 40px; display: flex; flex-direction: column; gap: 4px; font-family: var(--mono); font-size: 12px; }
.wb-rf-head { color: var(--faint); margin-bottom: 4px; }
.wb-rf { display: flex; gap: 12px; align-items: baseline; }
.wb-rf-p { color: var(--text); overflow-wrap: anywhere; }
.wb-rf-p.off { color: var(--faint); }
.wb-rf-t { font-size: 11px; letter-spacing: 0.08em; text-transform: uppercase; color: var(--mark); white-space: nowrap; }
.wb-noagents { padding: 14px 0; font-family: var(--mono); font-size: 12px; color: var(--faint); }

/* live */
.wb-live { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 48px 56px; align-items: start; }
.wb-watch { display: flex; align-items: center; gap: 8px; }
.wb-live-p { margin: 14px 0 0; font-size: 15px; color: var(--muted); max-width: 44ch; text-wrap: pretty; }
.wb-band { margin-top: 44px; min-height: 180px; border-top: 1px solid var(--rule); border-bottom: 1px solid var(--rule); display: flex; align-items: center; justify-content: center; overflow-x: auto; }
.wb-band:empty::before { content: attr(data-empty); font-family: var(--mono); font-size: 11px; letter-spacing: 0.1em; text-transform: uppercase; color: var(--faint); }
.wb-live-r { display: flex; flex-direction: column; gap: 26px; }
.wb-live-r .wb-block { margin-top: 0; }
.live-strip { margin-top: 10px; background: var(--panel); border: 1px solid var(--rule); border-radius: 4px; padding: 10px 14px; font-family: var(--mono); font-size: 12px; color: var(--text); display: flex; gap: 16px; flex-wrap: wrap; }
.wb-chip-a { color: var(--mark); }
.wb-chip-d { color: var(--faint); }
.wb-live-y { margin: 10px 0 0; font-size: 14px; color: var(--text); }
.wb-live-cols { display: grid; grid-template-columns: minmax(0, 240px) minmax(0, 1fr); gap: 22px; align-items: start; margin-top: 22px; }
.wb-live-runs { list-style: none; margin: 0; padding: 0; border: 1px solid var(--rule); max-height: 300px; overflow: auto; }
.wb-live-runs:empty { display: none; }
.wb-live-runs li { display: grid; grid-template-columns: 10px minmax(0, 1fr) auto; gap: 9px; align-items: center; padding: 7px 10px; font-family: var(--mono); font-size: 11px; cursor: pointer; border-bottom: 1px solid var(--grid); }
.wb-live-runs li:last-child { border-bottom: 0; }
.wb-live-runs li:hover, .wb-live-runs li[aria-selected="true"] { background: var(--panel); }
.lr-dot { width: 8px; height: 8px; border-radius: 2px; display: inline-block; }
.lr-t { color: var(--text); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.lr-f { color: var(--muted); letter-spacing: 0.04em; }
.lr-f.warn { color: var(--warn); }
.wb-live-detail { font-size: 13px; color: var(--text); min-height: 44px; }
.ld-head { font-family: var(--mono); font-size: 13px; color: var(--ink); display: flex; gap: 10px; align-items: baseline; }
.ld-fate { font-size: 11px; letter-spacing: 0.08em; text-transform: uppercase; color: var(--muted); }
.ld-fate.warn { color: var(--warn); }
.ld-meta { font-family: var(--mono); font-size: 11px; color: var(--faint); margin: 6px 0 12px; }
.ld-fh { font-size: 11px; letter-spacing: 0.1em; text-transform: uppercase; color: var(--faint); margin-bottom: 6px; }
.ld-files { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 3px; font-family: var(--mono); font-size: 11px; color: var(--text); }
.wb-hover { position: fixed; z-index: 50; background: var(--panel); border: 1px solid var(--rule); color: var(--text); font-family: var(--mono); font-size: 11px; padding: 5px 8px; pointer-events: none; }
.wb-band rect[data-sel="1"] { stroke: var(--ink); stroke-width: 1.5; }

/* the sheets */
.wb-scrim { position: absolute; inset: 52px 0 0 0; background: rgba(10, 12, 15, 0.55); z-index: 15; }
.wb-sheet { position: absolute; top: 52px; right: 0; bottom: 0; width: 460px; max-width: 100%; background: var(--panel); border-left: 1px solid var(--rule); z-index: 16; overflow: auto; padding: 28px 28px 40px; animation: wb-slide 0.25s cubic-bezier(0.2, 0.7, 0.2, 1) both; }
.wb-sheet-head { display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 20px; gap: 16px; }
.wb-sheet-head h2 { margin: 0; font-size: 18px; font-weight: 500; color: var(--ink); }
.wb-esc { background: none; border: 0; cursor: pointer; font-family: var(--mono); font-size: 11px; color: var(--faint); }
.wb-esc:hover { color: var(--ink); }
.wb-sheet-p { margin: 0 0 6px; font-size: 13px; color: var(--faint); }
.wb-sheet-cmd { font-family: var(--mono); font-size: 11px; color: var(--faint); margin-top: 8px; overflow-wrap: anywhere; }
.wb-fix { padding: 20px 0; border-top: 1px solid var(--rule); display: flex; flex-direction: column; gap: 10px; }
.wb-fix-head { display: flex; justify-content: space-between; gap: 16px; align-items: baseline; }
.wb-fix-head h3 { margin: 0; font-size: 15px; font-weight: 500; color: var(--ink); }
.wb-tag { font-family: var(--mono); font-size: 11px; letter-spacing: 0.1em; text-transform: uppercase; color: var(--mark); white-space: nowrap; }
.wb-tag.soft, .wb-tag.wait { color: var(--faint); }
.wb-fix-why { margin: 0; font-size: 13px; color: var(--muted); text-wrap: pretty; }
.wb-fix-eff { font-family: var(--mono); font-size: 11px; color: var(--faint); }
.wb-diff { background: var(--bg); border: 1px solid var(--rule); border-radius: 4px; padding: 10px 0; font-family: var(--mono); font-size: 11px; line-height: 1.7; }
.wb-diff-f { padding: 0 14px 6px; color: var(--faint); border-bottom: 1px solid var(--grid); margin-bottom: 6px; overflow-wrap: anywhere; }
.wb-diff-b { max-height: 320px; overflow: auto; }
.wb-dl { display: flex; gap: 12px; padding: 0 14px; }
.wb-dl.add { background: rgba(152, 178, 196, 0.06); }
.wb-ds { width: 8px; color: var(--faint); flex: none; }
.wb-dl.add .wb-ds { color: var(--mark); }
.wb-dl.cut .wb-ds { color: var(--warn); }
.wb-dt { color: var(--text); white-space: pre-wrap; overflow-wrap: anywhere; }
.wb-fixact { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; }
.wb-fbtn { background: var(--ink); color: var(--bg); border: 1px solid var(--ink); border-radius: 4px; padding: 7px 12px; cursor: pointer; font-family: var(--mono); font-size: 11px; letter-spacing: 0.06em; text-decoration: none; display: inline-block; }
.wb-fbtn:hover { opacity: 0.85; }
.wb-fbtn.ghost { background: none; color: var(--muted); border-color: var(--rule); }
.wb-fbtn.ghost:hover { border-color: var(--faint); color: var(--ink); opacity: 1; }
.wb-fnote { font-family: var(--mono); font-size: 11px; color: var(--faint); }
.wb-stk { width: 100%; aspect-ratio: 1; border: 1px solid var(--rule); background: var(--bg); margin-bottom: 16px; }
canvas#sticker { width: 100%; height: auto; display: block; }
.wb-share-acts { display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 10px; }

/* the static file: one column, the overview, then the sessions as plain rows */
.wb-static .wb-card { cursor: default; }
.wb-static .wb-main { overflow: visible; }
.wb-staticlist { padding-top: 0; }
.wb-staticlist .wb-row { border-left: 0; padding-left: 0; padding-right: 0; cursor: default; }
.wb-staticlist .wb-row:hover { background: none; }
.wb-closing { padding: 24px 64px 40px; max-width: 960px; font-family: var(--mono); font-size: 11px; letter-spacing: 0.06em; color: var(--faint); border-top: 1px solid var(--rule); margin: 0 64px; }

/* narrow: the list is a view of its own and the main pane takes the width */
@media (max-width: 900px) {
  .wb-app, .wb-embed { grid-template-columns: minmax(0, 1fr); }
  .wb-nav { display: inline-block; }
  .wb-bar { gap: 10px; padding: 0 14px; }
  .wb-acts .wb-key { display: none; }
  /* the promise is still one tap away, in the popover's fifth row */
  .wb-badge-full { display: none; }
  .wb-badge-short { display: inline; }
  .wb-word { flex: 0 0 auto; }
  .wb-repo, .wb-period, .wb-scope { display: none; }
  .wb-list { position: absolute; inset: 52px 0 0 0; z-index: 10; border-right: 0; }
  .wb[data-nav="main"] .wb-list { display: none; }
  .wb[data-nav="list"] .wb-main { display: none; }
  .wb-pane { padding: 24px; max-width: none; }
  .wb-sheet { width: 100%; }
  .wb-sentence { font-size: 24px; max-width: none; }
  .wb-herofig { font-size: 96px; }
  .wb-receipt { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 18px; }
  .wb-two { grid-template-columns: minmax(0, 1fr); gap: 32px; }
  .wb-live { grid-template-columns: minmax(0, 1fr); gap: 32px; }
  .wb-live-cols { grid-template-columns: minmax(0, 1fr); }
  .wb-closing { margin: 0 24px; padding: 24px 0 32px; }
  .wb-static .wb-pane { padding: 32px 24px; }
}
@media (max-width: 560px) {
  .wb-bar { gap: 8px; padding: 0 12px; }
  /* the sticker card on the overview is the share control at this width */
  .wb-acts [data-sheet="share"] { display: none; }
  .wb-mrow { grid-template-columns: minmax(0, 1fr) 36px 92px; gap: 8px; }
  .wb-fn { width: 28px; }
  .wb-pane { padding: 20px 16px 40px; }
  .wb-herofig { font-size: 72px; }
  .wb-sentence { font-size: 21px; }
  .wb-card { grid-template-columns: 72px minmax(0, 1fr); gap: 14px; }
  .wb-card-thumb { width: 72px; height: 72px; }
  .wb-card-go { grid-column: 2; }
  .wb-th, .wb-run-head { grid-template-columns: 22px minmax(0, 1fr) 46px 62px; }
  .wb-th > span:nth-child(5), .wb-run-head > span:nth-child(5) { grid-column: 2 / -1; text-align: left; }
  .wb-run-files { padding-left: 22px; }
  .wb-closing { margin: 0 16px; }
}

/* motion is a courtesy, never a requirement */
@media (prefers-reduced-motion: reduce) {
  .wb-rise, .wb-sheet, .wb-pop { animation: none !important; }
  .wb-dot, .wb-badge-dot { animation: none !important; }
}

/* print: the overview on paper, with the five rules and the limits registry under it. A closed
   details hides its content through the UA's content slot, so the pseudo is the rule that works
   and the display rule under it is the fallback for an engine that does not expose it. */
@media print {
  .wb, .wb-app, .wb-embed { height: auto; display: block; overflow: visible; }
  .wb-list, .wb-staticlist, .wb-hint, .wb-card-go, .wb-acts, .wb-nav, .wb-sp, .wb-scope { display: none !important; }
  .wb-main { overflow: visible; }
  .wb-pane { padding: 24px 0; max-width: none; }
  .wb-session, .wb-live { display: none !important; }
  .wb-closing { margin: 0; padding-top: 16px; }
  .wb-bar { display: block; height: auto; white-space: normal; padding: 0 0 16px; }
  .wb-ctx { display: flex; margin-top: 6px; }
  .wb-repo, .wb-period { display: inline; }
  .wb-trust { display: block; margin-top: 14px; }
  .wb-badge { color: var(--muted); }
  .wb-badge-full { display: inline; }
  .wb-badge-short { display: none; }
  .wb-trust::details-content, .wb-lim::details-content { content-visibility: visible; display: block; }
  .wb-trust > *:not(summary), .wb-lim > *:not(summary) { display: block !important; }
  .wb-pop { position: static; width: auto; box-shadow: none; border: 0; border-top: 1px solid var(--rule); border-radius: 0; padding: 12px 0 0; animation: none; }
  .wb-lim ul { max-height: none; overflow: visible; }
  .wb-card { break-inside: avoid; }
}
`;
