/**
 * Claude Code reader. Verified against Claude Code 2.1.241 on 2026-09-03.
 *
 * Facts this reader depends on (observed, the format is officially internal):
 * - one JSONL line per content block; every line of one API request repeats the same
 *   message.usage and shares requestId and message.id. Usage is counted ONCE per request.
 * - subagent transcripts live at <session>/subagents/agent-<id>.jsonl with a .meta.json
 *   {agentType, description, toolUseId, spawnDepth, model}; toolUseId matches the `Agent`
 *   tool_use block in the parent (the session, or another subagent for depth 2+).
 */
import { existsSync, readdirSync, readFileSync, realpathSync, statSync } from "node:fs";
import path from "node:path";
import { CLAUDE_ROOT, isInside, worktreeRoots, type Scope } from "../../config.js";
import { resolveRate, costOf, loadRates } from "../../rates/index.js";
import { emptyUsage, addUsage, type Claim, type Run, type Session, type ToolCall, type Turn, type Usage, type Mark } from "../../schema/ledger.js";
import { readJsonLines, peekJsonLines, str, num, rec, arr } from "../jsonl.js";

export interface SourceFile {
  file: string;
  sessionId: string;
  projectDir: string;
  cwd: string | null;
  mtime: Date;
}

export interface ReadOutput {
  sessions: Session[];
  runs: Run[];
  turns: Turn[];
  tool_calls: ToolCall[];
  claims: Claim[];
  warnings: string[];
  versions: string[];
  files_seen: number;
  bytes_seen: number;
}

interface ToolUse { id: string; name: string; ts: string; input: Record<string, unknown> }
interface Parsed {
  ownerId: string;
  ownerKind: "session" | "run";
  file: string;
  cwds: Set<string>;
  versions: Set<string>;
  gitBranch: string | null;
  entrypoint: string | null;
  firstPrompt: string;
  aiTitle: string | null;
  start: string | null;
  end: string | null;
  turns: Array<{ ts: string; model: string; usage: Usage }>;
  toolUses: ToolUse[];
  results: Set<string>;
  lastAssistantToolUseId: string | null;
  lastAssistantWasToolUse: boolean;
  lastText: string;
  bad: number;
  bytes: number;
  agentId: string | null;
}

const KNOWN_VERSIONS = ["2.1"];

/** Compare real paths: a transcript may record a symlinked cwd (macOS /var vs /private/var). */
function real(p: string): string { try { return realpathSync(p); } catch { return p; } }

/** Claude Code names a project directory after the path with separators replaced by "-". */
export function slugFor(p: string): string { return p.replace(/[\\/:.]/g, "-"); } // fixtures pinned per major.minor under eval/fixtures/claude_code/

function usageOf(u: Record<string, unknown>): Usage {
  const cc = rec(u["cache_creation"]);
  const creation = num(u["cache_creation_input_tokens"]);
  const w5 = cc ? num(cc["ephemeral_5m_input_tokens"]) : 0;
  const w1 = cc ? num(cc["ephemeral_1h_input_tokens"]) : 0;
  const split = cc !== null && w5 + w1 > 0;
  return {
    input: num(u["input_tokens"]),
    output: num(u["output_tokens"]),
    cache_read: num(u["cache_read_input_tokens"]),
    // no split → price everything as a 5m write (the cheaper rate; undercount rule)
    cache_write_5m: split ? w5 : creation,
    cache_write_1h: split ? w1 : 0,
  };
}

async function parseFile(file: string, ownerKind: "session" | "run", ownerId: string): Promise<Parsed> {
  const p: Parsed = {
    ownerId, ownerKind, file, cwds: new Set(), versions: new Set(), gitBranch: null, entrypoint: null, firstPrompt: "", aiTitle: null,
    start: null, end: null, turns: [], toolUses: [], results: new Set(), lastAssistantToolUseId: null, lastAssistantWasToolUse: false,
    lastText: "", bad: 0, bytes: 0, agentId: null,
  };
  const seenReq = new Set<string>();
  for await (const line of readJsonLines(file)) {
    p.bytes += line.bytes;
    const o = line.obj;
    if (!o) { p.bad += 1; continue; }
    const type = str(o["type"]);
    const ts = str(o["timestamp"]);
    if (ts) {
      if (!p.start || ts < p.start) p.start = ts;
      if (!p.end || ts > p.end) p.end = ts;
    }
    const cwd = str(o["cwd"]); if (cwd) p.cwds.add(cwd);
    const v = str(o["version"]); if (v) p.versions.add(v);
    const gb = str(o["gitBranch"]); if (gb) p.gitBranch = gb;
    const ep = str(o["entrypoint"]); if (ep && !p.entrypoint) p.entrypoint = ep;
    const aid = str(o["agentId"]); if (aid) p.agentId = aid;
    if (type === "ai-title") { p.aiTitle = str(o["aiTitle"]); continue; }
    const message = rec(o["message"]);
    if (type === "assistant" && message) {
      const usage = rec(message["usage"]);
      const model = str(message["model"]) ?? "unknown";
      const key = str(o["requestId"]) ?? str(message["id"]) ?? str(o["uuid"]) ?? `line:${line.n}`;
      if (usage && !seenReq.has(key)) {
        seenReq.add(key);
        p.turns.push({ ts: ts ?? p.end ?? "", model, usage: usageOf(usage) });
      }
      for (const b of arr(message["content"])) {
        const blk = rec(b); if (!blk) continue;
        const bt = str(blk["type"]);
        if (bt === "text") {
          const t = str(blk["text"]) ?? "";
          if (t.trim()) p.lastText = t;
          p.lastAssistantWasToolUse = false;
        } else if (bt === "tool_use") {
          const id = str(blk["id"]) ?? `tu:${line.n}`;
          p.toolUses.push({ id, name: str(blk["name"]) ?? "?", ts: ts ?? "", input: rec(blk["input"]) ?? {} });
          p.lastAssistantToolUseId = id;
          p.lastAssistantWasToolUse = true;
        }
      }
      continue;
    }
    if (type === "user" && message) {
      const content = message["content"];
      if (typeof content === "string") {
        if (!p.firstPrompt && o["isMeta"] !== true && o["isSidechain"] !== true && !content.startsWith("<")) {
          p.firstPrompt = content.replace(/\s+/g, " ").trim().slice(0, 160);
        }
      } else {
        for (const b of arr(content)) {
          const blk = rec(b); if (!blk) continue;
          if (str(blk["type"]) === "tool_result") {
            const id = str(blk["tool_use_id"]); if (id) p.results.add(id);
            if (p.lastAssistantToolUseId === id) p.lastAssistantWasToolUse = false;
          } else if (str(blk["type"]) === "text" && !p.firstPrompt && o["isMeta"] !== true && o["isSidechain"] !== true) {
            const t = str(blk["text"]) ?? "";
            if (t.trim() && !t.startsWith("<")) p.firstPrompt = t.replace(/\s+/g, " ").trim().slice(0, 160);
          }
        }
      }
    }
  }
  return p;
}

function kindOf(name: string): ToolCall["kind"] {
  if (name === "Write") return "write";
  if (name === "Edit" || name === "NotebookEdit" || name === "MultiEdit") return "edit";
  if (name === "Read") return "read";
  if (name === "Bash") return "bash";
  if (name === "Agent" || name === "Task") return "spawn";
  return "other";
}

function pathOf(tu: ToolUse): string | null {
  return str(tu.input["file_path"]) ?? str(tu.input["notebook_path"]) ?? null;
}

export async function discover(scope: Scope, claudeRoot = CLAUDE_ROOT): Promise<{ files: SourceFile[]; warnings: string[] }> {
  const roots = scope.allProjects ? [] : worktreeRoots(scope.repoPath);
  const warnings: string[] = [];
  const projects = path.join(claudeRoot, "projects");
  if (!existsSync(projects)) return { files: [], warnings: [`no Claude Code project directory at ${projects}`] };
  const files: SourceFile[] = [];
  for (const dir of readdirSync(projects)) {
    const projectDir = path.join(projects, dir);
    let entries: string[] = [];
    try { if (!statSync(projectDir).isDirectory()) continue; entries = readdirSync(projectDir); } catch (e) { warnings.push(`cannot read ${projectDir}: ${(e as Error).message}`); continue; }
    for (const name of entries) {
      if (!name.endsWith(".jsonl")) continue;
      const file = path.join(projectDir, name);
      let mtime: Date;
      try { mtime = statSync(file).mtime; } catch { continue; }
      if (scope.since && mtime < scope.since) continue;
      const head = await peekJsonLines(file, 40);
      const cwd = head.map((h) => str(h["cwd"])).find((c): c is string => !!c) ?? null;
      const sessionId = head.map((h) => str(h["sessionId"])).find((c): c is string => !!c) ?? name.replace(/\.jsonl$/, "");
      if (scope.sessionIds && !scope.sessionIds.includes(sessionId)) continue;
      if (!scope.allProjects) {
        // match by the cwd recorded inside the transcript; the directory slug is a fallback
        // only for a file that records no cwd at all (e.g. a zero-turn session)
        const cwds = new Set(head.map((h) => str(h["cwd"])).filter((c): c is string => !!c));
        if (cwds.size > 0) {
          if (![...cwds].some((c) => roots.some((rt) => isInside(real(c), rt)))) continue;
        } else if (![...roots, scope.repoPath, real(scope.repoPath), scope.repoPathGiven ?? scope.repoPath].map(slugFor).includes(dir)) continue; // a no-cwd session matches any worktree slug
      }
      files.push({ file, sessionId, projectDir, cwd: cwd ? real(cwd) : null, mtime });
    }
  }
  files.sort((a, b) => a.file.localeCompare(b.file));
  return { files, warnings };
}

/**
 * report_delivered (D16): a deliverable asserted in the final assistant text that the owner did
 * NOT back with a Write/Edit. A named path the owner wrote is file_written, not this; ambiguous
 * prose yields nothing (undercount). Returns each subject: a path, or "(in chat)" for a no-path
 * deliverable when the owner wrote nothing at all.
 */
export function deliveredFrom(text: string, written: string[]): string[] {
  if (!text) return [];
  const deliver = /\b(wrote|created|saved|delivered|produced|generated|prepared|attached|written to|report is (?:at|in|ready)|summary below|here (?:is|are)|here's)\b/i;
  if (!deliver.test(text)) return [];
  const base = (p: string) => p.split("/").pop() ?? p;
  const backed = (p: string) => written.some((w) => w === p || w.endsWith("/" + p) || base(w) === base(p));
  const out: string[] = [];
  const seen = new Set<string>();
  const paths = text.match(/[A-Za-z0-9_.\-/]*\/[A-Za-z0-9_.\-/]+\.[A-Za-z0-9]{1,6}|\b[A-Za-z0-9_-]+\.(?:md|txt|json|csv|pdf|html?|ya?ml|rst|docx?)\b/g) ?? [];
  for (const raw of paths) {
    const p = raw.replace(/^\.\//, "").replace(/[).,;:]+$/, "");
    if (seen.has(p) || backed(p)) continue;
    seen.add(p);
    out.push(p);
  }
  if (out.length === 0 && written.length === 0 && /\b(summary|report|analysis|findings|review|overview|breakdown|write-?up|recap|rundown)\b/i.test(text)) out.push("(in chat)");
  return out.slice(0, 5);
}

export async function read(scope: Scope, runId: string, repoId: string, claudeRoot = CLAUDE_ROOT): Promise<ReadOutput> {
  const out: ReadOutput = { sessions: [], runs: [], turns: [], tool_calls: [], claims: [], warnings: [], versions: [], files_seen: 0, bytes_seen: 0 };
  const rates = loadRates();
  const { files, warnings } = await discover(scope, claudeRoot);
  out.warnings.push(...warnings);
  const versions = new Set<string>();

  for (const sf of files) {
    const main = await parseFile(sf.file, "session", sf.sessionId);
    out.files_seen += 1; out.bytes_seen += main.bytes;
    main.versions.forEach((v) => versions.add(v));

    // subagents
    const subDir = path.join(sf.projectDir, sf.sessionId, "subagents");
    const parsedRuns: Array<{ p: Parsed; meta: Record<string, unknown> | null; agentId: string }> = [];
    if (existsSync(subDir)) {
      for (const name of readdirSync(subDir).sort()) {
        if (!name.endsWith(".jsonl")) continue;
        const agentId = name.replace(/^agent-/, "").replace(/\.jsonl$/, "");
        const metaPath = path.join(subDir, name.replace(/\.jsonl$/, ".meta.json"));
        let meta: Record<string, unknown> | null = null;
        if (existsSync(metaPath)) { try { meta = rec(JSON.parse(readFileSync(metaPath, "utf8"))); } catch { out.warnings.push(`bad meta.json: ${metaPath}`); } }
        const p = await parseFile(path.join(subDir, name), "run", agentId);
        out.files_seen += 1; out.bytes_seen += p.bytes;
        p.versions.forEach((v) => versions.add(v));
        parsedRuns.push({ p, meta, agentId });
      }
    }

    // join: toolUseId → the file that issued the Agent call
    const issuer = new Map<string, { ownerId: string; ownerKind: "session" | "run"; call: ToolUse }>();
    for (const tu of main.toolUses) if (kindOf(tu.name) === "spawn") issuer.set(tu.id, { ownerId: sf.sessionId, ownerKind: "session", call: tu });
    for (const r of parsedRuns) for (const tu of r.p.toolUses) if (kindOf(tu.name) === "spawn") issuer.set(tu.id, { ownerId: r.agentId, ownerKind: "run", call: tu });

    const emit = (p: Parsed, ownerKind: "session" | "run", ownerId: string): { usage: Usage; cost: number; mark: Mark; models: Record<string, number>; files: string[] } => {
      let usage = emptyUsage(); let cost = 0; let mark: Mark = "estimated"; const models: Record<string, number> = {};
      for (const t of p.turns) {
        const r = resolveRate(t.model, rates);
        const c = costOf(t.usage, r.rate);
        const nonzero = t.usage.input + t.usage.output + t.usage.cache_read + t.usage.cache_write_5m + t.usage.cache_write_1h > 0;
        if (r.mark === "assumed" && nonzero) mark = "assumed";
        usage = addUsage(usage, t.usage); cost += c; models[t.model] = (models[t.model] ?? 0) + 1;
        out.turns.push({ run_id: runId, owner: ownerId, owner_kind: ownerKind, ts: t.ts, model: t.model, usage: t.usage, cost_usd: c, rate_version: rates.rates_version, rate_mark: r.mark });
      }
      const files = new Set<string>();
      for (const tu of p.toolUses) {
        const kind = kindOf(tu.name);
        const fp = pathOf(tu);
        const cmd = kind === "bash" ? (str(tu.input["command"]) ?? "") : null;
        out.tool_calls.push({ run_id: runId, owner: ownerId, owner_kind: ownerKind, ts: tu.ts, tool_use_id: tu.id, name: tu.name, kind, path: fp, command: cmd ? cmd.slice(0, 400) : null, has_result: p.results.has(tu.id) });
        if ((kind === "write" || kind === "edit") && fp) {
          files.add(fp);
          out.claims.push({ run_id: runId, id: `fw:${ownerId}:${tu.id}`, kind: "file_written", owner: ownerId, owner_kind: ownerKind, subject: fp, ts: tu.ts, source: "transcript" });
        }
        if (kind === "bash" && cmd && /\bgit\s+commit\b/.test(cmd)) {
          out.claims.push({ run_id: runId, id: `cm:${ownerId}:${tu.id}`, kind: "commit_made", owner: ownerId, owner_kind: ownerKind, subject: cmd.slice(0, 200), ts: tu.ts, source: "transcript" });
        }
      }
      return { usage, cost, mark, models, files: [...files] };
    };

    const m = emit(main, "session", sf.sessionId);
    const title = main.aiTitle ?? (main.firstPrompt || `session ${sf.sessionId.slice(0, 8)}`);
    out.sessions.push({
      run_id: runId, id: sf.sessionId, tool: "claude_code", project_path: sf.cwd ?? [...main.cwds][0] ?? "", repo_id: repoId, source_file: sf.file,
      started_at: main.start, ended_at: main.end, tool_version: [...main.versions].sort().at(-1) ?? null, entrypoint: main.entrypoint,
      first_prompt: main.firstPrompt, title: title.slice(0, 120), git_branch: main.gitBranch, models: m.models, turns: main.turns.length,
      usage: m.usage, cost_usd: m.cost, cost_mark: m.mark, bad_lines: main.bad,
    });
    for (const d of deliveredFrom(main.lastText, m.files)) out.claims.push({ run_id: runId, id: `rd:${sf.sessionId}:${d}`, kind: "report_delivered", owner: sf.sessionId, owner_kind: "session", subject: d, ts: main.end ?? "", source: "final_text" });
    try {
      const facetPath = path.join(claudeRoot, "usage-data", "facets", `${sf.sessionId}.json`);
      if (existsSync(facetPath)) {
        const facet = JSON.parse(readFileSync(facetPath, "utf8")) as Record<string, unknown>;
        const outcome = typeof facet["outcome"] === "string" ? facet["outcome"] : null;
        if (outcome) out.claims.push({ run_id: runId, id: `so:${sf.sessionId}`, kind: "session_outcome", owner: sf.sessionId, owner_kind: "session", subject: outcome, ts: main.end ?? "", source: "insights_facet" });
      }
    } catch { /* facets are optional */ }

    const runRows = new Map<string, Run>();
    for (const r of parsedRuns) {
      const toolUseId = r.meta ? str(r.meta["toolUseId"]) : null;
      const from = toolUseId ? issuer.get(toolUseId) : undefined;
      const e = emit(r.p, "run", r.agentId);
      const description = (r.meta ? str(r.meta["description"]) : null) ?? (from ? str(from.call.input["description"]) : null) ?? "";
      const modelFromTurns = Object.entries(e.models).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
      const unanswered = r.p.lastAssistantWasToolUse && r.p.lastAssistantToolUseId !== null && !r.p.results.has(r.p.lastAssistantToolUseId);
      const row: Run = {
        run_id: runId, id: r.agentId, session_id: sf.sessionId, parent_run_id: from && from.ownerKind === "run" ? from.ownerId : null,
        depth: r.meta && typeof r.meta["spawnDepth"] === "number" ? (r.meta["spawnDepth"] as number) : from && from.ownerKind === "run" ? 2 : 1,
        spawned_by: from && from.ownerKind === "run" ? "agent" : "user",
        agent_type: (r.meta ? str(r.meta["agentType"]) : null) ?? (from ? str(from.call.input["subagent_type"]) : null),
        description: description.slice(0, 120), model: modelFromTurns ?? (r.meta ? str(r.meta["model"]) : null), source_file: r.p.file,
        started_at: r.p.start, ended_at: r.p.end, turns: r.p.turns.length, usage: e.usage, cost_usd: e.cost, cost_mark: e.mark,
        final_text_chars: r.p.lastText.length, final_text_sample: r.p.lastText.replace(/\s+/g, " ").slice(0, 240), files_written: e.files,
        spawned: r.p.toolUses.filter((t) => kindOf(t.name) === "spawn").length, last_tool_call_unanswered: unanswered, fate: "unknown", fate_evidence: "",
      };
      runRows.set(r.agentId, row);
      if (row.final_text_chars >= 300) out.claims.push({ run_id: runId, id: `rf:${r.agentId}`, kind: "run_finished", owner: r.agentId, owner_kind: "run", subject: row.description, ts: r.p.end ?? "", source: "transcript" });
      for (const d of deliveredFrom(r.p.lastText, e.files)) out.claims.push({ run_id: runId, id: `rd:${r.agentId}:${d}`, kind: "report_delivered", owner: r.agentId, owner_kind: "run", subject: d, ts: r.p.end ?? "", source: "final_text" });
      if (!from && toolUseId) out.warnings.push(`run ${r.agentId}: toolUseId ${toolUseId} not found in any parent file`);
      if (!r.meta) out.warnings.push(`run ${r.agentId}: no meta.json (recovered from the parent call where possible)`);
    }
    // depth from the parent chain when meta has none
    for (const row of runRows.values()) {
      if (row.parent_run_id && runRows.has(row.parent_run_id)) {
        const parent = runRows.get(row.parent_run_id)!;
        if (row.depth <= parent.depth) row.depth = parent.depth + 1;
      }
    }
    out.runs.push(...runRows.values());
  }
  out.versions = [...versions].sort();
  for (const v of out.versions) {
    const mm = v.split(".").slice(0, 2).join(".");
    if (!KNOWN_VERSIONS.includes(mm)) out.warnings.push(`schema drift: Claude Code ${v} has no pinned fixture (known: ${KNOWN_VERSIONS.join(", ")}); parsed anyway, numbers may be off`);
  }
  return out;
}

/**
 * The list-rate cost of one transcript file, counted once per request (a response's content
 * blocks share a requestId and message.usage), priced by rates.json. The same dedupe the
 * report uses, so the HUD window can show a cost for a session whose statusline never ran
 * (the VS Code extension renders no statusline). Cheap enough to call per poll behind an
 * mtime cache; a bad line is skipped, never fatal.
 */
export async function costOfTranscript(file: string, rates = loadRates()): Promise<number> {
  const seen = new Set<string>();
  let cost = 0;
  try {
    for await (const { n, obj } of readJsonLines(file)) {
      if (!obj || str(obj["type"]) !== "assistant") continue;
      const message = rec(obj["message"]);
      if (!message) continue;
      const usage = rec(message["usage"]);
      if (!usage || Object.keys(usage).length === 0) continue;
      const key = str(obj["requestId"]) ?? str(message["id"]) ?? str(obj["uuid"]) ?? ("line:" + n);
      if (seen.has(key)) continue;
      seen.add(key);
      const model = str(message["model"]) ?? "unknown";
      cost += costOf(usageOf(usage), resolveRate(model, rates).rate);
    }
  } catch { /* an unreadable transcript prices as far as it got */ }
  return cost;
}

export const KNOWN_CLAUDE_CODE_VERSIONS = KNOWN_VERSIONS;
