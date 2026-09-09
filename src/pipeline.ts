/**
 * read → normalise → join → grade → report → render. Each stage writes one
 * `stages` row. The run directory is the unit of idempotence.
 */
import { mkdirSync, realpathSync, writeFileSync } from "node:fs";
import path from "node:path";
import { CLAUDE_ROOT, stateDirFor, type Scope } from "./config.js";
import { grade } from "./grade/index.js";
import { join } from "./join/index.js";
import { newRunId, readLabels, runDir, writeLedger } from "./ledger/store.js";
import { read as readClaudeCode } from "./read/claude_code/index.js";
import { mergeLive } from "./read/live.js";
import { isWatching, liveSummary } from "./watch/index.js";
import { renderHtml } from "./render/html.js";
import { renderStickerSvg, stickerNumbers } from "./render/sticker.js";
import { buildReport } from "./report/index.js";
import { emptyLedger, type Ledger } from "./schema/ledger.js";
import type { Report } from "./schema/socket.js";

export interface PipelineResult { ledger: Ledger; report: Report; dir: string; htmlPath: string; stateDir: string }

export async function runPipeline(scopeIn: Scope, opts: { now?: Date; stateDir?: string; claudeRoot?: string; updateLatest?: boolean; watchStore?: string } = {}): Promise<PipelineResult> {
  // one normalisation for every caller: transcripts may record symlinked paths (macOS /tmp)
  let repoPath = scopeIn.repoPath;
  try { repoPath = realpathSync(scopeIn.repoPath); } catch { /* keep as given */ }
  const scope: Scope = { ...scopeIn, repoPath, repoPathGiven: scopeIn.repoPathGiven ?? scopeIn.repoPath };
  const now = opts.now ?? new Date();
  const runId = newRunId(now);
  const stateDir = opts.stateDir ?? stateDirFor(scope.repoId);
  const ledger = emptyLedger(runId);
  const stage = async <T>(name: string, fn: () => Promise<T> | T, rows: (r: T) => number): Promise<T> => {
    const started = new Date();
    const r = await fn();
    ledger.stages.push({ run_id: runId, stage: name, started_at: started.toISOString(), ended_at: new Date().toISOString(), rows: rows(r), warnings: [] });
    return r;
  };

  const readOut = await stage("read", () => readClaudeCode(scope, runId, scope.repoId, opts.claudeRoot ?? CLAUDE_ROOT), (r) => r.sessions.length + r.runs.length);
  ledger.sessions = readOut.sessions; ledger.runs = readOut.runs; ledger.turns = readOut.turns; ledger.tool_calls = readOut.tool_calls; ledger.claims = readOut.claims;
  ledger.warnings.push(...readOut.warnings);
  // the live ledger (D14): sessions the transcripts lost, writes the transcripts missed
  const live = await stage("live", () => {
    const m = mergeLive(stateDir, runId, scope.repoId, ledger.sessions, ledger.claims);
    const added = scope.sessionIds ? m.sessions_added.filter((s) => scope.sessionIds!.includes(s.id)) : m.sessions_added;
    for (const s of ledger.sessions) { const c = m.live_costs[s.id]; if (typeof c === "number") s.cost_live_usd = c; }
    ledger.sessions.push(...added); ledger.claims.push(...m.claims_added);
    if (m.skipped > 0) ledger.warnings.push(`live ledger: ${m.skipped} line${m.skipped === 1 ? "" : "s"} not in a known event shape (a newer or older actuals wrote them); skipped, never guessed`);
    return { ...m, sessions_added: added };
  }, (m) => m.sessions_added.length + m.claims_added.length);
  await stage("normalise", () => { ledger.labels = readLabels(stateDir); return ledger.labels.length; }, (n) => n);
  const joined = await stage("join", () => join(ledger, scope, now), (j) => j.commits.length + j.truths.length);
  ledger.commits = joined.commits; ledger.truths = joined.truths; ledger.warnings.push(...joined.warnings);
  const graded = await stage("grade", () => grade(ledger, now), (g) => g.runs.length + g.verdicts.length);
  ledger.runs = graded.runs; ledger.verdicts = graded.verdicts;
  const summary = liveSummary(stateDir);
  const report = await stage("report", () => buildReport(ledger, scope, { generatedAt: now, versions: readOut.versions, claudeRoot: opts.claudeRoot, redact: scope.redact, live: { watching: isWatching(opts.watchStore), events: live.events, sessions_live_only: live.sessions_added.length, compactions: live.compactions, first_event: summary.first } }), () => 1);
  const dir = runDir(stateDir, runId);
  mkdirSync(dir, { recursive: true });
  const htmlPath = path.join(dir, "report.html");
  await stage("render", () => {
    writeFileSync(path.join(dir, "report.json"), JSON.stringify(report, null, 2));
    writeFileSync(htmlPath, renderHtml(report, { redact: scope.redact }));
    writeFileSync(path.join(dir, "share.svg"), renderStickerSvg(report));
    writeFileSync(path.join(dir, "share.txt"), stickerNumbers(report).text);
    return 4;
  }, (n) => n);
  writeLedger(stateDir, ledger, { updateLatest: opts.updateLatest });
  return { ledger, report, dir, htmlPath, stateDir };
}
