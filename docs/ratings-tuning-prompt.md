# Ratings-tuning prompt (anti-inflation + 16-0 rarity)

Paste everything below the line into a fresh AI session (or follow it by hand)
whenever ratings drift — after a new season lands, after adding programs, or
whenever 16-0 starts feeling cheap. It encodes the algorithm and acceptance
targets from the ADR-0016 balance pass.

---

You are tuning the hidden player ratings of **The 16-0 Draft** (`game/` in the
cfb repo). `hidden_ovr` is the sim's ONLY input, so rating inflation directly
inflates perfect seasons. Your job: make the draft pool honest and keep 16-0
rare, without breaking the game's invariants.

## Invariants — never violate

1. **Rank preservation.** Never reorder players within a position. All
   deflation happens through the monotonic quantile remap
   (`calibrationMap` in `game/scripts/lib.ts`), never per-player edits.
   Same input rating → same output rating.
2. **§12 correlation.** Visible stats are untouched; because the remap is
   monotonic, the stat↔OVR correlation warning in `build-data.ts` must stay
   silent. If it fires, you broke something.
3. **Cross-era fairness.** One remap per position over the WHOLE pool (all
   eras together) — never per-era curves.
4. **Positional parity (§4.5).** Calibrate within position: the best QB and
   the best S should land in the same band.
5. Don't touch the warehouse's `player_ratings` — the remap lives only in the
   game bake. The pipeline's ratings serve other consumers.

## Why inflation happens (so you fix causes, not symptoms)

The warehouse rating is a within-season cohort percentile. The game pool then
takes top-N per powerhouse program at each player's best career season —
triple selection bias. Unremapped, the pool's median is ~87 and a third of
players are 90+, which made random play go 16-0 in 22.5% of runs.

## The loop

1. Bake: `cd game && npm run build:data` — note the `recalibrated OVRs` line.
2. Measure: `node --no-warnings scripts/balance.ts 20000` — it Monte-Carlos
   full drafts with the real engines under two bracketing strategies:
   `random` (floor: button-mashing) and `greedy` (ceiling: sees hidden
   ratings, optimal re-spins, best coach). Real skilled play lands between.
3. Compare against the acceptance targets below.
4. If off, turn ONE dial (in this order), then go to 1:
   a. `CALIBRATION_BANDS` in `scripts/lib.ts` — shrink the top-band shares to
      deflate (the ≥90 and ≥96 shares are what the greedy max-order-statistic
      feeds on; cells hold ~28 players, so greedy drafts the ~96th percentile
      of every pool).
   b. `SIM_MATRIX` Tier0 `min` in `src/engine/sim.ts` (96 → 97 → 98).
   c. `SIM_MATRIX` natty rows for Tiers 1-3 (each row must sum to 1.0 —
      update `sim.test.ts` frequencies to match).
   d. Coach modifiers / re-spin counts (last resort; they change game feel).
5. When targets pass: run `npx vitest run` and a full playthrough
   (`node --no-warnings scripts/screenshot.ts http://localhost:5173`), update
   ADR-0016 with the new numbers, commit.

## Acceptance targets (agreed 2026-07-10)

| Metric (20k runs) | Target | Shipped value |
|---|---|---|
| 16-0 rate, random strategy | 3-6% | 4.9% |
| 16-0 rate, greedy oracle (upper bound) | 15-20% | 17.5% |
| Implied skilled-human 16-0 rate | ~8-12% | — |
| Dynasty rate, random | <0.5% | ~0.0% |
| Dynasty rate, oracle | 2-5% | 2.0% |
| Pool share ≥96 / ≥90 | ≤1% / ≤4% | 0.7% / 3.2% |
| Pool median OVR | 75-80 | 76 |

Rationale: a perfect season should feel earned (roughly 1 in 10 for a good
player), a Dynasty should be a story you screenshot, and a random clicker
should still taste 16-0 often enough to believe it's possible.
