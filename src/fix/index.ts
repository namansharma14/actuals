/**
 * Fixer. Derives from the socket; applies on confirm; every fix is reversible.
 * Rules: show the diff, ask once, merge never overwrite, never touch settings.local.json,
 * idempotent on re-run, `undo` restores byte-identical from fixes/<id>/.
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { createInterface } from "node:readline";
import type { Report } from "../schema/socket.js";

export interface ApplyResult { applied: string[]; skipped: string[]; notes: string[] }
export interface FileChange { file: string; before: string | null; after: string }

const HOOK_FILE = ".claude/hooks/actuals-report-landed.mjs";
const HOOK_SCRIPT = `#!/usr/bin/env node
// Installed by actuals (fix f2-reports-land). SubagentStop hook: block a subagent's return
// when nothing landed under <cwd>/reports/ during the run. Exit 2 = block, stderr = reason.
// Primary check: a file under reports/ modified since the run started (any tool, any shell).
// Secondary: a Write/Edit tool call to reports/ in the agent transcript.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
let input = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (d) => { input += d; });
process.stdin.on("end", () => {
  let j = {};
  try { j = JSON.parse(input); } catch { process.exit(0); }
  if (j.stop_hook_active) process.exit(0);
  const cwd = j.cwd || process.cwd();
  const t = j.agent_transcript_path;
  let text = "";
  let startMs = Date.now() - 6 * 3600 * 1000;
  if (t) {
    try { text = readFileSync(t, "utf8"); } catch { /* no transcript: fall through to the directory check */ }
    const m = /"timestamp":"([^"]+)"/.exec(text);
    const parsed = m ? Date.parse(m[1]) : NaN;
    if (!Number.isNaN(parsed)) startMs = parsed;
    else { try { startMs = statSync(t).birthtimeMs || startMs; } catch { /* keep default */ } }
  }
  const dir = join(cwd, "reports");
  try {
    for (const f of readdirSync(dir)) {
      if (f.startsWith(".")) continue;
      const st = statSync(join(dir, f));
      if (st.isFile() && st.mtimeMs >= startMs - 60_000) process.exit(0);
    }
  } catch { /* no reports directory yet */ }
  if (text && text.includes('"file_path":"' + cwd + '/reports/')) process.exit(0);
  process.stderr.write("actuals: write your final report to reports/<date>-<slug>.md before returning. No file, no report.");
  process.exit(2);
});
`;

const CLAUDE_MD_RULE = "- Subagents write their final report to `reports/<date>-<slug>.md` before returning. No file, no report. (installed by actuals, fix f2-reports-land)";

function readJson(p: string): Record<string, unknown> {
  if (!existsSync(p)) return {};
  try { return JSON.parse(readFileSync(p, "utf8")) as Record<string, unknown>; } catch { throw new Error(`${p} is not valid JSON; fix it by hand first`); }
}

function planF1(repo: string, snippet: string): FileChange[] {
  const file = path.join(repo, ".claude", "settings.json");
  const cur = readJson(file);
  const env = (cur["env"] as Record<string, unknown> | undefined) ?? {};
  const want = (JSON.parse(snippet) as { env: Record<string, string> }).env;
  const next = { ...cur, env: { ...env, ...want } };
  const after = JSON.stringify(next, null, 2) + "\n";
  const before = existsSync(file) ? readFileSync(file, "utf8") : null;
  return before === after ? [] : [{ file, before, after }];
}

function planF2(repo: string): FileChange[] {
  const changes: FileChange[] = [];
  const md = path.join(repo, "CLAUDE.md");
  const mdBefore = existsSync(md) ? readFileSync(md, "utf8") : null;
  if (!mdBefore || !mdBefore.includes("fix f2-reports-land")) {
    const after = (mdBefore ? mdBefore.replace(/\s*$/, "\n\n") : "# CLAUDE.md\n\n") + "## Subagent rules (actuals)\n\n" + CLAUDE_MD_RULE + "\n";
    changes.push({ file: md, before: mdBefore, after });
  }
  const hook = path.join(repo, HOOK_FILE);
  const hookBefore = existsSync(hook) ? readFileSync(hook, "utf8") : null;
  if (hookBefore !== HOOK_SCRIPT) changes.push({ file: hook, before: hookBefore, after: HOOK_SCRIPT });
  const settings = path.join(repo, ".claude", "settings.json");
  const cur = readJson(settings);
  const hooks = (cur["hooks"] as Record<string, unknown[]> | undefined) ?? {};
  const list = (hooks["SubagentStop"] as Array<Record<string, unknown>> | undefined) ?? [];
  const already = JSON.stringify(list).includes(HOOK_FILE);
  if (!already) {
    const entry = { hooks: [{ type: "command", command: `node ${HOOK_FILE}` }] };
    const next = { ...cur, hooks: { ...hooks, SubagentStop: [...list, entry] } };
    const after = JSON.stringify(next, null, 2) + "\n";
    changes.push({ file: settings, before: existsSync(settings) ? readFileSync(settings, "utf8") : null, after });
  }
  return changes;
}


/** A readable line diff for one planned change (the diff the user confirms). */
export function diffOf(c: FileChange): string {
  const b = (c.before ?? "").split("\n"); const a = c.after.split("\n");
  const out = [`--- ${c.before === null ? "(new file)" : c.file}`, `+++ ${c.file}`];
  const max = Math.max(b.length, a.length);
  for (let i = 0; i < max; i++) { const x = b[i]; const y = a[i]; if (x === y) continue; if (x !== undefined) out.push(`- ${x}`); if (y !== undefined) out.push(`+ ${y}`); }
  return out.join("\n");
}

export async function confirm(question: string): Promise<boolean> {
  if (!process.stdin.isTTY) return false;
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const ans = await new Promise<string>((res) => rl.question(question, res));
  rl.close();
  return /^y(es)?$/i.test(ans.trim());
}

export function describeFixes(report: Report): string[] {
  return report.fixes.map((f) => `${f.id}: ${f.title}${f.available ? (f.opt_in ? " (opt in)" : "") : " (not available yet)"}\n    why: ${f.why}\n    target: ${f.target_file}`);
}

export function planFixes(report: Report, repoPath: string): Map<string, FileChange[]> {
  const plans = new Map<string, FileChange[]>();
  for (const f of report.fixes) {
    if (!f.available) continue;
    if (f.target_file.endsWith("settings.local.json")) continue; // never
    if (f.id === "f1-cap-tree") plans.set(f.id, planF1(repoPath, f.snippet));
    else if (f.id === "f2-reports-land") plans.set(f.id, planF2(repoPath));
  }
  return plans;
}

export async function applyFixes(report: Report, repoPath: string, stateDir: string, opts: { dryRun: boolean; yes: boolean; only?: string[] }): Promise<ApplyResult> {
  const result: ApplyResult = { applied: [], skipped: [], notes: [] };
  const optIn = new Set(report.fixes.filter((f) => f.opt_in).map((f) => f.id));
  const plans = planFixes(report, repoPath);
  for (const [id, changes] of plans) {
    // f1 applies by default; opt-in fixes (f2) only when named with `actuals fix <id>` (2026-09-06).
    if (opts.only) { if (!opts.only.includes(id)) continue; }
    else if (optIn.has(id)) { result.skipped.push(id); result.notes.push(`${id}: opt-in; run \`actuals fix ${id}\` to apply it, and name your reports folder if it is not reports/`); continue; }
    if (changes.length === 0) { result.skipped.push(id); result.notes.push(`${id}: already applied, nothing to change`); continue; }
    console.log(`\n${id}: ${changes.length} file${changes.length > 1 ? "s" : ""} would change`);
    for (const c of changes) console.log(diffOf(c));
    if (opts.dryRun) { result.skipped.push(id); continue; }
    const ok = opts.yes || (await confirm(`apply ${id}? [y/N] `));
    if (!ok) { result.skipped.push(id); result.notes.push(`${id}: not applied${process.stdin.isTTY ? "" : " (no TTY; pass --yes to apply)"}`); continue; }
    applyPlan(id, changes, stateDir);
    result.applied.push(id);
    result.notes.push(`${id}: applied; undo with \`actuals undo ${id}\``);
  }
  if (opts.dryRun) result.notes.push("dry run: nothing was changed; `actuals fix` applies with one confirm.");
  if (plans.size === 0) result.notes.push("no applicable fixes in the latest report");
  return result;
}

/**
 * Write a planned change set: the undo store first (so `undo` can restore byte-identical),
 * then the files. The confirm has already happened (TTY prompt, or the click in the app).
 */
export function applyPlan(id: string, changes: FileChange[], stateDir: string): string {
  const fixDir = path.join(stateDir, "fixes", `${id}-${new Date().toISOString().replace(/[:.]/g, "")}`);
  mkdirSync(fixDir, { recursive: true });
  const manifest = changes.map((c, i) => { const undo = path.join(fixDir, `undo-${i}`); if (c.before !== null) writeFileSync(undo, c.before); return { file: c.file, undo: c.before === null ? null : undo, after_sha256: sha256(c.after) }; });
  writeFileSync(path.join(fixDir, "manifest.json"), JSON.stringify({ id, applied_at: new Date().toISOString(), files: manifest }, null, 2));
  for (const c of changes) { mkdirSync(path.dirname(c.file), { recursive: true }); writeFileSync(c.file, c.after); }
  return fixDir;
}

/** Fix ids that have an undo store under <stateDir>/fixes/, newest application last. */
export function appliedFixIds(stateDir: string): string[] {
  const root = path.join(stateDir, "fixes");
  if (!existsSync(root)) return [];
  const ids = new Set<string>();
  for (const d of readdirSync(root).sort()) { const m = /^(.*)-\d{4}-\d{2}-\d{2}T\d+Z$/.exec(d); if (m && m[1]) ids.add(m[1]); }
  return [...ids];
}

const sha256 = (s: string | Buffer): string => createHash("sha256").update(s).digest("hex");

/**
 * Restore byte-identical from the undo store. If a file changed since the fix wrote it, the
 * user's later edits would be lost, so undo refuses unless forced and says which file.
 */
export async function undoFix(fixId: string, _repoPath: string, stateDir: string, opts: { force?: boolean } = {}): Promise<{ restored: string[]; notes: string[]; drifted: string[] }> {
  const root = path.join(stateDir, "fixes");
  if (!existsSync(root)) return { restored: [], notes: ["nothing to undo"], drifted: [] };
  const { rmSync } = await import("node:fs");
  const dirs = readdirSync(root).filter((d) => d.startsWith(fixId + "-")).sort();
  const last = dirs.at(-1);
  if (!last) return { restored: [], notes: [`no applied fix named ${fixId}`], drifted: [] };
  const manifest = JSON.parse(readFileSync(path.join(root, last, "manifest.json"), "utf8")) as { files: Array<{ file: string; undo: string | null; after_sha256?: string }> };
  const drifted = manifest.files.filter((f) => f.after_sha256 && existsSync(f.file) && sha256(readFileSync(f.file)) !== f.after_sha256).map((f) => f.file);
  if (drifted.length && !opts.force) return { restored: [], drifted, notes: [`${fixId}: ${drifted.length === 1 ? drifted[0] : `${drifted.length} files`} changed since the fix wrote ${drifted.length === 1 ? "it" : "them"}; not restored. Re-run with --force to restore the pre-fix copy anyway (edits made since would be lost).`] };
  const restored: string[] = [];
  for (const f of manifest.files) {
    if (f.undo === null) { if (existsSync(f.file)) rmSync(f.file); }
    else writeFileSync(f.file, readFileSync(f.undo));
    restored.push(f.file);
  }
  rmSync(path.join(root, last), { recursive: true, force: true });
  return { restored, drifted, notes: [`${fixId}: restored ${restored.length} file${restored.length === 1 ? "" : "s"} byte-identical${drifted.length ? " (forced over later edits)" : ""}`] };
}
