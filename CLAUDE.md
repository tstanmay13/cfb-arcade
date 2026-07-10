# CLAUDE.md — game/

Conventions + gotchas for AI agents working on The 16-0 Draft. Read the design
doc (`16-0-Draft_Design_Doc_v2.md`) before changing game rules — §0's resolved
decisions and §1's five pillars are non-negotiable.

## Ground rules

- **100% client-side.** No backend, no runtime DB/API calls, no secrets in the
  app. All data comes from the static `public/data.json`. If a change would
  break "deploy = upload static files," don't make it.
- **`hidden_ovr` is the only simulation input.** Visible stats are cosmetic but
  must correlate with OVR (§12 invariant) — never author stats that lie.
- **The sim is pre-computed at SIM_RESOLVE**; animations are pure playback.
- **All randomness goes through the seeded RNG** (mulberry32). Never call
  `Math.random()` in engine code — reproducibility of a run from its seed is a
  feature (§2 `runState.seed`) and what makes the engines testable.

## Layout

- `src/data/types.ts` — §4 schema + stat-label dictionaries. Shared by app AND
  bake script (hence plain type-strippable TS, no enums).
- `src/engine/` — pure logic (spin, sim, awards, rng). No React imports here;
  everything unit-tested with vitest (`npm test`).
- `src/` React components consume engines via the runState reducer.
- `scripts/build-data.ts` — bakes `public/data.json` (see ADR-0010/0011).
  `scripts/content/*.json` — authored historical rosters/coaches, one file per
  program; the human-readable source of truth (§4.5).

## Commands

- `npm run dev` — localhost dev server.
- `npm test` — vitest unit tests (engines + bake helpers). Run after touching
  `src/engine/` or `scripts/`.
- `npm run build:data` — re-bake `public/data.json` (needs network for
  Supabase; falls back to `../cfb.db` for branding/jerseys until the
  teams/rosters push lands).
- `npm run build` — tsc + vite production build (static `dist/`).

## Gotchas

- Relative imports **must include `.ts`** in `scripts/` (run by Node directly);
  Vite-side code follows the same style for consistency.
- WR1/WR2 are board slots, not player types — players have position `WR`.
  Both slots resolve to `STAT_LABELS.WR`.
- Historical content: keep players era-correct (a 2009 Heisman is the 2000s
  decade, not the 2010s) and never author a kicker/TE/OL into a board position.
- Decade powerhouse flags live per-program in `scripts/content/*.json`
  (`powerhouse_eras`), not in code.
- ADRs for the game continue in the repo-root `docs/adr/` log (0009+).
