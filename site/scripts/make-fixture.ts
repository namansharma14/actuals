/**
 * Copies a redacted report.json into site/fixtures/demo-report.json, through the same
 * check and sanitiser an upload goes through. Run from site/ with the repository's tsx:
 *
 *   ../node_modules/.bin/tsx scripts/make-fixture.ts <path to report.json>
 */
import { readFileSync, writeFileSync } from "node:fs";
import { checkRedactedSocket } from "../lib/socket.js";

const src = process.argv[2];
if (!src) { console.error("usage: make-fixture.ts <path to a redacted report.json>"); process.exit(2); }
const checked = checkRedactedSocket(JSON.parse(readFileSync(src, "utf8")));
if (!checked.ok) { console.error(checked.error); process.exit(1); }
writeFileSync("fixtures/demo-report.json", JSON.stringify(checked.report, null, 1) + "\n");
console.log(`wrote fixtures/demo-report.json from ${src}`);
