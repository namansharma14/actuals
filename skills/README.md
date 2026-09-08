# actuals/skills

One Claude Code skill so an agent can measure what the coding agents in a repository
actually shipped, and act on it: run `npx actuals`, read the report, review the fixes
actuals derives from the numbers and apply them on confirmation, and set up the always-on
status line. Local, nothing uploaded, no model called.

## Install

As a Claude Code plugin marketplace:

```
/plugin marketplace add namansharma14/actuals
/plugin install actuals@actuals
```

Or point Claude Code at this directory directly:

```
/plugin marketplace add ./skills
/plugin install actuals@actuals
```

The skill then loads when you ask what your agents actually did, what a session cost, what
shipped, or to clean up after a run. It reads `report.json`, the report file written next to
`report.html` under `~/.actuals/<repo>/runs/<run>/`, and never applies a change or shares a
report without your confirmation.

## Layout

```
skills/
  .claude-plugin/marketplace.json     the marketplace: one plugin, "actuals"
  plugins/actuals/
    .claude-plugin/plugin.json        the plugin manifest
    skills/actuals/SKILL.md           the skill itself
```
