/**
 * A tiny hand-written Claude Code fixture (one session, one subagent) shared by unit
 * tests and the G6/G7 measurers. Shapes mirror Claude Code 2.1.x on 2026-09-03.
 */
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

export interface TinyFixture { root: string; claudeRoot: string; repo: string; sessionId: string }

const line = (o: Record<string, unknown>) => JSON.stringify(o);
const base = (extra: Record<string, unknown>, sessionId: string, cwd: string, version: string) => ({ sessionId, cwd, gitBranch: "main", version, isSidechain: false, ...extra });
function assistant(sessionId: string, cwd: string, ts: string, requestId: string, blocks: unknown[], usage: Record<string, unknown>, model: string, version: string) {
  return blocks.map((b, i) => line(base({ type: "assistant", timestamp: ts, requestId, uuid: `${requestId}-${i}`, message: { id: `msg_${requestId}`, model, usage, content: [b] } }, sessionId, cwd, version)));
}

export function buildTinyFixture(opts: { version?: string; subagentVersion?: string } = {}): TinyFixture {
  const version = opts.version ?? "2.1.241";
  const subVersion = opts.subagentVersion ?? version;
  const root = realpathSync(mkdtempSync(path.join(tmpdir(), "actuals-tiny-")));
  const repo = path.join(root, "repo"); mkdirSync(repo);
  const claudeRoot = path.join(root, "claude"); const proj = path.join(claudeRoot, "projects", "-repo"); mkdirSync(proj, { recursive: true });
  const sessionId = "11111111-2222-3333-4444-555555555555";
  const usage = { input_tokens: 10, output_tokens: 100, cache_read_input_tokens: 1000, cache_creation_input_tokens: 500, cache_creation: { ephemeral_5m_input_tokens: 200, ephemeral_1h_input_tokens: 300 } };
  const lines: string[] = [];
  lines.push(line(base({ type: "user", timestamp: "2026-09-01T10:00:00.000Z", uuid: "u1", message: { role: "user", content: "Build the thing" } }, sessionId, repo, version)));
  lines.push(...assistant(sessionId, repo, "2026-09-01T10:00:05.000Z", "req1", [{ type: "thinking", thinking: "..." }, { type: "text", text: "Working." }, { type: "tool_use", id: "tu_agent", name: "Agent", input: { description: "Research X", subagent_type: "general-purpose", model: "sonnet", prompt: "go" } }], usage, "claude-opus-5", version));
  lines.push(line(base({ type: "user", timestamp: "2026-09-01T10:00:06.000Z", uuid: "u2", message: { role: "user", content: [{ type: "tool_result", tool_use_id: "tu_agent", content: "launched" }] } }, sessionId, repo, version)));
  lines.push(...assistant(sessionId, repo, "2026-09-01T10:10:00.000Z", "req2", [{ type: "tool_use", id: "tu_write", name: "Write", input: { file_path: path.join(repo, "kept.md"), content: "x" } }], usage, "claude-opus-5", version));
  lines.push(line(base({ type: "user", timestamp: "2026-09-01T10:10:01.000Z", uuid: "u3", message: { role: "user", content: [{ type: "tool_result", tool_use_id: "tu_write", content: "ok" }] } }, sessionId, repo, version)));
  lines.push(...assistant(sessionId, repo, "2026-09-01T10:11:00.000Z", "req3", [{ type: "tool_use", id: "tu_read1", name: "Read", input: { file_path: path.join(repo, "SPEC.md") } }], usage, "claude-opus-5", version));
  lines.push(...assistant(sessionId, repo, "2026-09-01T10:12:00.000Z", "req4", [{ type: "tool_use", id: "tu_read2", name: "Read", input: { file_path: path.join(repo, "SPEC.md") } }], usage, "claude-opus-5", version));
  lines.push("this is not json");
  lines.push(line(base({ type: "ai-title", aiTitle: "Build the thing (title)" }, sessionId, repo, version)));
  lines.push(...assistant(sessionId, repo, "2026-09-01T11:00:00.000Z", "req5", [{ type: "text", text: "Done." }], usage, "claude-zeta-9", version));
  writeFileSync(path.join(proj, `${sessionId}.jsonl`), lines.join("\n") + "\n");
  writeFileSync(path.join(repo, "kept.md"), "x");
  const sub = path.join(proj, sessionId, "subagents"); mkdirSync(sub, { recursive: true });
  const a: string[] = [];
  a.push(line(base({ type: "user", agentId: "abc", timestamp: "2026-09-01T10:00:07.000Z", isSidechain: true, message: { role: "user", content: "go" } }, sessionId, repo, subVersion)));
  a.push(...assistant(sessionId, repo, "2026-09-01T10:00:20.000Z", "reqA", [{ type: "tool_use", id: "tu_bash", name: "Bash", input: { command: "git commit -m x" } }], usage, "claude-sonnet-5", subVersion));
  writeFileSync(path.join(sub, "agent-abc.jsonl"), a.join("\n") + "\n");
  writeFileSync(path.join(sub, "agent-abc.meta.json"), JSON.stringify({ agentType: "general-purpose", description: "Research X", toolUseId: "tu_agent", spawnDepth: 1, model: "sonnet" }));
  return { root, claudeRoot, repo, sessionId };
}
