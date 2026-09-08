import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";

export interface JsonLine {
  n: number;
  obj: Record<string, unknown> | null;
  bytes: number;
}

/** Line-tolerant JSONL: a bad line yields obj=null and is counted, never fatal. */
export async function* readJsonLines(file: string): AsyncGenerator<JsonLine> {
  const rl = createInterface({ input: createReadStream(file, { encoding: "utf8" }), crlfDelay: Infinity });
  let n = 0;
  for await (const line of rl) {
    n += 1;
    const trimmed = line.trim();
    if (!trimmed) {
      yield { n, obj: null, bytes: line.length };
      continue;
    }
    try {
      const parsed: unknown = JSON.parse(trimmed);
      yield { n, obj: parsed !== null && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null, bytes: line.length };
    } catch {
      yield { n, obj: null, bytes: line.length };
    }
  }
}

export async function peekJsonLines(file: string, max: number): Promise<Record<string, unknown>[]> {
  const out: Record<string, unknown>[] = [];
  for await (const l of readJsonLines(file)) {
    if (l.obj) out.push(l.obj);
    if (out.length >= max) break;
  }
  return out;
}

export const str = (v: unknown): string | null => (typeof v === "string" ? v : null);
export const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);
export const rec = (v: unknown): Record<string, unknown> | null => (v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null);
export const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
