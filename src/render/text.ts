/**
 * The small text helpers every surface shares: escaping, money, counts, day and clock labels,
 * the mark chip and the caption label. They live here, below the template, so the Workbench
 * template and the per-session view can both use them without importing the page entry.
 */

export function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

/** An em dash or en dash never reaches a reader; a comma says the same thing. */
export const plain = (s: string): string => s.replace(/—|–/g, ",");

export function money(n: number | null): string {
  if (n === null) return "n/a";
  const abs = Math.abs(n);
  return (n < 0 ? "-$" : "$") + (abs >= 100 ? Math.round(abs).toLocaleString("en-US") : abs.toFixed(2));
}

export const int = (n: number): string => n.toLocaleString("en-US");

export function pct(part: number, whole: number): string { return whole > 0 ? `${Math.round((part / whole) * 100)}%` : "n/a"; }

export function dateOnly(iso: string): string { const m = /^(\d{4}-\d{2}-\d{2})/.exec(iso); return m && m[1] ? m[1] : iso; }

export function dateTime(iso: string): string { const m = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/.exec(iso); return m && m[1] && m[2] ? `${m[1]} ${m[2]} UTC` : iso; }

export function hm(iso: string): string { const m = /T(\d{2}:\d{2})/.exec(iso); return m && m[1] ? m[1] : iso; }

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function dayLabel(iso: string): string {
  const d = new Date(iso); if (Number.isNaN(d.getTime())) return iso;
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
}

/** The marks as a reader sees them: the schema keeps "founder-labelled", the page says whose label it is. */
const MARK_TEXT: Record<string, string> = { "founder-labelled": "your label" };

/** Every number carries its mark next to it; this is the chip that renders it. */
export const mark = (m: string): string => `<span class="mark">${esc(MARK_TEXT[m] ?? m)}</span>`;

/** A small uppercase caption over a figure or a block. */
export const lab = (s: string): string => `<div class="lab">${esc(s)}</div>`;
