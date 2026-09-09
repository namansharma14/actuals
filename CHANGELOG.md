# Releases

Newest first. Each entry is what a user gets, in plain terms. Dates are the ship date once
published; an unreleased entry is marked DRAFT and may still change.

## 0.1.3 (DRAFT, unreleased)

**`actuals watch` keeps working after npm cleans up.** The status line and the hooks used to
name the file `npx` had just unpacked. npm prunes that folder, and the commands quietly
stopped running. Watch now keeps a copy of the version you ran under
`~/.actuals/bin/<version>/`, points `~/.actuals/bin/current` at it, and writes commands that
name that path. Every `actuals watch` refreshes the copy; `actuals doctor` prints it and says
whether it is there; `actuals unwatch` leaves it alone.

**A new share card.** One composition on a dark card: agent runs, commits, what a commit cost
at list rates, and the concurrency curve of your tallest agent tree, with `npx actuals` on it
so anyone who sees a screenshot can find the tool. The same drawing now backs the card in the
app, `share.svg` and the PNG.

**Smaller things.** Bare `npx actuals` says the app is serving, how to stop it, and when it
stops itself. One session reads as "1 session". A machine with no Claude Code sessions gets a
sentence that says so instead of an offer to show every project.

## 0.1.2 (DRAFT, unreleased)

The first release with an account, a live view, and the full claim model. Everything still runs
on your own machine: Actuals reads your local Claude Code transcripts and git, and calls no model.

**Accounts and sharing** (works once the site update is live). `actuals login` pairs this machine
to your account from the terminal, and `actuals logout` unpairs it. A report you choose to share is
uploaded redacted, and only then, with a link you control; nothing leaves your machine until you
ask it to.

**Claims: what an agent said, and what actually happened.** Actuals now records three kinds of
claim and gives each one a verdict.
- **Delivered reports.** When an agent says in chat that it delivered a report or a file but wrote
  nothing to disk to back it, that claim is caught and checked against what is actually on disk.
- **Session outcomes.** A session's own `/insights` verdict ("achieved", and so on) is graded
  against what its runs really did, never taken on its word.
- **Was it used.** A delivered report is marked as cited when something later in your work reads,
  edits, or commits it. If nothing ever touches it, the report says so.
  Every claim carries kept, gone, or unknown, and the rule throughout is that anything unclear is
  never counted as delivered or kept.

**The control centre (Live tab).** A live view of the session running right now, drawn to time and
growing as it goes: one bar per agent run in its own lane, coloured by depth, warm when a run dies,
with the clock and the running cost. A new bar or a death shows within about a fifth of a second of
the event. Click any run for its detail. When no session is live, the tab says so.

**A legible chart on a phone.** The session timeline used to shrink its labels to the point of
unreadable on a narrow screen. It now draws a phone version at a real size and scrolls sideways
instead, so the axis times, the counts, and the callouts stay readable. Print is unchanged.

**Reads every worktree.** If you run Actuals in one git worktree of a repo, it now sees the
sessions and commits from the repo's other worktrees too, instead of missing them.

## 0.1.1

(Published notes to follow.)

## 0.1.0

First public build: read your local transcripts and git, and get a measured report of your agent
work, with nothing uploaded and no model called.
