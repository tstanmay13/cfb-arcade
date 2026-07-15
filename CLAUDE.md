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

The data pipeline lives in a separate, private platform repo. Two seams, each
with one job (ADR-0025, README "The data-platform seams"): ALL bakes read the
platform's **local warehouse** (`cfb.db` via `node:sqlite` — see
`scripts/warehouse.ts`; owner-side, no credentials), and Supabase is **runtime
stats only** (ADR-0019, anon key). Never add a credential beyond the public
anon key to this repo.

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
  `scripts/content/*.json` — one file per program, **hybrid** since the 68 P4
  expansion (ADR-0024): the original 18 are fully authored (historical rosters +
  coaches, the human-readable source of truth, §4.5); the ~50 expansion teams are
  stubs — authored coaches only (CFBD has none, ADR-0014/0015), with branding +
  modern rosters merged from the warehouse at bake (`players: []`, ADR-0025).
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
  Card/Meter/Pill/Delta primitives + `getTeamColors()` contrast correction;
  the `TeamMark` monogram badge itself is ARCADE-SHARED at
  `src/components/TeamMark.tsx` and used by all three cabinets — school
  colors live in the mark, team-name text stays ink, and screens never
  hardcode a brand hex),
  `scripts/build-gm.ts` → `public/gm-data.json` (real
  2026 P4 universe: projected rosters + Elo from real 2025 results + real
  rivalries from 2010-25 matchup history; warehouse-direct, ADR-0025). All game
  "AI" is seeded policy code — zero LLM/network at runtime. Design deltas
  live in `docs/CFB_GM_DESIGN.md` implementation-notes sections.

## Commands

- `npm run dev` — localhost dev server.
- `npm test` — vitest unit tests (engines + bake helpers). Run after touching
  `src/engine/` or `scripts/`.
- `npm run build:data` — re-bake `public/data.json` (owner-side, ADR-0025:
  reads the platform repo's `cfb.db` directly — sibling checkout by default,
  `CFB_DB_PATH` to override. Collaborators use the committed `data.json`).
- `npm run build:seasons` — re-bake `public/seasons.json` for Guess the Season
  (warehouse-direct like all bakes, ADR-0025/0017).
- `npm run build:gm` — re-bake `public/gm-data.json` for CFB-GM
  (warehouse-direct, ADR-0025/0023).
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
- Spin landing weight is **talent-driven and lives IN code** (§5.3,
  `src/engine/spin.ts`, ADR-0024): a cell's top-3-avg-OVR percentile on a gentle
  `[MIN_CELL_WEIGHT=1.5, MAX_CELL_WEIGHT=3.0]` curve, a `MARQUEE_BUMP=1.25` for the
  hand-curated `MARQUEE_TEAMS`, and `COACH_TIER_WEIGHT` for coach spins — all
  runtime-tweakable constants (retune = one-line edit, no data re-bake;
  `cellSpinWeight` is exported for tuning/tests). `powerhouse_eras` in
  `scripts/content/*.json` now only gates 80s/90s era authenticity, not weight.
- **ADRs share one global sequence across both repos** (see `docs/adr/`).
  Historical 0001–0021 stay in the private platform repo (owner-side); this
  repo owns **0022 onward** and is where new arcade decisions go. Numbers mean
  the same thing everywhere, so the `ADR-NNNN` refs in code comments never go
  stale. Record a new load-bearing decision as a `docs/adr/00NN-*.md` (bump from
  the highest number in either repo), not in `README.md`.
