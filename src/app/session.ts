/**
 * One session, as the Workbench's main pane draws it: the meta line, the title, the one
 * sentence under it, "Did it matter?" with the label, the session's agents drawn to time, and
 * the runs table where a run opens to the files it wrote.
 *
 * Built from the ledger of the current run and rendered on the server, so every number carries
 * its mark and the browser only swaps HTML. The same function fills the embed, where the views
 * are inlined and the label is read-only.
 */
import path from "node:path";
import { CLAUDE_ROOT, isInside } from "../config.js";
import { readEntity, readLabels } from "../ledger/store.js";
import { timelineFor, type Timeline } from "../report/index.js";
import { dayLabel, esc, int, mark, money } from "../render/html.js";
import { RUN_FATE, RUN_FATE_INK, treeBlock } from "../render/workbench.js";
import type { Claim, Label, Run, Session, Truth, Verdict } from "../schema/ledger.js";
import type { Report } from "../schema/socket.js";

export interface FileRow { path: string; writes: number; by: "session" | "agent"; on_disk: boolean; tracked: boolean | null; verdict: "kept" | "gone" | "unknown"; group: FileGroup }
/** Where a file was written: inside the repository, somewhere else on disk, or under the user's own ~/.claude. */
export type FileGroup = "repo" | "outside" | "claude";
/** One file a run wrote, with what is true of it today. */
export interface RunFile { path: string; on_disk: boolean; tracked: boolean }
export interface RunRow { id: string; agent_type: string | null; description: string; depth: number; spawned_by: Run["spawned_by"]; model: string | null; started_at: string | null; ended_at: string | null; minutes: number | null; cost_usd: number; cost_mark: Run["cost_mark"]; fate: Run["fate"]; fate_evidence: string; files_written: number; files: RunFile[] }
export interface SessionDetail {
  session_id: string;
  row: Report["sessions"][number];
  files: FileRow[];
  runs: RunRow[];
  timeline: Timeline | null;
  label: Label | null;
  html: string;
}

const LABEL_STATES = ["kept", "retired", "dead", "open"] as const;

function relPath(p: string, repoPath: string, redact: boolean, claudeRoot: string = CLAUDE_ROOT): string {
  if (redact) return "(redacted)";
  if (isInside(p, repoPath)) return path.relative(repoPath, p) || ".";
  if (isInside(p, claudeRoot)) return path.join("~/.claude", path.relative(claudeRoot, p));
  return p;
}

/** Which of the three groups a written file belongs to, decided on the real path before redaction. */
function groupOf(p: string, repoPath: string, claudeRoot: string): FileGroup {
  if (isInside(p, repoPath)) return "repo";
  if (isInside(p, claudeRoot)) return "claude";
  return "outside";
}

/**
 * The end of a path when the whole of it is too long for the row: the last two segments, so the
 * file name is what the eye lands on instead of the home directory every row shares.
 */
export function pathTail(p: string, max = 46): string {
  if (p.length <= max) return p;
  const seg = p.split("/").filter(Boolean);
  if (seg.length <= 2) return p;
  return `…/${seg.slice(-2).join("/")}`;
}

export function sessionDetail(stateDir: string, runId: string, report: Report, sessionId: string, o: { repoPath: string; redact: boolean; claudeRoot?: string }): SessionDetail | null {
  const claudeRoot = o.claudeRoot ?? CLAUDE_ROOT;
  const row = report.sessions.find((s) => s.id === sessionId);
  const session = readEntity<Session>(stateDir, runId, "sessions").find((s) => s.id === sessionId);
  if (!row || !session) return null;
  const runs = readEntity<Run>(stateDir, runId, "runs").filter((r) => r.session_id === sessionId).sort((a, b) => (a.started_at ?? "").localeCompare(b.started_at ?? "") || a.depth - b.depth);
  const owners = new Set([sessionId, ...runs.map((r) => r.id)]);
  const claims = readEntity<Claim>(stateDir, runId, "claims").filter((c) => c.kind === "file_written" && owners.has(c.owner));
  const truths = new Map<string, Map<string, string>>();
  for (const t of readEntity<Truth>(stateDir, runId, "truths")) { if (!truths.has(t.claim_id)) truths.set(t.claim_id, new Map()); truths.get(t.claim_id)!.set(t.kind, t.value); }
  const verdicts = new Map(readEntity<Verdict>(stateDir, runId, "verdicts").map((v) => [v.claim_id, v.verdict]));
  const byPath = new Map<string, FileRow>();
  /** what is true of each real path today, so a redacted render still knows tracked from gone */
  const status = new Map<string, { on_disk: boolean; tracked: boolean }>();
  for (const c of claims) {
    const t = truths.get(c.id);
    const onDisk = t?.get("file_on_disk") === "yes";
    const tracked = t?.has("file_tracked") ? t.get("file_tracked") === "yes" : null;
    const verdict = verdicts.get(c.id) ?? "unknown";
    const was = status.get(c.subject);
    status.set(c.subject, { on_disk: (was?.on_disk ?? false) || onDisk, tracked: (was?.tracked ?? false) || tracked === true });
    const prev = byPath.get(c.subject);
    if (prev) { prev.writes += 1; prev.on_disk = prev.on_disk || onDisk; prev.tracked = prev.tracked || tracked; if (verdict === "kept") prev.verdict = "kept"; else if (prev.verdict === "unknown") prev.verdict = verdict; if (c.owner_kind === "run") prev.by = "agent"; }
    else byPath.set(c.subject, { path: relPath(c.subject, o.repoPath, o.redact, claudeRoot), writes: 1, by: c.owner_kind === "run" ? "agent" : "session", on_disk: onDisk, tracked, verdict, group: groupOf(c.subject, o.repoPath, claudeRoot) });
  }
  const files = [...byPath.values()].sort((a, b) => a.path.localeCompare(b.path));
  const runRows: RunRow[] = runs.map((r) => ({
    id: r.id, agent_type: o.redact ? null : r.agent_type, description: o.redact ? `run ${r.id.slice(0, 8)}` : r.description, depth: r.depth, spawned_by: r.spawned_by, model: r.model,
    started_at: r.started_at, ended_at: r.ended_at,
    minutes: r.started_at && r.ended_at ? Math.round((new Date(r.ended_at).getTime() - new Date(r.started_at).getTime()) / 60e3) : null,
    cost_usd: Math.round(r.cost_usd * 100) / 100, cost_mark: r.cost_mark, fate: r.fate, fate_evidence: r.fate_evidence,
    files_written: new Set(r.files_written).size,
    files: [...new Set(r.files_written)].map((f) => ({ path: relPath(f, o.repoPath, o.redact, claudeRoot), on_disk: status.get(f)?.on_disk ?? false, tracked: status.get(f)?.tracked ?? false })),
  }));
  const timeline = timelineFor({ id: sessionId, date: row.date, title: row.title }, runs, o.redact);
  const label = readLabels(stateDir).filter((l) => l.target === sessionId).at(-1) ?? null;
  const d: SessionDetail = { session_id: sessionId, row, files, runs: runRows, timeline, label, html: "" };
  d.html = renderSessionView(d, session, o.redact);
  return d;
}

/** The one sentence under the title: what this session left, in the words the list uses. */
function subline(r: Report["sessions"][number]): string {
  const files = (n: number) => `${int(n)} ${n === 1 ? "file" : "files"}`;
  const commits = (n: number) => `${int(n)} ${n === 1 ? "commit" : "commits"}`;
  if (r.files_tracked > 0 || r.commits > 0) return `${files(r.files_alive)} still in the repo, ${commits(r.commits)}.`;
  if (r.files_alive > 0) return `${files(r.files_alive)} on disk, none committed.`;
  return "No file survives, no commit.";
}

function outcomeInk(state: string, labelled: boolean): string {
  if (labelled) return "var(--mark)";
  if (state === "kept") return "var(--ink)";
  if (state === "on disk") return "var(--muted)";
  if (state === "died") return "var(--warn)";
  return "var(--faint)";
}

/** The tag beside a file a run wrote. */
function fileTag(f: RunFile): string {
  if (!f.on_disk) return "gone";
  return f.tracked ? "tracked" : "untracked";
}

/**
 * The session view. Exported so a test can render one without a server, and so the embed can
 * inline it.
 */
export function renderSessionView(d: SessionDetail, s: Session, redact: boolean): string {
  const r = d.row;
  const labelled = r.outcome.mark === "founder-labelled";
  const costMark = r.cost_mark ?? (s.cost_mark === "assumed" || d.runs.some((x) => x.cost_mark === "assumed") ? "assumed" : "estimated");
  const word = labelled ? `${r.outcome.state} · your label` : r.outcome.state;
  const meta = `<div class="wb-meta">
    <span>${esc(dayLabel(r.date))}</span>
    <span>${r.hours === null ? "no clock" : `${r.hours} h`}</span>
    <span>${esc(money(r.cost_usd))} ${mark(costMark)}</span>
    <span class="wb-out" style="color: ${outcomeInk(r.outcome.state, labelled)}">${esc(word)}</span>
  </div>`;

  const states = LABEL_STATES.map((st) => `<button type="button" class="wb-lbtn" data-label="${st}" data-on="${d.label?.state === st ? "1" : "0"}">${st}</button>`).join("");
  const labelBar = `<div class="wb-labelbar">
    <span class="wb-labelq">Did it matter?</span>
    <div class="wb-lstates">${states}</div>
    <input type="text" class="wb-lnote" placeholder="One line on why" value="${esc(redact ? "" : d.label?.note ?? "")}" aria-label="why, in one line">
    <button type="button" class="wb-lsave" id="wb-lsave" data-session="${esc(d.session_id)}" data-ready="${d.label ? "1" : "0"}">${d.label ? "saved" : "save label"}</button>
    <span class="wb-lmsg">${d.label ? `${esc(d.label.state)} ${mark("founder-labelled")}` : "only you can say whether it mattered; labels stay on this machine"}</span>
  </div>`;

  const tree = d.timeline && d.timeline.runs.length ? treeBlock(d.timeline, "measured") : "";

  const head = `<div class="wb-th"><span>#</span><span>agent run</span><span>min</span><span>cost ${mark(costMark)}</span><span>left behind</span></div>`;
  const runRow = (x: RunRow, i: number): string => {
    const model = x.model ? x.model.replace(/^claude-/, "") : (x.agent_type ?? "agent");
    const spawn = x.spawned_by === "agent" ? `depth ${int(x.depth)} · by agent` : "";
    const tracked = x.files.filter((f) => f.tracked).length;
    const filesHead = x.files.length
      ? `wrote ${int(x.files.length)} file${x.files.length === 1 ? "" : "s"} · ${int(tracked)} in git today`
      : "wrote no files";
    const paths = x.files.map((f) => `<div class="wb-rf"><span class="wb-rf-p${f.on_disk ? "" : " off"}">${esc(pathTail(f.path))}</span><span class="wb-rf-t">${fileTag(f)}</span></div>`).join("");
    return `<div class="wb-run">
      <button type="button" class="wb-run-head" aria-expanded="false">
        <span class="wb-rn">${i + 1}</span>
        <span class="wb-rmodel"><span>${esc(model)}</span>${spawn ? `<span class="wb-rspawn">${esc(spawn)}</span>` : ""}</span>
        <span class="wb-rmin">${x.minutes === null ? "n/a" : int(x.minutes)}</span>
        <span class="wb-rcostc">${esc(money(x.cost_usd))}</span>
        <span style="color: ${RUN_FATE_INK[x.fate] ?? "var(--muted)"}">${esc(RUN_FATE[x.fate] ?? x.fate.replace(/_/g, " "))}</span>
      </button>
      <div class="wb-run-files" hidden><div class="wb-rf-head">${esc(filesHead)}</div>${paths}</div>
    </div>`;
  };
  const runs = d.runs.length
    ? `<div class="wb-runs">${head}${d.runs.map(runRow).join("")}</div>`
    : `<div class="wb-runs"><div class="wb-noagents">No agents in this session. The main conversation did the work.</div></div>`;

  return `${meta}
<h1 class="wb-stitle">${esc(r.title)}</h1>
<p class="wb-sub">${esc(subline(r))}</p>
${labelBar}
${tree}
${runs}`;
}

/**
 * Every session's view, keyed by id, for the self-contained embed (a frame shows the report and
 * opens a session with no server). Always redacted: the embed is a public surface.
 */
export function embedDrawers(stateDir: string, runId: string, report: Report, o: { repoPath: string }): Record<string, string> {
  const out: Record<string, string> = {};
  for (const s of report.sessions) {
    const d = sessionDetail(stateDir, runId, report, s.id, { repoPath: o.repoPath, redact: true });
    if (d) out[s.id] = d.html;
  }
  return out;
}
