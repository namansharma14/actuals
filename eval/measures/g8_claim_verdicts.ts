import type { Measurement } from "../harness.js";
import { synthetic } from "./_synthetic.js";

/** D16: the claim verdicts the grader assigns vs the blind generator's expectations, matched by
 * owner + kind + subject so the two 'achieved' session_outcomes do not collide. Gated directly,
 * not only through the fates they feed. */
export async function measure(): Promise<Measurement> {
  let s;
  try { s = await synthetic(); } catch (e) { return { gate: "g8_claim_verdicts", value: null, n: 0, note: (e as Error).message }; }
  const claims = s.result.ledger.claims;
  const verdicts = new Map(s.result.ledger.verdicts.map((v) => [v.claim_id, v.verdict]));
  const expected = s.truth.expected_verdicts ?? [];
  let ok = 0; const miss: string[] = [];
  for (const e of expected) {
    const c = claims.find((x) => x.owner === e.owner && x.kind === e.kind && x.subject === e.subject);
    const got = c ? verdicts.get(c.id) ?? "unknown" : "absent";
    if (got === e.verdict) ok += 1; else miss.push(`${e.where} (${e.kind}:${e.subject}) expected ${e.verdict}, got ${got}`);
  }
  return { gate: "g8_claim_verdicts", value: expected.length ? ok / expected.length : null, n: expected.length, note: `${ok} of ${expected.length} claim verdicts as the generator expected`, details: { misses: miss.slice(0, 10) } };
}
