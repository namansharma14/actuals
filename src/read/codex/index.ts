/**
 * Codex reader placeholder. Deferred behind a ChatGPT account (2026-09-03).
 * `doctor` reports honestly; `run` reads nothing from Codex until the reader lands.
 */
import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { CODEX_ROOT } from "../../config.js";

export function codexStatus(codexRoot = CODEX_ROOT): { installed: boolean; sessions_dir: string | null; rollouts: number; note: string } {
  const sessions = path.join(codexRoot, "sessions");
  if (!existsSync(codexRoot)) return { installed: false, sessions_dir: null, rollouts: 0, note: "no ~/.codex directory" };
  if (!existsSync(sessions)) return { installed: true, sessions_dir: null, rollouts: 0, note: "~/.codex exists but has no sessions directory (CLI not used yet)" };
  let n = 0;
  const walk = (d: string, depth: number): void => {
    if (depth > 4) return;
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p, depth + 1);
      else if (e.name.startsWith("rollout-") && e.name.endsWith(".jsonl")) n += 1;
    }
  };
  try { walk(sessions, 0); } catch { /* unreadable */ }
  return { installed: true, sessions_dir: sessions, rollouts: n, note: n ? "rollouts found; the Codex reader is not built yet (deferred)" : "no rollouts" };
}
