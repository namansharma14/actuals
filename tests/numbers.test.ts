import { execFile, execFileSync } from "node:child_process";
import http from "node:http";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { netMessage } from "../src/hosted/index.js";
import { buildNumbersPayload, countNumbers, describeNumbers, numbersPath, readNumbersSetting, shareAfterRun, writeNumbersSetting } from "../src/numbers/index.js";
import { runPipeline } from "../src/pipeline.js";
import type { Scope } from "../src/config.js";
import { buildTinyFixture } from "../eval/fixtures/tiny.js";

/** A loopback stand-in for the site's POST /api/numbers. */
function mockSite(): Promise<{ origin: string; seen: Array<{ url: string; method: string; body: Record<string, unknown> }>; close: () => void }> {
  const seen: Array<{ url: string; method: string; body: Record<string, unknown> }> = [];
  return new Promise((resolve) => {
    const srv = http.createServer((req, res) => {
      let raw = ""; req.on("data", (c) => { raw += c; }); req.on("end", () => {
        let body: Record<string, unknown> = {};
        try { body = JSON.parse(raw) as Record<string, unknown>; } catch { /* the route would answer 422 */ }
        seen.push({ url: req.url ?? "", method: req.method ?? "", body });
        res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify({ ok: true }));
      });
    });
    srv.listen(0, "127.0.0.1", () => resolve({ origin: `http://127.0.0.1:${(srv.address() as { port: number }).port}`, seen, close: () => srv.close() }));
  });
}

/** The mock lives in this process, so a send from a child is only answered while the event
 * loop is free: every test that expects a request runs the CLI asynchronously. */
function cliAsync(args: string[], cwd: string, env: NodeJS.ProcessEnv): Promise<string> {
  return new Promise((resolve) => {
    execFile("npx", ["tsx", path.join(process.cwd(), "src/cli.ts"), ...args], { cwd, env, encoding: "utf8" }, (_e, stdout) => resolve(stdout));
  });
}

const closers: Array<() => void> = [];
afterAll(() => { for (const c of closers) c(); });

const SPEC_KEYS = [
  "v", "install_id", "tool_version", "claude_code_version", "node", "os", "arch", "editor", "scope",
  "period_days", "sessions", "agent_runs", "cost_usd", "commits", "cost_per_commit", "files_written",
  "files_alive", "runs_no_fate", "runs_died", "peak_concurrency", "max_depth", "models", "watch_on",
  "fixes_applied", "run_ms",
];

/** Version strings, the two enums, model ids and fix ids: every string the payload may carry. */
const ALLOWED_STRING = /^(v?\d+[0-9a-z.\-+]*|terminal|vscode|repo|all|darwin|linux|win32|freebsd|x64|arm64|arm|ia32|[a-z0-9][a-z0-9-]*\d?|[0-9a-f]{32})$/;

async function runTiny(): Promise<{ fx: ReturnType<typeof buildTinyFixture>; stateDir: string; root: string; scope: Scope; res: Awaited<ReturnType<typeof runPipeline>> }> {
  const fx = buildTinyFixture();
  const stateDir = path.join(fx.root, "state");
  const root = path.join(fx.root, "state-root"); mkdirSync(root, { recursive: true });
  const scope: Scope = { repoPath: fx.repo, repoId: "tiny", originUrl: null, allProjects: false, since: null, tools: ["claude_code"], redact: false, generous: false };
  const res = await runPipeline(scope, { claudeRoot: fx.claudeRoot, stateDir, now: new Date("2026-09-02T00:00:00Z") });
  return { fx, stateDir, root, scope, res };
}

const shareOpts = (t: Awaited<ReturnType<typeof runTiny>>, host: string) => ({
  report: t.res.report, scope: t.scope, stateDir: t.stateDir, sessions: t.res.ledger.sessions,
  editor: "terminal" as const, watchOn: false, runMs: 1234, root: t.root, host,
});

describe("numbers sharing", () => {
  it("sends nothing at all when nobody has said yes", async () => {
    const site = await mockSite(); closers.push(site.close);
    const t = await runTiny();
    expect(readNumbersSetting(t.root)).toBeNull();
    const r = await shareAfterRun(shareOpts(t, site.origin));
    expect(r.sent).toBe(false);
    expect(r.payload).toBeNull();
    expect(site.seen).toHaveLength(0);
    // and the file is not written behind the user's back
    expect(existsSync(numbersPath(t.root))).toBe(false);
  });

  it("the run command opens no connection and prints neither the star line nor the question when the setting is not there", async () => {
    const site = await mockSite(); closers.push(site.close);
    const fx = buildTinyFixture();
    execFileSync("git", ["init", "-q"], { cwd: fx.repo });
    const state = path.join(fx.root, "cli-state");
    const env = { ...process.env, ACTUALS_CLAUDE_DIR: fx.claudeRoot, ACTUALS_STATE_DIR: state, ACTUALS_HOST: site.origin, ACTUALS_HOME_OVERRIDE: fx.root };
    const r = await cliAsync(["run", "--no-open"], fx.repo, env);
    expect(r).toContain("report:");
    expect(r).toContain("ran locally, nothing uploaded");
    expect(r).not.toContain("a star helps others find it");
    expect(r).not.toContain("share your numbers after every run?");
    expect(r).not.toContain("shared:");
    expect(site.seen).toHaveLength(0);
    expect(existsSync(path.join(state, "numbers.json"))).toBe(false);
  });

  it("with sharing on, posts exactly one payload of numbers and allowlisted words", async () => {
    const site = await mockSite(); closers.push(site.close);
    const t = await runTiny();
    const setting = writeNumbersSetting(t.root, { share: true, asked_at: "2026-09-15T00:00:00.000Z" });
    expect(setting.install_id).toMatch(/^[0-9a-f]{32}$/);
    const r = await shareAfterRun(shareOpts(t, site.origin));
    expect(r.sent).toBe(true);
    expect(site.seen).toHaveLength(1);
    expect(site.seen[0]!.method).toBe("POST");
    expect(site.seen[0]!.url).toBe("/api/numbers");
    const body = site.seen[0]!.body;
    expect(Object.keys(body).sort()).toEqual([...SPEC_KEYS].sort());
    expect(body["install_id"]).toBe(setting.install_id);
    expect(String(body["install_id"])).toMatch(/^[0-9a-f]{32}$/);
    expect(body["v"]).toBe(1);
    expect(body["editor"]).toBe("terminal");
    expect(body["scope"]).toBe("repo");
    expect(body["watch_on"]).toBe(false);
    expect(body["run_ms"]).toBe(1234);
    expect(body["sessions"]).toBe(1);
    const leaf = (v: unknown): void => {
      if (v === null || typeof v === "number" || typeof v === "boolean") return;
      expect(typeof v).toBe("string");
      expect(String(v)).toMatch(ALLOWED_STRING);
    };
    for (const [k, v] of Object.entries(body)) {
      if (k === "models") { for (const m of v as Array<Record<string, unknown>>) { expect(Object.keys(m).sort()).toEqual(["model", "runs"]); leaf(m["model"]); expect(typeof m["runs"]).toBe("number"); } continue; }
      if (k === "fixes_applied") { for (const id of v as unknown[]) leaf(id); continue; }
      leaf(v);
    }
    expect(countNumbers(r.payload!)).toBe(Object.keys(body).length - 2 + (body["models"] as unknown[]).length * 2 + (body["fixes_applied"] as unknown[]).length);
  });

  it("carries no word from the transcripts, the repository or this machine", async () => {
    const t = await runTiny();
    const setting = writeNumbersSetting(t.root, { share: true, asked_at: "2026-09-15T00:00:00.000Z" });
    const payload = buildNumbersPayload(t.res.report, { installId: setting.install_id, scope: t.scope, stateDir: t.stateDir, sessions: t.res.ledger.sessions, editor: "terminal", watchOn: false, runMs: 12 });
    const json = JSON.stringify(payload);
    const forbidden = [
      "Build the thing", "Research X", "kept.md", "SPEC.md", "git commit -m x", "main",
      t.fx.repo, t.fx.root, t.fx.sessionId, t.res.report.repo_path, t.res.report.repo_id,
      os.hostname(), os.userInfo().username,
    ];
    for (const s of t.res.ledger.sessions) { forbidden.push(s.title, s.project_path, s.source_file); if (s.first_prompt) forbidden.push(s.first_prompt); if (s.git_branch) forbidden.push(s.git_branch); }
    for (const c of t.res.ledger.commits) forbidden.push(c.subject, c.sha);
    for (const w of new Set(forbidden)) if (w && w.length > 2) expect(json).not.toContain(w);
    // the report holds those words; the payload is the aggregates only
    const reportJson = readFileSync(path.join(t.res.dir, "report.json"), "utf8");
    expect(reportJson).toContain("Build the thing");
    // and what the user is shown is the payload itself, with the sentence that says what is never in it
    const lines = describeNumbers(payload, "https://example.test").join("\n");
    expect(lines).toContain("https://example.test/api/numbers");
    expect(lines).toContain(JSON.stringify(payload, null, 2));
    expect(lines).toContain("never: a prompt, a path, a file name, a title, a label note, a commit message, a repository name or remote, a branch, a hostname, a username.");
    expect(lines).not.toContain("—");
  });

  it("a host that cannot be reached is one sentence, and the run goes on", async () => {
    const site = await mockSite(); const origin = site.origin; site.close(); // a closed port
    const t = await runTiny();
    writeNumbersSetting(t.root, { share: true, asked_at: "2026-09-15T00:00:00.000Z" });
    const r = await shareAfterRun(shareOpts(t, origin));
    expect(r.sent).toBe(false);
    expect(r.error).toBeDefined();
    const sentence = netMessage(r.error, origin);
    expect(sentence).toBe(`could not reach ${origin.replace(/^https?:\/\//, "")}; check your connection and try again.`);
    expect(sentence).not.toContain("\n"); // one sentence, not a stack trace
    expect(sentence).not.toContain("fetch failed");
  });

  it("once it is on, the run command sends after every run and says so on one line", async () => {
    const site = await mockSite(); closers.push(site.close);
    const fx = buildTinyFixture();
    execFileSync("git", ["init", "-q"], { cwd: fx.repo });
    const state = path.join(fx.root, "cli-state");
    const env = { ...process.env, ACTUALS_CLAUDE_DIR: fx.claudeRoot, ACTUALS_STATE_DIR: state, ACTUALS_HOST: site.origin, ACTUALS_HOME_OVERRIDE: fx.root };
    const cli = (...args: string[]) => cliAsync(args, fx.repo, env);
    expect(await cli("run", "--no-open")).toContain("ran locally, nothing uploaded");
    expect(site.seen).toHaveLength(0);
    const on = await cli("share", "--numbers", "--yes");
    expect(on).toContain(`shared: 25 numbers to 127.0.0.1:${new URL(site.origin).port} (actuals share --numbers --off to stop)`);
    expect(site.seen).toHaveLength(1);
    expect(readNumbersSetting(state)!.share).toBe(true);
    const again = await cli("run", "--no-open");
    expect(again).toContain("· ran locally · shared 25 numbers");
    expect(again).toContain("(actuals share --numbers --off to stop)");
    expect(site.seen).toHaveLength(2);
    expect(site.seen.every((x) => x.url === "/api/numbers" && x.method === "POST")).toBe(true);
    expect(site.seen[1]!.body["install_id"]).toBe(site.seen[0]!.body["install_id"]);
    expect(typeof site.seen[1]!.body["run_ms"]).toBe("number");
    expect(await cli("doctor")).toContain("numbers sharing: on · install id ");
    // and off stops it again
    expect(await cli("share", "--numbers", "--off")).toContain("numbers sharing is off");
    expect(await cli("run", "--no-open")).toContain("ran locally, nothing uploaded");
    expect(site.seen).toHaveLength(2);
  });

  it("--show prints the numbers and sends nothing; --off turns it off", async () => {
    const site = await mockSite(); closers.push(site.close);
    const fx = buildTinyFixture();
    execFileSync("git", ["init", "-q"], { cwd: fx.repo });
    const state = path.join(fx.root, "cli-state");
    const env = { ...process.env, ACTUALS_CLAUDE_DIR: fx.claudeRoot, ACTUALS_STATE_DIR: state, ACTUALS_HOST: site.origin, ACTUALS_HOME_OVERRIDE: fx.root };
    const cli = (...args: string[]) => cliAsync(args, fx.repo, env);
    expect(await cli("run", "--no-open")).toContain("report:");
    const show = await cli("share", "--numbers", "--show");
    expect(show).toContain("/api/numbers");
    expect(show).toContain("never: a prompt, a path");
    expect(show).toContain("nothing was sent");
    expect(site.seen).toHaveLength(0);
    const setting = readNumbersSetting(state);
    expect(setting!.install_id).toMatch(/^[0-9a-f]{32}$/);
    expect(setting!.share).toBe(false);
    expect(setting!.asked_at).toBeNull();
    const off = await cli("share", "--numbers", "--off");
    expect(off).toContain("numbers sharing is off");
    expect(off).toContain("Nothing leaves your machine unless you choose to share your numbers, and you see them first.");
    expect(readNumbersSetting(state)!.share).toBe(false);
    expect(site.seen).toHaveLength(0);
    const doctor = await cli("doctor");
    expect(doctor).toContain(`numbers sharing: off · install id ${setting!.install_id}`);
    expect(doctor).toContain("rm -rf ~/.actuals` deletes the id");
  });
});

describe("the setting file", () => {
  it("writes the install id once, keeps it across patches, and never derives it from the machine", () => {
    const root = path.join(buildTinyFixture().root, "state-root");
    expect(readNumbersSetting(root)).toBeNull();
    const a = writeNumbersSetting(root, { star_shown_at: "2026-09-15T00:00:00.000Z" });
    expect(a.install_id).toMatch(/^[0-9a-f]{32}$/);
    expect(a.share).toBe(false);
    expect(a.asked_at).toBeNull();
    const b = writeNumbersSetting(root, { share: true, asked_at: "2026-09-15T01:00:00.000Z" });
    expect(b.install_id).toBe(a.install_id);
    expect(b.star_shown_at).toBe("2026-09-15T00:00:00.000Z");
    expect(writeNumbersSetting(root, { share: false }).share).toBe(false);
    const raw = readFileSync(numbersPath(root), "utf8");
    expect(raw).not.toContain(os.hostname());
    expect(raw).not.toContain(os.userInfo().username);
  });
});
