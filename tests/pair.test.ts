import http from "node:http";
import { mkdtempSync, readFileSync, existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runLogin, pollPairing, disconnectPairing } from "../src/hosted/pair.js";
import { licencePath } from "../src/hosted/index.js";

/** A mock pairing site: start returns a code, poll returns pending N times then approved. */
function mockSite(opts: { pendingPolls: number; key: string; handle: string; expiresIn?: number }): Promise<{ origin: string; disconnects: string[]; polls: number; close: () => void }> {
  return new Promise((resolve) => {
    let polls = 0;
    const disconnects: string[] = [];
    const srv = http.createServer((req, res) => {
      let raw = "";
      req.on("data", (c) => (raw += c));
      req.on("end", () => {
        const body = (() => { try { return JSON.parse(raw); } catch { return {}; } })() as Record<string, unknown>;
        const port = (srv.address() as { port: number }).port;
        if (req.url === "/api/pair/start") {
          res.writeHead(200, { "content-type": "application/json" });
          res.end(JSON.stringify({ code: "ABCD-1234", url: `http://127.0.0.1:${port}/pair?code=ABCD-1234`, poll: "poll-secret-xyz", expires_in: opts.expiresIn ?? 600 }));
          return;
        }
        if (req.url === "/api/pair/poll") {
          polls += 1;
          res.writeHead(200, { "content-type": "application/json" });
          if (polls <= opts.pendingPolls) res.end(JSON.stringify({ status: "pending" }));
          else res.end(JSON.stringify({ status: "approved", key: opts.key, handle: opts.handle }));
          return;
        }
        if (req.url === "/api/pair/disconnect") {
          disconnects.push(String(body["key"] ?? ""));
          res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify({ ok: true }));
          return;
        }
        res.writeHead(404); res.end("{}");
      });
    });
    srv.listen(0, "127.0.0.1", () => resolve({ origin: `http://127.0.0.1:${(srv.address() as { port: number }).port}`, disconnects, get polls() { return polls; }, close: () => srv.close() } as never));
  });
}

const roots: string[] = [];
afterEach(() => { /* temp dirs are left for the OS to clean */ });

describe("pairing (actuals login)", () => {
  it("starts, shows the code, opens the browser, polls until approved, and saves the key once", async () => {
    const site = await mockSite({ pendingPolls: 2, key: "ak_" + "x".repeat(32), handle: "namesh" });
    const root = mkdtempSync(path.join(os.tmpdir(), "actuals-pair-"));
    roots.push(root);
    let opened = "";
    let shownCode = "";
    const res = await runLogin({
      host: site.origin,
      device: "test-box",
      cli: "0.0.0-test",
      onStart: (s) => { shownCode = s.code; },
      open: (u) => { opened = u; },
      intervalMs: 1000,
      sleep: () => Promise.resolve(),
      saveRoot: root,
    });
    expect(res.handle).toBe("namesh");
    expect(shownCode).toBe("ABCD-1234");
    expect(opened).toContain("/pair?code=ABCD-1234");
    expect(existsSync(licencePath(root))).toBe(true);
    expect(readFileSync(licencePath(root), "utf8").trim()).toBe("ak_" + "x".repeat(32));
    site.close();
  });

  it("gives up with a message when the code expires", async () => {
    const site = await mockSite({ pendingPolls: 100, key: "ak_" + "y".repeat(32), handle: "nope", expiresIn: 1 });
    const root = mkdtempSync(path.join(os.tmpdir(), "actuals-pair-"));
    // now() advances past the 1s deadline on the second tick
    let t = 0;
    await expect(runLogin({ host: site.origin, device: "b", cli: "0", intervalMs: 1000, sleep: () => Promise.resolve(), now: () => (t += 900), saveRoot: root })).rejects.toThrow(/timed out|expired/);
    expect(existsSync(licencePath(root))).toBe(false);
    site.close();
  });

  it("a 429 poll is treated as pending, not a failure", async () => {
    const srv = http.createServer((req, res) => { res.writeHead(429, { "content-type": "application/json" }); res.end(JSON.stringify({ error: "slow down" })); });
    await new Promise<void>((r) => srv.listen(0, "127.0.0.1", () => r()));
    const origin = `http://127.0.0.1:${(srv.address() as { port: number }).port}`;
    const p = await pollPairing(origin, "poll-secret");
    expect(p.status).toBe("pending");
    srv.close();
  });

  it("a 404 from the server reads as not-available-yet, not a bare error", async () => {
    const { startPairing } = await import("../src/hosted/pair.js");
    const srv = http.createServer((req, res) => { res.writeHead(404, { "content-type": "application/json" }); res.end(JSON.stringify({ error: "not found" })); });
    await new Promise<void>((r) => srv.listen(0, "127.0.0.1", () => r()));
    const origin = `http://127.0.0.1:${(srv.address() as { port: number }).port}`;
    await expect(startPairing(origin, "box", "0")).rejects.toThrow(/not available|still being set up/i);
    srv.close();
  });

  it("disconnect posts the key and reports success", async () => {
    const site = await mockSite({ pendingPolls: 0, key: "ak_" + "z".repeat(32), handle: "h" });
    const ok = await disconnectPairing(site.origin, "ak_" + "z".repeat(32));
    expect(ok).toBe(true);
    expect(site.disconnects).toContain("ak_" + "z".repeat(32));
    site.close();
  });
});
