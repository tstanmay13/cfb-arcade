# CLAUDE.md — CFB Arcade

Conventions + gotchas for AI agents working on the CFB Arcade (The 16-0 Draft
+ Guess the Season). Game rules follow the owner-side v2 design doc — its
resolved decisions and five pillars are non-negotiable; the §N references in
code comments point at it.

This is an **arcade** of independent game "cabinets" in one static SPA
(ADR-0017): The 16-0 Draft (cabinet #1), Guess the Season (cabinet #2), and
CFB-GM (cabinet #3, ADR-0023 — the dynasty sim, design doc
`docs/CFB_GM_DESIGN.md`). They share the design system, `rng.ts`, and
`scripts/lib.ts` — nothing else. `App` switches between them with a `view`
union mapped to URL paths (`/` draft · `/guess` · `/gm`; SPA rewrite in
`vercel.json`). **Do not entangle a new cabinet with the draft's
`runState`/reducer** (`src/state/store.tsx`) — that's the shipped game.

The data pipeline lives in a separate, private platform repo; the ONLY seam
between the two is Supabase (see README "The Supabase seam"). Never add a
credential beyond the public anon key to this repo.

## Ground rules

- **100% client-side.** No backend, no secrets in the app, game data only from
  static baked JSON. If a change would break "deploy = upload static files,"
  don't make it. The single sanctioned runtime network touch is the anonymous
  global-stats flow (`src/data/stats.ts`, ADR-0019): fire-and-forget writes +
  aggregate reads with the public anon key, and it must FAIL SILENT — a game
  can never block on it.
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
- **Guess the Season** (cabinet #2): `src/engine/guessSeason.ts` (pure logic +
  `.test.ts`), `src/components/GuessSeason.tsx` (screen, rendered *outside*
  `GameProvider`; takes `teams` as a prop, lazy-fetches its own JSON via
  `src/data/loadSeasons.ts`), `src/state/guessStorage.ts` (daily streak),
  `scripts/build-seasons.ts` → `public/seasons.json`. Each cabinet bakes its own
  JSON — never add to `data.json` for a different game.
- **Global stats** (ADR-0019): `src/data/stats.ts` (anon-key recordResult /
  fetchGlobalStats, fail-silent) + `src/components/GuessStatsModal.tsx`
  (personal + you-vs-everyone sheet). Server side is owner-only
  (`supabase/migrations/0006_arcade_results.sql`): anon can only INSERT rows
  and call the aggregate RPC. The Playwright harness intercepts + blocks the
  POSTs so verification runs never pollute real stats.
- **CFB-GM** (cabinet #3, ADR-0023): `src/gm/engine/*` (pure, no React, no
  storage — dynasty creation, steppable drive-level game sim (`GameSim`),
  Elo+poll, schedules, postseason, recruiting/RAP economy, portal+NIL,
  coaches/mandates, interactive 4-stage offseason; `gm.test.ts` is the
  calibration harness and the acceptance gate for any tuning-constant
  change), `src/gm/db.ts` (Dexie — the ONLY IndexedDB in the repo; snapshot
  per slot + append-only departed archive persisted at rollover; engines
  never import it), `src/gm/GmCabinet.tsx`/`GmShell.tsx`/`panels.tsx`/
  `recruitingPanel.tsx`/`WatchGame.tsx` (screens; lazy chunk so the dailies
  never pay for it), `src/gm/ui.tsx` + `theme.ts` (the GM design system:
  Card/Meter/Pill/Delta primitives, `getTeamColors()` contrast correction,
  and the `TeamMark` monogram badge — school colors live in the mark and
  `TeamName` text stays ink; screens never hardcode a brand hex),
  `scripts/build-gm.ts` → `public/gm-data.json` (real
  2026 P4 universe: projected rosters + Elo from real 2025 results + real
  rivalries from 2010-25 matchup history; Supabase-only, anon key). **Historical
  starts (ADR-0027)**: the same script takes a year (`npm run build:gm -- 2010`)
  and bakes `public/gm-data-YYYY.json` for any season 2010–2025 **except 2014
  and 2023** (unusable served-ratings coverage; the bake fails loudly). It reads
  season-scoped `cfb_teams`/`cfb_player_ratings`/`cfb_rosters`/`cfb_games` for
  that year — era-correct conferences included — plus the 2026 team list to fix
  the 68-team full-sim set (universe rule (a): the 2026 P4 schools full-sim in
  every era; the league realigns to the modern map at first rollover). One
  static file per year, lazy-loaded only when that start year is picked. All
  game "AI" is seeded policy code — zero LLM/network at runtime. Design deltas
  live in `docs/CFB_GM_DESIGN.md` implementation-notes sections.

## Commands

- `npm run dev` — localhost dev server.
- `npm test` — vitest unit tests (engines + bake helpers). Run after touching
  `src/engine/` or `scripts/`.
- `npm run build:data` — re-bake `public/data.json` (Supabase-only via the
  public anon key; no warehouse dependency, works from a clean clone).
- `npm run build:seasons` — re-bake `public/seasons.json` for Guess the Season
  (Supabase-only; ADR-0017).
- `npm run build:gm` — re-bake `public/gm-data.json` for CFB-GM (Supabase-only;
  ADR-0023).
- `npm run bench:gm -- run|report` — CFB-GM policy benchmark (headless
  30-year dynasties under scripted profiles). Baselines + method live in
  `docs/benchmarks/`; re-run and diff after ANY GM tuning change.
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
- **ADRs share one global sequence across both repos** (see `docs/adr/`).
  Historical 0001–0021 stay in the private platform repo (owner-side); this
  repo owns **0022 onward** and is where new arcade decisions go. Numbers mean
  the same thing everywhere, so the `ADR-NNNN` refs in code comments never go
  stale. Record a new load-bearing decision as a `docs/adr/00NN-*.md` (bump from
  the highest number in either repo), not in `README.md`.
