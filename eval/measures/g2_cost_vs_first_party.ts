/**
 * G2: our per-session output-token totals vs the first-party /insights session-meta files,
 * on your own transcripts. Needs ACTUALS_ACCEPT_REPO; otherwise unmeasured.
 * Cost is usage × rates.json by construction; the token count is what can disagree.
 */
import path from "node:path";
import { repoIdFor } from "../../src/config.js";
import { runPipeline } from "../../src/pipeline.js";
import { compare, deriveKey } from "../derive-key.js";
import type { Measurement } from "../harness.js";

export async function measure(): Promise<Measurement> {
  const repo = process.env.ACTUALS_ACCEPT_REPO;
  if (!repo) return { gate: "g2_cost_vs_first_party", value: null, n: 0, note: "set ACTUALS_ACCEPT_REPO to measure on real transcripts" };
  const { repoId, originUrl } = repoIdFor(repo);
  const stateDir = path.join(process.cwd(), "eval", "private", "state");
  const res = await runPipeline({ repoPath: repo, repoId, originUrl, allProjects: false, since: null, tools: ["claude_code"], redact: true, generous: false }, { stateDir });
  const cmp = compare(res, await deriveKey(repo));
  return { gate: "g2_cost_vs_first_party", value: cmp.g2.max_rel_error, n: cmp.g2.n, note: `max relative error on output tokens vs an independent per-request recount across ${cmp.g2.n} sessions; first-party /insights session-meta equals the per-line sum on ${cmp.first_party.meta_equals_per_line} of ${cmp.first_party.n} sessions (it overcounts), recorded here as a finding, not a target`, details: { first_party: cmp.first_party.rows.slice(0, 5).map((f) => ({ session: f.session.slice(0, 8), ours: f.ours_out, meta: f.meta_out, per_line: f.per_line_out, equal: f.meta_equals_per_line })) } };
}
