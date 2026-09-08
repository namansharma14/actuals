/**
 * The upload contract. A hosted run may only ever carry a redacted socket, so this module
 * is the one place that decides what is redacted enough to host, and the one place that
 * strips the fields the CLI redacts at render time rather than in the JSON.
 *
 * Two moves, in order:
 *   check    reject anything that is not a valid, redacted report.json
 *   sanitise remove the free text that `--redact` leaves in the socket and that
 *            renderHtml(redact) hides but does not delete: fix targets, fix snippets and
 *            the /insights goal line. Nothing here is displayed on any surface, so the
 *            stored file should not carry it either.
 */
import { ReportSchema, type Report } from "../../src/schema/socket.js";

/** `--redact` writes titles as `session <first 8 of the id>`. */
const REDACTED_TITLE = /^session [0-9a-f]{8}$/;
const REDACTED = "(redacted)";

export const MAX_SOCKET_BYTES = 2 * 1024 * 1024;
export const MAX_STICKER_BYTES = 2 * 1024 * 1024;

export type SocketCheck = { ok: true; report: Report } | { ok: false; error: string };

function reject(error: string): SocketCheck {
  return { ok: false, error };
}

/** Free text the socket carries but no hosted surface shows. */
function sanitise(report: Report): Report {
  return {
    ...report,
    // the repo id hashes the origin URL, so a public repository could be linked by hashing its clone URL
    repo_id: REDACTED,
    // a label note is the user's own words; the outcome state stays, the note does not
    sessions: report.sessions.map((s) => ({ ...s, claimed: s.claimed ? { ...s.claimed, goal: "" } : null, outcome: s.outcome.mark === "founder-labelled" ? { ...s.outcome, note: "" } : s.outcome })),
    fixes: report.fixes.map((f) => ({ ...f, target_file: REDACTED, snippet: REDACTED })),
  };
}

export function checkRedactedSocket(input: unknown): SocketCheck {
  const parsed = ReportSchema.safeParse(input);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return reject(first ? `report.json does not match the schema at ${first.path.join(".") || "(root)"}: ${first.message}` : "report.json does not match the schema");
  }
  const r = parsed.data;
  if (r.repo_path !== REDACTED) return reject("this report is not redacted: repo_path is a real path. Run actuals run --redact.");
  const named = r.sessions.find((s) => !REDACTED_TITLE.test(s.title));
  if (named) return reject(`this report is not redacted: session ${named.id.slice(0, 8)} carries a title. Run actuals run --redact.`);
  const t = r.burn.tree.timeline;
  if (t && !REDACTED_TITLE.test(t.title)) return reject("this report is not redacted: the drawn session carries a title. Run actuals run --redact.");
  const path = r.burn.rereads.top.find((x) => x.path !== REDACTED);
  if (path) return reject("this report is not redacted: the re-read table carries file paths. Run actuals run --redact.");
  return { ok: true, report: sanitise(r) };
}

export type { Report };
