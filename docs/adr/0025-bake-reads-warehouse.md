# ADR 0025: The data.json bake reads the warehouse directly; Supabase heads toward stats-only

- Status: Accepted
- Date: 2026-07-14

## Context

Since ADR-0010/0011 the `data.json` bake read the Supabase serving layer
(`cfb_teams` / `cfb_player_ratings` / `cfb_player_season_stats` / `cfb_rosters`)
with the public anon key, so it ran from a clean clone with zero secrets. That
bought collaborator-friendliness at the cost of a serving hop: warehouse →
`cfb push` → Supabase → bake, where every mismatch surfaced as a bake WARN and
the fix was always "run a push from the platform side."

In practice the bake is an **owner-side** activity anyway — its output
(`public/data.json`) is committed, and collaborators build against the committed
file, never re-bake. Meanwhile the platform repo's warehouse (`cfb.db`) is the
system of record the serving tables are a projection of, it's already restorable
on any machine via `cfb restore` (R2, ADR-0018), and the push transforms are
mechanical (drop bookkeeping columns, 0/1 → boolean). The direction of travel:
Supabase should serve **runtime stats only** (ADR-0019 `arcade_results` +
aggregate RPC), not game data.

## Decision

1. `scripts/build-data.ts` reads the warehouse **directly via `node:sqlite`**
   (read-only) instead of Supabase PostgREST. The four queries port 1:1 to SQL
   against the local tables (`teams`, `player_ratings`, `player_season_stats`,
   `rosters`) with the same filters the serving layer applied (`is_current`,
   `projected = 0`, `overall >= OVR_FLOOR`, pos-group set, `MODERN_SEASONS`,
   `ORDER BY nkey`). Engine code, TOP_N, calibration, validation: untouched.
2. The warehouse path defaults to the sibling checkout (`../../cfb/cfb.db`
   relative to `scripts/`) and is overridable with **`CFB_DB_PATH`** — the same
   env var the platform repo itself uses. Missing file = loud error naming
   `cfb restore`, never a silent fallback.
3. The bake keeps **zero credentials**: a local SQLite file needs none. The
   anon key disappears from `build-data.ts`; the app's only Supabase touch
   remains the runtime stats seam (`src/data/stats.ts`, ADR-0019) — untouched.
4. **Phase boundary**: `build:seasons` and `build:gm` still read the Supabase
   serving layer. Porting them the same way (and then retiring the game-data
   `cfb_*` reads entirely) is the follow-up phase; this ADR sets the pattern.

## Consequences

- Verified on the real warehouse: the ported bake's output is
  **byte-identical** to the Supabase-baked `data.json` (modulo `generated_at`)
  — 68 teams / 3,624 players / 123 coaches.
- Re-baking now requires the warehouse (owner-side by design). A clean clone
  without `cfb.db` can still dev/build/test the app — it just uses the
  committed `data.json`, as collaborators always did.
- Serving-layer staleness can no longer make `data.json` lie: the bake reads
  the same file `cfb push` reads. Bake WARNs now point at ingest/ratings
  fixes, not pushes.
- One behavioral nicety: jersey selection gains a deterministic same-season
  tiebreak (`ORDER BY season, nkey`) that PostgREST's unordered pages never
  guaranteed (no diff on current data).
