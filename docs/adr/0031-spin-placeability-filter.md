# ADR 0031: Spins are placeability-filtered (dead pools can't land)

- Status: Accepted
- Date: 2026-07-16

## Context

§5.6 case 2 of the design doc resolved "the pool has players but none can be
placed" with re-spins: land the cell anyway, grey everyone out, and make the
player spend a `TEAM ↻`/`ERA ↻` (or the free expanded fallback once both are
exhausted). That was tolerable when dead pools were rare.

The ADR-0028 era rebucket made them routine. Splitting the 2010s into
5-year windows halved per-window roster coverage, and the bake assigns each
athlete to **one** window (best-rated season, ties to the later year), with an
`OVR_FLOOR=75` cut and no per-position floor. Result in the shipped
`data.json`: **79 of 204 cells are missing at least one position — 67 of the
68 cells in 2010-14** (LB missing in 51 cells, S 45, DL/CB 40; Georgia
2010-14 is a 6-player pool with no CB and no S). Late-draft spins for a
defensive slot routinely landed "0 AVAILABLE · 10 OUT" (reproduced on spin
8/8: 2010-14 South Carolina with the S slot open), forcing a manual re-spin
the player never wanted. Owner's call: a cell you can't draft from **should
never land at all**.

## Decision

1. **Every player spin takes the board's slots** (`spin`, `teamRespin`,
   `eraRespin`, the keep-team sticky spin) and filters candidate cells to
   those holding ≥1 player with an eligible open slot (`eligibleOpenSlots` —
   position fit, dual-position, duplicate block all included). §5.6 case 2
   becomes structurally impossible, the same way case 1 (empty cell) always
   was. Weights (§5.3) re-percentile within the filtered candidate set.
2. **Placeability outranks locks, via a widen ladder**: an era-locked spin
   (team re-spin, keep-team) with no placeable cell inside the lock drops the
   era lock first, then the team lock, before it would ever land a dead pool.
   With current data the ladder never fires (every era keeps ≥17 cells per
   position); it exists so thin future data degrades gracefully.
3. **`ERA ↻` availability is enforced, not advisory**: the engine exposes
   `canEraRespin` / `canCoachEraRespin` / `canCoachTeamRespin` and the board
   disables the buttons — honoring the "the UI must disable the button"
   contract the engine comment always claimed.
4. **A keep-team lock that can't be honored refunds its token**: at PLACE,
   if the locked cell holds no placeable player once the pick is on the
   board, the sticky lock is dropped and `keepTeam` is credited back —
   arming was also tightened to require ≥2 currently-placeable players.
5. **Coach re-spins can no longer charge for a no-op**: `spinCoach` with an
   `exclude` now widens its era (mirror of the player ladder) or returns
   null instead of re-serving the identical cell — and a null never costs a
   re-spin.
6. **The bake warns loudly on position-incomplete cells** (per-era census in
   `build-data.ts`). The data itself is *not* backfilled — closing the
   2010-14 holes is platform-side ratings-coverage work (same cliff that
   makes 2014 unusable for CFB-GM historical starts, ADR-0027), or a future
   owner decision to relax the one-window-per-athlete / OVR-floor rules.

`isPoolUsable` + `expandedFallbackSpin` (§5.6 case 3) survive as unreachable
safety nets behind the same UI path.

## Consequences

- Re-spins revert to pure taste tools ("I don't like this team"), their §5
  intent. Nobody burns one to escape a pool they can't draft from.
- Landing odds become board-state-dependent: once only (say) the S slot is
  open, cells without a safety don't exist for that spin — so late-draft
  spins skew toward the windows with full coverage (2015-19 / 2020-25) until
  the 2010-14 holes are closed upstream. The wheel *looks* unchanged; the
  candidate set is just honest.
- Seeded reproducibility is unaffected (the filter is a pure function of
  run state), but a given seed produces a different run than pre-0031 —
  fine, seeds are not stable across balance changes anyway.
- `npm run build:data` prints the coverage debt every bake until the
  platform closes it.
