import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { applyWatch, planWatch, unwatch } from "../src/watch/index.js";
import { currentEntry, installShim, shimStatus } from "../src/watch/shim.js";

function tmp(): string { return realpathSync(mkdtempSync(path.join(tmpdir(), "actuals-shim-"))); }

/** A stand-in for what npx unpacks: a package folder with dist/cli.js and rates.json. */
function fakeNpxCache(root: string, note: string): { cache: string; cli: string; rates: string } {
  const cache = path.join(root, "_npx", "1a2b3c4d", "node_modules", "actuals");
  mkdirSync(path.join(cache, "dist"), { recursive: true });
  const cli = path.join(cache, "dist", "cli.js");
  writeFileSync(cli, `#!/usr/bin/env node\nconsole.log("${note} " + process.argv.slice(2).join(" "));\n`);
  const rates = path.join(cache, "rates.json");
  writeFileSync(rates, JSON.stringify({ rates_version: "test" }));
  return { cache, cli, rates };
}

describe("the copy behind watch", () => {
  it("installs the running bundle under the state dir, points current at it, and the commands watch writes still resolve after the npx cache is deleted", async () => {
    const home = tmp();
    const stateRoot = path.join(home, ".actuals");
    const npxRoot = tmp();
    const claudeRoot = tmp();
    const store = path.join(tmp(), "store");
    const { cache, cli, rates } = fakeNpxCache(npxRoot, "actuals-stub");

    const first = installShim({ source: cli, rates, version: "0.1.2", root: stateRoot });
    expect(first).not.toBeNull();
    expect(first!.copied).toBe(true);
    expect(first!.entry).toBe(currentEntry(stateRoot));
    expect(path.isAbsolute(first!.entry)).toBe(true);
    expect(first!.entry.startsWith("~")).toBe(false);

    // a second run of a newer version refreshes the copy and repoints current
    const second = installShim({ source: cli, rates, version: "0.1.3", root: stateRoot })!;
    expect(realpathSync(second.entry)).toBe(realpathSync(path.join(stateRoot, "bin", "0.1.3", "cli.js")));
    expect(existsSync(path.join(stateRoot, "bin", "0.1.3", "rates.json"))).toBe(true); // priced without the package

    applyWatch(planWatch({ hud: true, claudeRoot, command: second.command }), store);

    // npm prunes its cache: everything npx unpacked goes away
    rmSync(path.join(npxRoot, "_npx"), { recursive: true, force: true });
    expect(existsSync(cache)).toBe(false);

    const settings = JSON.parse(readFileSync(path.join(claudeRoot, "settings.json"), "utf8")) as { statusLine: { command: string }; hooks: Record<string, Array<{ hooks: Array<{ command: string }> }>> };
    const installed = [settings.statusLine.command, ...Object.values(settings.hooks).flatMap((list) => list.flatMap((e) => e.hooks.map((h) => h.command)))].filter((c) => c.includes("cli.js"));
    expect(installed.length).toBeGreaterThanOrEqual(8); // the status line and every hook
    for (const command of installed) {
      const file = /^node "(.+?)"/.exec(command)?.[1];
      expect(file).toBe(second.entry);
      expect(file).not.toContain("_npx");
      expect(command).not.toContain("npx ");
      expect(command).not.toContain("~");
      expect(existsSync(file!)).toBe(true);
    }
    // and the command Claude Code would run actually runs
    expect(execFileSync("node", [second.entry, "hud"], { encoding: "utf8" }).trim()).toBe("actuals-stub hud");
    expect(shimStatus(stateRoot)).toMatchObject({ entry: second.entry, resolves: true });

    // unwatch removes the settings entries and leaves the copy in place
    const r = await unwatch(store);
    expect(r.restored).toHaveLength(1);
    expect(existsSync(second.entry)).toBe(true);
    expect(shimStatus(stateRoot).resolves).toBe(true);
  });

  it("reports itself missing before the first install, and skips the copy when it is already running from it", () => {
    const stateRoot = path.join(tmp(), ".actuals");
    expect(shimStatus(stateRoot)).toMatchObject({ resolves: false, target: null });
    const { cli, rates } = fakeNpxCache(tmp(), "actuals-stub");
    const one = installShim({ source: cli, rates, version: "0.1.3", root: stateRoot })!;
    const again = installShim({ source: realpathSync(one.entry), rates: null, version: "0.1.3", root: stateRoot })!;
    expect(again.copied).toBe(false);
    expect(existsSync(again.entry)).toBe(true);
  });
});
