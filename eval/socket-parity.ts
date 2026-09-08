import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ReportSchema } from "../src/schema/socket.js";
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const p = path.join(ROOT, "eval", "fixtures", "socket", "report.fixture.json");
const r = ReportSchema.safeParse(JSON.parse(readFileSync(p, "utf8")));
if (!r.success) { console.error(r.error.issues.slice(0, 10)); process.exit(1); }
console.log("socket parity: fixture validates");
