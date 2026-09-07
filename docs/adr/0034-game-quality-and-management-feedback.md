# ADR 0034: Continuous difficulty, credible stats and effective GM controls

- Status: Accepted
- Date: 2026-09-08

## Problem

The owner asked for a researched, tested improvement to difficulty, stat credibility
and GM depth. The local checkout predated ADR-0032/0033; this change starts from
current main and preserves those later balance decisions.

Five regressions were reproduced before implementation: lower-tier odds did not
improve within a tier, a QB breakout increased interceptions, WR yards/catch did
not agree with receiving totals, manual GM development raised OVR without changing
the attributes the sim reads, and multiple pinned QBs were sorted by OVR rather
than the coach's preference. Browser review additionally exposed 147 all-zero
historical stat cards, retention efforts that were not autosaved, incorrect
starter labels, and class rank #0 before signing day.

## Decisions

1. Interpolate the existing Tier7–Tier4 outcome anchors continuously up to 78.
   Keep every 78+ anchor and the 97+ 70% title favorite from ADR-0033. Tier labels
   remain descriptive; they do not create low-power cliffs. All cumulative
   postseason probabilities must be monotone in power.
2. Show post-run title, semifinal and playoff probabilities from the exact
   outcome function. Show team OVR to one decimal to avoid presenting 96.9 as 97.
   These are retrospective roster expectations, not guarantees.
3. Keep the five seeded cosmetic performance rolls, but invert QB interceptions,
   handle negative rushing yards correctly, cap completion percentage and catch
   length, derive WR yards/catch from totals, and preserve half-credit sacks/TFL.
   Sacks ≤ TFL ≤ tackles and receiving TDs ≤ receptions. Cosmetic lines still do
   not form a shared team box score or affect the result.
4. Exclude cards with no recorded production from the draft bake before pool
   calibration. Do not invent historical numbers. Source data stays in the
   warehouse, and missing-coverage warnings remain visible during baking. This
   removes 147 cards: 68 programs / 204 cells / 4,094 players / 180 coaches.
   Position coverage remains uneven (80 cells lack at least one position), so
   the ADR-0031 placeability filter continues to be required.
5. Manual GM development shifts core attributes by the actual OVR gain with the
   same bounds as annual progression. Pinned starters are ordered preferences:
   latest pin first; injuries override pins. UI starter labels use the simulation
   lineup, including in sorted roster views; QB2 is a backup.
6. Add national/conference/team season leaderboards with player inspection,
   totals and per-game values. Player cards use the player's own team for colors,
   scheme fit and usage. Add an eight-week offseason calendar with resource status
   and direct links to recruiting, development and the current decision.
7. Serialize GM actions while saving; run simulations on a working copy so an
   exception cannot leave half-applied state. Surface failed saves, retain the
   in-memory state and pending departed archive, and provide Retry Save plus an importable recovery download of the unsaved
   snapshot and archive. Block
   further mutations until recovery. Retention courting autosaves immediately.
   Keep IndexedDB schema and export format unchanged.
8. Direct /gm loading must not depend on the draft's data.json. Supabase remains
   fail-silent anonymous stats only; browser verification intercepts those writes.

## Measurements

The final cleaned bake was run through `node --no-warnings scripts/balance.ts
2000` (2,000 complete deterministic drafts per policy, exact outcome accounting):

| Metric | Random | Skilled | Oracle |
| --- | ---: | ---: | ---: |
| Title rate | 3.14% | 8.71% | 24.61% |
| Records above 2% share | 10 | 10 | 9 |
| Largest non-title record share | 17.8% | 23.2% | 22.1% |

Skilled/random = 2.78×; oracle/skilled = 2.82×. Skilled remains in the 6–10%
band; ratio gates remain ≥2× and ≥2.2×. Earlier 20,000-per-policy power samples
also validated the curve alone, but are **not** the final-bake measurement.

Three 30-year GM benchmark cells (0, 80, 96: autopilot Georgia, balanced Arizona
State Normal, balanced Arizona State Brutal) match the stored 2026-07-15 baseline
byte-for-byte. These policies do not use manual development or lineup pins, so
this comparison establishes unchanged baseline behavior, not the optimal strength
of the new controls. The full calibration suite includes a 50-year soak.

## Verification and research

See [research](../game-quality-research.md) for primary sources and limitations.
`src/engine/quality.test.ts` checks stat integrity, all-zero bake exclusion and
cumulative odds; `src/gm/engine/management.test.ts` verifies changes reach sim
traits. `scripts/verify-gm.ts` covers real browser decisions, IndexedDB failure and
retry, reload, desktop/mobile rendering and rollover. Existing draft/Guess browser
harnesses cover finished games and sharing. Automated checks establish behavior;
subjective enjoyment still needs player feedback.
