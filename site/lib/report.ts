/**
 * The demo report: the founder's own repository, run with `--redact` on 2026-09-04, put
 * through the same check every upload goes through. Parsed once, at build time.
 */
import fixture from "../fixtures/demo-report.json";
import { checkRedactedSocket, type Report } from "./socket";

const checked = checkRedactedSocket(fixture);
if (!checked.ok) throw new Error(`the demo fixture is not hostable: ${checked.error}`);

export const demoReport: Report = checked.report;
export { money, int } from "../../src/render/html.js";
