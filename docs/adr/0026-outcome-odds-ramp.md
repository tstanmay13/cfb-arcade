# ADR 0026: Outcome odds ramp + varied records — 16-0 stays rare

- Status: Accepted
- Date: 2026-07-15

## Context
Owner playtests kept ending 14-1, and a 150k-season audit (50k full drafts per
policy through the real engines + `data.json`, exact outcome accounting) showed
why: **the monotony is structural, not the win rate**.

- A **skilled** drafter (ranks pools by *visible* stats — per-position stat↔OVR
  Spearman 0.63–0.90, the human ceiling) wins 16-0 in 8.8% of seasons on the
  shipped 68-team pool — a fine rarity — but lands on just two near-identical
  records, 14-1 (40.2%) and 12-2 (36.0%), in 76% of all seasons. Only five
  final records exist in the whole game, because each outcome maps to one
  fixed games/losses plan and *semis* is always exactly 14-1.
- The §6.2 step matrix discards power within a tier (85.0 ≡ 90.9) and flips
  odds at boundaries sitting on the densest band of human play (median skilled
  power ≈ 88).
- A 2026-07-14 retune direction ("Tier1 widens to 89 and becomes a 60% title
  favorite", drafted in response to a recap-card anecdote) was measured at
  29-41% skilled titles and **reversed by the owner before it ever shipped**:
  winning must stay rare — **6-10% for skilled play, a little higher for
  oracle-optimal play** — and what must change is the sameness of the losses.

## Decision
Two coupled changes in `sim.ts`:

1. **Odds ramp (`outcomeOdds`)**: for power 78–96.9 the outcome roll
   interpolates linearly between anchors instead of stepping at tier bounds —
   anchors at 78 (= Tier3 row), 85 (Tier2 row), 90, 94, and a 97 target; at
   ≥97 the stepped Tier0 row still applies, so the summit snap to a guaranteed
   title remains the one deliberate cliff. The curve is tuned rare:
   natty 5% @78 → 5.5% @85 → 9% @90 → 14% @94 → ~25% @96.9. Tiers keep the
   original §12 bounds for labels, scout-verified, Heisman chance, and the
   dynasty gate; Tier1–3's outcome columns are kept equal to
   `outcomeOdds(min)` (informational, pinned by a test).
2. **Record variety (`OUTCOME_PLAN`)**: the outcome still fixes season length
   and the exit round, but the **loss count is now a weighted draw** —
   semis → 14-1/13-2/12-3, major → 12-2/11-3/10-4, minor → 10-3/9-4/8-5,
   loss → 6-6/5-7/4-8; natty stays exactly 16-0. Bracket coherence: extra
   losses only land in the regular season or the CCG (an at-large berth),
   never in a knockout round the run advanced from (`pickLossIndices` cap).

Measured on the shipped 68-team pool (talent-weighted spins; 20k full drafts
per policy through the real engines, exact outcome accounting — same-pool
deployed baseline in parentheses):

| Policy  | 16-0 | max single non-win record | records with >2% share |
|---------|------|---------------------------|-------------------------|
| random  | 5.1% (was 5.0%) | 12-2 at 22.1% (was 44.8%) | 9 (was 4) |
| skilled | **7.7%** (was 8.8%) | 12-2 at **19.6%** (was 14-1 at 40.2%) | **10** (was 4) |
| oracle  | **12.5%** (was 15.7%) | 12-2 at 18.2% (was 14-1 at 45.5%) | 10 |

## Alternatives considered
- **The 60%-title-favorite retune (or a 41%-titles ramp tuning)**: rejected by
  the owner — winning becomes common; rarity is the game's spine.
- **Lower the rate but keep fixed records**: restores the original complaint —
  the near-miss mass flows back into a single 14-1 bucket.
- **Vary records but keep the step matrix**: leaves the within-tier dead zone
  and the boundary knife-edges under the densest human power band.

## Consequences
- A session's losses now read like seasons — ten live records instead of a
  14-1/12-2 shuffle — while 16-0 stays a rare, earned event at every skill
  level (random ~5%, skilled ~8%, oracle ~12%, Tier0 ≥97 the only guarantee).
- Every point of power moves the odds (steepest climb ~3.7% per +1.0 below
  97); no more dead draft improvements or boundary flips.
- `semis` no longer implies a perfect regular season — share grids and recap
  copy must derive from the schedule, never assume 12 straight 🟩
  (`share.test.ts` updated accordingly).
- `sim.test.ts` pins the anchors, monotonicity, the no-cliff bound, the
  SIM_MATRIX↔ramp consistency, and per-outcome record sets; re-run it plus
  `scripts/balance.ts` after touching `RAMP_ANCHORS` or `OUTCOME_PLAN`.
