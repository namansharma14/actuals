import { describe, expect, it } from "vitest";
import path from "node:path";
import { runPipeline } from "../src/pipeline.js";
import { renderHtml } from "../src/render/html.js";
import { WB_APP_JS, WB_CORE_JS, WB_EMBED_JS } from "../src/render/workbench-client.js";
import { embedDrawers } from "../src/app/session.js";
import { buildTinyFixture } from "../eval/fixtures/tiny.js";
import type { Scope } from "../src/config.js";

const redactedScope = (repo: string): Scope => ({ repoPath: repo, repoId: "tiny", originUrl: null, allProjects: false, since: null, tools: ["claude_code"], redact: true, generous: false });

async function embed(): Promise<{ html: string; drawers: Record<string, string>; repo: string; sessionId: string; sessions: number }> {
  const fx = buildTinyFixture();
  const stateDir = path.join(fx.root, "state");
  const res = await runPipeline(redactedScope(fx.repo), { claudeRoot: fx.claudeRoot, stateDir, now: new Date("2026-09-02T00:00:00Z") });
  const drawers = embedDrawers(res.stateDir, res.ledger.run_id, res.report, { repoPath: fx.repo });
  return { html: renderHtml(res.report, { redact: true, embed: { drawers } }), drawers, repo: fx.repo, sessionId: fx.sessionId, sessions: res.report.sessions.length };
}

describe("the interactive embed (export --embed)", () => {
  it("is self-contained, clickable, per-session views inlined, and fully redacted", async () => {
    const e = await embed();

    // interactive: the rows carry the session id, the views are inlined, the pane is there to fill
    expect(e.html).toContain("data-session=");
    expect(e.html).toContain("window.__actualsEmbed");
    expect(e.html).toContain('id="wb-session-body"');
    expect(Object.keys(e.drawers).length).toBe(e.sessions);

    // no server: nothing fetches an /api path, and there is no per-launch token
    for (const api of ["/api/session", "/api/label", "/api/run", "/api/fix", "/api/live", "x-actuals-token"]) expect(e.html).not.toContain(api);
    // no absolute URL at all; the card's XML namespace is stripped from the inline copy
    expect(/https?:\/\//.test(e.html)).toBe(false);

    // redacted: no real title, no goal, no path, no em dash
    expect(e.html).not.toContain("Build the thing");
    expect(e.html).not.toContain(e.repo);
    expect(e.html).not.toContain("kept.md");
    expect(e.html).toMatch(/session [0-9a-f]{8}/);
    expect(e.html).not.toContain("—");

    const all = Object.values(e.drawers).join("\n");
    expect(all).not.toContain("Build the thing");
    expect(all).not.toContain(e.repo);
    expect(all).toContain("session 11111111"); // the redacted stand-in title

    // the label control is present but read-only: the embed says where labels are saved
    expect(all).toContain('class="wb-lsave"');
    expect(e.html).toContain("labels are saved in the app");
    expect(WB_EMBED_JS).toContain("labels are saved in the app");
  });

  /**
   * The landing reads the first `#instrument svg` with a height inside the frame, and scrolls to
   * the panel its query names, so both have to survive every rework of the page.
   */
  it("keeps a chart with a height inside #instrument once a session is open, and a target for every panel", async () => {
    const e = await embed();
    expect(e.html).toContain('id="instrument"');
    const view = e.drawers[e.sessionId]!;
    expect(view).toContain("<svg");
    expect(view).toMatch(/<svg[^>]*height="\d+"/); // a height at load, not one a closed disclosure hides
    expect(view).toContain('class="wb-tree-svg"');

    // the pane the session view lands in is #instrument itself
    const pane = e.html.slice(e.html.indexOf('id="instrument"'), e.html.indexOf("</section>", e.html.indexOf('id="instrument"')));
    expect(pane).toContain('id="wb-session-body"');

    for (const id of ['id="panel-report"', 'id="instrument"', 'id="wb-fixes"', 'id="wb-share"']) expect(e.html).toContain(id);
    expect(WB_CORE_JS).toContain('panel === "fixes"');
    expect(WB_CORE_JS).toContain('panel === "share"');
    expect(WB_CORE_JS).toContain('panel === "live"');
    expect(WB_CORE_JS).toContain('location.hash.indexOf("#session=")');
  });

  it("a session with no agent runs says so instead of drawing an empty chart", async () => {
    const e = await embed();
    const empty = Object.values(e.drawers).find((v) => v.includes("wb-noagents"));
    // the tiny fixture's one session has a run, so prove the branch on a synthetic view
    if (empty) expect(empty).toContain("No agents in this session. The main conversation did the work.");
    expect(WB_CORE_JS).not.toContain("/api/");
    expect(WB_APP_JS).toContain("/api/session/");
  });
});
