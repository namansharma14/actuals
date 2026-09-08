/**
 * The live ledger, read back into the pipeline (D14). Two jobs: sessions the transcripts no
 * longer have (cleaned up) become minimal rows marked live; file writes the hooks saw that
 * the transcripts do not carry (compaction, cleanup) become claims with source "live",
 * deduplicated by tool_use_id. Every added row says where it came from.
 */
import type { Claim, Session } from "../schema/ledger.js";
import { listStates, readLiveLedger, type LiveSessionState } from "../watch/index.js";

export interface LiveMerge { sessions_added: Session[]; claims_added: Claim[]; compactions: Record<string, number>; events: number; sessions_seen: number; skipped: number; /** session id -> the cost Claude Code's statusline reported, for every live state that has one */ live_costs: Record<string, number> }

const WRITERS = new Set(["Write", "Edit", "MultiEdit", "NotebookEdit"]);

export function mergeLive(stateDir: string, runId: string, repoId: string, sessions: Session[], claims: Claim[]): LiveMerge {
  const { events, skipped } = readLiveLedger(stateDir);
  const known = new Set(sessions.map((s) => s.id));
  const knownToolUse = new Set(claims.map((c) => c.id.split(":").at(-1)));
  const states = new Map<string, LiveSessionState>(listStates(stateDir).map((s) => [s.session_id, s]));
  const compactions: Record<string, number> = {};
  const claims_added: Claim[] = [];
  const seen = new Set<string>();
  for (const e of events) {
    seen.add(e.session_id);
    if (e.kind === "pre_compact") compactions[e.session_id] = (compactions[e.session_id] ?? 0) + 1;
    if (e.kind === "tool" && e.path && e.tool_use_id && e.tool_name && WRITERS.has(e.tool_name) && !knownToolUse.has(e.tool_use_id)) {
      knownToolUse.add(e.tool_use_id);
      claims_added.push({ run_id: runId, id: `fw:live:${e.tool_use_id}`, kind: "file_written", owner: e.agent_id ?? e.session_id, owner_kind: e.agent_id ? "run" : "session", subject: e.path, ts: e.ts, source: "live" });
    }
  }
  // sessions only the live ledger knows: the transcript is gone, the meter kept the shape
  const sessions_added: Session[] = [];
  for (const sid of seen) {
    if (known.has(sid)) continue;
    const st = states.get(sid);
    const mine = events.filter((e) => e.session_id === sid);
    const ts = mine.map((e) => e.ts).sort();
    const models: Record<string, number> = {}; if (st?.model) models[st.model] = 1;
    const liveCost = typeof st?.cost_usd === "number" ? st.cost_usd : null;
    sessions_added.push({ run_id: runId, id: sid, tool: "claude_code", project_path: st?.cwd ?? mine[0]?.cwd ?? "", repo_id: repoId, source_file: "live", started_at: ts[0] ?? null, ended_at: ts.at(-1) ?? null, tool_version: null, entrypoint: null, first_prompt: "", title: `session ${sid.slice(0, 8)} (live ledger only; transcript gone)`, git_branch: null, models, turns: 0, usage: { input: 0, output: 0, cache_read: 0, cache_write_5m: 0, cache_write_1h: 0 }, cost_usd: liveCost ?? 0, cost_mark: liveCost === null ? "estimated" : "measured", cost_live_usd: liveCost, bad_lines: 0 });
  }
  const live_costs: Record<string, number> = {};
  for (const st of states.values()) if (typeof st.cost_usd === "number") live_costs[st.session_id] = st.cost_usd;
  return { sessions_added, claims_added, compactions, events: events.length, sessions_seen: seen.size, skipped, live_costs };
}
