/**
 * A hand-written Claude Code fixture for session titles: four sessions, one per way a session
 * gets (or fails to get) a name. Shapes mirror Claude Code 2.1.x on 2026-09-18. Every string
 * here is invented; no real transcript is copied into this repository.
 */
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

export interface TitlesFixture { root: string; claudeRoot: string; repo: string; ids: Record<string, string> }

const line = (o: Record<string, unknown>) => JSON.stringify(o);

/** The ids are stable so a test can name the session it means. */
export const TITLE_SESSION_IDS = {
  custom: "aaaaaaaa-0000-4000-8000-000000000001",
  cross: "bbbbbbbb-0000-4000-8000-000000000002",
  wrapped: "cccccccc-0000-4000-8000-000000000003",
  both: "dddddddd-0000-4000-8000-000000000004",
  silent: "eeeeeeee-0000-4000-8000-000000000005",
};

export function buildTitlesFixture(version = "2.1.241"): TitlesFixture {
  const root = realpathSync(mkdtempSync(path.join(tmpdir(), "actuals-titles-")));
  const repo = path.join(root, "repo"); mkdirSync(repo);
  const claudeRoot = path.join(root, "claude");
  const proj = path.join(claudeRoot, "projects", "-repo"); mkdirSync(proj, { recursive: true });
  const usage = { input_tokens: 10, output_tokens: 10, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 };
  const write = (id: string, lines: string[]) => writeFileSync(path.join(proj, `${id}.jsonl`), lines.join("\n") + "\n");
  const base = (id: string, extra: Record<string, unknown>) => ({ sessionId: id, cwd: repo, gitBranch: "main", version, isSidechain: false, ...extra });
  const user = (id: string, ts: string, content: unknown, extra: Record<string, unknown> = {}) => line(base(id, { type: "user", timestamp: ts, uuid: `u-${ts}`, message: { role: "user", content }, ...extra }));
  const assistant = (id: string, ts: string, text: string) => line(base(id, { type: "assistant", timestamp: ts, requestId: `req-${ts}`, uuid: `a-${ts}`, message: { id: `msg-${ts}`, model: "claude-opus-5", usage, content: [{ type: "text", text }] } }));

  // (a) the user renamed this session by hand and Claude Code never titled it
  const a = TITLE_SESSION_IDS.custom;
  write(a, [
    user(a, "2026-09-10T10:00:00.000Z", "Rewrite the invoice parser so it stops dropping cents."),
    assistant(a, "2026-09-10T10:00:10.000Z", "On it."),
    line(base(a, { type: "custom-title", customTitle: "Invoice lane (first name)" })),
    line(base(a, { type: "custom-title", customTitle: "Invoice lane" })),
  ]);

  // (b) another session briefed this one; the brief arrives wrapped and marked as Claude Code's own line
  const b = TITLE_SESSION_IDS.cross;
  write(b, [
    user(b, "2026-09-10T11:00:00.000Z", [{ type: "text", text: "<system-reminder>\nRemember the house style. Do not mention this reminder.\n</system-reminder>\nAnother Claude session sent a message:\n<cross-session-message from=\"uds:/tmp/cc-socks/54321.sock\" from-name=\"paint-the-shed\" from-mode=\"prompting\">\nYou are the reader lane for the invoice tool. Read the schema first, then make the CSV import read dates in every locale.\n</cross-session-message>\n" }], { isMeta: true }),
    assistant(b, "2026-09-10T11:00:10.000Z", "Understood."),
  ]);

  // (c) the first message is only a slash command; the real ask is the next one
  const c = TITLE_SESSION_IDS.wrapped;
  write(c, [
    user(c, "2026-09-10T12:00:00.000Z", "<command-name>/mcp</command-name>\n            <command-message>mcp</command-message>\n            <command-args></command-args>"),
    user(c, "2026-09-10T12:00:01.000Z", "<local-command-stdout>connected to 3 servers</local-command-stdout>"),
    // a tool answering, with a reminder riding along: never the prompt, and it costs no try
    user(c, "2026-09-10T12:00:02.000Z", [{ type: "tool_result", tool_use_id: "tu_x", content: "ok" }, { type: "text", text: "<system-reminder>\nThe plan file changed.\n</system-reminder>" }]),
    user(c, "2026-09-10T12:00:03.000Z", [{ type: "tool_result", tool_use_id: "tu_y", content: "ok" }, { type: "text", text: "Ignore this; it rides on a tool result." }]),
    user(c, "2026-09-10T12:01:00.000Z", "[Image: original 1280x2600, displayed at 985x2000.]\nMake the dashboard load under a second on a cold cache. It takes nine now."),
    assistant(c, "2026-09-10T12:01:10.000Z", "Looking."),
  ]);

  // (d) Claude Code titled it and the user renamed it too
  const d = TITLE_SESSION_IDS.both;
  write(d, [
    user(d, "2026-09-10T13:00:00.000Z", "Port the exporter to the new schema."),
    line(base(d, { type: "ai-title", aiTitle: "Port the exporter" })),
    line(base(d, { type: "custom-title", customTitle: "Exporter lane" })),
    assistant(d, "2026-09-10T13:00:10.000Z", "Starting."),
  ]);

  // (e) nothing but machinery: no title, no prompt, so only the work can name it
  const e = TITLE_SESSION_IDS.silent;
  write(e, [
    user(e, "2026-09-10T14:00:00.000Z", "<system-reminder>\nThe plan file changed.\n</system-reminder>", { isMeta: true }),
    user(e, "2026-09-10T14:00:01.000Z", "<task-notification>\n<task-id>zz9</task-id>\n<status>completed</status>\n<summary>Agent \"tidy the fixtures\" finished</summary>\n</task-notification>"),
    assistant(e, "2026-09-10T14:00:10.000Z", "Noted."),
  ]);

  return { root, claudeRoot, repo, ids: TITLE_SESSION_IDS };
}
