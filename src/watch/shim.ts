/**
 * The stable copy behind `actuals watch`.
 *
 * `npx actuals watch` writes a status line command and hooks into Claude Code's settings.
 * If those commands point at the file npx unpacked, they break the moment npm prunes its
 * cache: Claude Code then runs a path that no longer exists, silently. So watch first
 * copies the running bundle (one file) and `rates.json` into
 * `<state root>/bin/<version>/`, points `<state root>/bin/current` at that folder, and
 * installs commands that name `<state root>/bin/current/cli.js` by its absolute path: no
 * tilde, no npx, nothing under a cache anyone else prunes. Every `actuals watch` run
 * refreshes the copy to the version being run. `actuals unwatch` removes the settings
 * entries and leaves the copy alone, so a status line installed by hand keeps working.
 */
import { chmodSync, copyFileSync, existsSync, lstatSync, mkdirSync, realpathSync, rmSync, symlinkSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { cliVersion, STATE_ROOT } from "../config.js";

export function binRoot(root: string = STATE_ROOT): string { return path.join(root, "bin"); }
export function currentDir(root: string = STATE_ROOT): string { return path.join(binRoot(root), "current"); }
/** The absolute path every installed command names. */
export function currentEntry(root: string = STATE_ROOT): string { return path.join(currentDir(root), "cli.js"); }
/** The command a status line or a hook runs, with the entry quoted for the shell. */
export function commandFor(entry: string): string { return `node ${JSON.stringify(entry)}`; }

/** The running CLI's own bundle, and the rates file beside it. Null when running from source with no build. */
export function runningBundle(): { cli: string; rates: string | null } | null {
  let here: string;
  try { here = realpathSync(fileURLToPath(import.meta.url)); } catch { return null; }
  // bundled: this module IS dist/cli.js. From source (tsx): src/watch/shim.ts, so look for the build.
  const cli = here.endsWith(".ts") ? path.join(path.resolve(path.dirname(here), "..", ".."), "dist", "cli.js") : here;
  if (!existsSync(cli)) return null;
  const dir = path.dirname(cli);
  const rates = [path.join(dir, "rates.json"), path.join(dir, "..", "rates.json")].find((p) => existsSync(p)) ?? null;
  return { cli, rates };
}

export interface Shim { dir: string; entry: string; command: string; version: string; copied: boolean }

/**
 * Copy the bundle into `<root>/bin/<version>/` and point `current` at it. Returns null when
 * there is no bundle to copy (a source checkout with no build), so the caller can fall back.
 */
export function installShim(opts: { source?: string; rates?: string | null; version?: string; root?: string } = {}): Shim | null {
  const root = opts.root ?? STATE_ROOT;
  const found = opts.source ? { cli: opts.source, rates: opts.rates ?? null } : runningBundle();
  if (!found || !existsSync(found.cli)) return null;
  const version = opts.version ?? cliVersion() ?? "";
  const dir = path.join(binRoot(root), version || "unversioned");
  const entry = path.join(dir, "cli.js");
  let copied = false;
  const sameFile = (a: string, b: string): boolean => { try { return realpathSync(a) === realpathSync(b); } catch { return false; } };
  if (!sameFile(found.cli, entry)) {
    mkdirSync(dir, { recursive: true });
    copyFileSync(found.cli, entry);
    try { chmodSync(entry, 0o755); } catch { /* the mode is a convenience; node <path> runs either way */ }
    const rates = opts.rates === undefined ? found.rates : opts.rates;
    if (rates && existsSync(rates)) copyFileSync(rates, path.join(dir, "rates.json"));
    copied = true;
  }
  point(root, version || "unversioned", dir);
  return { dir, entry: currentEntry(root), command: commandFor(currentEntry(root)), version, copied };
}

/** `current` is a symlink to the version folder; where a link cannot be made, a copy of it. */
function point(root: string, version: string, dir: string): void {
  const cur = currentDir(root);
  try {
    const st = lstatSync(cur, { throwIfNoEntry: false });
    if (st) rmSync(cur, { recursive: true, force: true });
    symlinkSync(version, cur, "dir");
    return;
  } catch { /* a file system without links: copy the two files instead */ }
  mkdirSync(cur, { recursive: true });
  for (const name of ["cli.js", "rates.json"]) { const from = path.join(dir, name); if (existsSync(from)) copyFileSync(from, path.join(cur, name)); }
}

export interface ShimStatus { entry: string; resolves: boolean; target: string | null }

/** What `doctor` prints: the path the installed commands name, and whether it is there. */
export function shimStatus(root: string = STATE_ROOT): ShimStatus {
  const entry = currentEntry(root);
  try { return { entry, resolves: true, target: realpathSync(entry) }; } catch { return { entry, resolves: false, target: null }; }
}
