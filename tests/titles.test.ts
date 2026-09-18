import path from "node:path";
import { describe, expect, it } from "vitest";
import { buildTitlesFixture, TITLE_SESSION_IDS } from "../eval/fixtures/titles.js";
import { read } from "../src/read/claude_code/index.js";
import { buildReport } from "../src/report/index.js";
import { emptyLedger, type Claim, type Commit, type Session } from "../src/schema/ledger.js";
import type { Scope } from "../src/config.js";

const scopeFor = (repo: string): Scope => ({ repoPath: repo, repoId: "t", originUrl: null, allProjects: false, since: null, tools: ["claude_code"], redact: false, generous: false });

async function titles(): Promise<Map<string, Session>> {
  const fx = buildTitlesFixture();
  const out = await read(scopeFor(fx.repo), "r1", "t", fx.claudeRoot);
  return new Map(out.sessions.map((s) => [s.id, s]));
}

describe("a session is named from what it was asked to do", () => {
  it("takes the name the user gave the session when Claude Code never titled it", async () => {
    const s = (await titles()).get(TITLE_SESSION_IDS.custom)!;
    expect(s.title).toBe("Invoice lane"); // the last custom-title record, as with ai-title
    expect(s.first_prompt).toBe("Rewrite the invoice parser so it stops dropping cents.");
  });

  it("reads the brief another session sent, and never the wrapper around it", async () => {
    const s = (await titles()).get(TITLE_SESSION_IDS.cross)!;
    expect(s.title).toBe("You are the reader lane for the invoice tool.");
    expect(s.first_prompt).toContain("Read the schema first");
    for (const leak of ["uds:", "paint-the-shed", "Another Claude session", "system-reminder", "cross-session-message", "<"]) {
      expect(s.title).not.toContain(leak);
      expect(s.first_prompt).not.toContain(leak);
    }
  });

  it("skips a message that is only a command wrapper and asks the next one", async () => {
    const s = (await titles()).get(TITLE_SESSION_IDS.wrapped)!;
    expect(s.title).toBe("Make the dashboard load under a second on a cold cache.");
    expect(s.first_prompt).not.toContain("Image:");
    expect(s.first_prompt).not.toContain("/mcp");
  });

  it("prefers Claude Code's own title over the name the user gave the session", async () => {
    const s = (await titles()).get(TITLE_SESSION_IDS.both)!;
    expect(s.title).toBe("Port the exporter");
  });

  it("falls back to the id when the transcript holds no words of its own", async () => {
    const s = (await titles()).get(TITLE_SESSION_IDS.silent)!;
    expect(s.title).toBe(`session ${TITLE_SESSION_IDS.silent.slice(0, 8)}`);
    expect(s.first_prompt).toBe("");
  });
});

describe("a session with no title of its own is named by its work", () => {
  const repo = "/tmp/nowhere-actuals-titles";
  const id = "ffffffff-0000-4000-8000-000000000006";
  const usage = { input: 1, output: 1, cache_read: 0, cache_write_5m: 0, cache_write_1h: 0 };
  const session = (title: string): Session => ({ run_id: "r", id, tool: "claude_code", project_path: repo, repo_id: "t", source_file: "", started_at: "2026-09-10T10:00:00.000Z", ended_at: "2026-09-10T12:00:00.000Z", tool_version: "2.1.241", entrypoint: null, first_prompt: "", title, git_branch: null, models: {}, turns: 1, usage, cost_usd: 1, cost_mark: "estimated", bad_lines: 0 });
  const commit = (sha: string, at: string, subject: string): Commit => ({ run_id: "r", sha, author_time: at, author_email: "a@b.c", subject, reverted_by: null, reverted_at: null, session_id: id, attribution: "inside_session" });
  const wrote = (n: number, file: string): Claim => ({ run_id: "r", id: `fw:${id}:${n}`, kind: "file_written", owner: id, owner_kind: "session", subject: file, ts: "2026-09-10T11:00:00.000Z", source: "transcript" });
  const build = (led: ReturnType<typeof emptyLedger>) => buildReport(led, scopeFor(repo), { generatedAt: new Date("2026-09-11T00:00:00Z"), versions: ["2.1.241"], claudeRoot: "/tmp/nowhere-claude", redact: false }).sessions[0]!.title;

  it("uses the first commit the session made", () => {
    const led = emptyLedger("r");
    led.sessions = [session(`session ${id.slice(0, 8)}`)];
    led.commits = [commit("b2", "2026-09-10T11:30:00.000Z", "fix(app): later commit"), commit("a1", "2026-09-10T10:30:00.000Z", "feat(render): draw the session list")];
    led.claims = [wrote(1, path.join(repo, "src/render/list.ts"))];
    expect(build(led)).toBe("commit: feat(render): draw the session list");
  });

  it("uses where the files went when no commit was made inside the session", () => {
    const led = emptyLedger("r");
    led.sessions = [session(`session ${id.slice(0, 8)}`)];
    led.claims = [wrote(1, path.join(repo, "src/render/list.ts")), wrote(2, path.join(repo, "src/render/theme.ts")), wrote(3, path.join(repo, "src/app/server.ts")), wrote(4, "/elsewhere/notes.md")];
    expect(build(led)).toBe("2 files in src/render");
  });

  it("counts one file, and a file outside the repository as outside it", () => {
    const led = emptyLedger("r");
    led.sessions = [session(`session ${id.slice(0, 8)}`)];
    led.claims = [wrote(1, "/elsewhere/notes.md"), wrote(2, "/elsewhere/other/plan.md"), wrote(3, path.join(repo, "src/app/server.ts"))];
    expect(build(led)).toBe("2 files outside the repository");
  });

  it("keeps the id when the session left nothing behind, and keeps the live note", () => {
    const led = emptyLedger("r");
    led.sessions = [session(`session ${id.slice(0, 8)}`)];
    expect(build(led)).toBe(`session ${id.slice(0, 8)}`);
    const live = emptyLedger("r");
    live.sessions = [session(`session ${id.slice(0, 8)} (live ledger only; transcript gone)`)];
    live.claims = [wrote(1, path.join(repo, "src/app/server.ts"))];
    expect(build(live)).toBe("1 file in src/app (live ledger only; transcript gone)");
  });

  it("leaves a session that already has a title alone", () => {
    const led = emptyLedger("r");
    led.sessions = [session("Port the exporter")];
    led.commits = [commit("a1", "2026-09-10T10:30:00.000Z", "feat(render): draw the session list")];
    expect(build(led)).toBe("Port the exporter");
  });
});
