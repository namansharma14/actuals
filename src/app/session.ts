/**
 * The session drawer (D13): files written with their fate, commits inside the session,
 * runs drawn to time, the /insights claim, and the label control. Built from the ledger of
 * the current run and rendered server-side, so every number carries its mark and the
 * browser only swaps HTML.
 */
import path from "node:path";
import { isInside } from "../config.js";
import { readEntity, readLabels } from "../ledger/store.js";
import { timelineFor, type Timeline } from "../report/index.js";
import { dateTime, dayLabel, esc, hm, int, lab, mark, money } from "../render/html.js";
import type { Claim, Commit, Label, Run, Session, Truth, Verdict } from "../schema/ledger.js";
import type { Report } from "../schema/socket.js";

export interface FileRow { path: string; writes: number; by: "session" | "agent"; on_disk: boolean; tracked: boolean | null; verdict: "kept" | "gone" | "unknown" }
export interface CommitRow { sha: string; subject: string; author_time: string; attribution: Commit["attribution"]; reverted_by: string | null }
export interface RunRow { id: string; agent_type: string | null; description: string; depth: number; spawned_by: Run["spawned_by"]; model: string | null; started_at: string | null; ended_at: string | null; minutes: number | null; cost_usd: number; cost_mark: Run["cost_mark"]; fate: Run["fate"]; fate_evidence: string; files_written: number; files: string[] }
export interface SessionDetail {
  session_id: string;
  row: Report["sessions"][number];
  files: FileRow[];
  commits: CommitRow[];
  runs: RunRow[];
  timeline: Timeline | null;
  label: Label | null;
  assertions: Array<{ kind: string; subject: string; verdict: string; reason: string }>;
  html: string;
}

const LABEL_STATES = ["kept", "retired", "dead", "open"] as const;

function relPath(p: string, repoPath: string, redact: boolean): string {
  if (redact) return "(redacted)";
  return isInside(p, repoPath) ? path.relative(repoPath, p) || "." : p;
}

export function sessionDetail(stateDir: string, runId: string, report: Report, sessionId: string, o: { repoPath: string; redact: boolean }): SessionDetail | null {
  const row = report.sessions.find((s) => s.id === sessionId);
  const session = readEntity<Session>(stateDir, runId, "sessions").find((s) => s.id === sessionId);
  if (!row || !session) return null;
  const runs = readEntity<Run>(stateDir, runId, "runs").filter((r) => r.session_id === sessionId).sort((a, b) => (a.started_at ?? "").localeCompare(b.started_at ?? "") || a.depth - b.depth);
  const owners = new Set([sessionId, ...runs.map((r) => r.id)]);
  const claims = readEntity<Claim>(stateDir, runId, "claims").filter((c) => c.kind === "file_written" && owners.has(c.owner));
  const truths = new Map<string, Map<string, string>>();
  for (const t of readEntity<Truth>(stateDir, runId, "truths")) { if (!truths.has(t.claim_id)) truths.set(t.claim_id, new Map()); truths.get(t.claim_id)!.set(t.kind, t.value); }
  const vlist = readEntity<Verdict>(stateDir, runId, "verdicts");
  const verdicts = new Map(vlist.map((v) => [v.claim_id, v.verdict]));
  const vreason = new Map(vlist.map((v) => [v.claim_id, v.reason]));
  const byPath = new Map<string, FileRow>();
  for (const c of claims) {
    const t = truths.get(c.id);
    const onDisk = t?.get("file_on_disk") === "yes";
    const tracked = t?.has("file_tracked") ? t.get("file_tracked") === "yes" : null;
    const verdict = verdicts.get(c.id) ?? "unknown";
    const key = c.subject;
    const prev = byPath.get(key);
    if (prev) { prev.writes += 1; prev.on_disk = prev.on_disk || onDisk; prev.tracked = prev.tracked || tracked; if (verdict === "kept") prev.verdict = "kept"; else if (prev.verdict === "unknown") prev.verdict = verdict; if (c.owner_kind === "run") prev.by = "agent"; }
    else byPath.set(key, { path: relPath(c.subject, o.repoPath, o.redact), writes: 1, by: c.owner_kind === "run" ? "agent" : "session", on_disk: onDisk, tracked, verdict });
  }
  const files = [...byPath.values()].sort((a, b) => a.path.localeCompare(b.path));
  const commits: CommitRow[] = readEntity<Commit>(stateDir, runId, "commits").filter((c) => c.session_id === sessionId).sort((a, b) => a.author_time.localeCompare(b.author_time)).map((c) => ({ sha: c.sha, subject: o.redact ? "(redacted)" : c.subject, author_time: c.author_time, attribution: c.attribution, reverted_by: c.reverted_by }));
  const runRows: RunRow[] = runs.map((r) => ({ id: r.id, agent_type: o.redact ? null : r.agent_type, description: o.redact ? `run ${r.id.slice(0, 8)}` : r.description, depth: r.depth, spawned_by: r.spawned_by, model: r.model, started_at: r.started_at, ended_at: r.ended_at, minutes: r.started_at && r.ended_at ? Math.round((new Date(r.ended_at).getTime() - new Date(r.started_at).getTime()) / 60e3) : null, cost_usd: Math.round(r.cost_usd * 100) / 100, cost_mark: r.cost_mark, fate: r.fate, fate_evidence: r.fate_evidence, files_written: r.files_written.length, files: [...new Set(r.files_written.map((f) => relPath(f, o.repoPath, o.redact)))] }));
  const timeline = timelineFor({ id: sessionId, date: row.date, title: row.title }, runs, o.redact);
  const assertions = readEntity<Claim>(stateDir, runId, "claims")
    .filter((c) => (c.kind === "report_delivered" || c.kind === "session_outcome") && owners.has(c.owner))
    .map((c) => ({ kind: c.kind, subject: c.kind === "report_delivered" ? (c.subject === "(in chat)" ? "(in chat)" : relPath(c.subject, o.repoPath, o.redact)) : c.subject.replace(/_/g, " "), verdict: String(verdicts.get(c.id) ?? "unknown"), reason: vreason.get(c.id) ?? "" }));
  const label = readLabels(stateDir).filter((l) => l.target === sessionId).at(-1) ?? null;
  const d: SessionDetail = { session_id: sessionId, row, files, commits, runs: runRows, timeline, label, assertions, html: "" };
  d.html = renderDrawer(d, session, o.redact);
  return d;
}

function miniTimelineSvg(t: Timeline): string {
  const PW = 580, L = 30, PLOT = PW - L, CH = 64, ytop = 8;
  const t0 = new Date(t.start).getTime(), t1 = new Date(t.end).getTime(), span = Math.max(1, t1 - t0);
  const ymax = Math.max(4, Math.ceil(t.peak / 2) * 2);
  const X = (ms: number) => L + ((ms - t0) / span) * PLOT;
  const Y = (v: number) => ytop + (CH - ytop) * (1 - v / ymax);
  const ev: Array<[number, number]> = [];
  for (const r of t.runs) { ev.push([new Date(r.start).getTime(), 1]); ev.push([new Date(r.end).getTime(), -1]); }
  ev.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  let level = 0; const pts: Array<[number, number]> = [[t0, 0]];
  for (const [ms, d] of ev) { pts.push([ms, level]); level += d; pts.push([ms, level]); }
  pts.push([t1, 0]);
  const line = "M" + pts.map(([ms, v]) => `${X(ms).toFixed(1)} ${Y(v).toFixed(1)}`).join(" L");
  const RH = 7, G0 = CH + 14, GH = t.runs.length * RH, AX = G0 + GH + 6, H = AX + 16;
  const bars = t.runs.map((r, i) => {
    const x = X(new Date(r.start).getTime()); const w = Math.max(2, ((new Date(r.end).getTime() - new Date(r.start).getTime()) / span) * PLOT);
    const col = r.fate === "died" ? "var(--warn)" : r.depth <= 1 ? "var(--d1)" : r.depth === 2 ? "var(--d2)" : "var(--d3)";
    return `<rect x="${x.toFixed(1)}" y="${G0 + i * RH}" width="${w.toFixed(1)}" height="4" fill="${col}"></rect>`;
  }).join("");
  const ticks = [0, 0.5, 1].map((f) => { const x = L + f * PLOT; return `<line x1="${x.toFixed(1)}" y1="${ytop}" x2="${x.toFixed(1)}" y2="${G0 + GH}" stroke="var(--grid)" stroke-width="1"></line><text x="${(f === 1 ? x - 3 : x).toFixed(1)}" y="${AX + 10}" text-anchor="${f === 0 ? "start" : f === 1 ? "end" : "middle"}" class="svg-lab-n">${esc(hm(new Date(t0 + f * span).toISOString()))}</text>`; }).join("");
  const ylab = `<text x="${L - 6}" y="${(Y(ymax) + 3.5).toFixed(1)}" text-anchor="end" class="svg-lab-n">${ymax}</text><text x="${L - 6}" y="${(Y(0) + 3.5).toFixed(1)}" text-anchor="end" class="svg-lab-n">0</text>`;
  const px = X(new Date(t.peak_at).getTime()), py = Y(t.peak);
  const peak = `<circle cx="${px.toFixed(1)}" cy="${py.toFixed(1)}" r="3" fill="var(--mark)"></circle>`;
  return `<svg viewBox="0 0 ${PW} ${H}" width="${PW}" height="${H}" font-size="12" style="width: 100%; height: auto; display: block;"><title>runs over time</title>${ticks}${ylab}<path d="${line}" fill="none" stroke="var(--d1)" stroke-width="1.2"></path>${peak}${bars}</svg>`;
}

function renderDrawer(d: SessionDetail, s: Session, redact: boolean): string {
  const r = d.row;
  const alive = d.files.filter((f) => f.on_disk).length, tracked = d.files.filter((f) => f.tracked).length;
  const costMark = s.cost_mark === "assumed" || d.runs.some((x) => x.cost_mark === "assumed") ? "assumed" : "estimated";
  const readouts = `<div class="dr-readouts">
    <div class="dr-ro">${lab("tokens at list rates")}<div class="fig">${esc(money(r.cost_usd))}</div><div class="fine">${mark(costMark)} ${esc(money(r.cost_main_usd))} main · ${esc(money(r.cost_agents_usd))} agents</div></div>
    <div class="dr-ro">${lab("commits inside")}<div class="fig">${int(r.commits)}</div><div class="fine">${mark("measured")} author time in window, git commit issued</div></div>
    <div class="dr-ro">${lab("files alive")}<div class="fig">${int(alive)}<span class="unit"> of ${int(d.files.length)}</span></div><div class="fine">${mark("measured")} ${int(tracked)} tracked in git</div></div>
    <div class="dr-ro">${lab("agent runs")}<div class="fig">${int(d.runs.length)}</div><div class="fine">${mark("measured")} peak ${int(r.peak_concurrency)} · depth ${int(r.max_depth)}${r.died ? ` · <span class="warn">${int(r.died)} died</span>` : ""}</div></div>
    <div class="dr-ro">${lab("turns")}<div class="fig">${int(s.turns)}</div><div class="fine">${mark("measured")} API requests, counted once each</div></div>
    <div class="dr-ro">${lab("hours")}<div class="fig">${r.hours === null ? "n/a" : String(r.hours)}</div><div class="fine">${mark("measured")} first to last record</div></div>
  </div>`;
  const claimedKinds = d.assertions.length ? `<div class="dr-sec">${lab("claimed / what happened")}<div class="dr-rows">${d.assertions.map((a) => `<div class="dr-row claimed"><span class="subj" title="${esc(a.subject)}">${a.kind === "report_delivered" ? "report" : "session"}: ${esc(a.subject)}</span><span class="st ${a.verdict === "kept" ? "kept" : a.verdict === "gone" ? "gone" : ""}">${esc(a.verdict)}</span><span class="fine">${esc(a.reason)}</span></div>`).join("")}</div><div class="fine">${mark("estimated")} what the agent or session claimed; the verdict is measured against disk, git and later use</div></div>` : "";
  const outcome = `<div class="dr-sec">${lab("outcome")}<div><span class="outcome ${r.outcome.state === "died" ? "warn" : ""}"><span class="state">${esc(r.outcome.state)}</span></span> ${mark(r.outcome.mark)} <span class="fine">${esc(r.outcome.note)} · ${esc(r.outcome.source)}</span></div>${r.claimed ? `<div class="fine">claimed by /insights: ${esc(r.claimed.outcome)}${r.claimed.goal ? ` · ${esc(r.claimed.goal)}` : ""} ${mark(r.claimed.mark)}</div>` : ""}</div>`;
  const label = `<div class="dr-sec lbl">${lab("your label")}
    <div class="fine">${d.label ? `${esc(d.label.state)}${d.label.note && !redact ? ` · ${esc(d.label.note)}` : ""} · ${esc(dateTime(d.label.ts))} ${mark("founder-labelled")}` : "not labelled; the outcome above is measured from disk and git. Only you can say whether it mattered."}</div>
    <div class="lbl-states">${LABEL_STATES.map((st) => `<button type="button" class="btn sm" data-label="${st}" data-on="${d.label?.state === st ? "1" : "0"}">${st}</button>`).join("")}</div>
    <div class="lbl-row"><input type="text" id="lbl-note" placeholder="why, in one line" value="${esc(redact ? "" : d.label?.note ?? "")}"><button type="button" class="btn sm" id="lbl-save">save label</button></div>
    <span class="fine" id="lbl-msg">labels are append-only and stay on this machine; the report re-runs after saving</span>
  </div>`;
  const runs = d.runs.length ? `<div class="dr-sec">${lab(`${int(d.runs.length)} agent runs, drawn to time`)}${d.timeline ? `<div class="mini">${miniTimelineSvg(d.timeline)}</div>` : '<div class="fine">no run in this session has both a start and an end</div>'}
    <div class="dr-rows">${d.runs.map((x) => `<details class="dr-run"><summary class="runs"><span class="fine">d${x.depth}</span><span class="desc">${esc(x.description || x.agent_type || x.id.slice(0, 8))}${x.agent_type ? ` <span class="fine">${esc(x.agent_type)}</span>` : ""}</span><span class="num r">${x.minutes === null ? "n/a" : `${int(x.minutes)} min`}</span><span class="num r">${esc(money(x.cost_usd))} ${mark(x.cost_mark)}</span><span class="st ${x.fate === "died" ? "died" : x.fate === "landed_tracked" ? "kept" : ""}">${esc(x.fate.replace(/_/g, " "))}</span></summary><div class="dr-run-more"><div><span class="k">model</span> ${esc(x.model || "unknown")} \u00b7 ${x.spawned_by === "agent" ? "spawned by another agent" : "started by you"}${x.model && x.cost_mark === "assumed" ? ` \u00b7 rate ${mark("assumed")}` : ""}</div><div>${mark("measured")} ${esc(x.fate_evidence)}</div><div><span class="k">wrote</span> ${int(x.files_written)} file${x.files_written === 1 ? "" : "s"}${x.files_written && !redact ? `: ${x.files.map((f) => esc(f)).join(", ")}` : x.files_written ? " (paths hidden in this preview)" : ""}</div></div></details>`).join("")}</div>
    <div class="fine">${mark("measured")} fate by fixed rules, first match wins; cost ${mark(d.runs.some((x) => x.cost_mark === "assumed") ? "assumed" : "estimated")}</div></div>` : "";
  const files = `<div class="dr-sec">${lab(`${int(d.files.length)} files written`)}${d.files.length ? `<div class="dr-rows">${d.files.map((f) => `<div class="dr-row files"><span class="path" title="${esc(f.path)}">${esc(f.path)}</span><span class="fine">${f.by === "agent" ? "by agent" : "by session"}${f.writes > 1 ? ` ×${f.writes}` : ""}</span><span class="st ${f.on_disk ? "kept" : "gone"}">${f.on_disk ? "on disk" : "gone"}</span><span class="st">${f.tracked === null ? "outside repo" : f.tracked ? "tracked" : "untracked"}</span></div>`).join("")}</div>` : '<div class="fine">no Write or Edit call in this session</div>'}<div class="fine">${mark("measured")} on disk today; tracked when git ls-files lists it</div></div>`;
  const commits = `<div class="dr-sec">${lab(`${int(d.commits.length)} commits during the session`)}${d.commits.length ? `<div class="dr-rows">${d.commits.map((c) => `<div class="dr-row commits"><span class="path">${esc(c.sha.slice(0, 7))}</span><span class="subj" title="${esc(c.subject)}">${esc(c.subject)}</span><span class="fine">${esc(dayLabel(c.author_time))} ${esc(hm(c.author_time))}</span><span class="st ${c.reverted_by ? "gone" : c.attribution === "inside_session" ? "kept" : ""}">${c.reverted_by ? "reverted" : c.attribution === "inside_session" ? "inside" : "unattributed"}</span></div>`).join("")}</div>` : '<div class="fine">none in git log inside this window</div>'}<div class="fine">${mark("measured")} inside = author time in the window and a git commit issued within 5 minutes; unattributed commits are not the agent's</div></div>`;
  return `<div class="dr-head">${lab(`${esc(dayLabel(r.date))} · ${esc(r.tool.replace("_", " "))}${s.git_branch && !redact ? ` · branch ${esc(s.git_branch)}` : ""}${s.tool_version ? ` · ${esc(s.tool_version)}` : ""}`)}<h3>${esc(r.title)}</h3><div class="fine mono-sm">${esc(r.id)}</div></div>
${readouts}
${outcome}
${claimedKinds}
${label}
${runs}
${files}
${commits}`;
}

/**
 * Every session's pre-rendered drawer, keyed by id, for the self-contained interactive embed
 * (the landing shows the report and opens a drawer with no server). Always redacted: the embed
 * is a public surface.
 */
export function embedDrawers(stateDir: string, runId: string, report: Report, o: { repoPath: string }): Record<string, string> {
  const out: Record<string, string> = {};
  for (const s of report.sessions) {
    const d = sessionDetail(stateDir, runId, report, s.id, { repoPath: o.repoPath, redact: true });
    if (d) out[s.id] = d.html;
  }
  return out;
}
