# ADR 0029: The skill ladder — retuned win rates on the 5-year era pool

- Status: Accepted (supersedes ADR-0026's rarity band; keeps its structure)
- Date: 2026-07-16

## Context

ADR-0026 set winning rare (skilled 6–10%) and fixed record monotony, but owner
playtesting after the 68-team expansion + keep-team token surfaced the real
problem: **skill barely paid**. The complaint, verbatim: "~9% is fine — but
just not, like, that much higher than straight button mashing." An interim
direction (skilled 15–20%, oracle ~30%) was considered and walked back in the
2026-07-15 grilling session; the locked contract became a **ladder**:

> random ≤5% · skilled 9–12% · oracle 22–30%, with hard ratio gates
> **skilled ≥2× random** and **oracle ≥2.2× skilled**. Absolutes are bands;
> ratios are the contract. Record variety keeps ADR-0026's gates
> (≥9 records >2% share, max non-win ≤~25%, natty exactly 16-0, Tier0 97
> snap the only cliff).

Two measurement problems had hidden the flatness:

- `scripts/balance.ts` had no skilled policy (each audit rebuilt one ad hoc),
  and its oracle **never used era re-spins or keep-team tokens** — blind to
  the exact mechanics players exploit. Remeasured with the upgraded harness,
  the pre-rebucket game was random 5.1% / skilled 8.4% / oracle 17.1% —
  a 1.6× / 2.0× ladder, not the reported 5.1 / 7.7 / 12.5.
- The two-decade pool made the era re-spin a deterministic flip (ADR-0028),
  compressing the ladder further.

## Decision

1. **`scripts/balance.ts` is now the permanent three-policy harness**:
   `random` (true mashing floor), `skilled` (sign-corrected per-position
   visible-stat percentile composite — the human stat-reading ceiling), and
   `greedy` (hidden_ovr oracle). All policies model the full current economy:
   exclude-previous spins, 2 team + 2 era re-spins with era-fishing, 2
   keep-team tokens, coach re-spins funded by leftover tokens. Outcome and
   record shares are computed **exactly** (outcomeOdds × OUTCOME_PLAN loss
   weights — no roll noise), and an optional dump flag writes raw power
   samples so anchor candidates can be refit offline without re-drafting.
2. **RAMP_ANCHORS re-heighted** on the ADR-0028 pool — natty
   0.038 @78 → 0.052 @85 → 0.125 @90 → 0.31 @94 → 0.52 @96.9, with each
   anchor's non-natty mass keeping ADR-0026's semis/major/minor proportions.
   The shape is deliberately **flat through ~90 and steep 94→97**: skilled
   boards mass at power 84–91, oracle boards at 90–96, so the top leg is what
   separates mastery from competence — proportional re-heighting alone could
   not satisfy the oracle ratio (best 2.0×). SIM_MATRIX Tier1–3 informational
   rows updated to `outcomeOdds(min)` (test-pinned); Tier0/4–7 untouched;
   the 96.9→97 snap shrinks from 0.25→1.0 to 0.52→1.0 (a smaller cliff).

## Measured (20k drafts/policy, exact accounting, deterministic seeds)

| | decades + old ramp (shipped) | rebucket, old ramp | **rebucket + this retune** |
|---|---|---|---|
| random | 5.08% | 5.05% | **4.67%** |
| skilled | 8.35% | 7.55% | **9.99%** |
| oracle | 17.06% | 13.85% | **23.03%** |
| skilled/random | 1.64× | 1.50× | **2.14×** |
| oracle/skilled | 2.04× | 1.83× | **2.31×** |
| skilled records >2% | 10 | 10 | **10** |
| max non-win (skilled) | 12-2 at 19.3% | 12-2 at 19.6% | **12-2 at 19.1%** |
| expected dynasty (oracle) | 3.84% | 2.16% | **2.16%** |

The era-flip exploit, quantified: skilled play spends ~1.99 of 2 era re-spins
per draft in both pools, but the rebucket cut what the button buys (oracle
17.1% → 13.9% before any curve change). The retune then rebuilt the ladder on
top of the honest pool.

## Alternatives considered

- **Interim raised targets (skilled 15–20%)**: walked back by the owner —
  a win most weeks cheapens the share card; rarity is the game's spine.
- **Proportional re-heighting only**: hits the skilled band easily but caps
  oracle/skilled at ~2.0× — the overlap between skilled and oracle power mass
  below 92 lifts both together. Rejected for the flat-then-steep shape.
- **Fixing the gap by crushing random only (≤3%)**: mashing becomes nearly
  winless — brutal for casual first runs, and it still leaves oracle ~1.8×
  skilled.

## Consequences

- Knowing ball visibly pays: mash < read < master now steps 4.7% → 10.0% →
  23.0%, and every added point of power moves the odds (steepest leg 7% natty
  per +1.0 power, still no mid-ramp cliff; monotonicity + slope pinned by
  `sim.test.ts`).
- A skilled player's wins stay events (~1 in 10), and even perfect oracle play
  loses 3 of 4 — "one more run" survives mastery.
- Tier labels, scout badge, Heisman chance, and the dynasty gate keep the
  original §12 bounds (`min` values unchanged).
- Retuning anything here requires `scripts/balance.ts` numbers in the ADR —
  the harness is now permanent; do not rebuild it ad hoc.
