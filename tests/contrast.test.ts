import { describe, expect, it } from "vitest";
import { TOKENS_CSS } from "../src/render/tokens.js";
import { APP_CSS } from "../src/render/app.js";
import { CSS } from "../src/render/html.js";

/** WCAG 2.1 relative luminance and contrast ratio. */
const lin = (c: number): number => { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
const lum = (hex: string): number => { const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)); return 0.2126 * lin(r!) + 0.7152 * lin(g!) + 0.0722 * lin(b!); };
const contrast = (a: string, b: string): number => { const la = lum(a), lb = lum(b); const hi = Math.max(la, lb), lo = Math.min(la, lb); return (hi + 0.05) / (lo + 0.05); };

/** The dark :root block only (the report on screen); the print block is a separate light theme. */
function darkTokens(): Record<string, string> {
  const block = TOKENS_CSS.slice(TOKENS_CSS.indexOf(":root"), TOKENS_CSS.indexOf("@media"));
  const out: Record<string, string> = {};
  for (const m of block.matchAll(/(--[\w-]+):\s*(#[0-9A-Fa-f]{6})/g)) out[m[1]!] = m[2]!;
  return out;
}

/** The @media print block: the light theme the report prints in. */
function lightTokens(): Record<string, string> {
  const at = TOKENS_CSS.indexOf("@media");
  const start = TOKENS_CSS.indexOf(":root", at);
  const block = TOKENS_CSS.slice(start, TOKENS_CSS.indexOf("}", start));
  const out: Record<string, string> = {};
  for (const m of block.matchAll(/(--[\w-]+):\s*(#[0-9A-Fa-f]{6})/g)) out[m[1]!] = m[2]!;
  return out;
}

describe("report text tokens pass WCAG AA on their ground (dark theme)", () => {
  const t = darkTokens();
  // faint text is small (<=10.5px: .fine, .lab, .svg-lab, .rail, .claimed), so it needs 4.5:1, not 3:1.
  const grounds: Array<[string, string]> = [["--bg", t["--bg"]!], ["--panel", t["--panel"]!]];
  for (const token of ["--faint", "--muted", "--text", "--ink", "--mark", "--warn"]) {
    for (const [gname, g] of grounds) {
      it(`${token} on ${gname} is at least 4.5:1`, () => {
        expect(contrast(t[token]!, g)).toBeGreaterThanOrEqual(4.5);
      });
    }
  }
});

/** The narrow/phone instrument keeps every label legible: the desktop SVG scales one wide
 * viewBox down until 10px labels fall under readable on a phone, so a separate narrow SVG is
 * drawn to its own viewBox with a min-width equal to that viewBox (it never scales below 1:1)
 * and a font-size floor, and it carries at most half the desktop's x-ticks. */
describe("the narrow instrument's labels stay at a legible floor (>= 12px on screen)", () => {
  const usage = { input: 1, output: 1, cache_read: 0, cache_write_5m: 0, cache_write_1h: 0 };
  const at = (m: number) => `2026-08-31T10:${String(m).padStart(2, "0")}:00.000Z`;
  const mk = (id: string, s: number, e: number, depth: number, fate: string) => ({ run_id: "r", id, session_id: "S", parent_run_id: null, depth, spawned_by: "user", agent_type: "x", description: id, model: "claude-opus-5", source_file: null, started_at: at(s), ended_at: at(e), turns: 1, usage, cost_usd: 1, cost_mark: "estimated", final_text_chars: 400, final_text_sample: "", files_written: [], spawned: 0, last_tool_call_unanswered: fate === "died", fate, fate_evidence: "" });
  // a peak of 3 and a death, so peak-callout, died and cap annotations all render.
  const RUNS = [mk("r1", 0, 30, 1, "finished_unlanded"), mk("r2", 10, 40, 2, "finished_unlanded"), mk("r3", 20, 25, 3, "finished_unlanded"), mk("r4", 35, 55, 1, "died")];

  async function svgs() {
    const { timelineSvg, timelineSvgNarrow } = await import("../src/render/html.js");
    const { timelineFor } = await import("../src/report/index.js");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const tl = timelineFor({ id: "S", date: "2026-08-31", title: "narrow" }, RUNS as any, false)!;
    return { wide: timelineSvg(tl), narrow: timelineSvgNarrow(tl) };
  }

  it("never scales below 1:1 — min-width equals the viewBox width, so 12px is 12px on screen", async () => {
    const { narrow } = await svgs();
    const vb = narrow.match(/viewBox="0 0 (\d+) \d+"/);
    const mw = narrow.match(/min-width:\s*(\d+)px/);
    expect(vb).not.toBeNull();
    expect(mw).not.toBeNull();
    expect(Number(mw![1])).toBeGreaterThanOrEqual(Number(vb![1])); // scale >= 1 at every width
    const fs = narrow.match(/<svg[^>]*\sfont-size="(\d+)"/);
    expect(fs).not.toBeNull();
    expect(Number(fs![1])).toBeGreaterThanOrEqual(12); // the label floor, independent of the stylesheet
  });

  it("does not leak the desktop 10px label class into the narrow SVG", async () => {
    const { narrow } = await svgs();
    expect(narrow).toContain('class="svg-lab-n"');
    // the 10px desktop class, whether bare or with a modifier (svg-lab mk / svg-lab warn); svg-lab-n must not trip it
    expect(narrow).not.toMatch(/class="svg-lab[" ]/);
  });

  it("carries at most half the desktop's x-axis time labels", async () => {
    const { wide, narrow } = await svgs();
    const clocks = (svg: string) => (svg.match(/text-anchor="middle"/g) ?? []).length;
    const w = clocks(wide), n = clocks(narrow);
    expect(w).toBeGreaterThan(0);
    expect(n).toBeGreaterThan(0);
    expect(n).toBeLessThanOrEqual(Math.ceil(w / 2));
  });
});


/** The drawer legibility pass (landing gate): its floors are asserted here so a future edit cannot
 * quietly shrink drawer text back under the readable line, and so marks (which carry provenance)
 * stay crisp enough to read at a glance. */
describe("the rail token clears contrast on the embed's light ground (axe: the rail failed at --faint)", () => {
  it("--muted (the rail/footer token) is at least 4.5:1 on both light-theme grounds", () => {
    const t = lightTokens();
    for (const g of ["--bg", "--panel"]) expect(contrast(t["--muted"]!, t[g]!)).toBeGreaterThanOrEqual(4.5);
  });
  it("--faint would have failed there (documents why the rail moved off it)", () => {
    const t = lightTokens();
    expect(contrast(t["--faint"]!, t["--panel"]!)).toBeLessThan(4.5);
  });
});

describe("the token extractors read the whole block (a nested } would truncate silently)", () => {
  it("each theme yields its full token set", () => {
    expect(Object.keys(darkTokens()).length).toBeGreaterThanOrEqual(10);
    expect(Object.keys(lightTokens()).length).toBeGreaterThanOrEqual(10);
  });
});

describe("the report/app legibility floors are global (not scoped to any container)", () => {
  const ALLCSS = CSS + APP_CSS;
  const sizeOf = (sel: string): number | null => {
    const m = ALLCSS.match(new RegExp(sel.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\s*\\{[^}]*font-size:\\s*(\\d+(?:\\.\\d+)?)px"));
    return m ? Number(m[1]) : null;
  };
  it("marks >= 12px and other text >= 13px, unscoped (the landing loads the report outside .drawer)", () => {
    expect(sizeOf(".mark")).toBeGreaterThanOrEqual(12);
    expect(sizeOf(".lab")).toBeGreaterThanOrEqual(13);
    expect(sizeOf(".fine")).toBeGreaterThanOrEqual(13);
    expect(sizeOf(".svg-lab")).toBeGreaterThanOrEqual(12);
    expect(sizeOf(".dr-run > summary")).toBeGreaterThanOrEqual(13);
    expect(sizeOf(".dr-run-more")).toBeGreaterThanOrEqual(13);
    expect(sizeOf(".dr-run-more .k")).toBeGreaterThanOrEqual(12);
    expect(sizeOf(".dr-row .st")).toBeGreaterThanOrEqual(12);
  });
  it("the faint token is never used for text — color or fill — in either stylesheet", () => {
    expect(ALLCSS).not.toMatch(/(?:color|fill):\s*var\(--faint\)/);
  });
  it("the mark token (one, shared) clears 6.4:1 on both grounds in both themes", () => {
    for (const t of [darkTokens(), lightTokens()])
      for (const g of ["--bg", "--panel"]) expect(contrast(t["--mark"]!, t[g]!)).toBeGreaterThanOrEqual(6.4);
  });
  it("keeps the prominence order faint < muted < mark < text on every ground and theme", () => {
    for (const t of [darkTokens(), lightTokens()])
      for (const g of ["--bg", "--panel"]) {
        const c = (k: string) => contrast(t[k]!, t[g]!);
        expect(c("--faint")).toBeLessThan(c("--muted"));
        expect(c("--muted")).toBeLessThan(c("--mark"));
        expect(c("--mark")).toBeLessThan(c("--text"));
      }
  });
});
