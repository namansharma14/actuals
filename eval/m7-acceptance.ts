/**
 * M7 acceptance latency harness (no CLI surface; run: npx tsx eval/m7-acceptance.ts
 * [live ledger path] [session-id prefix]).
 *
 * Replays a slice of a REAL live ledger through the same record() -> fs.watch path the hooks
 * use, into a scratch state dir the app serves, and measures from the in-process SSE stream:
 * a bar appears within two seconds of its start event, a bar turns warm within two seconds of
 * the SessionEnd that leaves it open, and the strip's cost ticks. Frames for the report are
 * captured separately by eval/m7-serve.ts + one headless Chrome (a live page never goes
 * network-idle, so a plain --screenshot on a held steady state is the capture path).
 *
 * The source session ran in VS Code, which emits no status line, so the cost statusline events
 * are synthesised (said so in the report). The three deaths are real: three subagents were
 * open when the session ended.
 */
import http from "node:http";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { startApp } from "../src/app/server.js";
import { runPipeline } from "../src/pipeline.js";
import { buildTinyFixture } from "../eval/fixtures/tiny.js";
import { record, LiveEvent } from "../src/watch/index.js";
import type { Scope } from "../src/config.js";

// argv[2]: a live ledger (events.ndjson); argv[3]: the id prefix of a session in it that
// ended with subagents open. Without them the burst falls back to three synthetic ids.
const LEDGER = process.argv[2] ?? path.join(process.env.HOME ?? "", ".actuals/live/events.ndjson");
const SESSION = process.argv[3] ?? "";
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** The subagents open at the session's end (real deaths). */
function deathBurst(): string[] {
  if (!existsSync(LEDGER) || !SESSION) return ["a0dae65636", "a678da4a64", "a33bb7bca8"];
  const evs = readFileSync(LEDGER, "utf8").split("\n").filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean) as Record<string, unknown>[];
  const ses = evs.filter((e) => String(e["session_id"]).startsWith(SESSION));
  const stopped = new Set(ses.filter((e) => e["kind"] === "agent_stop").map((e) => e["agent_id"]));
  return ses.filter((e) => e["kind"] === "agent_start" && !stopped.has(e["agent_id"])).map((e) => String(e["agent_id"])).slice(-3);
}

async function main(): Promise<void> {
  const fx = buildTinyFixture();
  const stateDir = path.join(fx.root, "state");
  const scope: Scope = { repoPath: fx.repo, repoId: "tiny", originUrl: null, allProjects: false, since: null, tools: ["claude_code"], redact: false, generous: false };
  await runPipeline(scope, { claudeRoot: fx.claudeRoot, stateDir, now: new Date("2026-09-02T00:00:00Z") });
  const app = await startApp({ scope, stateDir, claudeRoot: fx.claudeRoot, idleExitMs: null });
  const agents = deathBurst();
  console.log("replaying real subagents (deaths):", agents.join(", "), "from", existsSync(LEDGER) ? "the real ledger" : "fallback ids");

  const frames: Array<{ at: number; runs: Array<{ id: string; fate: string }>; cost: number | null }> = [];
  const url = new URL(app.url + "api/live/stream?token=" + app.token);
  const req = http.get({ hostname: url.hostname, port: url.port, path: url.pathname + url.search }, (res) => {
    res.setEncoding("utf8"); let buf = "";
    res.on("data", (c: string) => {
      buf += c; let i: number;
      while ((i = buf.indexOf("\n\n")) !== -1) {
        const line = buf.slice(0, i).split("\n").find((l) => l.startsWith("data:")); buf = buf.slice(i + 2);
        if (!line) continue;
        try { const s = JSON.parse(line.slice(5).trim()); const t = s.tree; frames.push({ at: Date.now(), runs: t ? t.runs.map((r: { id: string; fate: string }) => ({ id: r.id, fate: r.fate })) : [], cost: t ? t.cost_usd : null }); } catch { /* keepalive */ }
      }
    });
  });

  const rec = (kind: string, extra: Record<string, unknown>): number => {
    record(LiveEvent.parse({ v: 1, ts: new Date().toISOString(), session_id: "replay-m7", repo_id: "tiny", cwd: fx.repo, kind, ...extra }), { stateDir });
    return Date.now();
  };
  const cost = (c: number, p: number) => rec("statusline", { model: "claude-opus-5", cost_usd: c, context: { input: 1, output: 1, cache_read: 0, cache_write: 0, size: 200000, used_pct: p } });
  const started: Record<string, number> = {};

  await sleep(400); cost(0.15, 12);
  await sleep(600); started[agents[0]!] = rec("agent_start", { agent_id: agents[0], agent_type: "general-purpose" });
  await sleep(1100); started[agents[1]!] = rec("agent_start", { agent_id: agents[1], agent_type: "general-purpose" });
  await sleep(1100); started[agents[2]!] = rec("agent_start", { agent_id: agents[2], agent_type: "general-purpose" }); cost(0.62, 31);
  await sleep(900); cost(1.18, 44);
  const endAt = rec("session_end", { reason: "clear" }); // leaves all three open -> died
  await sleep(1400);

  const barAppear = (id: string): number | null => { const f = frames.find((fr) => fr.runs.some((r) => r.id === id)); return f ? f.at - started[id]! : null; };
  const warmAt = (id: string): number | null => { const f = frames.find((fr) => fr.runs.some((r) => r.id === id && r.fate === "died")); return f ? f.at - endAt : null; };
  console.log("\n=== measured latencies (record -> SSE frame) ===");
  for (const a of agents) console.log(`  bar ${a} appeared +${barAppear(a)}ms`, (barAppear(a) ?? 9e9) < 2000 ? "PASS(<2s)" : "FAIL");
  for (const a of agents) console.log(`  bar ${a} turned warm +${warmAt(a)}ms after SessionEnd`, (warmAt(a) ?? 9e9) < 2000 ? "PASS(<2s)" : "FAIL");
  const costs = frames.map((f) => f.cost).filter((c): c is number => c !== null);
  console.log("  cost series:", costs.join(" -> "), costs.length && costs[costs.length - 1]! > (costs[0] ?? 0) ? "PASS(ticks up)" : "FAIL");
  req.destroy(); await app.close();
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
