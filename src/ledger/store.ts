/**
 * NDJSON ledger under ~/.actuals/<repo-id>/runs/<run_id>/. One directory per
 * actuals run, so idempotence per run_id is a property of the layout. labels.ndjson is
 * shared across runs and append-only.
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { ENTITIES, Label, type EntityName, type Ledger } from "../schema/ledger.js";

export function runDir(stateDir: string, runId: string): string {
  return path.join(stateDir, "runs", runId);
}

export function writeLedger(stateDir: string, ledger: Ledger, opts: { updateLatest?: boolean } = {}): string {
  const dir = runDir(stateDir, ledger.run_id);
  mkdirSync(path.join(dir, "ledger"), { recursive: true });
  for (const name of Object.keys(ENTITIES) as EntityName[]) {
    const rows = ledger[name] as unknown[];
    writeFileSync(path.join(dir, "ledger", `${name}.ndjson`), rows.map((r) => JSON.stringify(r)).join("\n") + (rows.length ? "\n" : ""));
  }
  writeFileSync(path.join(dir, "warnings.txt"), ledger.warnings.join("\n") + (ledger.warnings.length ? "\n" : ""));
  // a picker-scoped run from the app keeps its own directory but does not become "latest"
  if (opts.updateLatest !== false) writeFileSync(path.join(stateDir, "latest"), ledger.run_id + "\n");
  return dir;
}

export function latestRunId(stateDir: string): string | null {
  const p = path.join(stateDir, "latest");
  if (!existsSync(p)) return null;
  const id = readFileSync(p, "utf8").trim();
  return existsSync(runDir(stateDir, id)) ? id : null;
}

export function listRuns(stateDir: string): string[] {
  const p = path.join(stateDir, "runs");
  if (!existsSync(p)) return [];
  return readdirSync(p).sort();
}

export function readEntity<T>(stateDir: string, runId: string, name: EntityName): T[] {
  const p = path.join(runDir(stateDir, runId), "ledger", `${name}.ndjson`);
  if (!existsSync(p)) return [];
  return readFileSync(p, "utf8")
    .split("\n")
    .filter((l) => l.trim().length > 0)
    .map((l) => JSON.parse(l) as T);
}

export function appendLabel(stateDir: string, label: Label): void {
  mkdirSync(stateDir, { recursive: true });
  appendFileSync(path.join(stateDir, "labels.ndjson"), JSON.stringify(Label.parse(label)) + "\n");
}

export function readLabels(stateDir: string): Label[] {
  const p = path.join(stateDir, "labels.ndjson");
  if (!existsSync(p)) return [];
  const out: Label[] = [];
  for (const line of readFileSync(p, "utf8").split("\n")) {
    if (!line.trim()) continue;
    const parsed = Label.safeParse(JSON.parse(line));
    if (parsed.success) out.push(parsed.data);
  }
  return out;
}

export function newRunId(now = new Date()): string {
  return now.toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
}
