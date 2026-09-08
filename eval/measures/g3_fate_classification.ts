import type { Measurement } from "../harness.js";
import { synthetic } from "./_synthetic.js";

export async function measure(): Promise<Measurement> {
  let s;
  try { s = await synthetic(); } catch (e) { return { gate: "g3_fate_classification", value: null, n: 0, note: (e as Error).message }; }
  const ours = new Map(s.result.ledger.runs.map((r) => [r.id, r.fate]));
  let ok = 0; const miss: string[] = [];
  const graded = s.truth.runs.filter((r) => r.fate !== "still_running" || true);
  for (const r of graded) { const f = ours.get(r.id); if (f === r.fate) ok += 1; else miss.push(`${r.id}: expected ${r.fate}, got ${f ?? "absent"}`); }
  return { gate: "g3_fate_classification", value: graded.length ? ok / graded.length : null, n: graded.length, note: `${ok} of ${graded.length} runs classified as the generator expected`, details: { misses: miss.slice(0, 10) } };
}
