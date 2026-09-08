import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CLIENT_JS, stickerData, xIntentUrl } from "../src/render/app.js";
import { ReportSchema } from "../src/schema/socket.js";

const report = ReportSchema.parse(JSON.parse(readFileSync(new URL("../eval/fixtures/socket/report.fixture.json", import.meta.url), "utf8")));

describe("the sticker carries aggregates only", () => {
  it("stickerData holds no title, path, prompt or file name from the fixture, and its numbers are report.share's", () => {
    const d = stickerData(report);
    const json = JSON.stringify(d);
    const absent = (s: string) => { if (s && s !== "(none)") expect(json).not.toContain(s); };
    for (const s of report.sessions) { absent(s.title); if (s.claimed) absent(s.claimed.goal); }
    for (const f of report.fixes) absent(f.target_file);
    for (const t of report.burn.rereads.top) absent(t.path);
    absent(report.repo_path);
    absent(report.burn.tree.timeline!.title);
    expect(d.runs).toBe(report.share.agent_runs);
    expect(d.commits).toBe(report.share.commits);
    expect(d.runs_no_fate).toBe(report.share.runs_no_fate);
    expect(d.biggest_tree).toBe(report.share.biggest_tree);
    expect(d.curve).not.toBeNull();
    expect(d.curve!.peak).toBe(report.burn.tree.timeline!.peak);
    expect(d.curve!.points[0]).toEqual([0, 0]);
    expect(d.curve!.points.at(-1)).toEqual([1, 0]);
    for (const [x, v] of d.curve!.points) { expect(x).toBeGreaterThanOrEqual(0); expect(x).toBeLessThanOrEqual(1); expect(v).toBeGreaterThanOrEqual(0); }
    expect(d.text).toContain("measured by actuals");
    expect(json).not.toContain("—");
  });

  it("the browser draw code reads A.sticker and nothing else from the page data", () => {
    const start = CLIENT_JS.indexOf("// sticker:"); const end = CLIENT_JS.indexOf("// share as a page:"); // the upload code sits after the draw code and is allowed to call the app
    expect(start).toBeGreaterThan(0); expect(end).toBeGreaterThan(start);
    const block = CLIENT_JS.slice(start, end);
    expect(block).toMatch(/A\.sticker/);
    expect(block.match(/\bA\.(?!sticker\b)\w+/g)).toBeNull();
    for (const forbidden of ["sessions", "title", "repo_path", "fixes", "rereads", "fetch(", "api("]) expect(block).not.toContain(forbidden);
    expect(block).toContain("toBlob");
    expect(block).toContain("ClipboardItem");
    expect(block).toContain("navigator.share");
  });

  it("the X intent carries the text card only, and no title or path", () => {
    const url = xIntentUrl(report);
    expect(url.startsWith("https://x.com/intent/post?text=")).toBe(true);
    const text = decodeURIComponent(url.slice("https://x.com/intent/post?text=".length));
    expect(text).toContain("npx actuals");
    expect(text).toContain("measured by actuals");
    for (const s of report.sessions) expect(text).not.toContain(s.title);
    expect(text).not.toContain(report.repo_path);
  });
});
