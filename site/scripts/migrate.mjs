/**
 * Applies db/schema.sql to DATABASE_URL, one statement per round trip (Neon HTTP).
 *
 *   node --env-file=.env.local scripts/migrate.mjs
 *
 * Every statement is idempotent and every one of them is scoped to the `hosted` schema,
 * so this never touches the v1 portal's tables in `public`.
 */
import { readFileSync } from "node:fs";
import { neon } from "@neondatabase/serverless";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is not set. Try: node --env-file=.env.local scripts/migrate.mjs");
  process.exit(2);
}

const statements = readFileSync(new URL("../db/schema.sql", import.meta.url), "utf8")
  .split("\n")
  .filter((line) => !line.trimStart().startsWith("--"))
  .join("\n")
  .split(";")
  .map((s) => s.trim())
  .filter(Boolean);

const sql = neon(url);
for (const statement of statements) {
  await sql.query(statement);
  console.log("ok  " + statement.split("\n")[0].slice(0, 78));
}
console.log(`applied ${statements.length} statements`);
