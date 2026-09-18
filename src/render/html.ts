/**
 * The page entry. The report is one self-contained HTML file with embedded fonts, inline
 * styles and, in the app and the embed, one inline script. The document itself is the
 * Workbench (workbench.ts); this module is what the rest of the code imports.
 *
 * Nothing here reshapes the report: every number on the page comes from the socket
 * unmodified and carries its mark beside it.
 */
import { renderWorkbench, treeBlock, WB_CSS, type RenderOpts } from "./workbench.js";
import type { Report } from "../schema/socket.js";

export type { RenderOpts };
export { WB_CSS as CSS };
export { RUN_FATE, RUN_FATE_INK, spendByDay, treeSvg, windowLabel } from "./workbench.js";
export { dateOnly, dateTime, dayLabel, esc, hm, int, lab, mark, money, pct, plain } from "./text.js";

/**
 * One session's agents drawn to time, as the session view draws them. The app asks the
 * server for this when it redraws a session, so the browser never carries a second copy of
 * the geometry.
 */
export function instrumentBody(t: NonNullable<Report["burn"]["tree"]["timeline"]>, treeMark: string, _tallest: boolean): string {
  return treeBlock(t, treeMark);
}

export function renderHtml(report: Report, opts: RenderOpts): string {
  return renderWorkbench(report, opts);
}
