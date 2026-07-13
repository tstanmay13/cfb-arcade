# CFB-GM — reconciled design spec

_Source of truth for cabinet #3, the dynasty management sim (ADR-0023). This
supersedes the external "CFB-GM PRD v1.0.0" it was reconciled from: where the
two disagree, this document wins. Reconciliation interview: 2026-07-13._

The PRD was written without knowledge of this codebase. Its keepers (drive
outcome table, seeded RNG, IndexedDB saves, dev tiers, deal-breakers, booster
mandates, templated news) are folded in below; its hallucinations (an attribute
schema that doesn't exist, a fictional 70-team universe, unbounded progression
math, LLM-adjacent framing) are corrected. See "PRD deltas" at the bottom for
the full list of corrections and why.

## Locked decisions

1. **Home**: cabinet #3 in cfb-arcade (ADR-0023). Cabinet rules apply; first
   cabinet with persistent saves (Dexie/IndexedDB, DB per dynasty slot).
2. **Universe seed**: real 2026 preseason — real P4 programs, real rosters,
   v1-derived ratings baked from the Supabase seam. Generated recruits take
   over organically within ~5 sim years (ZenGM "real players league" model).
3. **Universe size**: the real **68 P4 programs full-sim** (rosters, recruiting,
   portal, coaching). Real **G5 programs exist as shells** — team-level rating
   only, no rosters — filling non-conference buy games so records look like
   real CFB (a closed P4 league would average .500 and break every win-based
   threshold). Year 1 plays the real 2026 schedule; later years generate
   schedules of the same shape (conference slate + OOC incl. shells, rivalries
   preserved).
4. **Attributes — two layers**:
   - *Engine truth*: a compact per-position schema (~5–7 attrs) extending the
     v1 ratings vocabulary; the sim, progression, and scouting read ONLY this.
   - *Presentation*: the full EA-style sheet (ThrowPower, BreakTackle, …) is a
     pure function of (core attrs, position, archetype, player seed) rendered
     on player cards. Derived, never stored — it cannot drift from the core.
     This is the §12 invariant ("visible stats must correlate, never lie")
     applied to ratings.
5. **Sim engine**: drive-level outcome resolution (the PRD Δ-table) + seeded
   synthetic expansion per drive (play count, yards, clock, touches) that
   yields box scores and the drive-viewer log. ~26 resolutions/game.
6. **Postseason**: conference championship games (top 2 by conference record),
   **12-team CFP** (5 champs + 7 at-large, top-4 byes, on-campus first round),
   **full bowl slate** for 6+ win teams, draft-bound bowl opt-outs as flavor.
7. **Rankings**: **Elo core** (seeded preseason from talent/prestige, updated
   per game) is engine truth — CFP committee input, shell strength, upset
   odds. The displayed AP-style Top 25 is a **bias layer** (preseason
   expectations, inertia, brand) for flavor only.
8. **Roster ecology — balanced by construction**: ~1,400 recruits/year
   (~20.5 avg signees), hard 85-man cap. Exits: graduation, NFL draft, portal,
   plus offseason "transfer down" attrition (low-OVR/low-morale players leave
   for G5 shells as flavor text). Over-cap forces cuts: AI cuts silently, the
   user gets a cut screen.
9. **Game AI (not LLM)**: the 67 AI programs run the SAME rules — recruiting
   RAP, NIL budgets, portal bids, retention — via deterministic policy
   functions over the seeded RNG. Zero network, zero keys, zero tokens; the
   news feed is templated strings (PRD already agreed).
10. **Progression — growth toward a hidden ceiling**: each player rolls a
    hidden potential ceiling from their dev tier (Elite 95–99, Star 89–94,
    Impact 83–88, Normal ≤82 — the PRD's table, now literally true). Annual
    growth = dev-scaled fraction of the remaining gap × coach/facility
    modifiers ± RNG − wear-and-tear penalty. No league OVR inflation by
    construction. Gem = ceiling a tier above visible stars; bust = below.
11. **Player role**: immortal head coach — never fired; failure bites through
    NIL collapse, prestige crashes, portal exodus, coordinator poaching. May
    switch schools during the offseason carousel window. "Career mode with
    firing" is a future toggle, not v1.
12. **History**: every player's identity + season-aggregate stats + accolades
    kept forever (leaderboards/record books always work). Full box scores kept
    ~3 seasons then compressed to score + headline; game results kept forever.
    All storage is the player's own IndexedDB; export/import = compressed JSON
    download (also the backup story). Hall of Fame is a curated layer on top,
    not the only survivor.
13. **v1 scope**: the playable season spine (roadmap below). Recruiting,
    portal/NIL, carousel/boosters, and watch-mode layer on in that order.

## Determinism & engine architecture

- All randomness through the existing `src/engine/rng.ts` (mulberry32). No
  `Math.random()`, no `Date.now()` in engine code — sim time comes from the
  dynasty calendar.
- **Hierarchical seeding**: `dynastySeed` → derived per-subsystem streams
  (per-game seed = f(dynastySeed, season, week, gameId); recruiting, portal,
  progression each get their own derived streams). A user action can never
  perturb an unrelated system's outcomes; same seed + same decision log =
  identical dynasty (the anti-save-scum property, and what makes 50-year bugs
  reproducible).
- **Engines are pure and storage-free** (arcade convention): the game engine
  is `(gameState, coachingParams, rng) → driveResult`. Two drivers share it:
  - *fast-sim*: loops with AI/default params, whole game precomputed at
    resolve (the SIM_RESOLVE pattern);
  - *watch-mode* (v1.4): pauses at drive boundaries for slider/QB-swap input,
    re-enters with new params. Interactive events (signing-day flips, etc.)
    are **sim pauses, never wall-clock timers** — the PRD's "60-second
    counter-bid window" is replaced by a modal that halts the sim until
    answered.
- **Threading**: v1 runs the sim on the main thread in chunked slices
  (measure first — 68 team-games/week at ~26 drive rolls is trivially inside
  the PRD's 150 ms budget). If multi-season fast-sim jank appears, the pure
  engines move behind a hand-rolled worker driver unchanged. The worker is an
  optimization, not an architecture.

## Data

- **Bake** (`scripts/build-gm.ts` → `public/gm-data.json`, anon key only):
  P4 teams + conferences + 2026 schedule + rosters + `player_ratings`
  (overall, pos_group, attributes JSON where statful) + G5 shell teams with
  team ratings + recruiting-class distribution templates + authored dynasty
  content.
- **Platform prerequisites** (owner repo, ADR-0021 amendment): serve
  `team_ratings`; add a recruiting-distribution export (star/position/
  geography histograms by class year — the honest version of the PRD's
  "historical database cloning": real distributions, generated names).
- **Dynasty creation** (client, seeded): import real rosters; statless players
  and all OL get synthesized core attrs from overall + position + seed;
  granular positions (CB/S/FS/SS, DE/DT, ILB/OLB) come from
  `player_season_stats` positions where known, else synthesized within
  pos_group. Every player rolls hidden dev rating, ceiling, loyalty,
  scheme preference (inferred from attribute shape for real players).
- **Authored content** (one-time, per the 68 programs): rivalries, pipeline
  states, booster-board profile, stadium reputation (seed from warehouse
  venue capacity), prestige tier (seed from talent/SP+). Extends the
  `scripts/content/*.json` per-program pattern.
- **Storage** (Dexie, DB per dynasty slot): active stores (players, teams,
  coaches, recruits, schedule) + archival stores (seasonStats, gameResults,
  boxScores≤3yr, hallOfFame, trophies). Engines never touch Dexie; drivers
  load/persist snapshots.

## Sim engine spec

- **Drive resolution**: compute both teams' six macro traits from the active
  depth chart's core attrs (scheme-fit modifiers applied here), roll
  E_off/E_def per the PRD equations, map Δ → outcome via the PRD table.
  Red-zone trait folds in as a TD↔FG swing modifier; havoc differential adds
  sack/strip events into the expansion; turnover split 45/55 fumble/INT per
  PRD.
- **The six macro traits survive**, rewritten over the compact schema
  (provisional weights, harness-owned): Air Attack (QB ACC/ARM + WR corps +
  OL pass-blk) vs Lockdown (DB COV); Ground (RB RUN + OL run-blk) vs Front
  (DL/LB STOP); Trench (OL pass-blk) vs Havoc (DL RUSH + LB blitz); Security
  (QB AWR + ball-carrier hands) vs Hunting (BALL attrs); Red Zone O vs D;
  Special Teams (K/P + returner SPD).
- **Expansion**: each drive gets plays/yards/time + touch attribution
  consistent with its outcome — box scores, player season stats, and the
  drive log fall out. Passer rating (QB-swap trigger) computes from expanded
  stats.
- **Clock/quarters**: drives consume expanded time across 4 quarters
  (quarter-scoped effects — trap-game first half, fatigue, spark swap — bind
  to that). **No ties: real CFB overtime** (alternating possessions from the
  25, mandatory 2-pt from 3OT), resolved via red-zone machinery.
- **Chaos layer kept as specced, constants harness-owned**: hostile noise
  (stadium rep ≥85: −6 away QB AWR, false-start bumps), rivalry boost (+8 to
  the weaker side), trap games (−5 first half), spark-swap roll (35/45/20),
  fatigue + wear-and-tear, injury tiers (minor → catastrophic with permanent
  SPD/AGI cap). G5-shell games: shell side plays as a trait vector derived
  from its team rating.

## Season calendar

Weeks 0–15 regular season (real 2026 shape) → CCG week → 12-team CFP + bowls
→ offseason stages: S1 boosters/mandates + draft declarations + pro-retention
window → S2 retention phase + transfer portal + spring academics → S3 training
camp (progression) → S4 prestige drift + carousel → S5 recruiting close-out,
cuts to 85, pruning, rollover. (PRD stage contents kept; numbers tuned in
harness. Recruiting runs weekly alongside the season per PRD; signing day
during S1.)

## Recruiting & game-AI policy (v1.1 module, architecture fixed now)

- User-side mechanics as PRD: 600 RAP/week, action costs/yields, 2-stage
  scouting, gem/bust (now = ceiling deviation), the FIVE deal-breakers (PRD
  says "3 Core" then lists five — five is correct), NIL demand with the 40%
  non-NIL-dealbreaker discount, 1,000-interest commit checks, signing-day flip
  checks (as sim-pause modals).
- Star distribution rescaled to ~1,400/class (P4-bound only): ~30 five-star,
  ~270 four-star, ~1,050 three-star, small two-star tail as bottom-roster
  filler (resolves the PRD's schema-vs-distribution contradiction).
- AI programs: `(teamState, board, week, rng) → RAP allocation` policy —
  positional need × prospect quality × pipeline geography × prestige-realism.
  Same function family drives AI portal bids and retention. No cheating; the
  harness asserts emergent realism (class rank ↔ prestige correlation).

## Progression (v1 module)

Ceiling model per locked decision #10. Coach dev bonus is a multiplier
(0.85–1.25; the PRD's "+1.5 additive" line is void). Facility multiplier from
prestige tier. Regression for age/catastrophic injury as PRD. Redshirt
4-game rule with auto-detect + manual lock; academics (hidden intelligence,
tutoring hours) as PRD, magnitudes harness-owned. NFL draft: national OVR/
stat ranking → round projection → declaration probability as PRD; Round-1
projections immutable, Rounds 2–7 buy-back window as specced.

## Calibration harness (ships WITH v1.0 — it is the acceptance gate)

Headless multi-season sims in vitest asserting, at minimum: determinism (same
seed → identical 5-season hash; save/load mid-season → identical
continuation); scoring distributions vs real P4 aggregates from the warehouse
(the unfair advantage: we can diff sim vs reality); win% vs Elo-gap follows a
sane logistic curve; upset rate in band; median in-conference record .500,
overall records realistic via shells; poll inertia sanity; OVR mean/sd stable
over 30 simmed years (no drift); class quality ↔ prestige Spearman ρ ≥ ~0.7;
portal churn ~15–25% of rosters/year; QB Heisman share 70–85%; prestige
responds (no eternal 6-star losers); every dollar/point constant in this doc
is tunable against these assertions, not sacred.

## Roadmap

- **v1.0 — season spine**: pick a real 2026 P4 team → fast-sim weeks →
  standings/Top-25/box scores → CCG/CFP/bowls → minimal offseason
  (graduation, draft, ceiling progression, auto-generated classes by prestige
  gravity — no interactive recruiting) → year 2. Plus: bake, dynasty
  creation, Dexie saves, export/import, calibration harness.
- **v1.1 — recruiting**: full RAP/scouting/deal-breakers/NIL/signing day +
  AI policy.
- **v1.2 — portal & retention**: morale/loyalty/flight-risk, retention phase,
  open portal, cuts screen.
- **v1.3 — coaching & boosters**: staff archetypes/XP, carousel + poaching,
  school-switching, booster mandates, prestige drift.
- **v1.4 — watch mode**: drive viewer, tactical sliders, QB spark swap,
  in-game injuries/fatigue surfaces.

## PRD deltas (corrections record)

1. Attribute schema (`QB_ThrowPower` etc.) didn't exist → two-layer model
   (compact engine schema + derived presentation sheet).
2. "70 P4 teams" fictional universe → real 68 P4 + G5 shells; closed-league
   .500 problem solved by shells, win thresholds stay meaningful.
3. "Historical Database Cloning" → real warehouse recruiting distributions +
   generated identities (same idea, honest data lineage).
4. Progression formula unbounded (+14–18/yr elite) and contradicted its own
   tier table → ceiling model; "+1.5 dev bonus" vs "1.25×" contradiction →
   multiplier.
5. Postseason + rankings were referenced everywhere, defined nowhere → CCGs +
   12-team CFP + bowls; Elo core + poll bias layer.
6. Roster ecology didn't balance (1,650/yr into 5,780 slots) → ~1,400 classes
   + attrition exits + hard-cap cuts.
7. AI opponent behavior unspecified → same-rules deterministic policy AI.
8. "3 Core Deal-Breakers" listing five → five.
9. Recruit schema `starRating` min 2 vs distribution starting at 3 → 2-star
   tail added.
10. 60-second real-time bid windows → sim-pause modals (no wall-clock in a
    deterministic sim).
11. Aggressive history pruning (deleting undrafted players) → keep aggregates
    forever, expire only box-score detail; 250 MB fear was misplaced.
12. Web Worker mandated up front → pure engines now, worker as measured
    optimization.
13. Dexie assumed → confirmed as the one new dependency (cabinet-scoped).
14. Positions enum (OL/DL/LB lumps) vs trait formulas needing slots →
    granular positions from stats data + synthesized slot granularity;
    depth-chart slots are team-side assignments.
15. Player schema gaps (no age/class fields, recruits lacked dev/scheme) →
    engine schema owns these; PRD JSON schemas are reference-only.

## v1.0 implementation notes (what shipped 2026-07-13, deltas from spec)

- **No platform-side changes were needed.** The warehouse already serves
  projected 2026 ratings (`cfb_player_ratings`, projected=1 — includes the
  real 2026 recruiting class), so year-1 rosters come straight off the seam;
  shell strength + preseason Elo are computed IN the bake from real 2025
  `cfb_games` results instead of serving `team_ratings`; recruit-class
  distributions are synthesized in-engine for v1.0 (the platform export is a
  v1.1 need, for geographic/positional realism).
- Persistence is ONE Dexie DB (`cfbgm`) with slot-keyed rows, not
  DB-per-dynasty — fewer moving parts, same export/import semantics.
- Notre Dame schedules inside the ACC pool (mirroring its real ACC slate);
  those games are flagged non-conference. All four scheduling pools are even
  (16/16/17+ND/18), which the circle method needs.
- Class years are 1-4 with no redshirts yet; 2026 classes derive from 2025
  roster class_year + 1, new players default FR.
- Proxies until authored content lands (v1.3): rivalry boost = late-season
  (wk 12+) conference games; hostile-noise = prestige ≥ 5 home crowds.
- Per the roadmap, v1.0 defers: wear-and-tear, redshirts, academics, schemes,
  coaches (facility multiplier uses prestige only), portal, interactive
  recruiting, watch-mode. Drive logs + box scores persist for user games
  only; every game keeps score + star line.
- The calibration harness lives at `src/gm/engine/gm.test.ts` (19 assertions:
  determinism hash, scoring bands, monotone upset curve, 10-year OVR
  stability, roster ecology, schedule legality). It is the acceptance gate
  for any constant change.

## v1.1–v1.4 implementation notes (shipped 2026-07-13, same day)

All four roadmap phases landed:

- **v1.1 Recruiting**: full RAP action economy, 2-stage scouting (fuzzy OVR
  band → exact + dev tier + gem/bust), three deal-breaker hard locks
  (PLAYING_TIME / CONTENDER / PRO_POTENTIAL — NIL_VALUATION folded into the
  portal's 90% rule), same-rules AI policy, weekly commit checks, signing-day
  flips, and a **late signing period** (unsigned recruits land by prestige
  gravity; true walk-ons only after the pool empties — the fix for the
  quality-inversion the harness caught).
- **v1.2 Portal & NIL**: budgets by prestige with natty/losing swings,
  exponential market valuations, morale/loyalty → flight risk, offseason
  became four interactive stages (report → retention → portal ×3 rounds →
  close-out), draft rounds on departures, All-America teams, national record
  books (state-resident, never erased), manual cuts. **Ceiling bands were
  recalibrated here** (tier-0 = 58-76) after the harness showed walk-ons
  growing into starters and killing portal churn.
- **v1.3 Coaching & boosters**: HC/OC/DC staffs with Recruiter/Tactician/
  Developer archetypes wired into interest gains, execution, and camp
  development; growth + hot-seat carousel + coordinator poaching with
  auto-backfill; open-jobs board with school switching; booster profiles
  issuing 1-2 mandates (NIL ±); **real rivalries baked** from 2010-25 matchup
  counts (replaces the week-12 proxy; the proxy remains as a fallback).
- **v1.4 Watch mode & edges**: the drive loop became a steppable `GameSim`
  (fast-sim and watch-mode share one seeded stream, so watching is a choice,
  not a different game); per-drive tactics (chew/no-huddle/blitz), one-shot
  QB spark swap (35/45/20), 2-pt chases, missed XPs, punt-return TDs,
  safeties, pick-sixes, injury severity tiers (incl. season-ending),
  redshirts (≤4 games banks the year once), pinned starters. Autosave now
  blocks the busy state so a rollover write can't be aborted by navigation.

Still deferred: wear-and-tear, academics, scheme fit, interactive staff
hiring, watch-mode fatigue. The calibration harness grew to 37 GM tests and
remains the acceptance gate.

## Open items (deferred, non-blocking)

- Cabinet display name ("CFB-GM" is a working title; arcade names are
  flavorful).
- Morale-event magnitudes, NIL dollar tables, RAP yields, chaos constants —
  all start at PRD values, owned by the harness.
- Coach XP earn rates / skill-tree shape (v1.3).
- Multi-dynasty slot UI polish; PWA/offline packaging (post-v1).
- Full-FBS universe upgrade path (shells → full sim) if ever wanted.
