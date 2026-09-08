---
name: actuals
description: >
  Measure what the coding agents in this repository actually shipped, and act on it.
  Runs `npx actuals` to read the local Claude Code transcripts and this repo's git
  history, then reports what was kept against what the agents claimed: tokens at list
  rates, commits that stuck, which files agents wrote are still on disk, which runs died
  or left nothing, concurrency and depth, and kept work per dollar by model. It then
  surfaces the fixes actuals derives from those numbers and applies them on confirmation,
  and can set up the always-on status line. Nothing leaves the machine. Use when the user asks
  what an agent actually did, what a session or a run cost, what shipped, what survived,
  which subagents died, cost per commit, or to review or clean up after a Claude Code or
  Codex session. Triggers on "actuals", "what did the agent actually do", "what did this
  session cost", "what shipped", "what survived", "measure my agents", "cost per commit",
  "which agents died", "which files are still on disk", "clean up after the agents",
  "cap my subagents", "am I over-spawning".
allowed-tools: Bash, Read
---

# actuals

`actuals` reads the Claude Code sessions already on this machine and the repository's git
history, locally, and reports what the coding agents actually delivered against what they
claimed. It runs no model, uploads nothing, and opens no network connection. Your job is to
run it, read the result, and help the user act on it.

## Run it

From the repository root:

```
npx actuals run --no-open --json
```

`--json` prints the paths of the two outputs and suppresses the browser. report.json is the
machine-readable report:

```
<repo>/.actuals or ~/.actuals/<repo-id>/runs/<run-id>/report.json
```

The `--json` output names the exact `report.json` path. Read that file. If `npx actuals`
reports no sessions, run `npx actuals doctor` and relay what it can and cannot see (usually
the user ran it outside the repository the agents worked in, or Claude Code's project
directory is elsewhere).

Useful flags: `--since 30d` bounds the window by file time; `--all-projects` reads every
project on the machine, not just this repo; `--redact` blanks titles, paths and prompts if
the user wants to share the result.

## Read the report file

`report.json` is the contract. The fields that matter:

- `headline`: `cost_usd`, `commits`, `cost_per_commit`, `files_alive` (alive of written),
  `runs_no_fate`. Every value carries a `mark`: `measured` (read from transcripts and git)
  or `estimated` (token counts priced at list rates). Always repeat the mark when you quote
  a number. Never present an estimated figure as a measured one.
- `burn.tree`: the tallest agent tree, its peak concurrency, depth, and deaths. `died` runs
  are the ones that crashed mid-run.
- `burn.fate`: how runs ended, by state. `unknown` and `finished_unlanded` are never counted
  as kept.
- `models`: per-model runs, cost per run, and kept work per dollar. This is the routing
  signal.
- `sessions`: each session with its cost, commits, files, and the `/insights` claim the tool
  made, so you can compare claimed against measured.
- `fixes`: the fixes actuals derived from these numbers (see below).

Summarize for the user in plain terms: what the work cost, what was kept versus what was
claimed, and anything that died or left no trace. Lead with what shipped.

## Offer the fixes

`report.json` carries a `fixes` array, each with a `title`, a `why` grounded in this repo's
numbers, a `target_file`, and whether it is `available`. To see the exact change before
anything is written:

```
npx actuals fix --dry-run
```

This prints each fix and the precise diff it would apply (for example, capping
`CLAUDE_CODE_MAX_CONCURRENT_SUBAGENTS` to the concurrency the machine actually survived, or
installing a hook that makes every subagent land its report on disk). Show the user the fix
and its reasoning, and apply only what they confirm:

```
npx actuals fix
```

Applied fixes are reversible: `npx actuals undo <fix-id>` restores the file byte for byte
and refuses if the file changed since. Never apply a fix the user did not confirm.

## Offer the always-on status line

If the user wants the numbers live rather than after the fact, `actuals watch` installs a
statusline HUD and hooks that write a local live ledger, with one confirm and a shown diff:

```
npx actuals watch
```

`npx actuals unwatch` removes them byte-identically. For VS Code, where the statusline never
draws, `npx actuals hud --serve` opens the live window to pin beside the
editor. Only suggest these; do not install them without the user asking.

## Rules

- Report faithfully. Repeat every number's mark. An estimated dollar figure is the size of
  the work at list rates, not a bill.
- Undercount rather than overcount: an unknown fate is never kept.
- Never apply a fix, install watch, or share a report without the user's confirmation.
- The tool spawns no agents and calls no model. Do not wrap it in one; just run it and read
  the file.
- To share a report, `npx actuals share --hosted` lists exactly what would leave and waits
  for one confirm. Nothing else ever leaves the machine.
