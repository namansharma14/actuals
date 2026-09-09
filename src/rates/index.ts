/**
 * Pricing at list rates. Exact id → longest-prefix match → family word →
 * fallback. Anything past an exact or prefix match is `assumed` and says so.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Mark, Usage } from "../schema/ledger.js";

export interface Rate {
  input: number;
  cache_write_5m: number;
  cache_write_1h: number;
  cache_read: number;
  output: number;
  provenance: "published" | "assumed";
}
export interface RatesTable {
  rates_version: string;
  source: string;
  as_of: string;
  models: Record<string, Rate>;
  families: Record<string, string>;
  fallback: string;
}

let cached: RatesTable | null = null;
export function loadRates(): RatesTable {
  if (cached) return cached;
  const here = path.dirname(fileURLToPath(import.meta.url));
  // src/rates/index.ts → ../../rates.json ; dist/cli.js → ../rates.json ; the copy behind
  // watch keeps rates.json beside cli.js, so the same folder counts too
  const candidates = [path.join(here, "..", "..", "rates.json"), path.join(here, "..", "rates.json"), path.join(here, "rates.json"), path.join(process.cwd(), "rates.json")];
  for (const c of candidates) {
    try {
      cached = JSON.parse(readFileSync(c, "utf8")) as RatesTable;
      return cached;
    } catch {
      /* try next */
    }
  }
  throw new Error("rates.json not found next to the package");
}

export interface Resolved {
  key: string;
  rate: Rate;
  mark: Mark;
}

/** Normalise vendor id variants: strip date suffixes and provider prefixes. */
function normalise(model: string): string {
  let m = model.trim().toLowerCase();
  m = m.replace(/^(anthropic\.|us\.anthropic\.|eu\.anthropic\.)/, "");
  m = m.replace(/-\d{8}(-v\d+:\d+)?$/, ""); // -20250514 or bedrock -v1:0
  m = m.replace(/\[.*\]$/, ""); // fable[1m]
  m = m.replace(/@\d{8}$/, ""); // vertex: claude-sonnet-4@20250514
  // the older naming order, claude-3-5-haiku, is the published claude-haiku-3-5
  m = m.replace(/^claude-(\d+(?:-\d+)*)-(opus|sonnet|haiku)$/, "claude-$2-$1");
  return m;
}

export function resolveRate(model: string, table: RatesTable = loadRates()): Resolved {
  const m = normalise(model);
  const exact = table.models[m];
  if (exact) return { key: m, rate: exact, mark: exact.provenance === "published" ? "estimated" : "assumed" };
  let best: string | null = null;
  for (const key of Object.keys(table.models)) {
    if (m.startsWith(key) && (best === null || key.length > best.length)) best = key;
  }
  if (best) return { key: best, rate: table.models[best]!, mark: "estimated" };
  for (const [word, key] of Object.entries(table.families)) {
    if (m.includes(word)) return { key, rate: table.models[key]!, mark: "assumed" };
  }
  return { key: table.fallback, rate: table.models[table.fallback]!, mark: "assumed" };
}

export function costOf(usage: Usage, rate: Rate): number {
  return (
    (usage.input * rate.input +
      usage.output * rate.output +
      usage.cache_read * rate.cache_read +
      usage.cache_write_5m * rate.cache_write_5m +
      usage.cache_write_1h * rate.cache_write_1h) /
    1_000_000
  );
}
