import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, symlinkSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const pkg = JSON.parse(readFileSync(path.join(ROOT, "package.json"), "utf8")) as { version: string };

/**
 * `npx actuals@latest --version` once printed "unknown": the version was read from a
 * package.json found relative to process.argv[1], which under npx is a symlink in another
 * package's .bin. This builds, packs, unpacks into a temp folder, and runs the tarball's own
 * cli.js directly and through an npx-shaped symlink.
 */
describe("--version from the packed tarball", () => {
  it("prints the package's version from a temp folder, directly and through a .bin symlink", () => {
    const tmp = mkdtempSync(path.join(os.tmpdir(), "actuals-version-"));
    const build = spawnSync("npm", ["run", "build", "--silent"], { cwd: ROOT, encoding: "utf8" });
    expect(build.status, build.stderr).toBe(0);
    const pack = spawnSync("npm", ["pack", "--json", "--ignore-scripts", "--pack-destination", tmp], { cwd: ROOT, encoding: "utf8" });
    expect(pack.status, pack.stderr).toBe(0);
    const tarball = (JSON.parse(pack.stdout) as Array<{ filename: string }>)[0]!.filename;
    execFileSync("tar", ["-xzf", path.join(tmp, tarball), "-C", tmp]);
    const cli = path.join(tmp, "package", "dist", "cli.js");
    expect(execFileSync(process.execPath, [cli, "--version"], { cwd: tmp, encoding: "utf8" }).trim()).toBe(pkg.version);
    // npx's layout: node_modules/.bin/actuals -> ../actuals/dist/cli.js
    mkdirSync(path.join(tmp, "node_modules", ".bin"), { recursive: true });
    symlinkSync(path.join(tmp, "package"), path.join(tmp, "node_modules", "actuals"));
    symlinkSync(path.join("..", "actuals", "dist", "cli.js"), path.join(tmp, "node_modules", ".bin", "actuals"));
    const viaBin = execFileSync(process.execPath, [path.join(tmp, "node_modules", ".bin", "actuals"), "--version"], { cwd: os.tmpdir(), encoding: "utf8" }).trim();
    expect(viaBin).toBe(pkg.version);
  }, 90_000);
});
