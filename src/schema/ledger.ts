/**
 * The ledger: the stable contract between readers (which churn with tool versions)
 * and everything downstream. Every row carries the actuals run_id that
 * produced it. Nothing derived overwrites raw.
 */
import { z } from "zod";

export const Tool = z.enum(["claude_code", "codex"]);
export type Tool = z.infer<typeof Tool>;

export const Mark = z.enum(["measured", "estimated", "founder-labelled", "illustrative", "assumed"]);
export type Mark = z.infer<typeof Mark>;

export const Usage = z.object({
  input: z.number().int().nonnegative(),
  output: z.number().int().nonnegative(),
  cache_read: z.number().int().nonnegative(),
  cache_write_5m: z.number().int().nonnegative(),
  cache_write_1h: z.number().int().nonnegative(),
});
export type Usage = z.infer<typeof Usage>;

export const emptyUsage = (): Usage => ({ input: 0, output: 0, cache_read: 0, cache_write_5m: 0, cache_write_1h: 0 });
export const addUsage = (a: Usage, b: Usage): Usage => ({
  input: a.input + b.input,
  output: a.output + b.output,
  cache_read: a.cache_read + b.cache_read,
  cache_write_5m: a.cache_write_5m + b.cache_write_5m,
  cache_write_1h: a.cache_write_1h + b.cache_write_1h,
});

export const Fate = z.enum([
  "still_running",
  "died",
  "founder_labelled",
  "landed_tracked",
  "landed_untracked",
  "finished_unlanded",
  "unknown",
]);
export type Fate = z.infer<typeof Fate>;

export const Session = z.object({
  run_id: z.string(),
  id: z.string(),
  tool: Tool,
  project_path: z.string(),
  repo_id: z.string(),
  source_file: z.string(),
  started_at: z.string().datetime({ offset: true }).nullable(),
  ended_at: z.string().datetime({ offset: true }).nullable(),
  tool_version: z.string().nullable(),
  entrypoint: z.string().nullable(),
  first_prompt: z.string(),
  title: z.string(),
  git_branch: z.string().nullable(),
  models: z.record(z.number().int()),
  turns: z.number().int(),
  usage: Usage,
  cost_usd: z.number(),
  cost_mark: Mark,
  /** the session's total cost as Claude Code's statusline reported it (cost.total_cost_usd), when watch recorded one; null or absent otherwise */
  cost_live_usd: z.number().nullable().optional(),
  bad_lines: z.number().int(),
});
export type Session = z.infer<typeof Session>;

export const Run = z.object({
  run_id: z.string(),
  id: z.string(),
  session_id: z.string(),
  parent_run_id: z.string().nullable(),
  depth: z.number().int(),
  spawned_by: z.enum(["user", "agent"]),
  agent_type: z.string().nullable(),
  description: z.string(),
  model: z.string().nullable(),
  source_file: z.string().nullable(),
  started_at: z.string().datetime({ offset: true }).nullable(),
  ended_at: z.string().datetime({ offset: true }).nullable(),
  turns: z.number().int(),
  usage: Usage,
  cost_usd: z.number(),
  cost_mark: Mark,
  final_text_chars: z.number().int(),
  final_text_sample: z.string(),
  files_written: z.array(z.string()),
  spawned: z.number().int(),
  last_tool_call_unanswered: z.boolean(),
  fate: Fate,
  fate_evidence: z.string(),
});
export type Run = z.infer<typeof Run>;

export const Turn = z.object({
  run_id: z.string(),
  owner: z.string(),
  owner_kind: z.enum(["session", "run"]),
  ts: z.string(),
  model: z.string(),
  usage: Usage,
  cost_usd: z.number(),
  rate_version: z.string(),
  rate_mark: Mark,
});
export type Turn = z.infer<typeof Turn>;

export const ToolCallKind = z.enum(["write", "edit", "read", "bash", "spawn", "other"]);
export const ToolCall = z.object({
  run_id: z.string(),
  owner: z.string(),
  owner_kind: z.enum(["session", "run"]),
  ts: z.string(),
  tool_use_id: z.string(),
  name: z.string(),
  kind: ToolCallKind,
  path: z.string().nullable(),
  command: z.string().nullable(),
  has_result: z.boolean(),
});
export type ToolCall = z.infer<typeof ToolCall>;

export const ClaimKind = z.enum(["file_written", "commit_made", "run_finished", "report_delivered", "session_outcome"]);
export const Claim = z.object({
  run_id: z.string(),
  id: z.string(),
  kind: ClaimKind,
  owner: z.string(),
  owner_kind: z.enum(["session", "run"]),
  subject: z.string(),
  ts: z.string(),
  source: z.string(),
});
export type Claim = z.infer<typeof Claim>;

export const TruthKind = z.enum([
  "file_on_disk",
  "file_tracked",
  "commit_in_log",
  "commit_reverted_within_30d",
  "report_on_disk",
  "report_cited",
  "founder_label",
]);
export const Truth = z.object({
  run_id: z.string(),
  claim_id: z.string(),
  kind: TruthKind,
  observed_at: z.string(),
  value: z.string(),
});
export type Truth = z.infer<typeof Truth>;

export const Verdict = z.object({
  run_id: z.string(),
  claim_id: z.string(),
  verdict: z.enum(["kept", "gone", "unknown"]),
  reason: z.string(),
});
export type Verdict = z.infer<typeof Verdict>;

export const LabelState = z.enum(["kept", "retired", "dead", "open"]);
export const Label = z.object({
  target: z.string(),
  target_kind: z.enum(["session", "run"]),
  state: LabelState,
  note: z.string(),
  ts: z.string(),
});
export type Label = z.infer<typeof Label>;

export const Commit = z.object({
  run_id: z.string(),
  sha: z.string(),
  author_time: z.string(),
  author_email: z.string(),
  subject: z.string(),
  reverted_by: z.string().nullable(),
  reverted_at: z.string().nullable(),
  session_id: z.string().nullable(),
  attribution: z.enum(["inside_session", "during_session_unattributed", "outside"]),
});
export type Commit = z.infer<typeof Commit>;

export const Fix = z.object({
  id: z.string(),
  kind: z.string(),
  target_file: z.string(),
  diff: z.string(),
  applied_at: z.string(),
  undo_existed: z.boolean(),
});
export type Fix = z.infer<typeof Fix>;

export const RunsRow = z.object({
  run_id: z.string(),
  stage: z.string(),
  started_at: z.string(),
  ended_at: z.string(),
  rows: z.number().int(),
  warnings: z.array(z.string()),
});
export type RunsRow = z.infer<typeof RunsRow>;

export const ENTITIES = {
  sessions: Session,
  runs: Run,
  turns: Turn,
  tool_calls: ToolCall,
  claims: Claim,
  truths: Truth,
  verdicts: Verdict,
  commits: Commit,
  stages: RunsRow,
} as const;
export type EntityName = keyof typeof ENTITIES;

export interface Ledger {
  run_id: string;
  sessions: Session[];
  runs: Run[];
  turns: Turn[];
  tool_calls: ToolCall[];
  claims: Claim[];
  truths: Truth[];
  verdicts: Verdict[];
  commits: Commit[];
  stages: RunsRow[];
  labels: Label[];
  warnings: string[];
}

export function emptyLedger(run_id: string): Ledger {
  return { run_id, sessions: [], runs: [], turns: [], tool_calls: [], claims: [], truths: [], verdicts: [], commits: [], stages: [], labels: [], warnings: [] };
}
