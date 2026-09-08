/**
 * The socket: report.json, validated here, rendered unmodified.
 * The checked-in fixture and the engine's emitted file must both validate.
 */
import { z } from "zod";
import { Fate, Mark } from "./ledger.js";

const Marked = <T extends z.ZodTypeAny>(v: T) => z.object({ value: v, mark: Mark });

export const HeadlineSchema = z.object({
  cost_usd: Marked(z.number()),
  commits: Marked(z.number().int()),
  cost_per_commit: Marked(z.number().nullable()),
  files_alive: z.object({ alive: z.number().int(), written: z.number().int(), mark: Mark }),
  runs_no_fate: z.object({ count: z.number().int(), cost_usd: z.number(), mark: Mark }),
  /** how the sessions' costs were made: measured is Claude Code's own figure from the live state, priced is our token count at list rates */
  cost_sessions: z.object({ measured: z.number().int(), priced: z.number().int() }).optional(),
});

export const SessionRow = z.object({
  id: z.string(),
  tool: z.string(),
  date: z.string(),
  title: z.string(),
  hours: z.number().nullable(),
  cost_usd: z.number(),
  cost_main_usd: z.number(),
  cost_agents_usd: z.number(),
  /** measured when cost_usd is Claude Code's own figure; estimated or assumed when it is our count at list rates */
  cost_mark: Mark.optional(),
  commits: z.number().int(),
  files_written: z.number().int(),
  files_alive: z.number().int(),
  files_tracked: z.number().int(),
  agents: z.number().int(),
  peak_concurrency: z.number().int(),
  max_depth: z.number().int(),
  died: z.number().int(),
  outcome: z.object({ state: z.string(), note: z.string(), source: z.string(), mark: Mark }),
  claimed: z.object({ outcome: z.string(), goal: z.string(), source: z.string(), mark: Mark }).nullable(),
  /** where the row came from (D14): the transcript, or the live ledger alone when the transcript is gone */
  source: z.enum(["transcript", "live"]).optional(),
  /** compaction points the live ledger recorded for this session */
  compactions: z.number().int().optional(),
});

export const ReportSchema = z.object({
  schema_version: z.literal("actuals.report/2.0"),
  repo_id: z.string(),
  repo_path: z.string(),
  generated_at: z.string(),
  run_id: z.string(),
  window: z.object({ since: z.string().nullable(), until: z.string().nullable() }),
  tools: z.array(z.string()),
  tool_versions: z.record(z.array(z.string())),
  rates_version: z.string(),
  provenance_note: z.string(),
  headline: HeadlineSchema,
  sessions: z.array(SessionRow),
  burn: z.object({
    tree: z.object({
      peaks: z.array(z.object({ date: z.string(), session_id: z.string(), peak: z.number().int(), max_depth: z.number().int() })),
      timeline: z.object({
        session_id: z.string(),
        date: z.string(),
        title: z.string(),
        start: z.string(),
        end: z.string(),
        peak: z.number().int(),
        peak_at: z.string(),
        died: z.number().int(),
        spawned_by_agents: z.number().int(),
        runs: z.array(z.object({ id: z.string(), start: z.string(), end: z.string(), depth: z.number().int(), fate: Fate })),
      }).nullable(),
      depth_histogram: z.record(z.number().int()),
      spawned_by_agents: z.number().int(),
      died: z.object({ count: z.number().int(), cost_usd: z.number() }),
      mark: Mark,
    }),
    fate: z.object({ by_state: z.record(z.number().int()), unlandable_count: z.number().int(), unlandable_cost_usd: z.number(), mark: Mark }),
    rereads: z.object({ reads: z.number().int(), rereads: z.number().int(), top: z.array(z.object({ path: z.string(), n: z.number().int() })), mark: Mark, note: z.string() }),
  }),
  models: z.array(z.object({
    model: z.string(),
    runs: z.number().int(),
    cost_usd: z.number(),
    per_run_usd: z.number(),
    finished: z.number().int(),
    landed: z.number().int(),
    kept_per_usd: z.number().nullable(),
    rate_mark: Mark,
  })),
  fixes: z.array(z.object({
    id: z.string(),
    kind: z.string(),
    title: z.string(),
    why: z.string(),
    target_file: z.string(),
    snippet: z.string(),
    would_have_blocked: z.string().nullable(),
    available: z.boolean(),
    opt_in: z.boolean().optional(),
  })),
  share: z.object({
    period: z.string(),
    agent_runs: z.number().int(),
    commits: z.number().int(),
    cost_per_commit: z.number().nullable(),
    files_alive_pct: z.number().nullable(),
    biggest_tree: z.number().int(),
    runs_no_fate: z.number().int(),
  }),
  method: z.array(z.string()),
  limitations: z.array(z.string()),
  marks_legend: z.record(z.string()),
  fate_states: z.array(Fate),
  /** the always-on status line (D14): present once a live ledger exists for this repository */
  live: z.object({ watching: z.boolean(), events: z.number().int(), sessions_live_only: z.number().int(), compactions: z.number().int(), first_event: z.string().nullable() }).optional(),
  tokens_spent_making_this: z.literal(0),
  left_machine: z.literal("nothing"),
});
export type Report = z.infer<typeof ReportSchema>;
