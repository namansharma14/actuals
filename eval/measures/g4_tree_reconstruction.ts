import type { Measurement } from "../harness.js";
import { synthetic } from "./_synthetic.js";

export async function measure(): Promise<Measurement> {
  let s;
  try { s = await synthetic(); } catch (e) { return { gate: "g4_tree_reconstruction", value: null, n: 0, note: (e as Error).message }; }
  const runs = new Map(s.result.ledger.runs.map((r) => [r.id, r]));
  let checks = 0, ok = 0; const miss: string[] = [];
  for (const t of s.truth.runs) {
    const r = runs.get(t.id);
    checks += 2;
    if (r && r.parent_run_id === t.parent_run_id) ok += 1; else miss.push(`${t.id}: parent expected ${t.parent_run_id}, got ${r?.parent_run_id ?? "absent"}`);
    if (r && r.depth === t.depth) ok += 1; else miss.push(`${t.id}: depth expected ${t.depth}, got ${r?.depth ?? "absent"}`);
  }
  const bySession = new Map(s.result.report.sessions.map((x) => [x.id, x]));
  for (const t of s.truth.sessions) {
    const x = bySession.get(t.id);
    checks += 2;
    if (x && x.peak_concurrency === t.peak_concurrency) ok += 1; else miss.push(`${t.id}: peak expected ${t.peak_concurrency}, got ${x?.peak_concurrency ?? "absent"}`);
    if (x && x.max_depth === t.max_depth) ok += 1; else miss.push(`${t.id}: max depth expected ${t.max_depth}, got ${x?.max_depth ?? "absent"}`);
  }
  return { gate: "g4_tree_reconstruction", value: checks ? ok / checks : null, n: checks, note: `${ok} of ${checks} tree facts exact (parent, depth, peak, max depth)`, details: { misses: miss.slice(0, 10) } };
}
