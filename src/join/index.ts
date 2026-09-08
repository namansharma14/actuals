/**
 * Join stage: git log, reverts, disk, tracked files, labels, git-ai notes.
 * Produces commits (with attribution) and truths for every claim.
 */
import { existsSync, realpathSync } from "node:fs";
import path from "node:path";
import { git, isInside, type Scope } from "../config.js";
import type { Commit, Ledger, Truth } from "../schema/ledger.js";

const FIVE_MIN = 5 * 60e3;
function real(p: string): string { try { return realpathSync(p); } catch { return p; } }
const THIRTY_DAYS = 30 * 86400e3;

interface RawCommit { sha: string; author_time: string; author_email: string; subject: string; body: string }

function gitLog(repo: string, since: Date | null): RawCommit[] {
  const args = ["log", "--no-merges", "--date=iso-strict", "--format=%H%x1f%aI%x1f%ae%x1f%s%x1f%b%x1e"];
  if (since) args.push(`--since=${since.toISOString()}`);
  const out = git(args, repo);
  if (!out) return [];
  return out.split("\x1e").map((r) => r.replace(/^\n/, "")).filter((r) => r.trim()).map((r) => {
    const [sha = "", author_time = "", author_email = "", subject = "", body = ""] = r.split("\x1f");
    return { sha: sha.trim(), author_time, author_email, subject, body };
  }).filter((c) => c.sha);
}

function trackedSet(repo: string): Set<string> {
  const out = git(["ls-files", "-z"], repo);
  return new Set(out ? out.split("\0").filter(Boolean) : []);
}

export interface JoinOutput { commits: Commit[]; truths: Truth[]; warnings: string[]; notes: { present: boolean; count: number } }

export function join(ledger: Ledger, scope: Scope, now = new Date()): JoinOutput {
  const warnings: string[] = [];
  const raw = gitLog(scope.repoPath, scope.since ? new Date(scope.since.getTime() - THIRTY_DAYS) : null);
  const tracked = trackedSet(scope.repoPath);
  const revertedBy = new Map<string, { sha: string; at: string }>();
  for (const c of raw) {
    const m = /This reverts commit ([0-9a-f]{7,40})/i.exec(c.body);
    if (m && m[1]) revertedBy.set(m[1], { sha: c.sha, at: c.author_time });
  }
  const resolveRevert = (sha: string): { sha: string; at: string } | null => {
    for (const [k, v] of revertedBy) if (sha.startsWith(k) || k.startsWith(sha)) return v;
    return null;
  };

  // session windows and their commit claims
  const sessions = ledger.sessions.map((s) => ({
    s,
    start: s.started_at ? new Date(s.started_at).getTime() : null,
    end: s.ended_at ? new Date(s.ended_at).getTime() : null,
    claims: ledger.claims.filter((c) => c.kind === "commit_made" && (c.owner === s.id || ledger.runs.some((r) => r.id === c.owner && r.session_id === s.id))).map((c) => ({ c, t: new Date(c.ts).getTime() })),
    inRepo: isInside(real(s.project_path || scope.repoPath), real(scope.repoPath)),
  }));
  // a subagent's end can be later than the session's last main line
  for (const w of sessions) {
    for (const r of ledger.runs) if (r.session_id === w.s.id && r.ended_at) { const t = new Date(r.ended_at).getTime(); if (w.end === null || t > w.end) w.end = t; }
  }

  const commits: Commit[] = [];
  const claimMatched = new Map<string, string>(); // claim id → sha
  for (const c of raw) {
    const t = new Date(c.author_time).getTime();
    const rv = resolveRevert(c.sha);
    let attribution: Commit["attribution"] = "outside";
    let session_id: string | null = null;
    for (const w of sessions) {
      if (!w.inRepo || w.start === null || w.end === null) continue;
      if (t < w.start - FIVE_MIN || t > w.end + FIVE_MIN) continue;
      const near = w.claims.find((k) => Math.abs(k.t - t) <= FIVE_MIN && !claimMatched.has(k.c.id));
      if (near) { attribution = "inside_session"; session_id = w.s.id; claimMatched.set(near.c.id, c.sha); break; }
      if (attribution === "outside") { attribution = "during_session_unattributed"; session_id = w.s.id; }
    }
    commits.push({ run_id: ledger.run_id, sha: c.sha, author_time: c.author_time, author_email: c.author_email, subject: c.subject.slice(0, 200), reverted_by: rv?.sha ?? null, reverted_at: rv?.at ?? null, session_id, attribution });
  }

  const truths: Truth[] = [];
  const observed = now.toISOString();
  for (const claim of ledger.claims) {
    if (claim.kind === "file_written") {
      const given = path.isAbsolute(claim.subject) ? claim.subject : path.join(scope.repoPath, claim.subject);
      const onDisk = existsSync(given);
      const abs = onDisk ? real(given) : given;
      truths.push({ run_id: ledger.run_id, claim_id: claim.id, kind: "file_on_disk", observed_at: observed, value: onDisk ? "yes" : "no" });
      if (onDisk && isInside(abs, scope.repoPath)) {
        const rel = path.relative(scope.repoPath, abs);
        truths.push({ run_id: ledger.run_id, claim_id: claim.id, kind: "file_tracked", observed_at: observed, value: tracked.has(rel) ? "yes" : "no" });
      }
    } else if (claim.kind === "commit_made") {
      const sha = claimMatched.get(claim.id);
      truths.push({ run_id: ledger.run_id, claim_id: claim.id, kind: "commit_in_log", observed_at: observed, value: sha ?? "no" });
      if (sha) {
        const rv = resolveRevert(sha);
        const within = rv ? new Date(rv.at).getTime() - new Date(commits.find((x) => x.sha === sha)!.author_time).getTime() <= THIRTY_DAYS : false;
        truths.push({ run_id: ledger.run_id, claim_id: claim.id, kind: "commit_reverted_within_30d", observed_at: observed, value: within ? rv!.sha : "no" });
      }
    } else if (claim.kind === "report_delivered" && claim.subject !== "(in chat)") {
      const given = path.isAbsolute(claim.subject) ? claim.subject : path.join(scope.repoPath, claim.subject);
      truths.push({ run_id: ledger.run_id, claim_id: claim.id, kind: "report_on_disk", observed_at: observed, value: existsSync(given) ? "yes" : "no" });
      const claimT = new Date(claim.ts).getTime();
      const cited = ledger.tool_calls.some((tc) => (tc.kind === "read" || tc.kind === "edit" || tc.kind === "bash") && new Date(tc.ts).getTime() > claimT && ((tc.path != null && tc.path.includes(claim.subject)) || (tc.command != null && tc.command.includes(claim.subject))));
      truths.push({ run_id: ledger.run_id, claim_id: claim.id, kind: "report_cited", observed_at: observed, value: cited ? "yes" : "no" });
    }
  }
  // founder labels as truths
  for (const l of ledger.labels) {
    for (const claim of ledger.claims) {
      if (claim.owner === l.target) truths.push({ run_id: ledger.run_id, claim_id: claim.id, kind: "founder_label", observed_at: l.ts, value: l.state });
    }
  }
  // git-ai notes (read only, counted; line-level survival is W5)
  const notesList = git(["notes", "--ref=ai", "list"], scope.repoPath);
  const notes = { present: !!notesList, count: notesList ? notesList.split("\n").filter(Boolean).length : 0 };
  if (raw.length === 0) warnings.push("git log returned no commits in the window; commit metrics are empty");
  return { commits, truths, warnings, notes };
}
