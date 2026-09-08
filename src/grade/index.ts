/**
 * Grader: fate per run (first match wins), verdict per claim, never rounding up.
 */
import type { Ledger, Run, Verdict } from "../schema/ledger.js";

const TEN_MIN = 10 * 60e3;

export function grade(ledger: Ledger, now = new Date()): { runs: Run[]; verdicts: Verdict[] } {
  const truthsByClaim = new Map<string, Map<string, string>>();
  for (const t of ledger.truths) {
    if (!truthsByClaim.has(t.claim_id)) truthsByClaim.set(t.claim_id, new Map());
    truthsByClaim.get(t.claim_id)!.set(t.kind, t.value);
  }
  const labelFor = (id: string): string | null => ledger.labels.filter((l) => l.target === id).at(-1)?.state ?? null;
  const sessionEnd = new Map<string, number>();
  for (const s of ledger.sessions) if (s.ended_at) sessionEnd.set(s.id, new Date(s.ended_at).getTime());

  const runs: Run[] = ledger.runs.map((r) => {
    const fileClaims = ledger.claims.filter((c) => c.kind === "file_written" && c.owner === r.id);
    const onDisk = fileClaims.filter((c) => truthsByClaim.get(c.id)?.get("file_on_disk") === "yes");
    const trackedFiles = onDisk.filter((c) => truthsByClaim.get(c.id)?.get("file_tracked") === "yes");
    const end = r.ended_at ? new Date(r.ended_at).getTime() : null;
    const parentEnd = sessionEnd.get(r.session_id) ?? null;
    const label = labelFor(r.id) ?? labelFor(r.session_id);
    const reportKept = ledger.claims.some((c) => c.kind === "report_delivered" && c.owner === r.id && (truthsByClaim.get(c.id)?.get("report_on_disk") === "yes" || truthsByClaim.get(c.id)?.get("report_cited") === "yes"));
    let fate: Run["fate"]; let ev: string;
    if (end !== null && now.getTime() - end < TEN_MIN && r.final_text_chars === 0) { fate = "still_running"; ev = "last record under 10 minutes old, no final text"; }
    else if (r.last_tool_call_unanswered) { fate = "died"; ev = "last record is a tool call with no result"; }
    else if (r.final_text_chars === 0 && end !== null && parentEnd !== null && parentEnd - end > TEN_MIN) { fate = "died"; ev = "no final text; the parent continued past this run"; }
    else if (label) { fate = "founder_labelled"; ev = `label: ${label}`; }
    else if (trackedFiles.length > 0) { fate = "landed_tracked"; ev = `${trackedFiles.length} of ${fileClaims.length} written files tracked in git`; }
    else if (onDisk.length > 0) { fate = "landed_untracked"; ev = `${onDisk.length} of ${fileClaims.length} written files on disk, none tracked`; }
    else if (reportKept) { fate = "landed_untracked"; ev = "a report this run delivered is on disk or was cited later, though no written file of its own survives"; }
    else if (r.final_text_chars >= 300) { fate = "finished_unlanded"; ev = `final text of ${r.final_text_chars} chars, no written file survives`; }
    else { fate = "unknown"; ev = "no final text, no surviving file"; }
    return { ...r, fate, fate_evidence: ev };
  });

  const runById = new Map(runs.map((r) => [r.id, r]));
  const runsBySession = new Map<string, Run[]>();
  for (const r of runs) { const a = runsBySession.get(r.session_id) ?? []; a.push(r); runsBySession.set(r.session_id, a); }
  const sessionLanded = (sid: string): "landed" | "died" | "mixed" => {
    const rs = runsBySession.get(sid) ?? [];
    if (rs.some((r) => r.fate === "landed_tracked" || r.fate === "landed_untracked")) return "landed";
    if (rs.length > 0 && rs.every((r) => r.fate === "died")) return "died";
    return "mixed";
  };
  const verdicts: Verdict[] = ledger.claims.map((c) => {
    const t = truthsByClaim.get(c.id) ?? new Map<string, string>();
    if (t.get("founder_label")) {
      const l = t.get("founder_label")!;
      return { run_id: ledger.run_id, claim_id: c.id, verdict: l === "kept" ? "kept" : l === "open" ? "unknown" : "gone", reason: `founder label: ${l}` };
    }
    if (c.kind === "file_written") {
      const d = t.get("file_on_disk");
      return { run_id: ledger.run_id, claim_id: c.id, verdict: d === "yes" ? "kept" : d === "no" ? "gone" : "unknown", reason: d === "yes" ? (t.get("file_tracked") === "yes" ? "on disk, tracked" : "on disk, untracked") : d === "no" ? "not on disk" : "not checked" };
    }
    if (c.kind === "commit_made") {
      const sha = t.get("commit_in_log");
      if (!sha || sha === "no") return { run_id: ledger.run_id, claim_id: c.id, verdict: "unknown", reason: "no commit in git log matched this call within 5 minutes" };
      const rv = t.get("commit_reverted_within_30d");
      return { run_id: ledger.run_id, claim_id: c.id, verdict: rv && rv !== "no" ? "gone" : "kept", reason: rv && rv !== "no" ? `reverted by ${rv.slice(0, 8)} within 30 days` : `commit ${sha.slice(0, 8)} in log` };
    }
    if (c.kind === "run_finished") {
      const r = runById.get(c.owner);
      const f = r?.fate ?? "unknown";
      return { run_id: ledger.run_id, claim_id: c.id, verdict: f === "landed_tracked" || f === "landed_untracked" ? "kept" : f === "died" ? "gone" : "unknown", reason: `fate: ${f}` };
    }
    if (c.kind === "report_delivered") {
      const onDisk = t.get("report_on_disk"), cited = t.get("report_cited");
      if (c.subject === "(in chat)") return { run_id: ledger.run_id, claim_id: c.id, verdict: cited === "yes" ? "kept" : "unknown", reason: cited === "yes" ? "an in-chat report, cited later in the codebase" : "an in-chat report; no citation found (absence is not counted against it)" };
      if (onDisk === "yes") return { run_id: ledger.run_id, claim_id: c.id, verdict: "kept", reason: cited === "yes" ? "the named report is on disk and was cited later" : "the named report is on disk" };
      if (onDisk === "no") return { run_id: ledger.run_id, claim_id: c.id, verdict: "gone", reason: "the agent named a report that is not on disk" };
      return { run_id: ledger.run_id, claim_id: c.id, verdict: "unknown", reason: "the named report was not checked" };
    }
    if (c.kind === "session_outcome") {
      const slabel = labelFor(c.owner);
      if (slabel) return { run_id: ledger.run_id, claim_id: c.id, verdict: slabel === "kept" ? "kept" : slabel === "open" ? "unknown" : "gone", reason: `founder label: ${slabel}` };
      const outcome = c.subject, spoken = outcome.replace(/_/g, " ");
      const positive = outcome === "achieved" || outcome === "mostly_achieved";
      if (!positive) return { run_id: ledger.run_id, claim_id: c.id, verdict: "unknown", reason: `claimed ${spoken}; nothing to punish` };
      const landed = sessionLanded(c.owner);
      return { run_id: ledger.run_id, claim_id: c.id, verdict: landed === "landed" ? "kept" : landed === "died" ? "gone" : "unknown", reason: landed === "landed" ? `claimed ${spoken}; a run landed` : landed === "died" ? `claimed ${spoken}; every run died` : `claimed ${spoken}; no run landed` };
    }
    return { run_id: ledger.run_id, claim_id: c.id, verdict: "unknown", reason: "no truth rule for this claim kind" };
  });
  return { runs, verdicts };
}
