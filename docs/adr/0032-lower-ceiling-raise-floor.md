# ADR 0032: Lower the 16-0 ceiling, raise the playoff floor

- Status: Accepted (supersedes ADR-0029's absolute bands; keeps its ratio contract)
- Date: 2026-07-16

## Context

Owner playtesting on the ADR-0029 dial surfaced two complaints, delivered with
a pair of season screenshots (a **90 OVR board finishing 8-5** next to an
**82 OVR board finishing 9-4**, both "missed the playoff, won the bowl"):

1. "Lower the ceiling for going 16-0" — the Tier0 summit (power ≥97) was a
   *guaranteed* natty, and the 97 interpolation target sat at 52%.
2. "Raise the floor for what teams get into the playoffs. … every game just
   seems to land at this point" — the minor column (missed the CFP entirely)
   was near-flat (~22–24%) across the whole 78–91 band, so 8 points of OVR
   bought almost no playoff security, and once two boards of very different
   strength both landed `minor` they drew records from an **identical**
   10-3/9-4/8-5 table. The screenshots weren't a fluke; they were the dial.

## Decision

Three coordinated changes in `src/engine/sim.ts`, measured with
`scripts/balance.ts` (20k drafts/policy, exact outcome accounting):

1. **Ceiling.** Tier0's row is now rolled like every other tier:
   `natty 0.45 · semis 0.32 · major 0.21 · minor 0.02` (was `natty 1.0`).
   The ramp's natty column tops out at 0.40 at the 97 target (was 0.52). The
   summit snap shrinks to +0.05 natty — still the one deliberate cliff, now a
   strong favorite rather than a handed-out title. Dynasty still requires a
   Tier0 natty, then the same 80% roll.
2. **Floor.** The minor column now falls with power across the anchors:
   26% (78) → 17% (85) → 9% (90) → 4% (94) → 2% (97). Playoff entry tracks
   board quality; a 90 board misses the CFP ~9%, not ~22%.
3. **Record tilt within an outcome** (`tiltedLossWeights`). The loss-count
   draw tilts by power relative to the outcome's own minimum (β = 1 − 0.5·t,
   t = clamp((power − 86)/10, −1, 1)): a 92 board's bowl season usually reads
   10-3, an 80's 9-4/8-5. Neutral when no power is passed, so the ADR-0026
   table is unchanged for old callers. 0.5 strength (not 0.6) keeps the
   ADR-0026 record-variety gates intact. `scripts/balance.ts` mirrors the
   tilt in its exact record accounting and now weights expected dynasty by
   the Tier0 natty odds.

Supporting trim: Tier4's fluke-title rate 0.05 → 0.03 (random boards mass
there; the old rate propped up the ladder's random baseline).

## Consequences

Measured before → after (2026-07-16 bake):

| metric | random | skilled | oracle |
|---|---|---|---|
| 16-0 rate | 4.7% → 3.1% | 10.0% → 7.5% | 23.0% → 17.3% |
| missed the CFP | 33.7% → 34.2% | 21.6% → 13.2% | 16.7% → 7.6% |

- Ladder: skilled/random **2.41×**, oracle/skilled **2.31×** — both above the
  ADR-0029 ratio gates (≥2× / ≥2.2×), which remain the contract.
- ADR-0029's *absolute* bands (skilled 9–12%, oracle 22–30%) are superseded:
  the owner's ceiling directive deliberately lands below them.
- Record-variety gates hold (records >2% share: 10/10/9; max non-win 12-2 at
  17.7/23.9/23.7% — within the ~25% cap).
- Tier labels, scout badges, Heisman gating, and the 78–96.9 interpolation
  structure are untouched; `SIM_MATRIX` Tier1–3 rows re-pinned to
  `outcomeOdds(min)` as ADR-0026 requires.
