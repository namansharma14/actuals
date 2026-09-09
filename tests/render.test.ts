import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ReportSchema, type Report } from "../src/schema/socket.js";
import { renderHtml } from "../src/render/html.js";
import { renderShareText } from "../src/render/share.js";
import { renderStickerSvg } from "../src/render/sticker.js";

const FIXTURE_URL = new URL("../eval/fixtures/socket/report.fixture.json", import.meta.url);
const raw = JSON.parse(readFileSync(FIXTURE_URL, "utf8"));

const EM_DASH = "—";

describe("eval/fixtures/socket/report.fixture.json", () => {
  it("validates against ReportSchema (a)", () => {
    const parsed = ReportSchema.safeParse(raw);
    if (!parsed.success) {
      throw new Error(`fixture failed schema validation: ${JSON.stringify(parsed.error.issues.slice(0, 10))}`);
    }
    expect(parsed.success).toBe(true);
  });
});

const report: Report = ReportSchema.parse(raw);
const html = renderHtml(report, { redact: false });
const redactedHtml = renderHtml(report, { redact: true });
const shareSvg = renderStickerSvg(report);
const shareText = renderShareText(report);

describe("renderHtml", () => {
  it("contains each headline value with its mark, and the closing line (b)", () => {
    const h = report.headline;
    // cost_usd: $2,540 · estimated
    expect(html).toMatch(/\$2,540[\s\S]{0,120}estimated/);
    expect(html).toContain(">estimated<");
    // commits: 149 · measured
    expect(html).toMatch(/149[\s\S]{0,120}measured/);
    // cost_per_commit: $17.05 · estimated
    expect(html).toContain("$17.05");
    // files_alive: 182 of 207, 88% · measured
    expect(html).toContain("182");
    expect(html).toContain("207");
    expect(html).toMatch(/88%[\s\S]{0,120}measured/);
    // runs_no_fate: 80 · measured, cost 700
    expect(html).toMatch(/80[\s\S]{0,160}measured/);
    expect(html).toContain("$700");
    expect(h.cost_usd.mark).toBe("estimated");
    expect(h.commits.mark).toBe("measured");

    expect(html).toContain("What left your machine: nothing. Tokens spent making this: 0.");
  });

  it("makes no network-shaped request: no http(s), @import, or <script (b)", () => {
    for (const forbidden of ["http", "https://", "@import", "<script"]) {
      expect(html.toLowerCase()).not.toContain(forbidden.toLowerCase());
    }
  });

  it("kept work per dollar is always a number for a model that spent, and the column says what 0 means", () => {
    // the fixture's claude-fable-5 spent $56.60 and landed nothing: 0.000, never "not measurable"
    expect(html).not.toContain("not measurable");
    expect(html).toContain(">0.000<");
    expect(html).toContain("kept work per dollar; 0 means nothing landed");
    expect(html).toContain("not available yet");
  });

  it("redact:true carries no session title from the fixture (c)", () => {
    for (const s of report.sessions) {
      expect(redactedHtml).not.toContain(s.title);
      expect(redactedHtml).toContain(`session ${s.id.slice(0, 8)}`);
    }
    expect(redactedHtml).not.toContain(report.repo_path);
    expect(redactedHtml).toContain("redacted");
    // Non-redacted render does carry the real title and path, proving the switch does something.
    expect(html).toContain(report.sessions[0]!.title);
    expect(html).toContain(report.repo_path);
  });

  it("redact:true also strips file paths and /insights goal text", () => {
    for (const fix of report.fixes) {
      if (fix.target_file) expect(redactedHtml).not.toContain(fix.target_file);
    }
    for (const top of report.burn.rereads.top) {
      expect(redactedHtml).not.toContain(top.path);
    }
    const claimedSession = report.sessions.find((s) => s.claimed);
    expect(claimedSession).toBeDefined();
    expect(redactedHtml).not.toContain(claimedSession!.claimed!.goal);
  });
});

describe("renderHtml as a hosted copy", () => {
  const hosted = renderHtml(report, { redact: true, hosted: true });
  it("says what is true on a page that exists because the report was uploaded", () => {
    expect(hosted).toContain("hosted copy · read locally · 0 tokens spent");
    expect(hosted).toContain("What left the machine: this redacted report and one PNG. Tokens spent making this: 0.");
    expect(hosted).not.toContain("0 bytes uploaded");
    expect(hosted).not.toContain("What left your machine: nothing");
    expect(html).toContain("What left your machine: nothing. Tokens spent making this: 0.");
    // the marks legend and fate states read as a stranger would; the fixture's own session titles may say anything, so check the redacted render
    expect(redactedHtml.toLowerCase()).not.toContain("founder");
  });
});

describe("renderHtml in app mode", () => {
  const appHtml = renderHtml(report, { redact: false, app: { token: "tok-test-123", port: 43123, catalog: report.sessions.map((s) => ({ id: s.id, date: s.date, title: s.title, cost_usd: s.cost_usd, agents: s.agents, peak_concurrency: s.peak_concurrency })), projects: [], project: "", repoTab: { slug: "", sessions: 0 }, scope: { since: null, until: null, sessionIds: null }, applied: [report.fixes[0]!.id], staticPath: "/tmp/x/report.html" } });
  it("adds the picker, drawer, fix actions and one inline script, still with no absolute URL and no em dash", () => {
    expect(appHtml).toContain("<script>");
    expect(appHtml).toContain("tok-test-123");
    expect(appHtml).toContain('id="picker"');
    expect(appHtml).toContain('id="drawer"');
    expect(appHtml).toContain(`data-fix="${report.fixes[0]!.id}" data-applied="1"`);
    expect(appHtml).toContain(`data-fix="${report.fixes[1]!.id}" data-applied="0"`);
    expect(appHtml).not.toContain(`data-fix="${report.fixes.find((f) => !f.available)!.id}"`);
    expect(appHtml).toContain("sessions with trees, click to draw");
    // the one absolute URL is the X post intent the user clicks; nothing else is network-shaped
    expect(appHtml).toMatch(/<a class="btn" id="stk-x" href="https:\/\/x\.com\/intent\/post\?text=[^"]+" target="_blank" rel="noopener noreferrer">/);
    // the card's XML namespace is an identifier, not an address; nothing fetches it
    expect(appHtml.replace(/<a class="btn" id="stk-x" href="[^"]*"/, "").replace(/http%3A%2F%2Fwww\.w3\.org%2F2000%2Fsvg|http:\/\/www\.w3\.org\/2000\/svg/g, "").toLowerCase()).not.toContain("http");
    expect(appHtml).toContain('<canvas id="sticker"');
    expect(appHtml).not.toContain("@import");
    expect(appHtml).not.toContain(EM_DASH);
  });
  it("the static render is unchanged by the app layer: no script, no picker", () => {
    expect(html).not.toContain("<script");
    expect(html).not.toContain('id="picker"');
    expect(html).toContain("other peaks");
  });
});

describe("the share card: renderStickerSvg / renderShareText", () => {
  it("contain none of the fixture's session titles or file paths, and contain the aggregate numbers (d)", () => {
    const s = report.share;
    for (const output of [shareSvg, shareText]) {
      for (const session of report.sessions) expect(output).not.toContain(session.title);
      for (const fix of report.fixes) if (fix.target_file) expect(output).not.toContain(fix.target_file);
      for (const top of report.burn.rereads.top) expect(output).not.toContain(top.path);
      expect(output).not.toContain(report.repo_path);

      expect(output).toContain(String(s.agent_runs));
      expect(output).toContain(String(s.commits));
      expect(output).toContain(String(s.runs_no_fate));
      expect(output).toContain("$17.05");
      expect(output).toContain("88%");
    }
    expect(shareText).toContain("measured by actuals");
    expect(shareText).toContain(String(s.biggest_tree)); // the card draws the tree instead of naming it
  });

  it("the card is one dark composition with npx actuals as its call to action, legible in a phone screenshot", () => {
    expect(shareSvg).toContain('viewBox="0 0 1080 1080"');
    expect(shareSvg).toContain("#0B0E12"); // the artboard
    expect(shareSvg).toContain("npx actuals");
    expect(shareSvg).toContain("getactuals.net");
    expect(shareSvg).not.toContain("Gradient"); // no gradients, no glow
    expect(shareSvg).not.toContain("filter=");
    // the call to action is set large enough to survive a screenshot, every label large enough to read
    const cta = /<text [^>]*font-size="(\d+)"[^>]*>npx actuals</.exec(shareSvg);
    expect(Number(cta![1])).toBeGreaterThanOrEqual(34);
    const sizes = [...shareSvg.matchAll(/<text [^>]*font-size="(\d+)"/g)].map((m) => Number(m[1]));
    expect(sizes.length).toBeGreaterThan(8);
    expect(Math.min(...sizes)).toBeGreaterThanOrEqual(23);
  });

  it("share.svg is well-formed enough to open standalone (has xmlns, no script, no re-quoted attributes)", () => {
    expect(shareSvg).toContain('xmlns="http://www.w3.org/2000/svg"');
    expect(shareSvg.toLowerCase()).not.toContain("<script");
    // A double quote inside a double-quoted attribute value (e.g. a font stack with an
    // embedded "Name") breaks XML well-formedness. Every `="..."` run must be followed
    // by whitespace, `/`, or `>`, never another bare character.
    expect(shareSvg).not.toMatch(/="[^"]*"[^\s/>]/);
  });
});

describe("no em dash anywhere in rendered output (e)", () => {
  it.each([
    ["renderHtml", html],
    ["renderHtml redacted", redactedHtml],
    ["renderStickerSvg", shareSvg],
    ["renderShareText", shareText],
  ])("%s", (_name, output) => {
    expect(output).not.toContain(EM_DASH);
  });
});

/**
 * The report is numbers first, words second (founder, 2026-09-07: "extremely verbose"). This
 * counts the prose a reader sees by default (headings, paragraphs, list items, fine print and
 * notes outside closed disclosures; never code, SVG or data cells) and holds it under half of
 * what the page carried before the trim (static 417, app 503 on this fixture).
 */
describe("visible prose budget", () => {
  const words = (t: string) => t.replace(/<[^>]+>/g, " ").replace(/&[a-z#0-9]+;/g, " ").split(/\s+/).filter((w) => /[A-Za-z]/.test(w)).length;
  function visibleProse(page: string): number {
    let s = page.replace(/<style[\s\S]*?<\/style>/g, " ").replace(/<script[\s\S]*?<\/script>/g, " ").replace(/<svg[\s\S]*?<\/svg>/g, " ").replace(/<pre[\s\S]*?<\/pre>/g, " ");
    s = s.replace(/<details(?![^>]*\bopen\b)[^>]*>([\s\S]*?)<\/details>/g, (_m, inner: string) => " " + (/<summary>([\s\S]*?)<\/summary>/.exec(inner)?.[1] ?? "") + " ");
    let n = 0;
    for (const re of [/<h2[^>]*>([\s\S]*?)<\/h2>/g, /<p\b[^>]*>([\s\S]*?)<\/p>/g, /<li>([\s\S]*?)<\/li>/g, /<(?:div|span) class="(?:fine|next|insight|legend-line)[^"]*"[^>]*>([\s\S]*?)<\/(?:div|span)>/g, /<div class="muted">([\s\S]*?)<\/div>/g]) {
      let m; while ((m = re.exec(s))) n += words(m[1]!);
    }
    return n;
  }
  it("the static report shows under 210 words of prose by default", () => {
    expect(visibleProse(html)).toBeLessThan(210);
  });
  it("the app page shows under 252 words of prose by default", () => {
    const appHtml = renderHtml(report, { redact: false, app: { token: "tok", port: 43123, catalog: report.sessions.map((s) => ({ id: s.id, date: s.date, title: s.title, cost_usd: s.cost_usd, agents: s.agents, peak_concurrency: s.peak_concurrency })), projects: [], project: "", repoTab: { slug: "", sessions: report.sessions.length }, scope: { since: null, until: null, sessionIds: null }, applied: [], staticPath: "/tmp/x/report.html" } });
    expect(visibleProse(appHtml)).toBeLessThan(252);
  });
  it("the words moved, they were not removed: the folded explainers are still in the page", () => {
    for (const s of ["How this was measured", "Cost per run is real", "one run, drawn to its start and end", "never a prompt, a path, a file name, or a line of code", "undo restores the file byte for byte"]) expect(html).toContain(s);
    expect(html).toContain("Run actuals app to click into any session.");
  });
});
