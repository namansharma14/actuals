/**
 * G7: an unseen tool version produces a warning, never a silent parse. Also checks that a
 * pinned version produces no drift warning. value = fraction of the two cases that behave.
 */
import { read } from "../../src/read/claude_code/index.js";
import { buildTinyFixture } from "../fixtures/tiny.js";
import type { Measurement } from "../harness.js";

export async function measure(): Promise<Measurement> {
  const scopeFor = (repo: string) => ({ repoPath: repo, repoId: "tiny", originUrl: null, allProjects: false, since: null, tools: ["claude_code" as const], redact: false, generous: false });
  const drift = buildTinyFixture({ version: "9.9.9" });
  const a = await read(scopeFor(drift.repo), "g7a", "tiny", drift.claudeRoot);
  const warned = a.warnings.some((w) => w.includes("schema drift") && w.includes("9.9.9")) && a.sessions.length === 1;
  const pinned = buildTinyFixture({ version: "2.1.241" });
  const b = await read(scopeFor(pinned.repo), "g7b", "tiny", pinned.claudeRoot);
  const quiet = !b.warnings.some((w) => w.includes("schema drift"));
  const ok = (warned ? 1 : 0) + (quiet ? 1 : 0);
  return { gate: "g7_schema_drift", value: ok / 2, n: 2, note: `unseen version warns: ${warned}; pinned version silent: ${quiet}` };
}
