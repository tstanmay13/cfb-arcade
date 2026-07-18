# ADR 0033: Elite boards are favorites (rarity is an overall budget)

- Status: Accepted (re-heights ADR-0032's ceiling; keeps its floor and
  ADR-0026/0029's contracts)
- Date: 2026-07-17

## Context — three owner directives that looked contradictory

1. **2026-07-14** — "a Team OVR 90 semifinalist should have won": drafted as
   "Tier1 = 60% title favorite," reversed before shipping ([ADR-0030], the
   reversal recorded in [ADR-0026]).
2. **2026-07-15** — "16-0 must stay rare — 6-10% for skilled play"
   ([ADR-0026] outcome ramp).
3. **2026-07-16 night** — "lower the ceiling, raise the floor" (with
   screenshots of a 90 board going 8-5 next to an 82 going 9-4):
   [ADR-0032] cut Tier0 from a guaranteed natty to 45% and the 97 ramp
   target to 40%.
4. **2026-07-17 morning** — the same screenshots return with "how are these
   teams not winning": under the 0032 dial a 91 board titled 13%, a 95 board
   31% (its quarterfinal exit was equally likely), and even ≥97 only 45%.

The directives stop contradicting once you see they answer **different
questions**:

- The **rarity law** (0026) is about the *overall* rate: across a session of
  runs, skilled play should land 16-0 in ~6-10% of them.
- The **favorite law** (0030's instinct, restated on 07-17) is *conditional*:
  once a player has actually assembled an elite board, that board should be
  a favorite — losing should feel like an upset, not the house edge.

Both can hold at once because elite boards are rare even for skilled play
(the skilled policy's p90 power is ~91; it reaches 94+ in a small tail). The
16-0 budget can be spent almost entirely on the runs that earn a monster
board, instead of being smeared thinly across every decent one.

## Decision

Steepen the 90→97 leg of the ramp and re-height the summit
(`src/engine/sim.ts`); keep ADR-0032's floor (minor falls with power;
`tiltedLossWeights` record tilt) and everything below power 90 unchanged:

| anchor | natty (0032 → 0033) | minor (unchanged shape) |
|---|---|---|
| 78 | 3% → 3% | 26% |
| 85 | 3.8% → 3.8% | 17% |
| 90 | 9% → 10% | 9% |
| 94 | 26% → **38%** | 4% → 3% |
| 97 target | 40% → **62%** | 2% → 1% |
| Tier0 row (≥97) | 45% → **100% — guaranteed** | 2% → 0% |

Conditional odds a player now sees: **91 → 17% natty** (miss-the-CFP 7.5%),
**93 → 31%**, **95 → 46%** (QF exit down to 20%), **≥97 → guaranteed 16-0**.
The guarantee was drafted here as 70% ("commanding, never guaranteed"); the
owner overruled on 2026-07-18 — "we genuinely need a 100% for some overalls" —
restoring the pre-0032 summit. The guarantee is paid for by scarcity, not
odds: reaching 97+ takes a near-perfect draft (measured reach odds — perfect
drafter 2.70% of runs = 1 in 37; stat-reading skilled play 1 in ~6,700;
random never in 20k). Dynasty still rides an 80% roll on the Tier0 natty.
Tier1's informational row re-pins to `outcomeOdds(91)` per the 0026
convention; the scarcity knob for the summit itself is bake-side
(`CALIBRATION_BANDS` — 23 players rate 96+ today).

## Measured (20k drafts/policy, scripts/balance.ts, 2026-07-16 bake)

| metric | random | skilled | oracle |
|---|---|---|---|
| 16-0 rate (0032 → 0033) | 3.10% → 3.10% | 7.5% → **8.75%** | 17.3% → **24.82%** |
| reaches the 97+ guarantee | never (0/20k) | 0.01% (1 in 6,667) | 2.70% (1 in 37) |
| missed the CFP | 34.2% → 31.3% | 13.2% → 13.2% | 7.6% → 7.1% |

- **Rarity law holds**: skilled 8.75% is inside the 6-10% band. Random is
  untouched (3.10% — button-mashing still can't buy titles; Tier4 fluke rate
  stays 0.03).
- **Ladder** (ADR-0029 ratio contract): skilled/random **2.82×**,
  oracle/skilled **2.84×** — both above the ≥2× / ≥2.2× gates. Oracle's
  ~25% absolute rate is a deliberate consequence of the favorite law: a
  policy that reliably builds ~95-power boards *should* title often.
  Oracle expected dynasty 2.16% (every summit natty rolls the 80%).
- Record-variety gates hold (>2% records: 10/10/9; max non-win 14-1 at 22%).

## The law for future retunes

Any future "elite teams lose too much" or "16-0 is too common" complaint
must name which of the two quantities it's about before touching the dial:

- *Overall* skilled 16-0 rate — budget: **6-10%** (move the 90-anchor).
- *Conditional* elite odds — floor: a 95-power board is a favorite to reach
  the final and ~coin-flip-plus to win it; ≥97 is guaranteed (move the 94/97
  anchors and Tier0 row in `src/engine/tuning.ts`; move the guarantee's
  scarcity with the bake's CALIBRATION_BANDS).

Retunes ship only with a fresh `scripts/balance.ts` table in the ADR.

[ADR-0026]: 0026-outcome-odds-ramp.md
[ADR-0030]: 0030-tier1-title-favorite.md
[ADR-0032]: 0032-lower-ceiling-raise-floor.md
