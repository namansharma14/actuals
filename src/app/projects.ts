/**
 * Every Claude Code project on this machine, for the app's project switcher: the directory
 * slug under ~/.claude/projects, the working directory its transcripts record, how many
 * sessions a run scoped to that directory would read, and when it was last touched.
 * Read-only; nothing here leaves the machine. The slug is the only identifier the page may
 * send back, and the server resolves it against this list, so the browser can never name an
 * arbitrary path.
 *
 * The session count is computed the way the reader scopes a run: every session file on the
 * machine whose recorded cwd sits inside the project's directory, whichever slug folder it
 * was written to. A session started in a sub-folder therefore counts for its parent too, and
 * the number here matches the number the report will show after a switch.
 */
import { existsSync, readdirSync, realpathSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { isInside } from "../config.js";
import { peekJsonLines } from "../read/jsonl.js";

export interface ProjectRow {
  /** the directory name under ~/.claude/projects */
  slug: string;
  /** the working directory recorded inside the transcripts, or null when none records one */
  cwd: string | null;
  /** the cwd with the home directory as ~, for display */
  label: string;
  sessions: number;
  /** the day of the newest session file, YYYY-MM-DD */
  last: string | null;
}

export function realPath(p: string): string { try { return realpathSync(p); } catch { return p; } }

export function tilde(p: string): string {
  const home = os.homedir();
  return p === home ? "~" : p.startsWith(home + path.sep) ? "~" + p.slice(home.length) : p;
}

interface SessionFile { slug: string; cwds: string[]; mtime: Date | null }

export async function listProjects(claudeRoot: string): Promise<ProjectRow[]> {
  const root = path.join(claudeRoot, "projects");
  if (!existsSync(root)) return [];
  const files: SessionFile[] = [];
  for (const slug of readdirSync(root)) {
    const dir = path.join(root, slug);
    let names: string[];
    try { if (!statSync(dir).isDirectory()) continue; names = readdirSync(dir).filter((n) => n.endsWith(".jsonl")); } catch { continue; }
    for (const name of names) {
      const file = path.join(dir, name);
      let mtime: Date | null = null;
      try { mtime = statSync(file).mtime; } catch { /* unreadable: still a session */ }
      // every cwd the head records, matched the way the reader matches a run's scope: any one inside the project counts
      let cwds: string[] = [];
      try {
        const head = await peekJsonLines(file, 40);
        cwds = [...new Set(head.map((h) => h["cwd"]).filter((c): c is string => typeof c === "string" && c.length > 0).map(realPath))];
      } catch { /* not JSON lines */ }
      files.push({ slug, cwds, mtime });
    }
  }
  const rows: ProjectRow[] = [];
  for (const slug of new Set(files.map((f) => f.slug))) {
    const own = files.filter((f) => f.slug === slug);
    const cwd = own.flatMap((f) => f.cwds)[0] ?? null;
    // a file that records no cwd falls back to its slug folder, as the reader does
    const inScope = cwd === null ? own : files.filter((f) => (f.cwds.length === 0 ? f.slug === slug : f.cwds.some((c) => isInside(c, cwd))));
    let last: Date | null = null;
    for (const f of inScope) if (f.mtime && (!last || f.mtime > last)) last = f.mtime;
    rows.push({ slug, cwd, label: cwd ? tilde(cwd) : slug, sessions: inScope.length, last: last ? last.toISOString().slice(0, 10) : null });
  }
  rows.sort((a, b) => (b.last ?? "").localeCompare(a.last ?? "") || a.label.localeCompare(b.label));
  return rows;
}
