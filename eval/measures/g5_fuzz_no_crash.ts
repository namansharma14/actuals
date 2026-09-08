import type { Measurement } from "../harness.js";
import { synthetic } from "./_synthetic.js";

export async function measure(): Promise<Measurement> {
  let crashes = 0; let n = 0; const notes: string[] = [];
  for (const seed of [1, 2, 3]) {
    n += 1;
    try { const s = await synthetic(seed, 8); notes.push(`seed ${seed}: ${s.result.ledger.sessions.length} sessions, ${s.truth.malformed_lines} malformed lines tolerated`); }
    catch (e) { crashes += 1; notes.push(`seed ${seed}: CRASH ${(e as Error).message}`); }
  }
  return { gate: "g5_fuzz_no_crash", value: crashes, n, note: notes.join("; ") };
}
