# Actuals

![The report actuals writes, opened as a local app on 127.0.0.1, redacted](assets/report.png)

![npx actuals in a terminal: one command, then the report opens](assets/actuals-run.gif)

See what your coding agents actually shipped. Actuals reads the Claude Code sessions already
on your machine and your git history, and reports what the agents left behind: what was kept,
what died, and what it cost. One command, about a second. Nothing leaves your machine unless
you choose to share your numbers, and you see them first.

## Run it

In any repository where you have used Claude Code (Node 20 or newer):

```
npx actuals
```

The report opens in your browser on 127.0.0.1. To keep a live line in Claude Code's status
bar while you work:

```
npx actuals watch
```

## How to use it

1. **Read the sentence.** The report opens on the overview: how many files your agents
   wrote in this window and how many are still on disk, then the receipt for the period:
   what the tokens cost at list rates, how many commits the sessions made, the cost per
   commit, and how many agent runs finished with nothing to show. Anything marked
   `MEASURED` was read from transcripts and git; `ESTIMATED` means priced at list rates.
2. **Pick the scope.** `this repo` or `everywhere` in the top bar re-runs on this repository
   or on every project on the machine. The box above the session list filters by title.
3. **Open a session.** The list on the left is newest first, with cost, hours, agents and
   the outcome. Click one, or press `j` and `k` to move through them. A session opens on
   its verdict, then its agents drawn to time, then every run with its model, minutes,
   cost and what it left behind: in git, on disk, nothing left, unknown, or died. A run
   expands to the files it wrote.
4. **Say whether it mattered.** The tool measures what happened on disk and in git; only
   you know whether the work mattered. Label the session in one click (`l` cycles the
   states) and add a line on why. Labels stay on this machine and are never overwritten.
5. **Watch a session live.** `v` opens the live view: agents appear as they start, go
   warm the moment one dies, and the cost ticks. It works once `npx actuals watch` has
   installed the hooks.
6. **Apply a fix, or undo it.** `f` opens the fixes, written from your own numbers. The
   first caps the agent tree at what your machine survived, as two settings in
   `.claude/settings.json`. Every fix shows its reason and the exact change before anything
   is written; one command restores every file byte for byte.
7. **Share the card.** `s` opens the card: three numbers and the curve as a 1080 by 1080
   PNG, aggregates only: no file names, no prompts, no code. Copy it, save it, or post it.

The badge in the top bar says what left your machine: `0 bytes uploaded`, or the count of
numbers you chose to share. Click it for how each figure is counted.

## Terminal or VS Code

Same command, same report. The one difference is the live line: in a terminal,
`npx actuals watch` puts one line in Claude Code's status bar (cost this session at list
rates, context used, agents alive against the cap, any that died). The VS Code extension has
no status bar, so the same command opens the Live tab instead and prints the address; pin it
with `Simple Browser: Show`.

## Commands

```
npx actuals                 read this repository's sessions, write the report, open the app
npx actuals --all-projects  the same across every project on the machine
npx actuals watch           install the status line and the hooks that feed the Live tab
npx actuals fix             apply the default fix after one confirm; undo <fix-id> restores it
npx actuals share           write the card PNG and the post text, locally
npx actuals share --numbers turn on numbers sharing after seeing the exact numbers; --off stops it
npx actuals doctor          say what it can read on this machine, and whether numbers sharing is on
```

## What leaves your machine

Nothing leaves your machine unless you choose to share your numbers, and you see them first.
The report, the labels and the fixes are files in your repository and your home folder. No
account, no model call. Tokens spent making the report: 0.

The numbers are the ones on the share card, plus versions: cost, commits, files written and
still alive, runs with no fate, deaths, concurrency and depth, the model ids with a run count,
and the actuals, Claude Code, Node and platform versions. Never a prompt, a path, a file name,
a title, a commit message, a repository name, or a line of code.

It is off until you say yes. `actuals share --numbers` prints the exact numbers and asks;
`actuals share --numbers --show` prints them and sends nothing; `actuals share --numbers --off`
turns it off. While it is on, the report says so and names what went.

## How it counts

Claude Code writes one transcript line per content block and repeats the request's usage
on each line; Actuals counts usage once per request. Counters that sum every line (the
`/insights` session-meta files do) report roughly four times the output tokens. A commit is
"made inside a session" only when its author time is inside the session window, the
session ran in this repository, and the session issued `git commit` within five minutes.
Unknown fate is never counted as kept. Accuracy checks in `ACCURACY.md`.

First pass reads Claude Code. Codex is next.

## Licence

Source available under the Functional Source License, FSL-1.1-ALv2 (see `LICENSE.md`):
read it, run it, change it, and use it for anything except making a competing product or
service. Each version converts to Apache-2.0 two years after its release.
