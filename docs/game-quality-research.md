# Game quality research

Research date: 2026-09-07. Scope: draft difficulty/stat credibility and GM management feedback. These are recommendations from primary documentation and source inspection, not evidence that players have found the changes fun.

## Football constraints versus arcade choices

The NCAA's indexed 2006 statisticians' manual credits a sack as a tackle and, when behind the line with lost yardage, a tackle for loss. NCAA records also use half-credit for assisted sacks. Consequently, a displayed defensive line should not have sacks exceeding tackles for loss or tackles for loss exceeding total tackles; sack/TFL precision should use half units. [NCAA manual, defensive statistics](https://fs.ncaa.org/Docs/stats/Stats_Manuals/Football/2006.pdf), [NCAA FBS records, defensive leaders](https://fs.ncaa.org/Docs/stats/football_records/2022/FBS.pdf).

Source limitation: the requested [current manual](https://fs.ncaa.org/Docs/stats/Stats_Manuals/Football.pdf) and its NCAA S3 mirror timed out in the browser tool; a direct download also timed out. The defensive rules above were verified in indexed primary-source text, not by reading the current PDF in full. No claim about a changed 2026 rule is made here.

Other invariants follow directly from the game's own labels and arithmetic: completion percentage stays between 0 and 100; WR yards/catch equals receiving yards divided by receptions to display precision; receiving touchdowns cannot exceed receptions; and longest catch cannot exceed 99 yards or total nonnegative receiving yards in this arcade's unsigned stat model. These are integrity constraints, not calibration targets. The five-field schema lacks pass attempts and RB carries, so full cross-stat reconstruction is impossible without extending it. [Stat labels](../src/data/types.ts).

Interceptions thrown have the opposite performance direction to passing yards/TDs. Treating a larger interception total as a positive eruption misleads the player. Preserve the seeded five-draw budget and award-modifier contract while applying the inverse direction to that field and deriving dependent WR averages after volume changes. Cosmetic draft stats must remain separate from the outcome engine. [Awards engine](../src/engine/awards.ts), [repo invariants](../AGENTS.md).

Difficulty is a product choice: NCAA rules cannot establish the right title probability for a fantasy draft. ADR-0033 explicitly separates overall skilled 16-0 rarity (6–10%) from conditional elite-board strength (roughly 70% titles at 97+). Preserve its 78+ anchors while replacing any flat low-power floor with a continuous, monotonic progression. Verify both conditional outcome distributions and complete drafting policies; one isolated unlucky loss is not evidence that the whole curve needs moving. [Accepted balance contract](adr/0033-elite-boards-are-favorites.md).

## GM controls should visibly change the simulation

At inspection, `developPlayer` increases OVR/morale while `traitsFromLineup` reads existing position attributes. Offseason `progressPlayer` already shifts attributes with OVR. Apply that same coherence to paid development so spending stamina improves the actual skill inputs, with ceiling and attribute clamps. Assert the starter's relevant trait increases, not merely the displayed OVR. [Development](../src/gm/engine/recruiting.ts), [simulation traits](../src/gm/engine/lineup.ts), [annual progression](../src/gm/engine/progression.ts).

At inspection, roster grouping sorts pins then OVR, whereas simulation excludes injured players before that sort. This can label an unavailable player as a starter and obscure the actual replacement. Share availability/priority ordering between the display and simulation; keep injured players visible with their status. Verify injured pinned players and an explicit QB preference, as QB1 alone normally feeds passing traits. [Roster and depth chart](../src/gm/panels.tsx), [lineup selection](../src/gm/engine/lineup.ts).

NN/g recommends immediate, intelligible feedback so people can evaluate actions and choose their next step. For GM, show phase/week, remaining stamina, pending decisions, and the next available action together; after development, report the gain and remaining resource. These are applications of the heuristic, not experimental findings specific to this game. [Visibility of System Status](https://www.nngroup.com/articles/visibility-system-status/).

NN/g's game-specific guidance supports contextual controls, familiar terminology, and disclosing only information relevant to the current task. Add actionable links from the dashboard to lineup problems, recruiting and offseason work rather than another static explanation panel. Keep detailed attributes in player inspection. Explain disabled actions with the unmet requirement. Avoid extra confirmation dialogs on routine reversible controls. [10 Usability Heuristics Applied to Video Games](https://www.nngroup.com/articles/usability-heuristics-applied-video-games/).

## Acceptance and remaining limits

- Draft: monotonic low-power odds, continuity at anchors, unchanged 78+ contracts, a fresh complete-policy balance report, and deterministic replay.
- Stats: adversarial maximum modifiers, zero volumes, fractional sacks/TFL, WR arithmetic and reversed interception direction. A believable single-player line still does not establish a coherent shared team box score: draft players retain separate cosmetic historical baselines.
- GM: paid development changes skill traits; injury/pin handling matches the displayed depth chart; actions deduct resources exactly once; advance, save/reload, offseason and rollover retain functionality.
- Browser: play complete draft and GM flows at desktop/mobile widths. Check that a new player can identify what to do next and see whether the action succeeded. Automated passing checks establish mechanics, not subjective enjoyment.

Additional design gap to review separately: the punter occupies a lineup slot and contributes to displayed lineup OVR, but `traitsFromLineup` has no punter attribute term and punt resolution is generic. This is a simulation simplification rather than a confirmed regression; avoid implying punter upgrades improve punt outcomes without adding and calibrating that mechanism. [Lineup traits](../src/gm/engine/lineup.ts), [drive simulation](../src/gm/engine/game.ts).
