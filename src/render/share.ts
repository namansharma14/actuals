/**
 * Share card: aggregates only. These functions read report.share and nothing
 * else, and the tests enforce it. SVG is standalone: literal colours, fallback font stacks.
 */
import type { Report } from "../schema/socket.js";

const MONO = "Martian Mono, ui-monospace, SF Mono, Menlo, Consolas, monospace";
const SANS = "Instrument Sans, system-ui, Helvetica, Arial, sans-serif";

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
function money(n: number | null): string {
  if (n === null) return "n/a";
  return n >= 100 ? "$" + Math.round(n).toLocaleString("en-US") : "$" + n.toFixed(2);
}

export function renderShareSvg(report: Report): string {
  const s = report.share;
  const pct = s.files_alive_pct === null ? "n/a" : `${s.files_alive_pct}%`;
  const cells = [
    { n: String(s.agent_runs), l: "agent runs" },
    { n: String(s.commits), l: "commits" },
    { n: money(s.cost_per_commit), l: "per commit, list rates" },
    { n: pct, l: "files still alive" },
    { n: String(s.biggest_tree), l: "biggest agent tree" },
    { n: String(s.runs_no_fate), l: "runs with no fate" },
  ];
  const cols = cells.map((c, i) => {
    const x = 72 + (i % 3) * 360; const y = i < 3 ? 250 : 430;
    return `<text x="${x}" y="${y}" font-family="${MONO}" font-weight="300" font-size="72" letter-spacing="-3" fill="#E8E4DA">${esc(c.n)}</text><text x="${x}" y="${y + 34}" font-family="${MONO}" font-size="14" letter-spacing="1.5" fill="#6C727B">${esc(c.l.toUpperCase())}</text>`;
  }).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 630" width="1200" height="630"><title>my actuals, ${esc(s.period)}</title><rect width="1200" height="630" fill="#0A0C0F"></rect><rect x="72" y="118" width="1056" height="1" fill="#262C34"></rect><text x="72" y="84" font-family="${MONO}" font-weight="500" font-size="16" letter-spacing="4" fill="#E8E4DA">ACTUALS</text><text x="1128" y="84" text-anchor="end" font-family="${MONO}" font-size="14" letter-spacing="1" fill="#6C727B">${esc(s.period)}</text>${cols}<rect x="72" y="520" width="1056" height="1" fill="#262C34"></rect><text x="72" y="566" font-family="${SANS}" font-size="18" fill="#9DA3AB">Read from local transcripts and git. Nothing uploaded. No model called.</text><text x="1128" y="566" text-anchor="end" font-family="${MONO}" font-size="13" letter-spacing="1.5" fill="#98B2C4">measured by actuals</text></svg>`;
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
