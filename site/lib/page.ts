/**
 * The report, on the web, is the report. `renderHtml(report, { redact: true })` exactly as
 * the command writes it, with nothing added and nothing corrected, served from its own
 * route so a frame can load it. The renderer is never forked.
 *
 * The sample report also carries the interactive drawers: every session's detail, rendered
 * by the command from the same redacted run and committed beside the report, so a landing
 * window can open a session with `?session=<id>` and no server. The site says what left the
 * machine outside the frame, in its own words, which is why the document no longer carries
 * a bar bolted to the top of it.
 */
import { renderHtml } from "../../src/render/html.js";
import drawersFixture from "../fixtures/demo-drawers.json";
import type { Report } from "./socket";

export function reportDocument(report: Report): string {
  return renderHtml(report, { redact: true });
}

const drawers: Record<string, string> = drawersFixture as Record<string, string>;

/* The drawers were redacted by the command and leak-checked before they were committed;
   this is the one cheap check the site can repeat at build time. */
for (const [id, html] of Object.entries(drawers)) {
  if (/\/Users\/|\/home\/|C:\\Users\\/.test(html)) throw new Error(`the sample drawer ${id} carries a real path`);
}

export function reportEmbedDocument(report: Report): string {
  return renderHtml(report, { redact: true, embed: { drawers } });
}

/**
 * A frame loading a whole document wants these headers and no more. The document is
 * self-contained (embedded fonts, inline styles, no network, an inline script only in embed
 * mode), so the policy names exactly that and nothing else; a stored socket that somehow
 * carried markup could still not load or send anything.
 */
export const reportHeaders = (maxAge: number, opts: { script?: boolean } = {}): Record<string, string> => ({
  "content-type": "text/html; charset=utf-8",
  "cache-control": maxAge > 0 ? `public, max-age=${maxAge}` : "public, max-age=0, must-revalidate",
  "x-content-type-options": "nosniff",
  "content-security-policy": [
    "default-src 'none'",
    "style-src 'unsafe-inline'",
    "img-src data:",
    "font-src data:",
    opts.script ? "script-src 'unsafe-inline'" : "",
    "base-uri 'none'",
    "form-action 'none'",
  ]
    .filter(Boolean)
    .join("; "),
});
