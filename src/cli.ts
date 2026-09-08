import { spawn } from "node:child_process";
import { copyFileSync, existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import os from "node:os";
import { CLAUDE_ROOT, STATE_ROOT, git, parseSince, repoIdFor, repoRoot, stateDirFor, type Scope } from "./config.js";
import { startApp } from "./app/server.js";
import { embedDrawers } from "./app/session.js";
import { applyFixes, describeFixes, undoFix } from "./fix/index.js";
import { appendLabel, latestRunId, readEntity, runDir } from "./ledger/store.js";
import { applyWatch, concurrencyCap, describeWatch, eventFrom, hudLine, isWatching, planWatch, previousStatusLineOutput, record, unwatch } from "./watch/index.js";
import { startHudServer } from "./watch/hud-server.js";
import { confirm } from "./fix/index.js";
import { clearLicence, DEFAULT_HOST, describeUpload, postLink, readLicence, redactedForUpload, saveLicence, uploadHosted } from "./hosted/index.js";
import { disconnectPairing, runLogin } from "./hosted/pair.js";
import { loadRates } from "./rates/index.js";
import { discover, KNOWN_CLAUDE_CODE_VERSIONS } from "./read/claude_code/index.js";
import { peekJsonLines, str as jstr } from "./read/jsonl.js";
import { codexStatus } from "./read/codex/index.js";
import { runPipeline } from "./pipeline.js";
import { renderShareSvg, renderShareText } from "./render/share.js";
import { renderHtml } from "./render/html.js";
import type { Session, Run } from "./schema/ledger.js";
import { LabelState } from "./schema/ledger.js";
import { ReportSchema, type Report } from "./schema/socket.js";

const HELP = `actuals: see what your coding agents actually shipped. Local. Nothing leaves your machine.

  npx actuals                 run on the current repo, open the app on 127.0.0.1 (loopback only)
  actuals run [--since 30d] [--all-projects] [--redact] [--generous] [--no-open] [--json]
  actuals app [--no-open] [--port N]   serve the latest report without re-running
  actuals export [--out <file>]        write the static report file (default ./actuals-report.html)
  actuals export --embed [--out <file>]   write the interactive, redacted, self-contained report (for an iframe)
  actuals export --ledger              the ledger as NDJSON on stdout
  actuals watch [--no-hud] [--yes]     always-on status line: a HUD plus hooks appending to a local live ledger
  actuals hud --serve [--port N] [--no-open]   open the live window (pin it beside the editor or in VS Code's Simple Browser)
  actuals unwatch                      remove them, byte-identical
  actuals fix [--dry-run] [--yes]     show fixes derived from your numbers, apply on confirm
  actuals undo <fix-id> [--force]      restore byte-identical; refuses if the file changed since, unless forced
  actuals share                        the aggregates-only card as share.svg and share.txt
  actuals share --hosted [--yes] [--sticker <png>]   upload the redacted report for a share link; shows what leaves first (works once the site update ships)
  actuals login [--no-open]            connect this computer to your account, no key to copy (works once the site update ships)
  actuals logout                       disconnect this computer, remove the stored key (works once the site update ships)
  actuals licence <key> | --clear      store a licence key by hand (for a headless machine or CI)
  actuals weekly                       a local weekly summary from the ledger
  actuals label <session|run id> kept|retired|dead|open "<note>"   mark what actually mattered
  actuals doctor                       what it can see and what it cannot
`;

function money(n: number | null): string { return n === null ? "n/a" : n >= 100 ? `$${Math.round(n).toLocaleString("en-US")}` : `$${n.toFixed(2)}`; }

function scopeFrom(values: Record<string, unknown>): Scope {
  const cwd = process.cwd();
  const repoPath = repoRoot(cwd) ?? cwd;
  const { repoId, originUrl } = repoIdFor(repoPath);
  return { repoPath, repoId, originUrl, allProjects: values["all-projects"] === true, since: parseSince(typeof values["since"] === "string" ? values["since"] : undefined), tools: ["claude_code"], redact: values["redact"] === true, generous: values["generous"] === true };
}

/** Baked in by the build (tsup define); undefined when run from source. */
declare const __ACTUALS_VERSION__: string | undefined;

/**
 * The package's own version. The build bakes it in; from source it is read from the
 * package.json one level above this file (src/ and dist/ both sit there). Never from
 * process.argv, which under npx is a symlink in another package's .bin.
 */
function cliVersion(): string {
  if (typeof __ACTUALS_VERSION__ === "string" && __ACTUALS_VERSION__) return __ACTUALS_VERSION__;
  try {
    const v = (JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { version?: unknown }).version;
    return typeof v === "string" ? v : "";
  } catch { return ""; }
}

/** A network failure should read as one sentence naming the host and the next step, never a Node error like "fetch failed". */
function netMessage(e: unknown, host: string): string {
  const m = e instanceof Error ? e.message : String(e);
  if (/fetch failed|ECONNREFUSED|ENOTFOUND|EAI_AGAIN|getaddrinfo|network|socket hang up|und_err|failed to fetch/i.test(m)) {
    return `could not reach ${host.replace(/^https?:\/\//, "")}; check your connection and try again.`;
  }
  return m;
}

function openFile(p: string): void {
  const cmd = process.platform === "darwin" ? "open" : process.platform === "win32" ? "start" : "xdg-open";
  try { spawn(cmd, [p], { detached: true, stdio: "ignore" }).unref(); } catch { /* not fatal */ }
}

/** Running inside VS Code (integrated terminal or the extension): Claude Code's status-line HUD
 * does not render there, so `watch` opens the app's Live tab instead (the control centre is the
 * HUD in VS Code). */
function isVsCode(): boolean {
  return process.env["TERM_PROGRAM"] === "vscode" || Object.keys(process.env).some((k) => k.startsWith("VSCODE_"));
}

/** Serve the app on loopback, open the browser unless told not to, and stay up until the page goes away or Ctrl-C. */
async function serveApp(scope: Scope, stateDir: string, runId: string | null, values: Record<string, unknown>): Promise<number> {
  const port = typeof values["port"] === "string" ? Number(values["port"]) : 0;
  if (!Number.isInteger(port) || port < 0 || port > 65535) { console.log("--port must be a whole number between 0 and 65535"); return 2; }
  const app = await startApp({ scope, stateDir, runId, port });
  console.log(`  app: ${app.url} (127.0.0.1 only; nothing leaves this machine) · Ctrl-C to stop`);
  if (values["no-open"] !== true) openFile(app.url);
  await app.idle;
  console.log("  page closed; stopped serving");
  return 0;
}

async function serveHud(values: Record<string, unknown>): Promise<number> {
  const scope = scopeFrom(values);
  const stateDir = stateDirFor(scope.repoId);
  const port = typeof values["port"] === "string" ? Number(values["port"]) : 0;
  if (!Number.isInteger(port) || port < 0 || port > 65535) { console.log("--port must be a whole number between 0 and 65535"); return 2; }
  const server = await startHudServer({ stateDir, repoPath: scope.repoPath, watching: isWatching(), port });
  console.log(`  hud: ${server.url} (127.0.0.1 only; reads the live ledger on this machine, nothing leaves it) \u00b7 Ctrl-C to stop`);
  if (!isWatching()) console.log("  note: watch is off, so the live window is empty. Run `actuals watch` in a terminal to start it.");
  if (values["no-open"] !== true) openFile(server.url);
  await server.idle;
  console.log("  window closed; stopped serving");
  return 0;
}

function latestReport(stateDir: string): { report: Report; runId: string } | null {
  const id = latestRunId(stateDir);
  if (!id) return null;
  const p = path.join(runDir(stateDir, id), "report.json");
  if (!existsSync(p)) return null;
  return { report: ReportSchema.parse(JSON.parse(readFileSync(p, "utf8"))), runId: id };
}

async function cmdRun(values: Record<string, unknown>): Promise<number> {
  const scope = scopeFrom(values);
  const t0 = Date.now();
  const res = await runPipeline(scope);
  const h = res.report.headline;
  const empty = res.ledger.sessions.length === 0;
  if (values["json"] === true) {
    console.log(JSON.stringify({ report: path.join(res.dir, "report.json"), html: res.htmlPath, sessions: res.ledger.sessions.length }));
    return empty ? 2 : 0;
  }
  if (empty) {
    // No sessions in this folder. Rather than a page of zeros and a dead end, open the app on
    // every project on this machine (the app widens automatically; the empty-folder default, 2026-09-06).
    if (values["no-open"] === true) {
      console.log(`actuals · ${scope.repoPath} · no Claude Code sessions in this folder.`);
      console.log("  Run `actuals` here without --no-open to open the app on every project on this machine, or run it inside the repository your agents worked in.");
      return 2;
    }
    console.log("No Claude Code sessions in this folder. Here is every project on this machine.");
    return serveApp(scope, res.stateDir, res.ledger.run_id, values);
  }
  console.log(`actuals · ${scope.repoPath} · ${res.report.share.period} · ran locally, nothing uploaded`);
  console.log(`  sessions ${res.ledger.sessions.length} · agent runs ${res.ledger.runs.length} · done in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  console.log(`  ${money(h.cost_usd.value)} of tokens at list rates [${h.cost_usd.mark}] · ${h.commits.value} commits [${h.commits.mark}] · ${money(h.cost_per_commit.value)} per commit`);
  console.log(`  ${h.files_alive.alive} of ${h.files_alive.written} files agents wrote are still on disk [${h.files_alive.mark}] · ${h.runs_no_fate.count} runs with no traceable fate [measured], ${money(h.runs_no_fate.cost_usd)} at list rates [estimated]`);
  if (res.ledger.warnings.length) console.log(`  ${res.ledger.warnings.length} warnings (see ${path.join(res.dir, "warnings.txt")})`);
  console.log(`  report: ${res.htmlPath}`);
  if (res.report.fixes.some((f) => f.available)) console.log(`  fixes: ${res.report.fixes.filter((f) => f.available).length} derived; run \`actuals fix\` to see them`);
  if (values["no-open"] === true) return 0;
  return serveApp(scope, res.stateDir, res.ledger.run_id, values);
}

async function cmdDoctor(): Promise<number> {
  const cwd = process.cwd();
  const repo = repoRoot(cwd);
  console.log(`actuals doctor · node ${process.version} · ${process.platform}`);
  console.log(`  repo: ${repo ?? "(not a git repository; scope would be the current directory)"}${repo ? ` · id ${repoIdFor(repo).repoId}` : ""}`);
  console.log(`  rates: ${loadRates().rates_version} (${loadRates().source})`);
  const projects = path.join(CLAUDE_ROOT, "projects");
  if (!existsSync(projects)) console.log(`  claude code: no transcripts at ${projects}`);
  else {
    let dirs = 0, files = 0, bytes = 0, subdirs = 0;
    for (const d of readdirSync(projects)) {
      const p = path.join(projects, d);
      try { if (!statSync(p).isDirectory()) continue; } catch { continue; }
      dirs += 1;
      for (const f of readdirSync(p)) { const fp = path.join(p, f); try { const st = statSync(fp); if (f.endsWith(".jsonl")) { files += 1; bytes += st.size; } else if (st.isDirectory() && existsSync(path.join(fp, "subagents"))) subdirs += 1; } catch { /* skip */ } }
    }
    console.log(`  claude code: ${files} sessions in ${dirs} project dirs, ${subdirs} with subagents, ${(bytes / 1e6).toFixed(0)} MB of session files (subagent files sit under each session directory) at ${projects}`);
    if (repo) {
      const scope: Scope = { repoPath: repo, repoId: repoIdFor(repo).repoId, originUrl: null, allProjects: false, since: null, tools: ["claude_code"], redact: false, generous: false };
      const { files: mine, warnings } = await discover(scope);
      const versions = new Set<string>();
      for (const f of mine.slice(0, 50)) { try { for (const line of await peekJsonLines(f.file, 40)) { const v = jstr(line["version"]); if (v) { versions.add(v); break; } } } catch { /* skip */ } }
      const drift = [...versions].filter((v) => !KNOWN_CLAUDE_CODE_VERSIONS.includes(v.split(".").slice(0, 2).join(".")));
      console.log(`  this repo: ${mine.length} sessions match by cwd · versions seen ${[...versions].sort().join(", ") || "none"}${drift.length ? ` · WARNING unpinned versions ${drift.join(", ")} (fixtures cover ${KNOWN_CLAUDE_CODE_VERSIONS.join(", ")})` : ""}`);
      for (const w of warnings) console.log(`  warning: ${w}`);
    }
    const facets = path.join(CLAUDE_ROOT, "usage-data", "facets");
    console.log(`  /insights output: ${existsSync(facets) ? `${readdirSync(facets).length} session facets (read as claims, marked)` : "not present (optional)"}`);
  }
  const cx = codexStatus();
  console.log(`  codex: ${cx.installed ? "" : "not installed · "}${cx.note}`);
  console.log(`  git: ${git(["--version"], cwd) ?? "not found"}`);
  console.log(`  state: ${STATE_ROOT} (${existsSync(STATE_ROOT) ? "exists" : "will be created"}; delete it to remove everything actuals stores)`);
  console.log(`  watch: ${isWatching() ? "on (statusline HUD and hooks installed; live ledger under each repo's state dir)" : "off (actuals watch installs the always-on status line)"}`);
  console.log("  network: none, except actuals login, logout and share --hosted, each only when you run it and each says what it sends first; telemetry: none");
  return 0;
}

function readStdin(): Promise<string> {
  return new Promise((resolve) => {
    if (process.stdin.isTTY) return resolve("");
    let s = ""; process.stdin.setEncoding("utf8");
    process.stdin.on("data", (c) => { s += c; }); process.stdin.on("end", () => resolve(s)); process.stdin.on("error", () => resolve(s));
  });
}
function parsePayload(raw: string): Record<string, unknown> | null {
  try { const j = JSON.parse(raw) as unknown; return j && typeof j === "object" && !Array.isArray(j) ? (j as Record<string, unknown>) : null; } catch { return null; }
}

function needLatest(): { stateDir: string; report: Report; runId: string } | null {
  const repo = repoRoot(process.cwd()) ?? process.cwd();
  const stateDir = stateDirFor(repoIdFor(repo).repoId);
  const l = latestReport(stateDir);
  if (!l) { console.log("No report yet for this repository. Run `actuals` first."); return null; }
  return { stateDir, ...l };
}

async function main(): Promise<number> {
  let parsed;
  try {
    parsed = parseArgs({
      args: process.argv.slice(2), allowPositionals: true, strict: true,
      options: { since: { type: "string" }, "all-projects": { type: "boolean" }, redact: { type: "boolean" }, generous: { type: "boolean" }, "no-open": { type: "boolean" }, json: { type: "boolean" }, "dry-run": { type: "boolean" }, yes: { type: "boolean" }, "no-hud": { type: "boolean" }, serve: { type: "boolean" }, force: { type: "boolean" }, hosted: { type: "boolean" }, sticker: { type: "string" }, clear: { type: "boolean" }, port: { type: "string" }, out: { type: "string" }, ledger: { type: "boolean" }, embed: { type: "boolean" }, version: { type: "boolean", short: "v" }, help: { type: "boolean", short: "h" } },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const m = /'(-{1,2}[^']+)'/.exec(msg);
    const opt = (m && m[1]) ? m[1] : "";
    const bare = opt.replace(/^-+/, "");
    const hint = bare && "since".startsWith(bare[0]!) ? " (did you mean --since?)" : "";
    console.log(opt ? `unknown option ${opt}${hint}. Run \`actuals --help\` for the options.` : `could not parse the arguments: ${msg}`);
    return 2;
  }
  const { values, positionals } = parsed;
  if (values["version"] === true) { console.log(cliVersion() || "unknown"); return 0; }
  const cmd = positionals[0] ?? "run";
  if (values["help"] === true || cmd === "help") { console.log(HELP); return 0; }
  if (typeof values["since"] === "string" && parseSince(values["since"]) === null) {
    console.log(`--since must look like 7d, 24h or 2w (a whole number then d, h or w); got "${values["since"]}".`);
    return 2;
  }
  switch (cmd) {
    case "run": return cmdRun(values);
    case "app": {
      const l = needLatest(); if (!l) return 2;
      return serveApp(scopeFrom(values), l.stateDir, l.runId, values);
    }
    case "doctor": return cmdDoctor();
    case "watch": {
      const plan = planWatch({ hud: values["no-hud"] !== true });
      if (plan.changes.length === 0) { console.log("watch is already installed; nothing to change"); return 0; }
      console.log(describeWatch(plan));
      console.log(`\nThis edits ${plan.settingsPath}: a statusline command (the HUD line: cost at list rates, context, agents against the cap, deaths) and hooks that append one line per event to ~/.actuals/<repo>/live/events.ndjson. No daemon, no network. \`actuals unwatch\` restores the file byte for byte.${plan.previousStatusLine ? " Your current statusline is kept and printed under ours." : ""}`);
      const ok = values["yes"] === true || (await confirm("install watch? [y/N] "));
      if (!ok) { console.log(`not installed${process.stdin.isTTY ? "" : " (no TTY; pass --yes to install)"}`); return 2; }
      applyWatch(plan);
      if (isVsCode()) {
        // The status line does not render in VS Code; open the app's Live tab as the HUD there.
        const scope = scopeFrom(values);
        const res = await runPipeline(scope);
        const port = typeof values["port"] === "string" ? Number(values["port"]) : 0;
        if (!Number.isInteger(port) || port < 0 || port > 65535) { console.log("--port must be a whole number between 0 and 65535"); return 2; }
        const app = await startApp({ scope, stateDir: res.stateDir, runId: res.ledger.run_id, port });
        console.log(`watch is on. In VS Code the status line lives at ${app.url}; pin it with Simple Browser: Show.`);
        if (values["no-open"] !== true) openFile(app.url + "#live");
        await app.idle;
        return 0;
      }
      console.log("watch is on. Start a new Claude Code session to see the HUD; the report picks up the live ledger on its next run.");
      return 0;
    }
    case "unwatch": {
      const r = await unwatch(undefined, { force: values["force"] === true });
      for (const n of r.notes) console.log(`  ${n}`);
      return 0;
    }
    case "hud": {
      if (values["serve"] === true) return serveHud(values);
      // Claude Code's statusline: never fail, always print one line
      const raw = await readStdin();
      try {
        const payload = parsePayload(raw) ?? {};
        const ev = eventFrom("statusline", payload);
        const st = ev ? record(ev) : null;
        const cwd = typeof payload["cwd"] === "string" ? (payload["cwd"] as string) : process.cwd();
        console.log(hudLine(st, concurrencyCap(cwd), payload));
        const prev = previousStatusLineOutput(raw); if (prev) console.log(prev);
      } catch (e) { console.log(`actuals · hud error: ${e instanceof Error ? e.message : String(e)}`); }
      return 0;
    }
    case "event": {
      // a hook: append one line to the live ledger, exit 0 whatever happens
      const name = positionals[1] ?? "";
      const payload = parsePayload(await readStdin());
      try { if (payload) { const ev = eventFrom(name, payload); if (ev) record(ev); } } catch { /* a hook must never stop Claude Code */ }
      return 0;
    }
    case "fix": {
      const l = needLatest(); if (!l) return 2;
      const only = positionals[1] ? [positionals[1]] : undefined;
      console.log(describeFixes(l.report).join("\n"));
      const r = await applyFixes(l.report, repoRoot(process.cwd()) ?? process.cwd(), l.stateDir, { dryRun: values["dry-run"] === true, yes: values["yes"] === true, only });
      for (const n of r.notes) console.log(`  ${n}`);
      if (r.applied.length) console.log(`applied: ${r.applied.join(", ")}`);
      return 0;
    }
    case "undo": {
      const id = positionals[1]; if (!id) { console.log("usage: actuals undo <fix-id>"); return 2; }
      const l = needLatest(); if (!l) return 2;
      const r = await undoFix(id, repoRoot(process.cwd()) ?? process.cwd(), l.stateDir, { force: values["force"] === true });
      for (const n of r.notes) console.log(`  ${n}`);
      if (r.restored.length) console.log(`restored: ${r.restored.join(", ")}`);
      return 0;
    }
    case "login": {
      try {
        const res = await runLogin({
          host: DEFAULT_HOST,
          device: os.hostname(),
          cli: cliVersion(),
          onStart: (s) => {
            console.log(`\n  actuals \u00b7 connect this computer to ${DEFAULT_HOST.replace(/^https?:\/\//, "")}`);
            console.log(`  code:    ${s.code}`);
            console.log(`  approve: ${s.url}`);
            console.log(values["no-open"] === true ? "  open that link and approve; waiting (Ctrl-C to stop)\n" : "  opening your browser; approve there. Waiting (Ctrl-C to stop)\n");
          },
          open: (url) => { if (values["no-open"] !== true) openFile(url); },
        });
        console.log(`  connected as ${res.handle}. Hosted runs from this computer are yours now; nothing else is sent.`);
        return 0;
      } catch (e) { console.log(`  ${netMessage(e, DEFAULT_HOST)}`); return 2; }
    }
    case "logout": {
      const key = readLicence();
      if (!key) { console.log("this computer is not connected."); return 0; }
      const ok = await disconnectPairing(DEFAULT_HOST, key);
      clearLicence();
      console.log(ok ? "disconnected; the stored key is removed here and revoked on the server." : "the stored key is removed here; the server could not be reached to revoke it (it will expire).");
      return 0;
    }
    case "licence": {
      if (values["clear"] === true) { console.log(clearLicence() ? "licence key removed" : "no licence key stored"); return 0; }
      const key = positionals[1];
      if (!key) { const cur = readLicence(); console.log(cur ? `a licence key is stored (${cur.slice(0, 6)}...). \`actuals licence --clear\` removes it.` : "Most people never need this: run `actuals login`. For a machine without a browser, create a key on your account page under connected computers."); return cur ? 0 : 2; }
      const p = saveLicence(key); console.log(`stored at ${p} (mode 600). It is sent only with \`actuals share --hosted\`.`); return 0;
    }
    case "share": {
      if (values["hosted"] === true) {
        // the one upload: re-run redacted in memory, show what leaves, one confirm, post
        const key = readLicence();
        if (!key) { console.log("not connected yet. Run `actuals login` first."); return 2; }
        const scope = { ...scopeFrom(values), redact: true };
        const res = await runPipeline(scope, { updateLatest: false });
        let report: Report;
        try { report = redactedForUpload(res.report); } catch (e) { console.log(e instanceof Error ? e.message : String(e)); return 2; }
        let sticker: Uint8Array | null = null;
        if (typeof values["sticker"] === "string" && values["sticker"]) { try { sticker = new Uint8Array(readFileSync(values["sticker"])); } catch { console.log(`cannot read ${values["sticker"]}`); return 2; } }
        for (const line of describeUpload(report, sticker, DEFAULT_HOST)) console.log(`  ${line}`);
        const ok = values["yes"] === true || (await confirm("upload this and get a share link? [y/N] "));
        if (!ok) { console.log(`not uploaded${process.stdin.isTTY ? "" : " (no TTY; pass --yes to upload)"}`); return 2; }
        try {
          const r = await uploadHosted({ host: DEFAULT_HOST, key, report, sticker });
          console.log(`share link: ${postLink(r.url)}`);
          console.log(`  ${r.charged === "free" ? `${r.free_runs_left} free hosted runs left` : r.charged === "credit" ? `${r.credits_left} credits left` : "on your plan"} · what left the machine: this redacted report${sticker ? " and one PNG" : ""}`);
          return 0;
        } catch (e) { console.log(netMessage(e, DEFAULT_HOST)); return 1; }
      }
      const l = needLatest(); if (!l) return 2;
      const dir = runDir(l.stateDir, l.runId);
      writeFileSync(path.join(dir, "share.svg"), renderShareSvg(l.report));
      const txt = renderShareText(l.report); writeFileSync(path.join(dir, "share.txt"), txt);
      console.log(txt); console.log(`\nsvg: ${path.join(dir, "share.svg")} (aggregates only)`);
      return 0;
    }
    case "weekly": {
      const l = needLatest(); if (!l) return 2;
      const sessions = readEntity<Session>(l.stateDir, l.runId, "sessions");
      const runs = readEntity<Run>(l.stateDir, l.runId, "runs");
      const cut = Date.now() - 7 * 86400e3;
      const week = l.report.sessions.filter((s) => new Date(s.date).getTime() >= cut);
      const cost = week.reduce((a, s) => a + s.cost_usd, 0); const commits = week.reduce((a, s) => a + s.commits, 0);
      const weekRuns = runs.filter((r) => r.started_at && new Date(r.started_at).getTime() >= cut);
      const landed = weekRuns.filter((r) => r.fate === "landed_tracked").length;
      const cheapest = week.filter((s) => s.commits > 0).sort((a, b) => a.cost_usd / a.commits - b.cost_usd / b.commits)[0];
      console.log(`This week: ${money(cost)} of tokens at list rates [estimated], ${commits} commits [measured], ${weekRuns.length} agent runs [measured]. ${landed} runs landed tracked files [measured].${cheapest ? ` Cheapest kept commit came from "${cheapest.title}" (${money(cheapest.cost_usd / cheapest.commits)} per commit [estimated]).` : ""}`);
      const unlabelled = week.filter((s) => s.outcome.mark !== "founder-labelled");
      if (unlabelled.length) { console.log(`\n${unlabelled.length} sessions this week have no label${unlabelled.length > 10 ? " (showing the first 10)" : ""}. Only you can say what they were worth:`); for (const s of unlabelled.slice(0, 10)) console.log(`  actuals label ${s.id.slice(0, 8)} kept|retired|dead|open "why"   # ${s.date} ${s.title.slice(0, 60)}`); }
      void sessions;
      return 0;
    }
    case "label": {
      const [, idArg, stateArg, ...noteParts] = positionals;
      const st = LabelState.safeParse(stateArg);
      if (!idArg || !st.success) { console.log('usage: actuals label <session|run id> kept|retired|dead|open "<note>"'); return 2; }
      const l = needLatest(); if (!l) return 2;
      const sessions = readEntity<Session>(l.stateDir, l.runId, "sessions"); const runs = readEntity<Run>(l.stateDir, l.runId, "runs");
      const s = sessions.find((x) => x.id.startsWith(idArg)); const r = runs.find((x) => x.id.startsWith(idArg));
      if (!s && !r) { console.log(`no session or run in the latest report starts with ${idArg}`); return 2; }
      const target = s ? s.id : r!.id;
      appendLabel(l.stateDir, { target, target_kind: s ? "session" : "run", state: st.data, note: noteParts.join(" "), ts: new Date().toISOString() });
      console.log(`labelled ${s ? "session" : "run"} ${target.slice(0, 8)} as ${st.data}. Re-run \`actuals\` to see it in the report.`);
      return 0;
    }
    case "export": {
      const l = needLatest(); if (!l) return 2;
      if (values["ledger"] === true) {
        const dir = path.join(runDir(l.stateDir, l.runId), "ledger");
        for (const f of readdirSync(dir).sort()) { const entity = f.replace(/\.ndjson$/, ""); for (const line of readFileSync(path.join(dir, f), "utf8").split("\n")) if (line.trim()) console.log(JSON.stringify({ entity, ...(JSON.parse(line) as object) })); }
        return 0;
      }
      if (values["embed"] === true) {
        // the interactive embed: the report plus every session's drawer, inlined, no server. It
        // is a public surface, so it is built from a fresh REDACTED run (redacted titles, blanked
        // goals, no paths), never from whatever the latest run happened to be. A landing iframe
        // opens a drawer with ?session=<id> and jumps with ?panel=top|session|fixes.
        const scope = { ...scopeFrom(values), redact: true };
        const res = await runPipeline(scope, { updateLatest: false });
        const drawers = embedDrawers(res.stateDir, res.ledger.run_id, res.report, { repoPath: scope.repoPath });
        const html = renderHtml(res.report, { redact: true, embed: { drawers } });
        const outEmbed = path.resolve(typeof values["out"] === "string" && values["out"] ? values["out"] : "actuals-embed.html");
        writeFileSync(outEmbed, html);
        console.log(`wrote ${outEmbed} (interactive, redacted, self-contained; open with ?session=<id> and ?panel=top|session|fixes)`);
        return 0;
      }
      // the static file (D13): the same report, no script, for sending or printing
      const src = path.join(runDir(l.stateDir, l.runId), "report.html");
      if (!existsSync(src)) { console.log("the latest run has no report.html; run `actuals` first"); return 2; }
      const out = path.resolve(typeof values["out"] === "string" && values["out"] ? values["out"] : "actuals-report.html");
      copyFileSync(src, out);
      console.log(`wrote ${out} (static, no script; holds session titles and paths unless the run used --redact)`);
      return 0;
    }
    default: console.log(`unknown command "${cmd}". Run \`actuals --help\` for the commands.\n`); console.log(HELP); return 2;
  }
}

main().then((code) => process.exit(code)).catch((e: unknown) => { console.error(e instanceof Error ? e.message : String(e)); process.exit(1); });
