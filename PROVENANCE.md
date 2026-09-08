# Provenance

Actuals v2 starts from an empty tree. Three files were copied from Actuals v1
(`namansharma14/actuals`, commit `98ab533`, tagged `v1-final-2026-09-03`) as planning
material rather than rewritten, so their origin is on record. They were removed from the
tree on 2026-09-07 and remain in this repository's history:

| Source in v1 | Why it was copied |
|---|---|
| `web/tokens.css` | Design tokens (Newsreader, IBM Plex, paper/ink palette, both themes). The report renderer has its own tokens in `src/render/tokens.ts`, with embedded fonts and no remote fonts. |
| `pivot-recovery/10-actuals-rebuild-plan.md` | Plan v2.1: the pivot, doors, funnel, validation, competition, eight weeks, kill numbers, money. |
| `pivot-recovery/11-v2-build-plan.md` | The approved build plan (2026-09-03) the product is written from. |

Ported as ideas, not files: the claim/truth data model (v1 SPEC §2.2), the gate discipline
(`gates.toml`, harness, `ACCURACY.md` rendered from a run log), the prompt-contract
versioning rule (no prompts in the MVP; the rule waits), the honesty marks, the
undercount rule, the socket contract between engine and renderer, and the practice of
logging an ambiguity instead of guessing past it.

Not ported: the Python engine, the Zendesk and generic adapters, the hosted portal
(`api/`), the site (`web/`), GTM, and legal drafts. They stay in v1.
