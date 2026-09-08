import { describe, expect, it } from "vitest";
import path from "node:path";
import { runPipeline } from "../src/pipeline.js";
import { renderHtml } from "../src/render/html.js";
import { embedDrawers } from "../src/app/session.js";
import { buildTinyFixture } from "../eval/fixtures/tiny.js";
import type { Scope } from "../src/config.js";

const redactedScope = (repo: string): Scope => ({ repoPath: repo, repoId: "tiny", originUrl: null, allProjects: false, since: null, tools: ["claude_code"], redact: true, generous: false });

describe("the interactive embed (export --embed)", () => {
  it("is self-contained, clickable, drawers inlined, and fully redacted", async () => {
    const fx = buildTinyFixture();
    const stateDir = path.join(fx.root, "state");
    const res = await runPipeline(redactedScope(fx.repo), { claudeRoot: fx.claudeRoot, stateDir, now: new Date("2026-09-02T00:00:00Z") });
    const drawers = embedDrawers(res.stateDir, res.ledger.run_id, res.report, { repoPath: fx.repo });
    const html = renderHtml(res.report, { redact: true, embed: { drawers } });

    // interactive: session rows carry data-session, the drawer shell and the inlined data are present
    expect(html).toContain('data-session=');
    expect(html).toContain("window.__actualsEmbed");
    expect(html).toContain('id="drawer"');
    expect(Object.keys(drawers).length).toBe(res.report.sessions.length);

    // no server: nothing fetches an /api path, and there is no per-launch token
    expect(html).not.toContain("/api/session");
    expect(html).not.toContain("/api/label");
    expect(html).not.toContain("/api/run");

    // redacted: the fixture's real title and goal never appear, titles are the session-<hex> form,
    // no repository path leaks, and no em dash
    expect(html).not.toContain("Build the thing");
    expect(html).not.toContain(fx.repo);
    expect(html).not.toContain("kept.md");
    expect(html).toMatch(/session [0-9a-f]{8}/);
    expect(html).not.toContain("—");

    // the inlined drawers are themselves redacted (no real title, no path)
    const allDrawers = Object.values(drawers).join("\n");
    expect(allDrawers).not.toContain("Build the thing");
    expect(allDrawers).not.toContain(fx.repo);

    // the label control is present but the embed marks it read-only via the client script
    expect(html).toContain("read-only preview");
  });
});
