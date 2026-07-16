# ADR 0024: The 16-0 Draft expands to 68 P4 teams with talent-weighted spins

- Status: Accepted
- Date: 2026-07-14

## Context

The 16-0 Draft (cabinet #1) shipped only 18 blue-blood programs — the exact set
of authored `scripts/content/*.json` files. Players/branding for *every* FBS team
already live in the Supabase serving layer (`cfb_teams`, `cfb_player_ratings`, …,
read at bake time with the public anon key), so the 18-team cap was a content-file
limitation, not a data one. (Verified live: the serving layer already carries all
136 FBS teams / ~245K `cfb_player_ratings` rows, so the bake needs no warehouse
restore, service key, or CFBD key — only the public anon key.) We want more teams
without diluting the game into a
coin-flip between stacked and hopeless rosters.

Two constraints shaped the design:
- **Coaches are authored-only** (ADR-0014/0015: CFBD has no coach dataset), so new
  teams need hand-authored coaches even though their players come from Supabase — the
  ~50 new stubs add ~100 hand-authored coaches whose tiers are derived from real
  head-coach records.
- The old spin weighting was a binary `POWERHOUSE_WEIGHT = 3` on `is_historic_powerhouse`
  cells — fine for 18 blue-bloods, meaningless once the field is 68 mixed-quality teams.

## Decision

1. **Scope: 68 Power-conference programs** (SEC/Big Ten/Big 12/ACC + Notre Dame),
   the same set `build-gm.ts` derives. The 18 authored files stay verbatim; the ~50
   new teams are content **stubs** (identity + authored coaches, empty `players`) whose
   modern rosters + branding are pulled from Supabase at bake — no new credentials, R2,
   or `cfb push`.
2. **Talent-weighted spin** (`spin.ts`): the exported `cellSpinWeight` computes a
   `{team, era}` cell's landing weight from its **top-3-average-OVR percentile** within
   the candidate set, mapped onto a **gentle** `[MIN_CELL_WEIGHT, MAX_CELL_WEIGHT] =
   [1.5, 3.0]` curve, times a `MARQUEE_BUMP` (1.25) for a hand-curated `MARQUEE_TEAMS`
   set. Coaches weight by `COACH_TIER_WEIGHT`. All constants are runtime + tweakable —
   retuning is a one-line edit, no data re-bake.
3. OVR recalibration (ADR-0016) now runs across the full 68-team pool (unchanged code —
   it already spans all baked players); tier thresholds in `sim.ts` are unchanged.
4. **Era policy is unchanged** (ADR-0014/0015): `EXCLUDED_DECADES` still drops the
   1980s/1990s/2000s, so the ~50 new stub teams ship **2010s + 2020s eras only** (their
   `powerhouse_eras` are empty) — the real-data window from ADR-0014.

## Consequences

- Baked `public/data.json`: 68 teams / 3,624 players / 123 coaches / ~1.4 MB
  (~161 KB gzip — a single boot fetch, still trivial).
- Feel (verified on real data): every team reachable, the strongest cell lands ~2.3×
  the weakest, marquee ~41% of spins, expansion teams ~69%, no draft soft-locks, 16-0
  rate ~12.6% under greedy-optimal drafting (in the tuned ~5%-random / ~18%-oracle band).
- A "bad" program with a standout era/roster is now an exciting spin, not a dead cell.
- New editorial surfaces to maintain: `MARQUEE_TEAMS` (the 18 original blue-bloods plus
  Clemson, Colorado, Texas A&M, Wisconsin, UCLA, and Michigan State) and per-team coach tiers.
- Fixed a latent bake bug: `quoteList` now URL-encodes values ("Texas A&M" broke the
  PostgREST `in.()` filter via its `&`).
