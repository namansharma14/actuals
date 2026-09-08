import { describe, expect, it } from "vitest";
import { grade } from "../src/grade/index.js";
import { emptyLedger, type Claim, type Run, type Session, type Truth } from "../src/schema/ledger.js";

const NOW = new Date("2026-09-03T00:00:00Z");
const usage = { input: 1, output: 1, cache_read: 0, cache_write_5m: 0, cache_write_1h: 0 };
function session(id: string): Session {
  return { run_id: "r", id, tool: "claude_code", project_path: "/x", repo_id: "t", source_file: "", started_at: "2026-09-01T10:00:00.000Z", ended_at: "2026-09-01T12:00:00.000Z", tool_version: "2.1.241", entrypoint: null, first_prompt: "", title: id, git_branch: null, models: {}, turns: 1, usage, cost_usd: 1, cost_mark: "estimated", bad_lines: 0 };
}
function run(id: string, sid: string, opts: Partial<Run> = {}): Run {
  return { run_id: "r", id, session_id: sid, parent_run_id: null, depth: 1, spawned_by: "user", agent_type: "x", description: id, model: "claude-opus-5", source_file: null, started_at: "2026-09-01T10:00:00.000Z", ended_at: "2026-09-01T11:00:00.000Z", turns: 1, usage, cost_usd: 1, cost_mark: "estimated", final_text_chars: 400, final_text_sample: "", files_written: [], spawned: 0, last_tool_call_unanswered: false, fate: "unknown", fate_evidence: "", ...opts };
}
const claim = (id: string, kind: Claim["kind"], owner: string, owner_kind: Claim["owner_kind"], subject: string, source: string): Claim => ({ run_id: "r", id, kind, owner, owner_kind, subject, ts: "2026-09-01T10:30:00.000Z", source });
const truth = (claim_id: string, kind: Truth["kind"], value: string): Truth => ({ run_id: "r", claim_id, kind, observed_at: "2026-09-01T12:00:00.000Z", value });

describe("grader D16: report_delivered", () => {
  it("kept on disk, gone when named-but-absent, kept/unknown for an in-chat report by citation", () => {
    const led = emptyLedger("r");
    led.sessions = [session("S1")];
    led.runs = [run("R1", "S1")];
    led.claims = [
      claim("c-disk", "report_delivered", "R1", "run", "docs/on.md", "final_text"),
      claim("c-absent", "report_delivered", "R1", "run", "docs/gone.md", "final_text"),
      claim("c-chat-cited", "report_delivered", "R1", "run", "(in chat)", "final_text"),
      claim("c-chat-un", "report_delivered", "R1", "run", "(in chat)", "final_text"),
    ];
    led.truths = [
      truth("c-disk", "report_on_disk", "yes"),
      truth("c-absent", "report_on_disk", "no"),
      truth("c-chat-cited", "report_cited", "yes"),
    ];
    const v = new Map(grade(led, NOW).verdicts.map((x) => [x.claim_id, x.verdict]));
    expect(v.get("c-disk")).toBe("kept");
    expect(v.get("c-absent")).toBe("gone");
    expect(v.get("c-chat-cited")).toBe("kept");
    expect(v.get("c-chat-un")).toBe("unknown"); // absence of a citation is never counted against it
  });
});

describe("grader D16: session_outcome graded against fate, not the claim's word", () => {
  it("achieved is kept only if a run landed, gone if all died, unknown when under-claimed", () => {
    const led = emptyLedger("r");
    led.sessions = [session("S_land"), session("S_die")];
    // S_land: one run that lands (a file on disk + tracked)
    led.runs = [
      run("RL", "S_land"),
      run("RD", "S_die", { last_tool_call_unanswered: true, final_text_chars: 0 }),
    ];
    led.claims = [
      claim("fw", "file_written", "RL", "run", "src/a.ts", "tool"),
      claim("so-land", "session_outcome", "S_land", "session", "mostly_achieved", "insights_facet"),
      claim("so-die", "session_outcome", "S_die", "session", "achieved", "insights_facet"),
      claim("so-under", "session_outcome", "S_land", "session", "not_achieved", "insights_facet"),
    ];
    led.truths = [truth("fw", "file_on_disk", "yes"), truth("fw", "file_tracked", "yes")];
    const g = grade(led, NOW);
    const v = new Map(g.verdicts.map((x) => [x.claim_id, x.verdict]));
    expect(g.runs.find((r) => r.id === "RL")!.fate).toBe("landed_tracked");
    expect(g.runs.find((r) => r.id === "RD")!.fate).toBe("died");
    expect(v.get("so-land")).toBe("kept");   // achieved + a run landed
    expect(v.get("so-die")).toBe("gone");    // achieved but every run died
    expect(v.get("so-under")).toBe("unknown"); // under-claimed, nothing to punish
  });
  it("a founder label on the session overrides the outcome", () => {
    const led = emptyLedger("r");
    led.sessions = [session("S")];
    led.runs = [run("R", "S", { last_tool_call_unanswered: true, final_text_chars: 0 })]; // would be gone
    led.claims = [claim("so", "session_outcome", "S", "session", "achieved", "insights_facet")];
    led.labels = [{ target: "S", target_kind: "session", state: "kept", note: "shipped", ts: "2026-09-02T00:00:00.000Z" }];
    const v = new Map(grade(led, NOW).verdicts.map((x) => [x.claim_id, x.verdict]));
    expect(v.get("so")).toBe("kept");
  });
});

describe("grader D16: a delivered report that survives feeds the run's fate", () => {
  it("a run whose only deliverable is a cited/on-disk report reads as landed, not finished_unlanded", () => {
    const led = emptyLedger("r");
    led.sessions = [session("S")];
    led.runs = [run("Rrep", "S", { final_text_chars: 500, files_written: [] })]; // long final text, no files -> would be finished_unlanded
    led.claims = [claim("rd", "report_delivered", "Rrep", "run", "(in chat)", "final_text")];
    led.truths = [truth("rd", "report_cited", "yes")];
    const g = grade(led, NOW);
    expect(g.runs.find((r) => r.id === "Rrep")!.fate).toBe("landed_untracked");
  });
  it("an uncited in-chat report does not rescue the fate (undercount)", () => {
    const led = emptyLedger("r");
    led.sessions = [session("S")];
    led.runs = [run("Rrep", "S", { final_text_chars: 500, files_written: [] })];
    led.claims = [claim("rd", "report_delivered", "Rrep", "run", "(in chat)", "final_text")];
    led.truths = [];
    expect(grade(led, NOW).runs.find((r) => r.id === "Rrep")!.fate).toBe("finished_unlanded");
  });
});
