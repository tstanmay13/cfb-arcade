# ADR 0028: 5-year era windows — dynasty cores, not decade mush

- Status: Accepted
- Date: 2026-07-16

## Context

The 16-0 Draft's live pool ran on two eras (2010s / 2020s), which broke the
game two ways:

1. **The era re-spin was a solved button.** `eraRespin` keeps the team and
   re-rolls the era — with exactly two live eras that is a deterministic flip
   to the other decade. Land 2020-25 Alabama, press once, get the 2010s
   dynasty. Owner playtesting flagged it ("keep team … made it a little too
   easy"), and the upgraded balance harness (ADR-0029) measured skilled play
   spending ~1.9 of 2 era re-spins per draft: the button was always correct.
2. **Rosters were decade mush.** A "2010s Alabama" cell blends the 2009-12
   core with the Tua machine; 2011-15 Bama, 2016-20 Clemson, and 2021-25
   Georgia are the units fans actually think in. Era authenticity is this
   game's recognition dopamine, and decades blurred it.

Owner-locked decisions (grilled 2026-07-15) resolved the design questions
before implementation; this ADR records them.

## Decision

Live eras are now **"2010-14" / "2015-19" / "2020-25"** (`Era` union in
`src/data/types.ts`; dormant authored decades keep their `"1980s"`-style
strings). Specifics:

- **Forward rule**: half-decade grid; the trailing grid window absorbs the
  partial half-decade until it holds **≥3 real seasons**. 2025 therefore lives
  in "2020-25" today; the 2027 bake splits it into "2020-24" + "2025-29".
  Encoded in `eraOf()` (`scripts/build-data.ts`).
- **Labels are the union strings themselves** — chips, wheel, share card all
  render the raw value; there is no formatting layer. Entity fields keep the
  historical name `decade`.
- **Players keep the best-season rule**: one row per human, in the window of
  their best-rated season — straddlers need no special handling. The authored
  pre-2015 legends (Cam Newton, Patrick Peterson, …) were re-keyed to the
  window of their real peak season so the bake's supersede-by-{name, school,
  era} rule still de-dupes them against warehouse rows (verified at bake: 32
  superseded, 22 kept).
- **Coaches re-authored by real tenure** (owner-reviewed table, 2026-07-16):
  the 55 "2010s" decade rows became window rows with window-scoped era wins
  and titles (Saban Elite in both 2010s windows; Dabo Great 2010-14 → Elite
  2015-19; sub-2-season window tenures dropped). All 68 "2020s" rows carried
  into "2020-25" unchanged. **Gap fills**: 13 programs had no 2010s coach at
  all; 27 era-correct rows were added (Kirby 2015-19 Elite, Petersen 2015-19
  Elite, Jimbo Fisher 2010-14 Elite, Bob Stoops + Lincoln Riley, …), with a
  same-human consistency rule for career wins / bowl%.
- **Conferences**: decade keys copy to their windows; the 17 realignment
  movers get an explicit "2020-25" override showing the conference held for
  the **majority of the window** (Texas → Big 12, USC → Pac-12, SMU →
  American; 2023 Big 12 joiners break the 3-3 tie to Big 12).
- **powerhouse_eras**: mechanical decade→window split. The flags only gate
  the dormant 80s/90s wheel (`POWERHOUSE_ONLY_ERAS`), so modern-window flags
  are inert; no curation needed.

## Measured shape (bake of 2026-07-16, warehouse @ ../cfb/cfb.db)

| | decades (was) | windows (now) |
|---|---|---|
| players | 3,624 | 4,241 (751 / 1,674 / 1,816) |
| cells | 136 | 204 |
| median cell size | 26 | 24 |
| cells missing some position | 4 (3%) | 79 (39%) |
| cells with no QB | 3 | 17 |
| coach rows | 123 | 180 |

Pool-wide scarcity is calibration-pinned (23 players ≥96), so the rebucket
thins cells by **spreading** the same elite mass over 1.5× more cells — the
best window of a program is genuinely shallower than its old decade cell,
which is what turns the era re-spin back into a real decision. §12 invariant
verified on the new bake: per-position skilled-composite↔OVR Spearman
0.67–0.92.

## Alternatives considered

- **Four windows (2010-14/2015-19/2020-24/2025)**: rejected — the 2025 bucket
  is single-season rosters (42% of cells missing a position, 42 with no QB).
- **Offset windows (2010-15/2016-20/2021-25)**: statistically identical;
  lost on label legibility ("2010-14" maps to "early 2010s" fan-speak) and on
  grid stability under the forward rule.
- **Coaches stay decade-scoped**: zero content work but two era granularities
  in one union forever, and "2010s Saban" chips next to "2015-19" boards.
- **Peak-window single row per coach**: cheap but flavor-poor — 2015-19
  Alabama could never offer 2015-19 Saban.

## Consequences

- `player_id`/`coach_id` embed the era string and therefore churned; nothing
  persists them, so this is free. Trophy-room roster snapshots saved before
  this change render their legacy "2010s" strings as-is — cosmetically
  correct for when those runs happened.
- The era re-spin now rolls a talent-weighted lottery over ≥2 alternative
  windows instead of a guaranteed flip, and mining a stacked cell
  (keep-team token) works against genuinely shallower pools.
- Every rate in the outcome ramp shifted down; ADR-0029 records the retune
  to the owner's ladder targets on this pool.
- The 2027 bake owes the trailing-window split (see `eraOf()` comment) plus
  a content-file era-key migration for "2020-25" → "2020-24"/"2025-29".
