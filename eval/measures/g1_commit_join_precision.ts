import type { Measurement } from "../harness.js";
import { synthetic } from "./_synthetic.js";

/**
 * G1: precision of "made inside a session" attribution against the generator's truth.
 * Recall over the generator's inside_session commits is reported in the note.
 */
export async function measure(): Promise<Measurement> {
  let s;
  try { s = await synthetic(); } catch (e) { return { gate: "g1_commit_join_precision", value: null, n: 0, note: (e as Error).message }; }
  const truth = s.truth.commits;
  const ours = s.result.ledger.commits.filter((c) => c.attribution === "inside_session");
  let tp = 0; const fp: string[] = [];
  for (const c of ours) {
    const t = truth.find((x) => x.sha.startsWith(c.sha) || c.sha.startsWith(x.sha));
    if (t && t.attribution === "inside_session" && t.session_id === c.session_id) tp += 1;
    else fp.push(`${c.sha.slice(0, 8)} "${c.subject}" → ${c.session_id?.slice(0, 8) ?? "none"} (truth: ${t?.attribution ?? "absent"} ${t?.session_id?.slice(0, 8) ?? ""})`);
  }
  const expectedTotal = truth.filter((c) => c.attribution === "inside_session").length;
  return { gate: "g1_commit_join_precision", value: ours.length ? tp / ours.length : null, n: ours.length, note: `${tp} of ${ours.length} attributed commits correct; recall ${expectedTotal ? (tp / expectedTotal).toFixed(2) : "n/a"} of ${expectedTotal} expected inside sessions`, details: { false_positives: fp.slice(0, 10) } };
}
