import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { TOKENS_CSS } from "../src/render/tokens.js";
import { CSS, renderHtml, treeSvg } from "../src/render/html.js";
import { ReportSchema } from "../src/schema/socket.js";

/** WCAG 2.1 relative luminance and contrast ratio. */
const lin = (c: number): number => { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
const lum = (hex: string): number => { const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)); return 0.2126 * lin(r!) + 0.7152 * lin(g!) + 0.0722 * lin(b!); };
const contrast = (a: string, b: string): number => { const la = lum(a), lb = lum(b); const hi = Math.max(la, lb), lo = Math.min(la, lb); return (hi + 0.05) / (lo + 0.05); };

/** The dark :root block only (the page on screen); the print block is a separate light theme. */
function darkTokens(): Record<string, string> {
  const block = TOKENS_CSS.slice(TOKENS_CSS.indexOf(":root"), TOKENS_CSS.indexOf("@media"));
  const out: Record<string, string> = {};
  for (const m of block.matchAll(/(--[\w-]+):\s*(#[0-9A-Fa-f]{6})/g)) out[m[1]!] = m[2]!;
  return out;
}

/** The @media print block: the light theme the page prints in. */
function lightTokens(): Record<string, string> {
  const at = TOKENS_CSS.indexOf("@media");
  const start = TOKENS_CSS.indexOf(":root", at);
  const block = TOKENS_CSS.slice(start, TOKENS_CSS.indexOf("}", start));
  const out: Record<string, string> = {};
  for (const m of block.matchAll(/(--[\w-]+):\s*(#[0-9A-Fa-f]{6})/g)) out[m[1]!] = m[2]!;
  return out;
}

/** The three grounds a word can land on: the page, a raised panel, the selected row. */
const GROUNDS = ["--bg", "--panel", "--selected"] as const;
/** Every token the Workbench sets text in. */
const TEXT_TOKENS = ["--faint", "--muted", "--text", "--ink", "--mark", "--warn"] as const;

describe("every text token clears AA on every ground, in both themes", () => {
  for (const [theme, t] of [["dark", darkTokens()], ["print", lightTokens()]] as const) {
    for (const token of TEXT_TOKENS) {
      for (const g of GROUNDS) {
        it(`${theme}: ${token} on ${g} is at least 4.5:1`, () => {
          expect(contrast(t[token]!, t[g]!)).toBeGreaterThanOrEqual(4.5);
        });
      }
    }
  }
});

describe("the retired 2.6:1 grey is never text", () => {
  const report = ReportSchema.parse(JSON.parse(readFileSync(new URL("../eval/fixtures/socket/report.fixture.json", import.meta.url), "utf8")));
  const app = renderHtml(report, { redact: false, app: { token: "t", port: 1, catalog: [], projects: [], project: "", repoTab: { slug: "", sessions: 0 }, scope: { since: null, until: null, sessionIds: null }, applied: [], staticPath: "/x" } });

  it("#4B5058 is never a text colour in the stylesheet, by name or by token", () => {
    expect(CSS).not.toMatch(/(?:color|fill):\s*#4B5058/i);
    expect(CSS).not.toMatch(/(?:color|fill):\s*var\(--dim\)/);
    expect(CSS).not.toMatch(/(?:color|fill):\s*var\(--dimmer\)/);
  });

  it("no inline style on the page sets text to it either", () => {
    expect(app).not.toMatch(/color:\s*#4B5058/i);
    expect(app).not.toMatch(/color:\s*var\(--dim\)/);
  });

  it("the row index, the hints, the shortcut letters and the esc control take the dim token instead", () => {
    for (const rule of [".wb-rn", ".wb-key", ".wb-hints", ".wb-hint", ".wb-esc", ".wb-fnote"]) {
      const found = new RegExp(rule.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "[^{]*\\{[^}]*color:\\s*var\\(--faint\\)").test(CSS);
      expect(found, `${rule} should take var(--faint)`).toBe(true);
    }
    // #4B5058 survives only as a bar and a swatch, never as a word
    expect(TOKENS_CSS).toContain("--dim: #4B5058");
  });

  it("the dim token clears 4.5:1 on all three dark grounds, so 11px text on it is legible", () => {
    const t = darkTokens();
    for (const g of GROUNDS) expect(contrast(t["--faint"]!, t[g]!)).toBeGreaterThanOrEqual(4.5);
  });
});

describe("the mark token stays at 6.4:1", () => {
  it("on every ground in both themes", () => {
    for (const t of [darkTokens(), lightTokens()])
      for (const g of GROUNDS) expect(contrast(t["--mark"]!, t[g]!)).toBeGreaterThanOrEqual(6.4);
  });
  it("keeps the prominence order faint < muted < mark < text", () => {
    for (const t of [darkTokens(), lightTokens()])
      for (const g of GROUNDS) {
        const c = (k: string) => contrast(t[k]!, t[g]!);
        expect(c("--faint")).toBeLessThan(c("--muted"));
        expect(c("--muted")).toBeLessThan(c("--mark"));
        expect(c("--mark")).toBeLessThan(c("--text"));
      }
  });
});

describe("no text on the page is set below 11px", () => {
  it("every font-size in the stylesheet is 11px or more", () => {
    const small = [...CSS.matchAll(/font-size:\s*([\d.]+)px/g)].map((m) => Number(m[1])).filter((n) => n < 11);
    expect(small).toEqual([]);
  });
  it("the mark and the caption are exactly the 11px the design asks for", () => {
    expect(/\.mark \{[^}]*font-size: 11px/.test(CSS)).toBe(true);
    expect(/\.lab \{[^}]*font-size: 11px/.test(CSS)).toBe(true);
  });
});

/**
 * The tree is drawn to a 640 unit viewBox and shown at 640 CSS pixels, so its labels never
 * scale: an 11 unit label is 11 pixels on a phone and on a desktop alike, and the wrapper
 * scrolls instead of shrinking the type.
 */
describe("the agent tree never scales its labels below the floor", () => {
  const at = (m: number) => `2026-08-31T10:${String(m).padStart(2, "0")}:00.000Z`;
  const t = {
    session_id: "S", date: "2026-08-31", title: "x", start: at(0), end: at(50), peak: 3, peak_at: at(20),
    died: 1, spawned_by_agents: 2,
    runs: [
      { id: "r1", start: at(0), end: at(30), depth: 1, fate: "finished_unlanded" as const },
      { id: "r2", start: at(10), end: at(40), depth: 2, fate: "finished_unlanded" as const },
      { id: "r3", start: at(20), end: at(25), depth: 3, fate: "finished_unlanded" as const },
      { id: "r4", start: at(35), end: at(50), depth: 1, fate: "died" as const },
    ],
  };
  const svg = treeSvg(t);

  it("the rendered width equals the viewBox width (scale 1), and the label floor is 11", () => {
    const vb = /viewBox="0 0 (\d+) (\d+)"/.exec(svg)!;
    const w = /<svg[^>]*\swidth="(\d+)"/.exec(svg)!;
    expect(Number(w[1])).toBe(Number(vb[1]));
    expect(Number(/<svg[^>]*\sfont-size="(\d+)"/.exec(svg)![1])).toBeGreaterThanOrEqual(11);
    expect(CSS).toMatch(/\.wb-tree-svg \{[^}]*width: 640px/);
    expect(CSS).toMatch(/\.wb-tree-wrap \{[^}]*overflow-x: auto/);
  });

  it("puts the bars at y 128, six units tall, and the peak dot on the curve", () => {
    expect(svg).toContain('y="128"');
    expect(svg).toContain('height="6"');
    expect(svg).toContain('fill="var(--warn)"'); // the run that died
    expect(svg).toMatch(/<circle [^>]*r="3\.5" fill="var\(--mark\)"/);
    expect(svg).toContain("3 at once");
    expect(svg).toContain('fill-opacity="0.06"');
  });
});
