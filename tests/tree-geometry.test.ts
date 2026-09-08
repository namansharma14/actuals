import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { concurrencyCurve, fateColour, fateTone, laneRuns, peakOf, timeScale, type GeoRun } from "../src/render/tree-geometry.js";
import { timelineFor } from "../src/report/index.js";
import type { Run } from "../src/schema/ledger.js";

const usage = { input: 1, output: 1, cache_read: 0, cache_write_5m: 0, cache_write_1h: 0 };
const at = (m: number) => `2026-08-31T10:${String(m).padStart(2, "0")}:00.000Z`;
function run(id: string, s: number, e: number, depth: number, fate: Run["fate"]): Run {
  return { run_id: "r", id, session_id: "S", parent_run_id: null, depth, spawned_by: "user", agent_type: "x", description: id, model: "claude-opus-5", source_file: null, started_at: at(s), ended_at: at(e), turns: 1, usage, cost_usd: 1, cost_mark: "estimated", final_text_chars: 400, final_text_sample: "", files_written: [], spawned: 0, last_tool_call_unanswered: fate === "died", fate, fate_evidence: "" };
}
const RUNS: Run[] = [run("r1", 0, 30, 1, "finished_unlanded"), run("r2", 10, 40, 2, "finished_unlanded"), run("r3", 35, 50, 1, "died"), run("r4", 20, 25, 3, "finished_unlanded")];
const geo: GeoRun[] = RUNS.map((r) => ({ id: r.id, start: r.started_at!, end: r.ended_at!, depth: r.depth, fate: r.fate }));

describe("the tree renders byte-identically after the geometry was lifted out", () => {
  it("timelineSvg matches the golden captured before the refactor", async () => {
    const { timelineSvg } = await import("../src/render/html.js");
    const tl = timelineFor({ id: "S", date: "2026-08-31", title: "golden" }, RUNS, false)!;
    // golden regenerated 2026-09-06: peak callout is the accent (--mark), warm = died only; the cap annotation is a label (--faint), not an accent.
    const golden = readFileSync(path.join(__dirname, "fixtures", "timeline.golden.txt"), "utf8");
    expect(timelineSvg(tl)).toBe(golden);
  });
});

describe("timeScale", () => {
  it("maps t0 to left, t1 to left+width, linearly, and clamps a zero span", () => {
    const x = timeScale(0, 100, 200, 10);
    expect(x(0)).toBe(10);
    expect(x(100)).toBe(210);
    expect(x(50)).toBe(110);
    expect(x("1970-01-01T00:00:00.050Z")).toBe(110); // 50 ms as an ISO instant
    expect(timeScale(5, 5, 200, 0)(5)).toBe(0); // span clamps to 1, no divide-by-zero
  });
});

describe("concurrencyCurve", () => {
  it("is a step function bracketed by zero at both ends, rising to the peak", () => {
    const pts = concurrencyCurve(geo, new Date(at(0)).getTime(), new Date(at(50)).getTime());
    expect(pts[0]).toEqual([new Date(at(0)).getTime(), 0]);
    expect(pts[pts.length - 1]).toEqual([new Date(at(50)).getTime(), 0]);
    expect(Math.max(...pts.map((p) => p[1]))).toBe(3); // r1, r2, r4 all alive 20..25
  });
  it("applies an end before a start at the same instant (a hand-off is not a phantom agent)", () => {
    const back = [
      { id: "a", start: at(0), end: at(10), depth: 1, fate: "finished_unlanded" },
      { id: "b", start: at(10), end: at(20), depth: 1, fate: "finished_unlanded" },
    ];
    const pts = concurrencyCurve(back, new Date(at(0)).getTime(), new Date(at(20)).getTime());
    expect(Math.max(...pts.map((p) => p[1]))).toBe(1); // never two at once
  });
});

describe("peakOf", () => {
  it("returns the height and first instant of the peak", () => {
    const { peak, at: peakAt } = peakOf(geo);
    expect(peak).toBe(3);
    expect(peakAt).toBe(new Date(at(20)).getTime());
  });
});

describe("fateTone and fateColour", () => {
  it("a death wins over depth; otherwise the depth band, capped at three", () => {
    expect(fateTone({ fate: "died", depth: 1 })).toBe("died");
    expect(fateTone({ fate: "finished_unlanded", depth: 0 })).toBe("d1");
    expect(fateTone({ fate: "finished_unlanded", depth: 1 })).toBe("d1");
    expect(fateTone({ fate: "finished_unlanded", depth: 2 })).toBe("d2");
    expect(fateTone({ fate: "finished_unlanded", depth: 5 })).toBe("d3");
    expect(fateColour({ fate: "died", depth: 1 })).toBe("var(--warn)");
    expect(fateColour({ fate: "finished_unlanded", depth: 2 })).toBe("var(--d2)");
  });
});

describe("laneRuns (first-fit)", () => {
  it("packs non-overlapping runs onto the same lane, opens a new lane only when needed", () => {
    const { placed, lanes } = laneRuns(geo);
    const lane = (id: string) => placed.find((p) => p.run.id === id)!.lane;
    expect(lanes).toBe(3);
    expect(lane("r1")).toBe(0);
    expect(lane("r2")).toBe(1);
    expect(lane("r4")).toBe(2);
    expect(lane("r3")).toBe(0); // r1 ended at :30, r3 starts at :35, so it reuses lane 0
  });
  it("lets a touching pair share a lane (end == next start)", () => {
    const { lanes } = laneRuns([
      { id: "a", start: at(0), end: at(10), depth: 1, fate: "x" },
      { id: "b", start: at(10), end: at(20), depth: 1, fate: "x" },
    ]);
    expect(lanes).toBe(1);
  });
});
