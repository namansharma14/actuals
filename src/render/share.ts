/**
 * Share card, text half: aggregates only. This function reads report.share and nothing
 * else, and the tests enforce it. The drawing lives in sticker.ts and is the same on every
 * surface.
 */
import type { Report } from "../schema/socket.js";

function money(n: number | null): string {
  if (n === null) return "n/a";
  return n >= 100 ? "$" + Math.round(n).toLocaleString("en-US") : "$" + n.toFixed(2);
}

export function renderShareText(report: Report): string {
  const s = report.share;
  return [
    `my actuals · ${s.period}`,
    `${s.agent_runs} agent runs. ${s.commits} commits [measured]. ${money(s.cost_per_commit)} a commit, list rates [estimated].`,
    `files still alive: ${s.files_alive_pct === null ? "n/a" : s.files_alive_pct + "%"}`,
    `biggest agent tree: ${s.biggest_tree}`,
    `agent output with no fate: ${s.runs_no_fate} runs`,
    `measured by actuals`,
  ].join("\n");
}
