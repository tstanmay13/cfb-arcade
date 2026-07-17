# ADR 0030: Tier1 is a title favorite (elite rosters should win)

- Status: Superseded by [ADR-0026](0026-outcome-odds-ramp.md) before shipping
  (owner reversed the premise: 16-0 must stay rare — ~6-10% for skilled play.
  The dial changes below were never deployed.)
- Date: 2026-07-14 (recorded as 0024 in a parallel session; renumbered — that
  slot was already taken by [ADR-0024](0024-16-0-team-expansion.md) on main)

## Context
Under ADR-0016's §12 balance dials, the sim's outcome is a two-stage roll:
roster `hidden_ovr` avg × coach modifier → **power score** → **tier** → the
tier's fixed probability row. A recap card surfaced the tension: a **14-1,
Team OVR 90** semifinalist (Burrow/Chase/Barkley, 5 All-Americans, Elite
coach) lost in the SF, and the owner's read is that a roster that good should
win. But power 90 lands in **Tier2** (min 85), whose row is natty 0.08 /
semis 0.42 — so a semifinal exit was the *modal* outcome (42%) and the title a
mere 8% shot. Tier1 (91–96) barely helped: only 20% natty. Only Tier0
(min 97) is a guaranteed champ. The thresholds *are* the balance knob, and
the owner chose to loosen them for elite rosters.

## Decision
Reward well-drafted elite rosters without touching the guaranteed-champ bar:
1. **Widen Tier1 down**: `min` 91 → **89**, so a Team OVR ~89–96 roster is
   Tier1 (Tier2 now covers 85–88).
2. **Raise Tier1's title odds**: natty 0.20 → **0.60**, semis 0.50 → 0.25,
   major 0.30 → 0.15 (row re-normalized to 1.0).
3. **Tier0 (min 97, natty 1.0, dynasty 0.8) is unchanged** — it stays the only
   *guaranteed* champion and the ceiling players chase.

Measured with `scripts/balance.ts` (20k drafts/strategy, real engines + data):

| Strategy | 16-0 before | 16-0 after |
|----------|-------------|------------|
| random (button-masher) | 4.9% | **5.0%** |
| oracle (perfect draft)  | 17.5% | **53.9%** |

Dynasty rate is unchanged (2.0% oracle / 0% random) since Tier0 is untouched.
A Team OVR 90 now wins the natty **~60%** (was 8%); its SF-exit chance drops
to ~25%. This revises ADR-0016's §12 dials only — the quantile calibration
method and the "16-0 must be *earned*" principle stand; the bar for "earned"
moved from oracle-only to skilled-drafter.

## Alternatives considered
- **Lower Tier0's bar to ~90 (auto-champ)**: literal "this should win," but a
  sledgehammer — every 90+ roster auto-wins, Dynasties become common, and
  16-0 stops being rare at all. Kills the ceiling.
- **Leave ADR-0016 as-is**: internally consistent and the SF loss was
  correct by the model — but the owner wants elite rosters to feel rewarding,
  not coin-flips.
- **Gentle bump (Tier1 natty ~0.40, ~40% for a 90)**: smallest deviation, but
  a 90 still loses the majority of the time — doesn't satisfy "should win."

## Consequences
- A skilled drafter who assembles a genuinely elite board is now a **heavy
  title favorite**, not a coin-flip; button-mashing is still ~5% to run the
  table (it rarely clears power 89).
- The random↔oracle 16-0 gap widens (5% → 54%), so *draft skill* matters far
  more to the outcome — the intended direction.
- Re-run the balance loop (`scripts/balance.ts`) and `sim.test.ts` after any
  future matrix/calibration change; `sim.test.ts` now pins the 60/25/15 Tier1
  row and the 89 boundary.
