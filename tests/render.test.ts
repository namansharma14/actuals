import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ReportSchema, type Report } from "../src/schema/socket.js";
import { CSS, renderHtml, spendByDay, windowLabel, type RenderOpts } from "../src/render/html.js";
import { renderShareText } from "../src/render/share.js";
import { renderStickerSvg } from "../src/render/sticker.js";

const FIXTURE_URL = new URL("../eval/fixtures/socket/report.fixture.json", import.meta.url);
const raw = JSON.parse(readFileSync(FIXTURE_URL, "utf8"));

const EM_DASH = "—";

describe("eval/fixtures/socket/report.fixture.json", () => {
  it("validates against ReportSchema", () => {
    const parsed = ReportSchema.safeParse(raw);
    if (!parsed.success) throw new Error(`fixture failed schema validation: ${JSON.stringify(parsed.error.issues.slice(0, 10))}`);
    expect(parsed.success).toBe(true);
  });
});

const report: Report = ReportSchema.parse(raw);
const appRender: NonNullable<RenderOpts["app"]> = {
  token: "tok-test-123", port: 43123,
  catalog: report.sessions.map((s) => ({ id: s.id, date: s.date, title: s.title, cost_usd: s.cost_usd, agents: s.agents, peak_concurrency: s.peak_concurrency })),
  projects: [{ slug: "-a", label: "a", sessions: 3, last: null }], project: "", repoTab: { slug: "", sessions: 8 },
  scope: { since: null, until: null, sessionIds: null }, applied: [report.fixes[0]!.id], staticPath: "/tmp/x/report.html", dailyKept: { n: 26, m: 26 },
};
const embedRender = { drawers: { [report.sessions[0]!.id]: '<div class="wb-meta"><span>1 Sep</span></div>' } };

const html = renderHtml(report, { redact: false });
const redactedHtml = renderHtml(report, { redact: true });
const appHtml = renderHtml(report, { redact: false, app: appRender });
const embedHtml = renderHtml(report, { redact: true, embed: embedRender });
const shareSvg = renderStickerSvg(report);
const shareText = renderShareText(report);

describe("the three modes come out of one template", () => {
  it("app: the live controls, the token, one inline script, and no absolute URL but the post intent", () => {
    expect(appHtml).toContain("<script>");
    expect(appHtml).toContain("tok-test-123");
    expect(appHtml).toContain('data-sheet="fixes"');
    expect(appHtml).toContain('data-sheet="share"');
    expect(appHtml).toContain('data-project="*"'); // the scope toggle
    expect(appHtml).toContain('id="wb-q"'); // the filter
    expect(appHtml).toContain('id="tab-live"');
    expect(appHtml).toContain('<canvas id="sticker"');
    expect(appHtml).toContain('data-fix="' + report.fixes[0]!.id + '" data-applied="1"');
    expect(appHtml).toContain('data-fix="' + report.fixes[1]!.id + '" data-applied="0"');
    // the one absolute URL is the post the user clicks; the card's XML namespace is an identifier
    expect(appHtml).toMatch(/<a class="wb-fbtn ghost" id="stk-x" href="https:\/\/x\.com\/intent\/post\?text=[^"]+"/);
    const rest = appHtml.replace(/<a class="wb-fbtn ghost" id="stk-x" href="[^"]*"/, "").replace(/http%3A%2F%2Fwww\.w3\.org%2F2000%2Fsvg|http:\/\/www\.w3\.org\/2000\/svg/g, "");
    expect(rest.toLowerCase()).not.toContain("http");
    expect(appHtml).not.toContain(EM_DASH);
  });

  it("embed: the per-session views inlined, no server, no absolute URL, labels read-only", () => {
    expect(embedHtml).toContain("window.__actualsEmbed");
    expect(embedHtml).toContain(report.sessions[0]!.id);
    for (const api of ["/api/session", "/api/label", "/api/run", "/api/fix", "/api/live"]) expect(embedHtml).not.toContain(api);
    expect(embedHtml).not.toContain("x-actuals-token");
    expect(embedHtml.replace(/http:\/\/www\.w3\.org\/2000\/svg/g, "").toLowerCase()).not.toContain("http");
    expect(embedHtml).toContain("labels are saved in the app");
    expect(embedHtml).not.toContain(EM_DASH);
  });

  it("static: no script at all, the overview and the session list as plain rows, print keeps the overview", () => {
    expect(html).not.toContain("<script");
    expect(html).not.toContain("window.__actuals");
    expect(html).not.toContain('id="wb-q"');
    expect(html).not.toContain("panel-live");
    expect(html).toContain('class="wb-pane wb-staticlist noprint"');
    expect(html).toContain('class="wb-row"'); // rows, not buttons
    expect(html).not.toContain('class="wb-row" data-session=');
    expect(html).toMatch(/@media print \{[\s\S]*?\.wb-staticlist[^}]*display: none/);
    expect(/https?:\/\//.test(html)).toBe(false);
    // the static file still says what left, which is the sentence the pipeline check reads
    expect(html).toContain("What left your machine: nothing. Tokens spent making this: 0.");
  });
});

describe("every figure carries its mark, in the design's caption idiom", () => {
  const receipt = html.slice(html.indexOf('class="wb-receipt"'), html.indexOf('class="wb-block"'));
  it("the four receipt captions each end in a mark", () => {
    expect(receipt).toContain('spent at list rates <span class="mark">estimated</span>');
    expect(receipt).toContain('commits <span class="mark">measured</span>');
    expect(receipt).toContain('per commit <span class="mark">estimated</span>');
    expect(receipt).toContain('runs that left nothing · $700 <span class="mark">measured</span>');
    // four figures, four marks: no number without one
    expect((receipt.match(/class="wb-recv/g) ?? []).length).toBe(4);
    expect((receipt.match(/class="mark"/g) ?? []).length).toBe(4);
  });
  it("the hero keeps its own mark, and the overview row shows the spend with one", () => {
    expect(html).toContain('<div class="mark">measured from disk and git</div>');
    expect(appHtml).toContain('<span class="wb-rcost">$2,540 <span class="mark">estimated</span></span>');
  });
  it("the models block and the fate block carry one mark each in their head line", () => {
    expect(html).toMatch(/kept work per dollar <span class="mark">(estimated|assumed)<\/span>/);
    expect(html).toMatch(/what \d+ agent runs left behind <span class="mark">measured<\/span>/);
  });
});

describe("the copy the rules bind", () => {
  it("the badge reads local · 0 bytes uploaded, and counts the numbers when sharing is on", () => {
    expect(html).toContain("local · 0 bytes uploaded");
    const shared = renderHtml(report, { redact: false, numbersShared: { count: 24, at: "2026-09-15T09:31:00.000Z" } });
    expect(shared).toContain("local · shared 24 numbers");
    expect(shared).not.toContain("0 bytes uploaded");
    expect(shared).toContain("24 numbers at 09:31, shown before they went; nothing else.");
    expect(html).toContain("Nothing. No account, no upload, no model call.");
  });

  it("the sentence counts the files and says on disk", () => {
    expect(html).toContain("Your agents wrote 207 files in this window. 182 are still on disk.");
    expect(html).not.toContain("still in your repo");
  });

  it("the eyebrow and the overview row name the real window, never a month", () => {
    expect(windowLabel(report)).toBe("8 Aug to 1 Sep");
    expect(html).toContain("8 Aug to 1 Sep · 8 sessions · 114 agent runs");
    expect(html).not.toContain("this month");
  });

  it("the limitations registry is verbatim under the five rules", () => {
    const pop = html.slice(html.indexOf('class="wb-pop"'), html.indexOf("</details>", html.indexOf('class="wb-lim"')));
    expect(pop).toContain("what this report cannot see");
    for (const l of report.limitations) expect(pop).toContain(l.replace(/&/g, "&amp;").replace(/'/g, "&#39;"));
    expect(pop).toContain("How this counts");
    for (const k of ["Measured", "Estimated", "Alive", "Commit", "Left your machine"]) expect(pop).toContain(`>${k}<`);
  });

  it("the hero is at its value in the HTML, so the page reads without script", () => {
    expect(html).toContain('<div class="wb-herofig" id="wb-hero" data-to="88%">88%</div>');
  });
});

describe("the vocabulary", () => {
  it("names a run's fate in the words a developer already uses", () => {
    const fateBlock = html.slice(html.indexOf("agent runs left behind"), html.indexOf('class="wb-card'));
    expect(fateBlock).toContain("in git");
    expect(fateBlock).toContain("on disk");
    expect(fateBlock).toContain("unknown");
    expect(fateBlock).toContain("died");
    expect(fateBlock).toContain("your label");
    expect(fateBlock).not.toContain("landed, tracked");
    expect(fateBlock).not.toContain("finished, nothing survives");
    // the whole vocabulary, including the states this fixture has none of
    const every: Report = { ...report, burn: { ...report.burn, fate: { ...report.burn.fate, by_state: { landed_tracked: 1, landed_untracked: 1, finished_unlanded: 1, unknown: 1, died: 1, founder_labelled: 1, still_running: 1 } } } };
    const all = renderHtml(every, { redact: false });
    const block = all.slice(all.indexOf("agent runs left behind"), all.indexOf('class="wb-card'));
    for (const w of ["in git", "on disk", "nothing left", "unknown", "died", "your label", "still running"]) expect(block).toContain(w);
  });
  it("keeps a session's outcome word, and says whose label it is when there is one", () => {
    expect(html).toContain(">kept</span>");
    expect(html).toContain("dead · your label");
    expect(html).not.toContain("founder-labelled");
  });
});

describe("motion is off under reduced motion", () => {
  it("the rise, the slide and the pulse are all disabled, and the count-up needs script", () => {
    expect(CSS).toMatch(/@media \(prefers-reduced-motion: reduce\) \{[\s\S]*?\.wb-rise[\s\S]*?animation: none/);
    expect(CSS).toMatch(/@media \(prefers-reduced-motion: reduce\) \{[\s\S]*?\.wb-dot[\s\S]*?animation: none/);
    expect(html).not.toContain("requestAnimationFrame"); // no script on the static page at all
    expect(appHtml).toContain("prefers-reduced-motion: reduce");
  });
});

describe("the panels a frame can ask for", () => {
  it("every ?panel target exists, and #session= opens a session too", () => {
    expect(embedHtml).toContain('id="panel-report"'); // ?panel=top
    expect(embedHtml).toContain('id="instrument"'); // ?panel=session
    expect(embedHtml).toContain('id="wb-fixes"'); // ?panel=fixes
    expect(embedHtml).toContain('panel === "fixes"');
    expect(embedHtml).toContain('#session=');
    expect(appHtml).toContain('panel === "live"');
  });
});

describe("spend by day", () => {
  it("fills every day in the window, highlights the peak, and titles each bar", () => {
    const days = spendByDay(report);
    expect(days[0]!.key).toBe("2026-08-08");
    expect(days.at(-1)!.key).toBe("2026-09-01");
    expect(days.length).toBe(25);
    expect(days.filter((d) => d.v === 0).length).toBeGreaterThan(0);
    expect(html).toContain('title="2026-08-09 · $760"');
    expect(html).toContain("peak $760 on 9 Aug");
    expect(html).toMatch(/class="wb-day" style="height: 96px; background: var\(--ink\)"/);
  });
});

describe("redaction", () => {
  it("carries no session title, no repository path, no fix target and no snippet", () => {
    for (const s of report.sessions) {
      expect(redactedHtml).not.toContain(s.title);
      expect(redactedHtml).toContain(`session ${s.id.slice(0, 8)}`);
    }
    expect(redactedHtml).not.toContain(report.repo_path);
    expect(redactedHtml).toContain("redacted");
    for (const f of report.fixes) if (f.target_file) expect(redactedHtml).not.toContain(f.target_file);
    for (const f of report.fixes) if (f.snippet.trim()) expect(redactedHtml).not.toContain(f.snippet);
    expect(html).toContain(report.sessions[0]!.title);
    expect(html).toContain(report.repo_path.split("/").filter(Boolean).at(-1)!);
  });
});

describe("the share card: renderStickerSvg / renderShareText", () => {
  it("contain none of the fixture's session titles or file paths, and contain the aggregate numbers", () => {
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
    expect(shareText.split("\n").slice(-2)).toEqual(["measured by actuals", "npx actuals · github.com/namansharma14/actuals"]);
  });

  it("the card is one dark composition with npx actuals as its call to action", () => {
    expect(shareSvg).toContain('viewBox="0 0 1080 1080"');
    expect(shareSvg).toContain("#0B0E12");
    expect(shareSvg).toContain("npx actuals");
    expect(shareSvg).toContain("getactuals.net");
    expect(shareSvg).not.toContain("Gradient");
    expect(shareSvg).not.toContain("filter=");
    const cta = /<text [^>]*font-size="(\d+)"[^>]*>npx actuals</.exec(shareSvg);
    expect(Number(cta![1])).toBeGreaterThanOrEqual(34);
    const sizes = [...shareSvg.matchAll(/<text [^>]*font-size="(\d+)"/g)].map((m) => Number(m[1]));
    expect(Math.min(...sizes)).toBeGreaterThanOrEqual(23);
  });

  it("share.svg is well-formed enough to open standalone, and the page's copy of it drops the namespace", () => {
    expect(shareSvg).toContain('xmlns="http://www.w3.org/2000/svg"');
    expect(shareSvg.toLowerCase()).not.toContain("<script");
    expect(shareSvg).not.toMatch(/="[^"]*"[^\s/>]/);
    expect(html).toContain('class="wb-thumb-svg"');
    expect(html).not.toContain('xmlns="http://www.w3.org/2000/svg"');
  });
});

describe("no em dash anywhere in rendered output", () => {
  it.each([
    ["static", html],
    ["static redacted", redactedHtml],
    ["app", appHtml],
    ["embed", embedHtml],
    ["renderStickerSvg", shareSvg],
    ["renderShareText", shareText],
  ])("%s", (_name, output) => {
    expect(output).not.toContain(EM_DASH);
  });
});

/**
 * The page is numbers first. This counts the prose a reader sees by default (headings,
 * paragraphs, list items and the fine print outside a closed disclosure; never code, SVG or a
 * data cell) and holds it where the Workbench put it.
 */
describe("visible prose budget", () => {
  const words = (t: string) => t.replace(/<[^>]+>/g, " ").replace(/&[a-z#0-9]+;/g, " ").split(/\s+/).filter((w) => /[A-Za-z]/.test(w)).length;
  function visibleProse(page: string): number {
    let s = page.replace(/<style[\s\S]*?<\/style>/g, " ").replace(/<script[\s\S]*?<\/script>/g, " ").replace(/<svg[\s\S]*?<\/svg>/g, " ");
    // a pane or a sheet the page opens hidden is not prose a reader sees
    for (const tag of ["section", "aside", "div"]) s = s.replace(new RegExp("<" + tag + "[^>]*\\shidden[^>]*>[\\s\\S]*?<\\/" + tag + ">", "g"), " ");
    s = s.replace(/<details(?![^>]*\bopen\b)[^>]*>([\s\S]*?)<\/details>/g, (_m, inner: string) => " " + (/<summary[^>]*>([\s\S]*?)<\/summary>/.exec(inner)?.[1] ?? "") + " ");
    let n = 0;
    for (const re of [/<h1[^>]*>([\s\S]*?)<\/h1>/g, /<p\b[^>]*>([\s\S]*?)<\/p>/g, /<div class="wb-card-p"[^>]*>([\s\S]*?)<\/div>/g, /<span class="wb-card-p"[^>]*>([\s\S]*?)<\/span>/g]) {
      let m; while ((m = re.exec(s))) n += words(m[1]!);
    }
    return n;
  }
  it("the overview shows under 80 words of prose by default", () => {
    expect(visibleProse(html)).toBeLessThan(80);
  });
  it("the app page shows under 80 words of prose by default", () => {
    expect(visibleProse(appHtml)).toBeLessThan(80);
  });
});
