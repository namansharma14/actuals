# Synthetic fixtures

`eval/generate.ts` builds a deterministic, from-scratch fixture set: a fake Claude Code
project directory (session + subagent JSONL, shaped exactly like real transcripts) and a
real git repository, together with a `ground_truth.json` answer key computed by
construction. It is the synthetic generator, written blind to
`src/read/` — it encodes the transcript format from the spec and from real transcript
shapes inspected read-only, never from the reader implementation.

## Regenerating

```
npx tsx eval/generate.ts --out <dir> --seed 1 --sessions 18
```

- `--out` — destination directory. Wiped and rebuilt on every run.
- `--seed` — integer seed for the internal PRNG (mulberry32). Same seed + same
  `--sessions` + same `--now` (if passed) always produces byte-identical output; there is
  no `Date.now()` or `Math.random()` anywhere in the generator.
- `--sessions` — target session count. 18 required "case" sessions are always produced
  (each carries one or more of the cases below); if `--sessions` asks for more, plain
  filler sessions pad the count up. Asking for fewer than 18 still yields all 18 — case
  coverage is not optional.
- `--now` — ISO timestamp used to anchor the `still_running` case (defaults to a fixed
  constant, not the real clock).

Output layout:

```
<out>/claude/projects/<slug>/<session>.jsonl               # main session transcripts
<out>/claude/projects/<slug>/<session>/subagents/agent-<id>.jsonl
<out>/claude/projects/<slug>/<session>/subagents/agent-<id>.meta.json
<out>/claude/usage-data/facets/<session>.json               # optional /insights outcome claim
<out>/repo/                                                 # real git repo (git init)
<out>/repo-secondary/                                       # second cwd, for the cwd-change case
<out>/ground_truth.json                                     # the answer key
```

`<slug>` is `<out>/repo` with `/` replaced by `-`, matching how Claude Code names project
directories from `cwd`.

## Reading the answer key

`ground_truth.json` has four top-level arrays/maps:

- `sessions[]` — per session: id, window, turn count, usage totals and cost per model
  (computed via `src/rates`, so it always agrees with `rates.json`), commit subjects
  attributed to it, re-read count, peak concurrency, and max tree depth.
- `runs[]` — per subagent run: id, session, parent run, depth, the **expected fate** and
  the rule that produces it, files it wrote, and whether its last tool call went
  unanswered.
- `commits[]` — sha, subject, author time, attribution (`inside_session` /
  `during_session_unattributed` / `outside`), and revert linkage.
- `cases` — a map from case name to `{ session_id, run_id?, note }`, so a harness (or a
  human) can jump straight to the session/run that exercises a given case instead of
  re-deriving it.

## Cases covered (each present in `cases`, in at least one session)

- **Tree shape** — `tree_depth3`, `spawn_depth2`, `spawn_depth3`, `peak_concurrency`: one
  session spawns two depth-1 runs in parallel; one of them chains depth-1 → depth-2 →
  depth-3, giving max depth 3 and a computed peak concurrency of 4.
- **Fates** (first-match-wins) — `died_run` (subagent file ends on an
  unanswered tool_use while the parent session keeps going), `still_running` (last event
  within minutes of `--now`, no final text — wins over the died heuristic by rule order),
  `landed_tracked` / `landed_untracked` / `finished_unlanded` / `unknown_fate` (four
  sibling runs in one session, one per remaining fate).
- **Transcript shape** — `sidechain` (isSidechain:true lines sandwiched in the main file),
  `cwd_change` (cwd switches from `<out>/repo` to `<out>/repo-secondary` mid-session),
  `first_message_tool_result` (a resumed-looking session whose first user line is a
  tool_result, not a prompt), `zero_turns` (only non-message line types, no user/assistant
  lines), `is_meta_line` (a user line with `isMeta:true`), `non_message_line_types`
  (`queue-operation`, `last-prompt`, `ai-title`, `file-history-snapshot`, `attachment`,
  `file-history-delta` all appear, shaped minimally as observed in real files).
- **Model/usage** — `unknown_model` (`claude-zeta-9`, unresolved by `rates.json`, falls
  back to the family default marked `assumed`), `bedrock_model`
  (`us.anthropic.claude-opus-5-20260301-v1:0`, normalises to `claude-opus-5`),
  `usage_split_present` / `usage_split_absent` (the `cache_creation.ephemeral_5m/1h`
  object present vs. absent — when absent, the whole creation count is priced at the
  cheaper 5m rate per the undercount rule).
- **Re-reads** — `re_reads`: the same path `Read` twice in one session; `re_reads: 1`.
- **Malformed lines** — `malformed_lines` / `malformed_lines_subagent`: a main file and a
  subagent file each carrying 3+ malformed lines (truncated JSON, an empty line, a JSON
  array instead of an object) at recorded indices, sandwiched between otherwise-valid
  lines so a reader must skip-and-count rather than abort.
- **Commits** — `commit_inside_attributed` (author time inside a session
  window with a matching `Bash` `git commit` call within 5 minutes), `commit_outside`
  (author time 10 days before any session), `commit_revert` (a `git revert` 10 days after
  its target, inside the 30-day window). File-survival variants ride along with the fate
  cases: `landed_tracked`'s file is committed and tracked, `landed_untracked`'s is written
  and left untracked, `finished_unlanded`'s is written then deleted before the disk survey.
- **Claims/truths** (the claim design, blind-by-design fixtures) — `report_delivered_positive`
  (final text names a path with no backing Write/Edit/NotebookEdit; the path exists on
  disk untracked) / `report_delivered_negative` (final text names a path a Write in the
  same run's own turns backs -> `file_written`, not `report_delivered`); `session_outcome_positive`
  (an `/insights` facets file claims `achieved`, and a run in the session landed) /
  `session_outcome_negative` (same claimed `achieved`, but the session's only run died);
  `report_cited_positive` (a run delivers a report by path; a later session Reads that
  same path) / `report_cited_negative` (a delivered report path nothing later reads,
  edits, or commits). These six have no dedicated verdict/claim field on `GTCase`/`GTRun`
  — the expected claim kind, subject, and verdict are spelled out in each case's `note`
  instead; `expected_fate` is set as usual wherever the case's fate is part of what it
  tests. The two `session_outcome` cases are the only ones that emit a facets file.

## Notes

- Every commit is made with a fixed author/committer identity and date
  (`GIT_AUTHOR_DATE`/`GIT_COMMITTER_DATE`, plus `-c user.email=a@b -c user.name=Gen`), so
  commit hashes are a pure function of tree + message + dates — reproducible across
  machines and independent of `--out`'s absolute path.
- Determinism is checked byte-for-byte on the session/subagent/meta/ground-truth files
  (`tests/generate.test.ts`); `.git/index` is excluded from that comparison because git
  embeds real filesystem stat data (mtime/inode) in it regardless of how deterministic the
  commit content is — the commit shas, dates, subjects and tree contents are asserted
  directly via `git log` instead.
- Nothing here is copied from real transcripts. Prompts, file contents, and descriptions
  are synthetic placeholder text; only the JSON envelope shape and field names come from
  the transcript format and from inspecting real files' *keys*.
- `still_running` is defined relative to `ground_truth.json`'s top-level `now`, not the
  real wall clock. A harness grading this fixture set must pass that same `now` as its
  clock, or the run reads as `died` the moment real time moves past it.
- `started_at`/`ended_at` on every session come only from the first/last *timestamped*
  line actually emitted in its own main transcript file — never a hand-picked constant,
  and never rolled up from its subagent files' timestamps (a turn is owned by a session
  XOR a run, never both; see `ledger.ts`'s `owner_kind`). One case makes this an open
  question rather than a fact: `zero_turns`'s only timestamped lines are
  `queue-operation`s, since `last-prompt`/`ai-title`/`file-history-snapshot` carry no
  timestamp in real files either — `Session.started_at`/`ended_at` are nullable in the
  ledger schema for exactly this reason, and a reader may reasonably resolve it to `null`
  instead. Flagged rather than guessed past.
- Cost is computed by calling `src/rates` directly (`resolveRate` + `costOf`), the same
  code a reader would use, so `ground_truth.json`'s dollar figures agree with
  `rates.json` by construction. Grading against synthetic fixtures therefore exercises a
  reader's usage extraction and its 5m-absent collapse (independently re-derived here,
  not delegated to `src/rates`) — it does not independently verify rate normalisation
  itself, since both sides call the same function.
