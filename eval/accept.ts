/**
 * Private acceptance: run the pipeline over your own transcripts and
 * compare to an independently derived key. Paths come from the environment, never from
 * the repo:
 *   ACTUALS_ACCEPT_REPO=/path/to/repo  (the repository whose sessions are graded)
 * Output goes to eval/private/ (gitignored).
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { repoIdFor } from "../src/config.js";
import { runPipeline } from "../src/pipeline.js";
import { deriveKey, compare } from "./derive-key.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repo = process.env.ACTUALS_ACCEPT_REPO;
if (!repo) { console.error("set ACTUALS_ACCEPT_REPO=/path/to/repo"); process.exit(2); }
const { repoId, originUrl } = repoIdFor(repo);
const stateDir = path.join(ROOT, "eval", "private", "state");
mkdirSync(stateDir, { recursive: true });
const t0 = Date.now();
const res = await runPipeline({ repoPath: repo, repoId, originUrl, allProjects: false, since: null, tools: ["claude_code"], redact: false, generous: false }, { stateDir });
const secs = (Date.now() - t0) / 1000;
const key = await deriveKey(repo);
const cmp = compare(res, key);
const out = { generated_at: new Date().toISOString(), seconds: secs, repo, run_dir: res.dir, key, comparison: cmp };
const outPath = path.join(ROOT, "eval", "private", `accept-${new Date().toISOString().slice(0, 10)}.json`);
writeFileSync(outPath, JSON.stringify(out, null, 2));
console.log(`pipeline: ${secs.toFixed(1)}s · sessions ${res.ledger.sessions.length} · runs ${res.ledger.runs.length} · turns ${res.ledger.turns.length} · commits inside sessions ${res.ledger.commits.filter((c) => c.attribution === "inside_session").length}`);
console.log(`key:      sessions ${key.sessions} · runs ${key.runs} · turns ${key.turns} · git commits in window ${key.commits_in_window}`);
for (const [k, v] of Object.entries(cmp.checks)) console.log(`  ${v.ok ? "OK " : "MISS"} ${k}: ours ${v.ours} vs key ${v.key}${v.note ? ` (${v.note})` : ""}`);
console.log(`  G2 independent per-request recount: ${cmp.g2.n} sessions; max rel error ${cmp.g2.max_rel_error === null ? "n/a" : (cmp.g2.max_rel_error * 100).toFixed(3) + "%"}`);
for (const d of cmp.g2.worst.slice(0, 3)) console.log(`     ${d.session.slice(0, 8)} ours ${d.ours_out} key ${d.key_out}`);
console.log(`  first-party /insights session-meta (informational): ${cmp.first_party.n} sessions; ${cmp.first_party.meta_equals_per_line} of them equal the per-line sum exactly (the first-party counter sums every transcript line)`);
for (const f of cmp.first_party.rows.slice(0, 4)) console.log(`     ${f.session.slice(0, 8)} ours ${f.ours_out} · session-meta ${f.meta_out} · per-line ${f.per_line_out}${f.meta_equals_per_line ? " (equal)" : ""}`);
console.log(`report: ${res.htmlPath}\nwritten: ${outPath}`);
