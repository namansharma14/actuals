import http from "node:http";
import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { startApp, type App } from "../src/app/server.js";
import { clearLicence, describeUpload, postLink, readLicence, redactedForUpload, saveLicence, uploadHosted } from "../src/hosted/index.js";
import { runPipeline } from "../src/pipeline.js";
import { ReportSchema, type Report } from "../src/schema/socket.js";
import { buildTinyFixture } from "../eval/fixtures/tiny.js";
import type { Scope } from "../src/config.js";

const fixture = ReportSchema.parse(JSON.parse(readFileSync(new URL("../eval/fixtures/socket/report.fixture.json", import.meta.url), "utf8")));
const redactedFixture: Report = { ...fixture, repo_path: "(redacted)", sessions: fixture.sessions.map((s, i) => ({ ...s, title: `session ${s.id.slice(0, 8)}`, outcome: i === 0 ? { state: "kept", note: "see /Users/x/SECRETNOTE.ts", source: "your label", mark: "founder-labelled" as const } : s.outcome })), burn: { ...fixture.burn, tree: { ...fixture.burn.tree, timeline: fixture.burn.tree.timeline ? { ...fixture.burn.tree.timeline, title: `session ${fixture.burn.tree.timeline.session_id.slice(0, 8)}` } : null }, rereads: { ...fixture.burn.rereads, top: fixture.burn.rereads.top.map((t) => ({ ...t, path: "(redacted)" })) } } };

/** A loopback stand-in for the site's POST /api/runs. */
function mockSite(): Promise<{ origin: string; seen: Array<{ auth: string | undefined; body: Record<string, unknown>; sticker_b64_len: number }>; close: () => void }> {
  const seen: Array<{ auth: string | undefined; body: Record<string, unknown>; sticker_b64_len: number }> = [];
  return new Promise((resolve) => {
    const srv = http.createServer((req, res) => {
      let raw = ""; req.on("data", (c) => { raw += c; }); req.on("end", () => {
        const body = JSON.parse(raw) as Record<string, unknown>; seen.push({ auth: req.headers.authorization, body, sticker_b64_len: typeof body["sticker_png_base64"] === "string" ? (body["sticker_png_base64"] as string).length : 0 });
        if (req.headers.authorization !== "Bearer ak_testkey_0123456789abcdef") { res.writeHead(401, { "content-type": "application/json" }); res.end(JSON.stringify({ error: "unknown_licence", message: "that licence key is not one of ours" })); return; }
        const report = (body["report"] as Record<string, unknown>);
        if (report["repo_path"] !== "(redacted)") { res.writeHead(422, { "content-type": "application/json" }); res.end(JSON.stringify({ error: "not_redacted", message: "repo_path is a real path" })); return; }
        res.writeHead(201, { "content-type": "application/json" }); res.end(JSON.stringify({ id: "AbCdEf123456", url: `http://127.0.0.1:${(srv.address() as { port: number }).port}/r/AbCdEf123456`, charged: "free", free_runs_left: 4, credits_left: 0 }));
      });
    });
    srv.listen(0, "127.0.0.1", () => resolve({ origin: `http://127.0.0.1:${(srv.address() as { port: number }).port}`, seen, close: () => srv.close() }));
  });
}

const apps: App[] = []; const closers: Array<() => void> = [];
afterAll(async () => { for (const a of apps) await a.close(); for (const c of closers) c(); });

describe("hosted runs: the one upload", () => {
  it("refuses an unredacted socket before anything is sent, and strips what the page hides from a redacted one", () => {
    expect(() => redactedForUpload(fixture)).toThrow(/not redacted/);
    const up = redactedForUpload(redactedFixture);
    const json = JSON.stringify(up);
    for (const s of fixture.sessions) { expect(json).not.toContain(s.title); if (s.claimed?.goal) expect(json).not.toContain(s.claimed.goal); }
    for (const f of fixture.fixes) if (f.snippet.length > 12) expect(json).not.toContain(f.snippet);
    expect(up.fixes.every((f) => f.target_file === "(redacted)" && f.snippet === "(redacted)")).toBe(true);
    expect(up.sessions.every((s) => !s.claimed || s.claimed.goal === "")).toBe(true);
    expect(json).not.toContain("SECRETNOTE"); expect(up.sessions[0]!.outcome).toMatchObject({ state: "kept", note: "", mark: "founder-labelled" });
    expect(up.repo_id).toBe("(redacted)");
    expect(up.headline).toEqual(fixture.headline);
    const lines = describeUpload(up, new Uint8Array(1024), "https://example.test");
    expect(lines[0]).toContain("https://example.test/api/runs");
    expect(lines.join("\n")).toContain("never: a prompt, a path");
    expect(lines.join("\n")).toContain("a label note");
    expect(lines.join("\n")).not.toContain("—");
  });

  it("stores the licence key with mode 600 and reads it back; clears it", () => {
    const root = path.join(buildTinyFixture().root, "state-root");
    expect(readLicence(root)).toBeNull();
    expect(() => saveLicence("not-a-key", root)).toThrow(/licence key/);
    const p = saveLicence("  ak_testkey_0123456789abcdef\n", root);
    expect(existsSync(p)).toBe(true);
    expect(statSync(p).mode & 0o777).toBe(0o600);
    expect(readLicence(root)).toBe("ak_testkey_0123456789abcdef");
    expect(clearLicence(root)).toBe(true); expect(readLicence(root)).toBeNull();
  });

  it("posts the redacted socket and the sticker with the bearer key, and surfaces refusals", async () => {
    const site = await mockSite(); closers.push(site.close);
    const up = redactedForUpload(redactedFixture);
    const r = await uploadHosted({ host: site.origin, key: "ak_testkey_0123456789abcdef", report: up, sticker: new Uint8Array([0x89, 0x50, 0x4e, 0x47]) });
    expect(r.url).toContain("/r/AbCdEf123456"); expect(r.charged).toBe("free"); expect(r.free_runs_left).toBe(4);
    expect(site.seen[0]!.auth).toBe("Bearer ak_testkey_0123456789abcdef");
    expect(site.seen[0]!.body["sticker_png_base64"]).toBe(Buffer.from([0x89, 0x50, 0x4e, 0x47]).toString("base64"));
    expect((site.seen[0]!.body["report"] as Report).repo_path).toBe("(redacted)");
    await expect(uploadHosted({ host: site.origin, key: "ak_wrong_0123456789abcdef", report: up, sticker: null })).rejects.toThrow(/401.*not one of ours/);
  });

  it("the app's share-as-a-page shows what leaves first, then uploads only on confirm, re-running redacted in memory", async () => {
    const site = await mockSite(); closers.push(site.close);
    const fx = buildTinyFixture(); const stateDir = path.join(fx.root, "state");
    const scope: Scope = { repoPath: fx.repo, repoId: "tiny", originUrl: null, allProjects: false, since: null, tools: ["claude_code"], redact: false, generous: false };
    const first = await runPipeline(scope, { claudeRoot: fx.claudeRoot, stateDir, now: new Date("2026-09-02T00:00:00Z") });
    const app = await startApp({ scope, stateDir, claudeRoot: fx.claudeRoot, idleExitMs: null, hostedOrigin: site.origin, licenceKey: "ak_testkey_0123456789abcdef" }); apps.push(app);
    const post = (body: unknown) => fetch(app.url + "api/hosted", { method: "POST", headers: { "x-actuals-token": app.token, "content-type": "application/json" }, body: JSON.stringify(body) });
    const preview = await (await post({ confirm: false })).json() as { confirmed: boolean; leaves: string[]; bytes: number };
    expect(preview.confirmed).toBe(false); expect(preview.leaves.length).toBeGreaterThan(3); expect(preview.bytes).toBeGreaterThan(1000);
    expect(site.seen).toHaveLength(0); // nothing left the machine yet
    // a real sticker is about 90 KB of PNG, well past the 64 KB cap every other route keeps
    const bigPng = new Uint8Array(100 * 1024); bigPng.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]); for (let i = 8; i < bigPng.length; i++) bigPng[i] = (i * 31) & 0xff;
    const b64 = Buffer.from(bigPng).toString("base64");
    const previewBig = await post({ confirm: false, sticker_png_base64: b64 });
    expect(previewBig.status).toBe(200);
    expect(((await previewBig.json()) as { sticker_bytes: number }).sticker_bytes).toBe(100 * 1024);
    const done = await (await post({ confirm: true, sticker_png_base64: b64 })).json() as { confirmed: boolean; url: string };
    expect(done.confirmed).toBe(true); expect(done.url).toContain("/r/");
    expect(site.seen).toHaveLength(1);
    expect(site.seen[0]!.sticker_b64_len).toBe(b64.length);
    expect((await post({ confirm: true, sticker_png_base64: "A".repeat(4 * 1024 * 1024) })).status).toBe(413); // still capped, just higher
    const sent = site.seen[0]!.body["report"] as Report;
    expect(sent.repo_path).toBe("(redacted)"); expect(sent.sessions[0]!.title).toMatch(/^session [0-9a-f]{8}$/);
    expect(JSON.stringify(sent)).not.toContain("Build the thing"); expect(JSON.stringify(sent)).not.toContain(fx.repo);
    expect(app.current().runId).toBe(first.ledger.run_id); // the redacted re-run did not replace the page's run
    const noKey = await startApp({ scope, stateDir, claudeRoot: fx.claudeRoot, idleExitMs: null, hostedOrigin: site.origin, licenceKey: null }); apps.push(noKey);
    expect((await fetch(noKey.url + "api/hosted", { method: "POST", headers: { "x-actuals-token": noKey.token, "content-type": "application/json" }, body: "{}" })).status).toBe(402);
  });
});

describe("postLink", () => {
  it("hands the person a link that says it came from a post, and changes nothing else", () => {
    expect(postLink("https://getactuals.net/r/AbCdEf123456")).toBe("https://getactuals.net/r/AbCdEf123456?ref=post");
    expect(postLink("https://getactuals.net/r/AbCdEf123456?x=1")).toBe("https://getactuals.net/r/AbCdEf123456?x=1&ref=post");
    expect(postLink("not a url")).toBe("not a url");
  });
});
