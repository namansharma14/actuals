/**
 * Gates harness. `--score` runs every gate that has a measurer under
 * eval/measures/<gate>.ts, appends one entry per gate to eval/runs/accuracy.jsonl, and
 * renders ACCURACY.md. `--check` exits 1 if any ENFORCED gate is red or unmeasured.
 * ACCURACY.md is never hand-edited.
 */
import { existsSync, mkdirSync, readFileSync, appendFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parse as parseToml } from "smol-toml";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const GATES = path.join(ROOT, "eval", "gates.toml");
const LOG = path.join(ROOT, "eval", "runs", "accuracy.jsonl");
const OUT = path.join(ROOT, "ACCURACY.md");

/** Load ROOT/.env.local (gitignored) so a local `check`/`eval` can default machine-specific
 * settings such as ACTUALS_ACCEPT_REPO. An env var already set always wins; CI has no
 * .env.local and simply reads the last committed measurement. */
function loadDotenvLocal(): void {
  const f = path.join(ROOT, ".env.local");
  if (!existsSync(f)) return;
  for (const raw of readFileSync(f, "utf8").split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq < 0) continue;
    const k = line.slice(0, eq).trim();
    let v = line.slice(eq + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (k && process.env[k] === undefined) process.env[k] = v;
  }
}

interface Gate { title: string; kind: "min" | "max" | "max_abs_rel_error"; threshold: number; enforced: boolean }
export interface Measurement { gate: string; value: number | null; n: number; note: string; details?: Record<string, unknown> }
interface Entry extends Measurement { ts: string; status: "green" | "red" | "unmeasured"; enforced: boolean; threshold: number }

function status(g: Gate, value: number | null): Entry["status"] {
  if (value === null || Number.isNaN(value)) return "unmeasured";
  if (g.kind === "min") return value >= g.threshold ? "green" : "red";
  return value <= g.threshold ? "green" : "red";
}

async function measure(name: string): Promise<Measurement | null> {
  const p = path.join(ROOT, "eval", "measures", `${name}.ts`);
  if (!existsSync(p)) return null;
  const mod = (await import(pathToFileURL(p).href)) as { measure: () => Promise<Measurement> };
  return mod.measure();
}

function readLog(): Entry[] {
  if (!existsSync(LOG)) return [];
  return readFileSync(LOG, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l) as Entry);
}

function latestPerGate(entries: Entry[]): Map<string, Entry> {
  const m = new Map<string, Entry>();
  for (const e of entries) m.set(e.gate, e);
  return m;
}

function render(gates: Record<string, Gate>, latest: Map<string, Entry>): string {
  const lines = [
    "# ACCURACY.md",
    "",
    "Rendered by `npm run eval` from `eval/runs/accuracy.jsonl`. Never hand-edited. A red",
    "enforced gate blocks main; a waived gate (`enforced = false`) is waiting for its first",
    "real measurement and flips to enforced in the same change that lands it.",
    "",
    "| Gate | Target | Latest | n | Status | Enforced | Measured at | Note |",
    "|---|---|---|---|---|---|---|---|",
  ];
  for (const [name, g] of Object.entries(gates)) {
    const e = latest.get(name);
    const target = g.kind === "min" ? `≥ ${g.threshold}` : `≤ ${g.threshold}`;
    const val = e && e.value !== null ? String(Math.round(e.value * 10000) / 10000) : "not measured";
    const st = e ? e.status.toUpperCase() : "UNMEASURED";
    lines.push(`| ${name} · ${g.title} | ${target} | ${val} | ${e?.n ?? 0} | ${st} | ${g.enforced ? "yes" : "waived"} | ${e?.ts ?? ""} | ${e?.note ?? ""} |`);
  }
  lines.push("");
  return lines.join("\n");
}

async function main(): Promise<void> {
  loadDotenvLocal();
  const args = new Set(process.argv.slice(2));
  const gates = parseToml(readFileSync(GATES, "utf8")) as unknown as Record<string, Gate>;
  if (args.has("--score")) {
    mkdirSync(path.dirname(LOG), { recursive: true });
    for (const [name, g] of Object.entries(gates)) {
      const m = await measure(name);
      const entry: Entry = m
        ? { ...m, ts: new Date().toISOString(), status: status(g, m.value), enforced: g.enforced, threshold: g.threshold }
        : { gate: name, value: null, n: 0, note: "no measurer yet", ts: new Date().toISOString(), status: "unmeasured", enforced: g.enforced, threshold: g.threshold };
      appendFileSync(LOG, JSON.stringify(entry) + "\n");
      console.log(`${name}: ${entry.status} ${entry.value ?? ""} ${entry.note}`);
    }
  }
  const latest = latestPerGate(readLog());
  writeFileSync(OUT, render(gates, latest));
  if (args.has("--check")) {
    const failing = Object.entries(gates).filter(([name, g]) => g.enforced && latest.get(name)?.status !== "green");
    if (failing.length) {
      console.error("RED enforced gates: " + failing.map(([n]) => n).join(", "));
      process.exit(1);
    }
    console.log(`gates --check: ${Object.values(gates).filter((g) => g.enforced).length} enforced, all green; ${Object.values(gates).filter((g) => !g.enforced).length} waived until measured`);
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
