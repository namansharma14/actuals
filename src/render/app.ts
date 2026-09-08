/**
 * The app layer of the report page (D13): what the local app adds on top of the static
 * report. Picker, drawer shell, fix actions, and one inline script that only ever fetches
 * relative URLs on the loopback origin it was served from. The static export never
 * includes any of this (renderHtml without `app`).
 */
import type { Report } from "../schema/socket.js";
import { renderShareText } from "./share.js";

export interface CatalogRow { id: string; date: string; title: string; cost_usd: number; agents: number; peak_concurrency: number }
export interface ProjectOption { slug: string; label: string; sessions: number; last: string | null }
export interface AppRender {
  /** per-launch token, required on every POST; embedded here and nowhere else */
  token: string;
  /** the loopback port, shown in the rail so the user can see where the page came from */
  port: number;
  /** every session in the latest full run, so the picker can widen as well as narrow */
  catalog: CatalogRow[];
  /** every Claude Code project on this machine, for the project switcher; slugs only, resolved server-side */
  projects: ProjectOption[];
  /** the project the current report was made for: a slug, "" for this folder, "*" for every project */
  project: string;
  /** the "This repository" tab: the launch folder's slug and its session count */
  repoTab: { slug: string; sessions: number };
  /** the scope the current report was made with */
  scope: { since: string | null; until: string | null; sessionIds: string[] | null };
  /** fix ids with an undo store on disk */
  applied: string[];
  /** where the static file of the current run lives */
  staticPath: string;
  /** yesterday's kept work re-tested today (git+disk), or null when there is no yesterday */
  dailyKept?: { n: number; m: number } | null;
}

export interface EmbedRender {
  /** sessionId -> the pre-rendered drawer HTML, inlined so the embed needs no server */
  drawers: Record<string, string>;
}

export function embedData(embed: EmbedRender): string {
  return JSON.stringify({ drawers: embed.drawers }).replace(/</g, "\\u003c");
}

/**
 * The embed client: the report drawer, driven entirely from inlined data and the URL, with no
 * network. A landing iframe sets state with ?session=<id>&panel=top|session|fixes; the drawer
 * opens over the report and labels are shown read-only (saving lives in the app).
 */
export const EMBED_JS = `
(function () {
  var E = window.__actualsEmbed || { drawers: {} };
  function $(sel, root) { return (root || document).querySelector(sel); }
  function all(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }
  var drawer = $("#drawer"), scrim = $("#scrim"), body = $("#dr-body");
  function closeDrawer() { if (drawer) drawer.hidden = true; if (scrim) scrim.hidden = true; }
  function openDrawer(id) {
    var html = E.drawers[id];
    if (!html || !drawer) return;
    body.innerHTML = html;
    var save = $("#lbl-save", body); if (save) { save.style.display = "none"; }
    var note = $("#lbl-note", body); if (note) { note.setAttribute("readonly", "readonly"); }
    var msg = $("#lbl-msg", body); if (msg) { msg.textContent = "labels are saved in the app; this is a read-only preview"; }
    drawer.hidden = false; scrim.hidden = false; drawer.scrollTop = 0;
    try { history.replaceState(null, "", location.pathname + location.search + "#session=" + id); } catch (e) {}
  }
  all(".tr[data-session]").forEach(function (row) { row.style.cursor = "pointer"; row.addEventListener("click", function () { openDrawer(row.getAttribute("data-session")); }); });
  all(".peak-row[data-session]").forEach(function (b) { b.addEventListener("click", function () { openDrawer(b.getAttribute("data-session")); }); });
  var cb = $("#dr-close"); if (cb) cb.addEventListener("click", closeDrawer);
  if (scrim) scrim.addEventListener("click", closeDrawer);
  document.addEventListener("keydown", function (ev) { var t = ev.target; if (ev.key === "Escape" && !(t && /^(INPUT|TEXTAREA)$/.test(t.tagName))) closeDrawer(); });
  var q; try { q = new URLSearchParams(location.search); } catch (e) { q = { get: function () { return null; } }; }
  var panel = q.get("panel");
  var target = panel === "session" ? "#sessions" : panel === "fixes" ? "#fixes" : panel === "top" ? "#instrument" : null;
  if (target) { var el = $(target); if (el) { try { el.scrollIntoView({ block: "start" }); } catch (e) { el.scrollIntoView(); } } }
  var sess = q.get("session") || (location.hash.indexOf("#session=") === 0 ? location.hash.slice(9) : null);
  if (sess) openDrawer(sess);
})();
`;

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}
function money(n: number): string { return n >= 100 ? `$${Math.round(n).toLocaleString("en-US")}` : `$${n.toFixed(2)}`; }

export function sPicker(r: Report, app: AppRender): string {
  const dates = app.catalog.map((s) => s.date).filter(Boolean).sort();
  const min = dates[0] ?? "", max = dates.at(-1) ?? "";
  const selected = new Set(app.scope.sessionIds ?? app.catalog.map((s) => s.id));
  const rows = [...app.catalog].sort((a, b) => b.date.localeCompare(a.date)).map((s) => `<label class="pk-row"><input type="checkbox" value="${esc(s.id)}" data-date="${esc(s.date)}"${selected.has(s.id) ? " checked" : ""}><span class="fine">${esc(s.date)}</span><span class="pk-title">${esc(s.title)}</span><span class="num r">${esc(money(s.cost_usd))}</span><span class="fine r">${s.agents ? `${s.agents} agents` : "no agents"}</span></label>`).join("");
  const n = selected.size, m = app.catalog.length;
  const scoped = n !== m || app.scope.since !== null || app.scope.until !== null;
  const total = app.projects.reduce((a, p) => a + p.sessions, 0);
  const empty = r.sessions.length === 0 ? `<p class="pk-empty fine">No Claude Code sessions in this folder yet. Pick another project above to see its report, or run Claude Code here and come back: every number on this page is 0 until then.</p>` : "";
  return `<section class="picker noprint" id="picker">
  <div class="pk-l">
    <span class="lab">scope</span>
    <div class="pk-tabs" role="tablist" aria-label="which sessions to report on">
      <button type="button" class="pk-tab" role="tab" data-project="${esc(app.repoTab.slug)}" aria-selected="${app.project !== "*" ? "true" : "false"}">This repository · ${app.repoTab.sessions} ${app.repoTab.sessions === 1 ? "session" : "sessions"}</button>
      <button type="button" class="pk-tab" role="tab" data-project="*" aria-selected="${app.project === "*" ? "true" : "false"}">Every project · ${total} ${total === 1 ? "session" : "sessions"}</button>
    </div>
    <label class="pk-field"><span class="lab">from</span><input type="date" id="pk-since" value="${esc(app.scope.since ?? min)}" min="${esc(min)}" max="${esc(max)}"></label>
    <label class="pk-field"><span class="lab">to</span><input type="date" id="pk-until" value="${esc(app.scope.until ?? max)}" min="${esc(min)}" max="${esc(max)}"></label>
    <details class="pk-sessions" id="pk-sessions">
      <summary><span class="lab">sessions</span><span class="num" id="pk-count">${n} of ${m}</span><span class="pk-caret">+</span></summary>
      <div class="pk-list">
        <div class="pk-tools"><button type="button" class="btn sm ghost" data-pk="all">all</button><button type="button" class="btn sm ghost" data-pk="none">none</button><span class="fine">cost at list rates <span class="mark">estimated</span></span></div>
        ${rows}
      </div>
    </details>
  </div>
  ${empty}
  <div class="pk-r">
    <button type="button" class="btn" id="pk-run">re-run on this scope</button>
    <button type="button" class="btn ghost" id="pk-reset"${scoped ? "" : " disabled"}>everything</button>
    <span class="fine" id="pk-status">${scoped ? `this report is scoped to ${r.sessions.length} of ${m} sessions` : "runs locally in about a second"}</span>
    <span class="fine">app on 127.0.0.1:${app.port} · nothing leaves this machine</span>
  </div>
</section>`;
}

export function sDrawerShell(): string {
  return `<div class="scrim noprint" id="scrim" hidden></div>
<aside class="drawer noprint" id="drawer" hidden aria-label="session detail">
  <div class="dr-bar"><span class="lab" id="dr-title">session</span><button type="button" class="btn sm ghost" id="dr-close">close</button></div>
  <div class="dr-body" id="dr-body"></div>
</aside>`;
}

/** The action row under a fix card: show the real diff, one confirm, undo beside it. */
export function fixActions(fixId: string, available: boolean, applied: boolean): string {
  if (!available) return "";
  return `<div class="fixact noprint" data-fix="${esc(fixId)}" data-applied="${applied ? "1" : "0"}">
    <div class="fixact-row">${applied
      ? `<span class="mark">applied</span><button type="button" class="btn sm" data-act="undo">undo</button>`
      : `<button type="button" class="btn sm" data-act="plan">show the change</button>`}<span class="fine fixnote"></span></div>
    <div class="fixdiff" hidden><pre class="diff"></pre><div class="fixconfirm"><button type="button" class="btn sm" data-act="apply">apply to this repository</button><button type="button" class="btn sm ghost" data-act="cancel">cancel</button><span class="fine">one confirm; undo restores every file byte for byte</span></div></div>
  </div>`;
}

/**
 * Everything the sticker is drawn from: aggregates and a curve of numbers. Built from
 * report.share and the tallest tree's run times only. No title, path, prompt or file name
 * exists in this object, and the test proves it against the fixture.
 */
export interface StickerData {
  period: string; runs: number; commits: number; per_commit: string; files_alive_pct: number | null; runs_no_fate: number; biggest_tree: number;
  curve: { points: Array<[number, number]>; peak: number; peak_x: number; died: number; runs: number; minutes: number } | null;
  text: string;
}
export function stickerData(r: Report): StickerData {
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

/** The X post intent: the text card only; the sticker PNG is attached by the user from the clipboard. */
export function xIntentUrl(r: Report): string {
  return "https://x.com/intent/post?text=" + encodeURIComponent(renderShareText(r) + "\n\nnpx actuals");
}

/** The sticker section (app only): a transparent PNG drawn in the browser from aggregates. */
export function sSticker(r: Report): string {
  return `<section class="block avoid" id="sticker-block">
  <div class="block-head"><div>${lab("the sticker")}<h2>Three numbers and the curve.</h2></div></div>
  <div class="stk">
    <div class="stk-canvas"><canvas id="sticker" width="1080" height="1080" aria-label="sticker preview"></canvas></div>
    <div class="stk-side">
      <div class="stk-row"><button type="button" class="btn" data-stk="copy">copy sticker</button><button type="button" class="btn" data-stk="share">share</button><button type="button" class="btn ghost" data-stk="download">save png</button><a class="btn" id="stk-x" href="${esc(xIntentUrl(r))}" target="_blank" rel="noopener noreferrer">post on X</a><button type="button" class="btn ghost" data-stk="hosted">share as a page</button></div>
      <div class="hosted" id="hosted" hidden><div class="lab">what would leave this machine</div><ul class="fine" id="hosted-leaves"></ul><div class="stk-row"><button type="button" class="btn sm" id="hosted-go">upload and get the link</button><button type="button" class="btn sm ghost" id="hosted-cancel">cancel</button><span class="fine" id="hosted-msg"></span></div></div>
      <div class="stk-row">${lab("ink")}<button type="button" class="btn sm" data-ink="light" data-on="1">light, for dark photos</button><button type="button" class="btn sm" data-ink="dark" data-on="0">dark, for light photos</button></div>
      <span class="fine" id="stk-msg">1080 by 1080 PNG, transparent · aggregates only</span>
    </div>
  </div>
</section>`;
}

const lab = (s: string): string => `<div class="lab">${esc(s)}</div>`;

export function appData(app: AppRender, r: Report): string {
  const data = { token: app.token, port: app.port, scope: app.scope, drawn: r.burn.tree.timeline?.session_id ?? null, sticker: stickerData(r) };
  // "<" never appears raw inside the script; the JSON stays inert if a title carries markup
  return JSON.stringify(data).replace(/</g, "\\u003c");
}

export const APP_CSS = `
[hidden] { display: none !important; }
#panel-report { display: flex; flex-direction: column; gap: 44px; }
@media (max-width: 900px) { #panel-report { gap: 32px; } }
.picker { position: relative; display: flex; justify-content: space-between; align-items: center; gap: 24px; flex-wrap: wrap; margin-top: -26px; padding-bottom: 14px; border-bottom: 1px solid var(--rule); }
.pk-l, .pk-r { display: flex; align-items: center; gap: 18px; flex-wrap: wrap; min-width: 0; max-width: 100%; }
.pk-field { display: inline-flex; align-items: center; gap: 8px; min-width: 0; max-width: 100%; }
.picker input[type="date"] { background: var(--panel); color: var(--text); border: 1px solid var(--rule); font-family: var(--mono); font-size: 11.5px; padding: 6px 8px; color-scheme: dark; }
.picker input[type="date"]:focus { outline: none; border-color: var(--muted); }
.pk-tabs { display: inline-flex; gap: 4px; align-items: center; flex-wrap: wrap; }
.pk-tab { font-family: var(--mono); font-size: 12.5px; letter-spacing: 0.02em; color: var(--muted); background: var(--panel); border: 1px solid var(--rule); padding: 6px 12px; cursor: pointer; }
.pk-tab[aria-selected="true"] { color: var(--ink); border-color: var(--muted); background: var(--bg); }
.pk-tab:hover { color: var(--text); }
.pk-tab:focus-visible { outline: 2px solid var(--mark); outline-offset: 1px; }
.pk-empty { flex-basis: 100%; margin: 0; color: var(--muted); }
.btn { font-family: var(--mono); font-size: 10.5px; letter-spacing: 0.12em; text-transform: uppercase; color: var(--ink); background: transparent; border: 1px solid var(--rule); padding: 8px 12px; cursor: pointer; line-height: 1; white-space: nowrap; }
.btn:hover { border-color: var(--muted); }
.btn.ghost { color: var(--muted); }
.btn.sm { padding: 5px 9px; font-size: 10px; }
.btn[disabled] { opacity: 0.45; cursor: default; }
.btn[data-on="1"] { border-color: var(--ink); color: var(--ink); }
.pk-sessions { position: static; }
.pk-sessions summary { list-style: none; display: inline-flex; align-items: center; gap: 10px; cursor: pointer; border: 1px solid var(--rule); padding: 6px 10px; }
.pk-sessions summary::-webkit-details-marker { display: none; }
.pk-sessions summary:hover { border-color: var(--muted); }
.pk-caret { font-family: var(--mono); color: var(--muted); }
.pk-sessions[open] .pk-caret { display: none; }
.pk-list { position: absolute; left: 0; top: calc(100% + 6px); z-index: 30; background: var(--panel); border: 1px solid var(--rule); width: min(680px, 100%); max-height: 380px; overflow: auto; padding: 6px 0 8px; box-shadow: 0 12px 40px rgba(0, 0, 0, 0.45); }
.pk-tools { display: flex; gap: 8px; align-items: center; padding: 6px 12px 10px; border-bottom: 1px solid var(--grid); }
.pk-row { display: grid; grid-template-columns: 16px 76px minmax(0, 1fr) 64px 80px; gap: 12px; align-items: center; padding: 6px 12px; cursor: pointer; }
.pk-row:hover { background: var(--grid); }
.pk-row input { margin: 0; accent-color: var(--ink); }
.pk-title { font-size: 12.5px; color: var(--text); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.pk-row.out { opacity: 0.4; }
.tr[data-session] { cursor: pointer; }
.tr[data-session]:hover { background: var(--panel); }
.tr[data-session]:hover .title { color: var(--ink); }
button.peak-row { all: unset; box-sizing: border-box; display: grid; grid-template-columns: 56px minmax(0, 1fr) 36px 70px; gap: 12px; align-items: center; cursor: pointer; padding: 2px 6px; margin: 0 -6px; width: 100%; }
button.peak-row:hover { background: var(--panel); }
button.peak-row[aria-current="true"] { background: var(--panel); }
button.peak-row[aria-current="true"] .peak-bar i { background: var(--ink); }
.instrument-body { display: flex; flex-direction: column; gap: 18px; }
.fixact { display: flex; flex-direction: column; gap: 10px; margin-top: 4px; }
.fixact-row { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
.fixdiff { display: flex; flex-direction: column; gap: 10px; }
.fixconfirm { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
pre.diff { max-height: 320px; overflow: auto; }
.scrim { position: fixed; inset: 0; background: rgba(0, 0, 0, 0.55); z-index: 40; }
.drawer { position: fixed; top: 0; right: 0; height: 100vh; width: min(640px, 100vw); box-sizing: border-box; background: var(--panel); border-left: 1px solid var(--rule); z-index: 41; overflow: auto; padding: 22px 30px 44px; display: flex; flex-direction: column; gap: 22px; }
.dr-bar { display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid var(--rule); padding-bottom: 12px; }
.dr-body { display: flex; flex-direction: column; gap: 24px; }
.dr-head h3 { font-family: var(--sans); font-size: 21px; font-weight: 500; line-height: 1.2; letter-spacing: -0.01em; color: var(--ink); margin: 6px 0 6px; text-wrap: pretty; }
.dr-readouts { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 14px 18px; }
.dr-ro { display: flex; flex-direction: column; gap: 6px; }
.dr-ro .fig { font-size: 28px; }
.dr-sec { display: flex; flex-direction: column; gap: 10px; border-top: 1px solid var(--rule); padding-top: 14px; }
.dr-rows { display: flex; flex-direction: column; }
.dr-row { display: grid; gap: 12px; align-items: baseline; padding: 6px 0; border-bottom: 1px solid var(--grid); font-size: 13px; }
.dr-row.files { grid-template-columns: minmax(0, 1fr) 62px 62px 70px; }
.dr-row.commits { grid-template-columns: 64px minmax(0, 1fr) 88px 70px; }
.dr-row.runs { grid-template-columns: 20px minmax(0, 1fr) 56px 64px 110px; }
.dr-row.claimed { grid-template-columns: minmax(0, 1fr) 64px minmax(0, 1.4fr); }
.dr-row .path, .dr-row .subj { font-family: var(--mono); font-size: 13px; color: var(--text); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.dr-row .desc { font-size: 13px; color: var(--text); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.dr-row .st { font-family: var(--mono); font-size: 12px; letter-spacing: 0.06em; color: var(--muted); }
.dr-row .st.gone, .dr-row .st.died { color: var(--warn); }
.dr-run { border-bottom: 1px solid var(--grid); }
.dr-run > summary { display: grid; grid-template-columns: 20px minmax(0, 1fr) 56px 124px 110px; gap: 12px; align-items: baseline; padding: 6px 0; font-size: 13px; cursor: pointer; list-style: none; }
.dr-run > summary::-webkit-details-marker { display: none; }
.dr-run > summary::marker { content: ""; }
.dr-run > summary:hover .desc { color: var(--ink); }
.dr-run[open] > summary .desc { color: var(--ink); }
.dr-run-more { padding: 2px 0 10px 32px; display: flex; flex-direction: column; gap: 5px; font-size: 13px; color: var(--muted); line-height: 1.55; }
.dr-run-more .k { color: var(--muted); text-transform: uppercase; font-size: 12px; letter-spacing: 0.08em; }
.dr-row .st.kept { color: var(--ink); }
.lbl { display: flex; flex-direction: column; gap: 10px; }
.lbl-states { display: flex; gap: 8px; flex-wrap: wrap; }
.lbl input[type="text"] { background: var(--bg); color: var(--text); border: 1px solid var(--rule); font-family: var(--sans); font-size: 13px; padding: 8px 10px; flex: 1; min-width: 0; box-sizing: border-box; }
.lbl input[type="text"]:focus { outline: none; border-color: var(--muted); }
.lbl-row { display: flex; gap: 10px; align-items: center; }
.mini { border-top: 1px solid var(--rule); border-bottom: 1px solid var(--rule); padding: 10px 0 4px; overflow-x: auto; }
.stk { display: grid; grid-template-columns: minmax(0, 440px) minmax(0, 1fr); gap: 28px; align-items: start; }
.stk-canvas { border: 1px solid var(--rule); background: repeating-conic-gradient(var(--grid) 0 25%, transparent 0 50%) 0 0 / 28px 28px; }
canvas#sticker { width: 100%; height: auto; display: block; }
.stk-side { display: flex; flex-direction: column; gap: 16px; }
.stk-row { display: flex; gap: 10px; flex-wrap: wrap; align-items: center; }
.hosted { display: flex; flex-direction: column; gap: 10px; border-top: 1px solid var(--rule); padding-top: 12px; }
.hosted ul { margin: 0; padding-left: 16px; display: flex; flex-direction: column; gap: 4px; }
.hosted a { color: var(--ink); }
a.btn { text-decoration: none; display: inline-block; }
.tabs { display: flex; gap: 0; margin-top: 16px; border-bottom: 1px solid var(--rule); }
.tab { all: unset; font-family: var(--mono); font-size: 12px; letter-spacing: 0.12em; text-transform: uppercase; color: var(--muted); padding: 10px 14px; cursor: pointer; border-bottom: 2px solid transparent; margin-bottom: -1px; }
.tab:hover { color: var(--muted); }
.tab[aria-selected="true"] { color: var(--ink); border-bottom-color: var(--ink); }
.panel-live { display: flex; flex-direction: column; gap: 16px; padding-top: 18px; }
.live-strip { display: flex; justify-content: space-between; align-items: baseline; gap: 18px; flex-wrap: wrap; border-bottom: 1px solid var(--rule); padding-bottom: 12px; }
.ls-left { display: flex; align-items: baseline; gap: 14px; font-family: var(--mono); min-width: 0; }
.ls-live { font-size: 10px; letter-spacing: 0.14em; text-transform: uppercase; color: var(--warn); }
.ls-clock { font-size: 13px; color: var(--text); font-variant-numeric: tabular-nums; }
.ls-right { display: flex; align-items: baseline; gap: 16px; flex-wrap: wrap; }
.ls-cost { font-family: var(--mono); font-size: 14px; color: var(--ink); font-variant-numeric: tabular-nums; }
.ls-daily { font-family: var(--mono); font-size: 11px; color: var(--muted); letter-spacing: 0.04em; }
.live-plot { overflow-x: auto; }
.live-empty { color: var(--muted); }
.live-cols { display: grid; grid-template-columns: minmax(0, 250px) minmax(0, 1fr); gap: 22px; align-items: start; }
.live-runs { list-style: none; margin: 0; padding: 0; border: 1px solid var(--rule); max-height: 320px; overflow: auto; }
.live-runs:focus { outline: none; }
.live-runs li { display: grid; grid-template-columns: 10px minmax(0, 1fr) auto; gap: 9px; align-items: center; padding: 7px 10px; font-family: var(--mono); font-size: 11px; cursor: pointer; border-bottom: 1px solid var(--grid); }
.live-runs li:last-child { border-bottom: none; }
.live-runs li:hover, .live-runs li[aria-selected="true"] { background: var(--panel); }
.live-runs li:focus { outline: 1px solid var(--muted); outline-offset: -1px; }
.lr-dot { width: 8px; height: 8px; border-radius: 2px; display: inline-block; }
.lr-t { color: var(--text); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.lr-f { color: var(--muted); letter-spacing: 0.04em; } .lr-f.warn { color: var(--warn); }
.live-detail { font-size: 12.5px; color: var(--text); min-height: 44px; }
.ld-head { font-family: var(--mono); font-size: 13px; color: var(--ink); display: flex; gap: 10px; align-items: baseline; }
.ld-fate { font-size: 12px; letter-spacing: 0.08em; text-transform: uppercase; color: var(--muted); } .ld-fate.warn { color: var(--warn); }
.ld-meta { font-family: var(--mono); font-size: 11px; color: var(--muted); margin: 6px 0 12px; }
.ld-fh { font-size: 12px; letter-spacing: 0.1em; text-transform: uppercase; color: var(--muted); margin-bottom: 6px; }
.ld-files { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 3px; font-family: var(--mono); font-size: 11px; color: var(--text); }
.live-plot rect[data-sel="1"] { stroke: var(--ink); stroke-width: 1.5; }
.live-hover { position: fixed; z-index: 50; background: var(--panel); border: 1px solid var(--rule); color: var(--text); font-family: var(--mono); font-size: 11px; padding: 5px 8px; pointer-events: none; }
@media (max-width: 700px) { .live-cols { grid-template-columns: 1fr; } }
@media (max-width: 900px) { .stk { grid-template-columns: 1fr; } }
@media (max-width: 900px) { .picker { margin-top: -14px; } .dr-readouts { grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); } .pk-field { max-width: 100%; } .dr-row.runs { grid-template-columns: 20px minmax(0, 1fr) 56px; } .dr-row.runs > :nth-child(n+4) { display: none; } }
`;

/**
 * Browser script. Vanilla, no dependencies, relative URLs only. Every mutating call
 * carries the per-launch token; the page reloads after a re-run or a label so every
 * number on it comes from one run.
 */
export const CLIENT_JS = `
(function () {
  var A = window.__actuals;
  var $ = function (s, el) { return (el || document).querySelector(s); };
  var $$ = function (s, el) { return Array.prototype.slice.call((el || document).querySelectorAll(s)); };
  function api(path, body) {
    var init = { method: body ? "POST" : "GET", headers: { "x-actuals-token": A.token } };
    if (body) { init.headers["content-type"] = "application/json"; init.body = JSON.stringify(body); }
    return fetch(path, init).then(function (res) {
      return res.text().then(function (t) {
        var j = null; try { j = t ? JSON.parse(t) : null; } catch (e) { j = null; }
        if (!res.ok) throw new Error((j && j.error) || (res.status + " " + res.statusText));
        return j;
      });
    });
  }

  // picker: date range + session multi-select, resolved on the server, then reload
  var since = $("#pk-since"), until = $("#pk-until"), status = $("#pk-status");
  function syncRange() {
    if (!since || !until) return;
    var a = since.value, b = until.value, n = 0, m = 0;
    $$(".pk-row").forEach(function (row) {
      var cb = $("input", row), d = cb.getAttribute("data-date") || "";
      var out = d && ((a && d < a) || (b && d > b));
      row.classList.toggle("out", !!out);
      m += 1; if (cb.checked && !out) n += 1;
    });
    var c = $("#pk-count"); if (c) c.textContent = n + " of " + m;
  }
  if (since) since.addEventListener("change", syncRange);
  if (until) until.addEventListener("change", syncRange);
  $$(".pk-row input").forEach(function (cb) { cb.addEventListener("change", syncRange); });
  $$("[data-pk]").forEach(function (b) { b.addEventListener("click", function () { var on = b.getAttribute("data-pk") === "all"; $$(".pk-row input").forEach(function (cb) { cb.checked = on; }); syncRange(); }); });
  function rerun(body) {
    if (status) status.textContent = "re-running locally";
    $$("#pk-run, #pk-reset").forEach(function (b) { b.disabled = true; });
    api("/api/run", body).then(function () { location.hash = ""; location.reload(); }).catch(function (e) {
      if (status) status.textContent = e.message; $$("#pk-run, #pk-reset").forEach(function (b) { b.disabled = false; });
    });
  }
  var runBtn = $("#pk-run"); if (runBtn) runBtn.addEventListener("click", function () {
    var ids = $$(".pk-row input").filter(function (cb) { return cb.checked; }).map(function (cb) { return cb.value; });
    rerun({ since: since && since.value ? since.value : null, until: until && until.value ? until.value : null, sessions: ids });
  });
  var resetBtn = $("#pk-reset"); if (resetBtn) resetBtn.addEventListener("click", function () { rerun({}); });
  $$(".pk-tab").forEach(function (t) { t.addEventListener("click", function () { if (t.getAttribute("aria-selected") === "true") return; rerun({ project: t.getAttribute("data-project") }); }); });
  document.addEventListener("click", function (ev) { var d = $("#pk-sessions"); if (d && d.open && !d.contains(ev.target)) d.open = false; });
  syncRange();

  // the instrument draws any session with timed runs
  $$("button.peak-row[data-session]").forEach(function (b) {
    b.addEventListener("click", function () {
      var id = b.getAttribute("data-session");
      api("/api/session/" + encodeURIComponent(id) + "/instrument").then(function (j) {
        var body = $("#instrument-body"); if (body) body.innerHTML = j.html;
        $$("button.peak-row[data-session]").forEach(function (x) { x.setAttribute("aria-current", x === b ? "true" : "false"); });
      }).catch(function (e) { b.title = e.message; });
    });
  });

  // session drawer
  var drawer = $("#drawer"), scrim = $("#scrim"), body = $("#dr-body");
  function closeDrawer() { if (drawer) drawer.hidden = true; if (scrim) scrim.hidden = true; if (location.hash.indexOf("#session=") === 0) history.replaceState(null, "", location.pathname); }
  function openDrawer(id) {
    api("/api/session/" + encodeURIComponent(id)).then(function (j) {
      body.innerHTML = j.html; drawer.hidden = false; scrim.hidden = false; drawer.scrollTop = 0;
      history.replaceState(null, "", "#session=" + id);
      wireLabel(j.session_id);
    }).catch(function (e) { body.textContent = ""; var el = document.createElement("div"); el.className = "fine"; el.textContent = e.message; body.appendChild(el); drawer.hidden = false; scrim.hidden = false; });
  }
  $$(".tr[data-session]").forEach(function (row) { row.addEventListener("click", function () { openDrawer(row.getAttribute("data-session")); }); });
  var closeBtn = $("#dr-close"); if (closeBtn) closeBtn.addEventListener("click", closeDrawer);
  if (scrim) scrim.addEventListener("click", closeDrawer);
  document.addEventListener("keydown", function (ev) { var t = ev.target; if (ev.key === "Escape" && !(t && /^(INPUT|TEXTAREA)$/.test(t.tagName))) closeDrawer(); });
  if (location.hash.indexOf("#session=") === 0 && drawer) openDrawer(location.hash.slice(9));

  // label: the one column only the user can fill
  function wireLabel(sessionId) {
    var state = null;
    $$("[data-label]", body).forEach(function (b) {
      if (b.getAttribute("data-on") === "1") state = b.getAttribute("data-label");
      b.addEventListener("click", function () { state = b.getAttribute("data-label"); $$("[data-label]", body).forEach(function (x) { x.setAttribute("data-on", x === b ? "1" : "0"); }); });
    });
    var save = $("#lbl-save", body), note = $("#lbl-note", body), msg = $("#lbl-msg", body);
    if (!save) return;
    save.addEventListener("click", function () {
      if (!state) { msg.textContent = "pick a state first"; return; }
      save.disabled = true; msg.textContent = "saving, then re-running";
      api("/api/label", { target: sessionId, target_kind: "session", state: state, note: note ? note.value : "" }).then(function () { location.reload(); }).catch(function (e) { msg.textContent = e.message; save.disabled = false; });
    });
  }

  // fixes: show the real diff, one confirm, undo beside it
  $$(".fixact").forEach(function (box) {
    var id = box.getAttribute("data-fix"), note = $(".fixnote", box), diffBox = $(".fixdiff", box), pre = $("pre.diff", box), row = $(".fixact-row", box);
    function setRow(applied, text) {
      row.innerHTML = applied
        ? '<span class="mark">applied</span><button type="button" class="btn sm" data-act="undo">undo</button><span class="fine fixnote"></span>'
        : '<button type="button" class="btn sm" data-act="plan">show the change</button><span class="fine fixnote"></span>';
      box.setAttribute("data-applied", applied ? "1" : "0"); note = $(".fixnote", box); note.textContent = text || ""; diffBox.hidden = true; wire();
    }
    function wire() {
      $$("[data-act]", box).forEach(function (b) {
        b.onclick = function () {
          var act = b.getAttribute("data-act");
          if (act === "plan") api("/api/fix/plan", { id: id }).then(function (j) { pre.textContent = j.diff || "(nothing to change: already applied)"; diffBox.hidden = false; note.textContent = j.files.length ? j.files.length + (j.files.length === 1 ? " file" : " files") + " would change" : ""; }).catch(function (e) { note.textContent = e.message; });
          else if (act === "cancel") diffBox.hidden = true;
          else if (act === "apply") api("/api/fix/apply", { id: id }).then(function (j) { setRow(true, j.notes.join(" ")); }).catch(function (e) { note.textContent = e.message; });
          else if (act === "undo") api("/api/fix/undo", { id: id }).then(function (j) { setRow(false, j.notes.join(" ")); }).catch(function (e) { note.textContent = e.message; });
        };
      });
    }
    wire();
  });

  // sticker: a transparent PNG drawn from A.sticker only (aggregates and a curve of numbers)
  var stk = A.sticker, cv = $("#sticker"), stkMsg = $("#stk-msg");
  if (stk && cv) {
    var ink = "light";
    function inks() { return ink === "light" ? { ink: "#E8E4DA", faint: "#9DA3AB", warn: "#FF6A3D", mark: "#98B2C4" } : { ink: "#121212", faint: "#4F5257", warn: "#C8471F", mark: "#27506C" }; }
    function spaced(ctx, text, x, y, gap) { for (var i = 0; i < text.length; i++) { ctx.fillText(text[i], x, y); x += ctx.measureText(text[i]).width + gap; } return x; }
    function draw() {
      var c = inks(), ctx = cv.getContext("2d"), W = cv.width, L = 72, R = W - 72;
      ctx.clearRect(0, 0, W, cv.height);
      ctx.textAlign = "left"; ctx.textBaseline = "alphabetic";
      ctx.fillStyle = c.ink; ctx.font = "500 34px 'Martian Mono', monospace"; spaced(ctx, "ACTUALS", L, 118, 8);
      ctx.fillStyle = c.faint; ctx.font = "400 23px 'Martian Mono', monospace"; ctx.textAlign = "right"; ctx.fillText(stk.period, R, 118); ctx.textAlign = "left";
      // two counts on one line, then the headline: what a commit cost at list rates
      [[String(stk.runs), "AGENT RUNS"], [String(stk.commits), "COMMITS"]].forEach(function (cell, i) { var x = L + i * 468; ctx.fillStyle = c.ink; ctx.font = "300 88px 'Martian Mono', monospace"; ctx.fillText(cell[0], x, 280); ctx.fillStyle = c.faint; ctx.font = "400 23px 'Martian Mono', monospace"; spaced(ctx, cell[1], x, 318, 2.5); });
      ctx.fillStyle = c.ink; ctx.font = "300 136px 'Martian Mono', monospace"; ctx.fillText(stk.per_commit, L, 500);
      ctx.fillStyle = c.faint; ctx.font = "400 23px 'Martian Mono', monospace"; spaced(ctx, "PER COMMIT, AT LIST RATES", L, 540, 2.5);
      var top = 620, bottom = 830;
      ctx.strokeStyle = c.faint; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(L, bottom); ctx.lineTo(R, bottom); ctx.stroke();
      ctx.fillStyle = c.faint; ctx.font = "400 23px 'Martian Mono', monospace";
      if (stk.curve && stk.curve.points.length) {
        var ymax = Math.max(4, stk.curve.peak), X = function (f) { return L + f * (R - L); }, Y = function (v) { return bottom - (v / ymax) * (bottom - top); };
        ctx.strokeStyle = c.ink; ctx.lineWidth = 4; ctx.lineJoin = "round"; ctx.beginPath();
        stk.curve.points.forEach(function (p, i) { if (i === 0) ctx.moveTo(X(p[0]), Y(p[1])); else ctx.lineTo(X(p[0]), Y(p[1])); });
        ctx.stroke();
        ctx.fillStyle = c.mark; ctx.beginPath(); ctx.arc(X(stk.curve.peak_x), Y(stk.curve.peak), 9, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = c.faint; spaced(ctx, stk.curve.peak + " AT ONCE · " + stk.curve.runs + " RUNS IN " + stk.curve.minutes + " MIN" + (stk.curve.died ? " · " + stk.curve.died + " DIED" : ""), L, bottom + 40, 2.5);
      } else {
        spaced(ctx, "NO AGENT TREE IN THIS WINDOW", L, bottom + 40, 2.5);
      }
      ctx.fillStyle = c.faint; spaced(ctx, "FILES ALIVE " + (stk.files_alive_pct === null ? "N/A" : stk.files_alive_pct + "%") + " · RUNS WITH NO FATE " + stk.runs_no_fate + " · BIGGEST TREE " + stk.biggest_tree, L, 940, 2.5);
      ctx.fillStyle = c.ink; ctx.font = "500 23px 'Martian Mono', monospace"; spaced(ctx, "MEASURED BY ACTUALS", L, 1000, 4);
    }
    var fontsReady = document.fonts && document.fonts.load ? Promise.all(["300 136px 'Martian Mono'", "300 88px 'Martian Mono'", "500 34px 'Martian Mono'", "400 23px 'Martian Mono'"].map(function (f) { return document.fonts.load(f); })) : Promise.resolve();
    fontsReady.then(draw, draw);
    $$("[data-ink]").forEach(function (b) { b.addEventListener("click", function () { ink = b.getAttribute("data-ink"); $$("[data-ink]").forEach(function (x) { x.setAttribute("data-on", x === b ? "1" : "0"); }); draw(); }); });
    function say(t) { if (stkMsg) stkMsg.textContent = t; }
    function png() { return new Promise(function (res, rej) { cv.toBlob(function (b) { if (b) res(b); else rej(new Error("could not render the sticker")); }, "image/png"); }); }
    $$("[data-stk]").forEach(function (b) {
      b.addEventListener("click", function () {
        var act = b.getAttribute("data-stk");
        if (act === "hosted") { hostedPreview(); return; }
        png().then(function (blob) {
          if (act === "copy") {
            if (!navigator.clipboard || !window.ClipboardItem) throw new Error("this browser cannot copy images; save the PNG instead");
            return navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]).then(function () { say("copied: paste it onto a photo, a story, or the X post"); });
          }
          if (act === "share") {
            var file = new File([blob], "actuals-sticker.png", { type: "image/png" });
            if (navigator.share && navigator.canShare && navigator.canShare({ files: [file] })) return navigator.share({ files: [file], text: stk.text }).then(function () { say("shared"); });
            throw new Error("this browser cannot share files; copy or save the PNG instead");
          }
          var a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = "actuals-sticker.png"; a.click();
          setTimeout(function () { URL.revokeObjectURL(a.href); }, 5000); say("saved actuals-sticker.png");
        }).catch(function (e) { say(e.message); });
      });
    });

    // share as a page: the one upload, and only after the list of what leaves is shown
    var hostedBox = $("#hosted"), hostedList = $("#hosted-leaves"), hostedMsg = $("#hosted-msg"), hostedGo = $("#hosted-go");
    function hostedSay(t) { if (hostedMsg) hostedMsg.textContent = t; }
    function pngBase64() { return png().then(function (blob) { return new Promise(function (res) { var r = new FileReader(); r.onload = function () { res(String(r.result).split(",")[1] || ""); }; r.readAsDataURL(blob); }); }); }
    function hostedPreview() {
      hostedBox.hidden = false; hostedList.textContent = ""; hostedSay("preparing the redacted copy");
      pngBase64().then(function (b64) { return api("/api/hosted", { sticker_png_base64: b64, confirm: false }); }).then(function (j) {
        hostedList.textContent = ""; (j.leaves || []).forEach(function (line) { var li = document.createElement("li"); li.textContent = line; hostedList.appendChild(li); });
        hostedSay(""); hostedGo.disabled = false;
      }).catch(function (e) { hostedSay(e.message); hostedGo.disabled = true; });
    }
    if (hostedGo) hostedGo.addEventListener("click", function () {
      hostedGo.disabled = true; hostedSay("uploading");
      pngBase64().then(function (b64) { return api("/api/hosted", { sticker_png_base64: b64, confirm: true }); }).then(function (j) {
        hostedMsg.textContent = ""; var a = document.createElement("a"); a.href = j.url; a.textContent = j.url; a.target = "_blank"; a.rel = "noopener noreferrer"; hostedMsg.appendChild(document.createTextNode("share link: ")); hostedMsg.appendChild(a);
        hostedMsg.appendChild(document.createTextNode(j.charged === "free" ? " · " + j.free_runs_left + " free hosted runs left" : j.charged === "credit" ? " · " + j.credits_left + " credits left" : ""));
      }).catch(function (e) { hostedSay(e.message); hostedGo.disabled = false; });
    });
    var hostedCancel = $("#hosted-cancel"); if (hostedCancel) hostedCancel.addEventListener("click", function () { hostedBox.hidden = true; });
  }

  // tabs: the classic Report and the live control centre
  var panelReport = $("#panel-report"), panelLive = $("#panel-live");
  function showPanel(name) {
    $$(".tab").forEach(function (t) { t.setAttribute("aria-selected", t.getAttribute("data-panel") === name ? "true" : "false"); });
    if (panelReport) panelReport.hidden = name !== "report";
    if (panelLive) panelLive.hidden = name !== "live";
    if (name === "live") startLive();
  }
  $$(".tab").forEach(function (t) { t.addEventListener("click", function () { showPanel(t.getAttribute("data-panel")); }); });
  if (location.hash === "#live") showPanel("live"); // deep link straight to the control centre

  // the live control centre (M7): draw the current session's tree from the SSE stream, the
  // poll as the floor. Redraw whole on each frame, so there is nothing to animate and
  // reduced motion is honoured for free.
  var liveOn = false, es = null, liveTree = null, liveSelId = null, liveDetailId = null, liveErr = null;
  function startLive() {
    if (liveOn) return; liveOn = true;
    if (typeof EventSource !== "undefined") {
      try {
        es = new EventSource("/api/live/stream?token=" + encodeURIComponent(A.token));
        es.onopen = function () { liveErr = null; };
        es.onmessage = function (ev) { liveErr = null; try { drawLive(JSON.parse(ev.data)); } catch (e) {} };
        es.onerror = function () { liveErr = "reconnecting to the live feed"; paintErr(); }; // EventSource retries on its own; we only surface it
        return;
      } catch (e) {}
    }
    (function poll() { api("/api/live").then(function (s) { liveErr = null; drawLive(s); }).catch(function () { liveErr = "reconnecting to the live feed"; paintErr(); }); setTimeout(poll, 2000); })();
  }
  function lesc(x) { return String(x).replace(/[&<>"]/g, function (c) { return ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]; }); }
  function lhm(iso) { return iso && iso.length >= 16 ? String(iso).slice(11, 16) : ""; }
  function lmoney(n) { if (n === null || n === undefined) return "n/a"; var a = Math.abs(n); return "$" + (a >= 100 ? Math.round(a).toLocaleString("en-US") : a.toFixed(2)); }
  function lfate(r) { if (r.fate === "died") return "var(--warn)"; return r.depth <= 1 ? "var(--d1)" : r.depth === 2 ? "var(--d2)" : "var(--d3)"; }
  function llanes(runs) {
    var sorted = runs.slice().sort(function (a, b) { return a.start < b.start ? -1 : a.start > b.start ? 1 : a.depth - b.depth; });
    var ends = [], out = [];
    sorted.forEach(function (run) {
      var st = Date.parse(run.start), en = Date.parse(run.end), lane = -1;
      for (var i = 0; i < ends.length; i++) { if (ends[i] <= st) { lane = i; break; } }
      if (lane === -1) { lane = ends.length; ends.push(en); } else ends[lane] = en;
      out.push({ run: run, lane: lane });
    });
    return { placed: out, lanes: ends.length };
  }
  function lcurve(runs, t0, t1) {
    var ev = []; runs.forEach(function (r) { ev.push([Date.parse(r.start), 1]); ev.push([Date.parse(r.end), -1]); });
    ev.sort(function (a, b) { return a[0] - b[0] || a[1] - b[1]; });
    var lvl = 0, pts = [[t0, 0]]; ev.forEach(function (e) { pts.push([e[0], lvl]); lvl += e[1]; pts.push([e[0], lvl]); }); pts.push([t1, 0]);
    return pts;
  }
  function runById(id) { if (!liveTree) return null; for (var i = 0; i < liveTree.runs.length; i++) if (liveTree.runs[i].id === id) return liveTree.runs[i]; return null; }
  function runName(r) { var mins = Math.max(0, Math.round((Date.parse(r.end) - Date.parse(r.start)) / 60000)); return (r.agent_type || "agent") + " · " + String(r.fate).replace(/_/g, " ") + " · " + mins + " min"; }
  function highlight(id) {
    $$("#live-tree rect[data-run]").forEach(function (x) { x.setAttribute("data-sel", x.getAttribute("data-run") === id ? "1" : "0"); });
    $$("#live-runs li").forEach(function (li) { var on = li.getAttribute("data-run") === id; li.setAttribute("aria-selected", on ? "true" : "false"); li.tabIndex = on ? 0 : -1; });
  }
  function openRunDetail(id) {
    var r = runById(id), d = $("#live-detail"); if (!r || !d) return;
    var t0 = (window.performance && performance.now) ? performance.now() : 0;
    liveDetailId = id; liveSelId = id;
    var mins = Math.max(0, Math.round((Date.parse(r.end) - Date.parse(r.start)) / 60000));
    var started = r.parent ? (function () { var p = runById(r.parent); return "started by " + lesc(p ? (p.agent_type || "an agent") : ("agent " + String(r.parent).slice(0, 8))); })() : "top level (you started it)";
    var why = r.fate === "died" ? "open when the session ended" : r.fate === "still_running" ? "still running now" : "returned to its parent";
    var files = r.files || [], hidden = r.files_hidden || 0;
    d.innerHTML = '<div class="ld-head">' + lesc(r.agent_type || "agent") + ' <span class="ld-fate' + (r.fate === "died" ? " warn" : "") + '">' + lesc(String(r.fate).replace(/_/g, " ")) + '</span></div>'
      + '<div class="ld-meta">' + started + (liveTree && liveTree.model ? " · " + lesc(liveTree.model) : "") + ' · depth ' + r.depth + ' · ' + mins + ' min · ' + why + '</div>'
      + '<div class="ld-fh">written so far (' + (files.length + hidden) + (files.length >= 40 ? "+" : "") + ") · fate on the next run</div>"
      + (files.length ? '<ul class="ld-files">' + files.map(function (f) { return "<li>" + lesc(f) + "</li>"; }).join("") + "</ul>" : hidden ? '<p class="fine">' + hidden + (hidden === 1 ? " file" : " files") + ' written (paths hidden in this preview)</p>' : '<p class="fine">no files written yet</p>');
    if (t0) d.setAttribute("data-render-ms", String(Math.round((performance.now() - t0) * 100) / 100));
    highlight(id);
  }
  function paintErr() { var empty = $("#live-empty"); if (empty && liveErr) { empty.hidden = false; empty.textContent = liveErr + "…"; } }
  function drawLive(snap) {
    var clock = $("#ls-clock"), cost = $("#ls-cost"), model = $("#ls-model"), empty = $("#live-empty"), plot = $("#live-tree"), runsEl = $("#live-runs"), detail = $("#live-detail");
    var tree = snap && snap.tree; liveTree = tree || null; liveErr = null;
    if (!tree || !tree.runs || !tree.runs.length) {
      if (empty) { empty.hidden = false; empty.textContent = snap && snap.watching ? "No agent is running in this repo yet. Start Claude Code here and the tree draws itself." : "The status line is off. Run actuals watch in a terminal to record the live tree, then reopen this view."; }
      if (clock) clock.textContent = snap && snap.watching ? "waiting for a session" : "not connected";
      if (cost) cost.textContent = ""; if (model) model.textContent = "";
      if (plot) plot.innerHTML = ""; if (runsEl) runsEl.innerHTML = ""; if (detail) detail.innerHTML = "";
      return;
    }
    if (empty) empty.hidden = true;
    if (clock) clock.textContent = lhm(tree.started_at) + " to " + lhm(tree.now) + (tree.ended ? " · ended" : "");
    if (cost) cost.textContent = lmoney(tree.cost_usd);
    if (model) model.textContent = tree.model || "";
    var PW = 1088, L = 8, PLOT = PW - L, CH = 46, RH = 12, gap = 8;
    var t0 = Date.parse(tree.started_at), t1 = Date.parse(tree.now), span = Math.max(1, t1 - t0);
    var X = function (ms) { return L + ((ms - t0) / span) * PLOT; };
    var packed = llanes(tree.runs);
    var pts = lcurve(tree.runs, t0, t1), peak = 0; pts.forEach(function (p) { if (p[1] > peak) peak = p[1]; }); var ymax = Math.max(1, peak);
    var Yc = function (v) { return 6 + (CH - 6) * (1 - v / ymax); };
    var curve = "M" + pts.map(function (p) { return X(p[0]).toFixed(1) + " " + Yc(p[1]).toFixed(1); }).join(" L");
    var G0 = CH + gap, H = G0 + Math.max(1, packed.lanes) * RH + 8;
    var bars = packed.placed.map(function (p) {
      var x = X(Date.parse(p.run.start)), w = Math.max(3, X(Date.parse(p.run.end)) - x), y = G0 + p.lane * RH;
      return '<rect data-run="' + lesc(p.run.id) + '" x="' + x.toFixed(1) + '" y="' + y + '" width="' + w.toFixed(1) + '" height="7" rx="1" fill="' + lfate(p.run) + '" style="cursor:pointer"><title>' + lesc(runName(p.run)) + "</title></rect>";
    }).join("");
    if (plot) plot.innerHTML = '<svg viewBox="0 0 ' + PW + " " + H + '" width="' + PW + '" height="' + H + '" style="width:100%;height:auto;display:block" role="img" aria-label="' + tree.runs.length + ' agent runs, live"><path d="' + curve + '" fill="none" stroke="var(--d1)" stroke-width="1.2" opacity="0.8"></path>' + bars + "</svg>";
    if (runsEl) runsEl.innerHTML = tree.runs.map(function (r) { return '<li role="option" data-run="' + lesc(r.id) + '" tabindex="-1" aria-selected="false"><i class="lr-dot" style="background:' + lfate(r) + '"></i><span class="lr-t">' + lesc(r.agent_type || "agent") + '</span><span class="lr-f' + (r.fate === "died" ? " warn" : "") + '">' + lesc(String(r.fate).replace(/_/g, " ")) + "</span></li>"; }).join("");
    if (liveDetailId && runById(liveDetailId)) openRunDetail(liveDetailId);
    else if (tree.runs.length) openRunDetail(tree.runs[tree.runs.length - 1].id); // default: the newest run, until one is picked
    else if (detail) detail.innerHTML = '<p class="fine">Pick a run to see its detail.</p>';
    if (liveSelId) highlight(liveSelId);
  }
  (function wireLive() {
    var treeEl = $("#live-tree"), runsEl = $("#live-runs"), hoverEl = $("#live-hover");
    function overRun(ev) { var el = ev.target && ev.target.closest ? ev.target.closest("[data-run]") : null; return el ? el.getAttribute("data-run") : null; }
    if (treeEl) {
      treeEl.addEventListener("click", function (ev) { var id = overRun(ev); if (id) openRunDetail(id); });
      treeEl.addEventListener("mousemove", function (ev) { var id = overRun(ev); if (id && hoverEl) { var r = runById(id); if (r) { hoverEl.hidden = false; hoverEl.textContent = runName(r); hoverEl.style.left = (ev.clientX + 12) + "px"; hoverEl.style.top = (ev.clientY + 14) + "px"; } } else if (hoverEl) hoverEl.hidden = true; });
      treeEl.addEventListener("mouseleave", function () { if (hoverEl) hoverEl.hidden = true; });
    }
    if (runsEl) {
      runsEl.addEventListener("click", function (ev) { var id = overRun(ev); if (id) openRunDetail(id); });
      runsEl.addEventListener("keydown", function (ev) {
        if (!liveTree || !liveTree.runs.length) return;
        var ids = liveTree.runs.map(function (r) { return r.id; }), i = ids.indexOf(liveSelId); if (i < 0) i = 0;
        if (ev.key === "ArrowDown") { ev.preventDefault(); liveSelId = ids[Math.min(ids.length - 1, i + 1)]; highlight(liveSelId); focusSel(); }
        else if (ev.key === "ArrowUp") { ev.preventDefault(); liveSelId = ids[Math.max(0, i - 1)]; highlight(liveSelId); focusSel(); }
        else if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); if (liveSelId) openRunDetail(liveSelId); }
      });
      function focusSel() { var els = runsEl.querySelectorAll("li[data-run]"); for (var k = 0; k < els.length; k++) if (els[k].getAttribute("data-run") === liveSelId) { els[k].focus(); return; } }
    }
  })();

  // heartbeat: the server exits a while after the last page closes
  setInterval(function () { api("/api/ping", { t: Date.now() }).catch(function () {}); }, 10000);
})();
`;
