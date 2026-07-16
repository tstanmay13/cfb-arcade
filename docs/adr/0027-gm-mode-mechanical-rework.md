# ADR 0027: CFB-GM mechanical rework (PR 2) — offseason inversion, portal/recruiting/scheme depth, historical starts

- Status: Accepted
- Date: 2026-07-15

## Context

CFB-GM shipped v1.0–v1.4 plus quick-wins and two visual passes (ADR-0023,
`docs/CFB_GM_DESIGN.md`). A second mechanical spec ("GM Mode: Mechanical
Spec, PR 2") asks to deepen the systems that shipped thin. It reads as
greenfield in places but is almost entirely a **rework of shipped code**, and
two of its asks **contradict locked decisions** in the design doc. A grilling
session (2026-07-15) walked the whole design tree and resolved every
open product decision (the spec's Appendix A) plus the contradictions. This
ADR records those decisions before implementation; the design doc's affected
lines are superseded by what follows.

## Decision

### Season loop (M0.1) — offseason inversion

1. **Recruiting and the transfer portal move entirely into `OFFSEASON`.** The
   shipped model ran recruiting *weekly alongside the regular season*
   (`rapLeft` refilled in-season, `pendingVisits` resolved off Saturday
   results); the design doc's "recruiting runs weekly alongside the season"
   line (locked decision #13, calendar section) is **reversed**. In-season
   recruiting state is removed. Recruiting is *disabled*, not merely ignored,
   outside the offseason.
2. **The offseason is an explicit ~8-week state machine**, each week a
   discrete user turn (act → Advance Week). Layout:
   - **Wk 1** — recap/honors/draft declarations/progression resolve on entry;
     recruiting board opens.
   - **Wk 2** — retention window (non-NIL efforts); flight-risk resolves →
     portal populates.
   - **Wk 3–7** — the 5 portal rounds (M1.3), recruiting continues.
   - **Wk 8** — signing day (commits resolve), cuts to 85, prestige drift,
     coaching carousel, next budgets → rollover.
   The portal sits in the **middle** (wk 3–7), not front-loaded, so the user
   sees departures and does a round of recruiting before the portal battle.
3. **Two sim actions**: "Simulate Regular Season" (stops in `POSTSEASON` with
   the bracket unplayed) and "Simulate Whole Season" (runs through recap).
4. **Auto-Sim Recruiting toggle** resolves all user recruiting/portal/stamina
   allocations via the same AI policy function, so 8 weeks can be advanced
   with zero input.

### Stamina economy (M1.4)

5. **One shared weekly pool, 100 stamina/week** (retires the recruiting-only
   600 RAP). It funds recruiting actions, player development, morale,
   retention, and scouting from the *same* budget — the shared pool is what
   creates the tradeoff. Starting costs (all harness-tunable): scout 20
   (capped 2×/recruit, a distinct action), recruit action 15, develop 25,
   targeted morale 10 / team-wide 30, retention effort 20. Coaching staff
   modifies the pool (RC adds stamina, Developer cuts develop cost).

### Transfer portal (M1.3)

6. **Desires-driven NIL discount.** Each portal player carries a weighted
   desires profile (playing time, scheme fit, position of need, prestige,
   coach stability, geography, title contention, NFL development). A school
   scores fit 0–1; **effective ask = base ask × (1 − 0.40 × fit)**, so a
   near-perfect fit signs at a **60% floor** of the listed ask. Fit also feeds
   the commit-utility race — a great-fit lower bid can beat a rich bad-fit bid
   outright. This replaces the flat "bid must clear 90% of ask" rule as the
   *user's* mechanic (the 90% gate was the shipped v1.2 behavior).
7. **Volume via tier-based churn**, layered on the existing morale/loyalty
   flight-risk model (base entry rate by star tier, then morale/playing-time
   adjusts): 5★ ~8%, 4★ ~15%, 3★ ~22%, 2★ ~30% → ~250–350 entries/cycle,
   3–6 five-stars. Lands inside the harness's "15–25% churn" band.
8. **5 rounds** mapped to offseason weeks; players take 2–4 rounds to commit;
   per-school interest exposed as a progress bar; commit events record
   destination and linger one round before dropping off.

### Postseason (M1.5)

9. **CFP field = 4 conference champions + 8 at-large**, seeded straight by
   ranking, champions guaranteed in, byes to the top 4 overall.
   **AUDIT NOTE (2026-07-15): `postseason.ts` already implements exactly
   this** — `ccgGames` runs 4 conference championships, `buildPostseason`
   seeds 4 champs + 8 at-large straight by committee order with top-4 byes.
   Only the design *doc* ever said "5 champs + 7 at-large"; the shipped code
   was already correct. So this decision is a **no-op for the engine** — it
   ratifies existing behavior and corrects the doc. Straight-by-ranking
   mirrors the current real CFP (dropped champions-get-top-4-seeds in 2025).
10. **AUDIT NOTE: the "Top 25" tab already merges rankings + postseason**
    (`panels.tsx` `RankingsPanel`, "merged rankings + postseason" since V5),
    with no separate AP/Postseason tabs. Remaining M1.5 work is therefore only
    (a) drop the residual "AP" text (**done** — the two `dynasty.ts` news
    strings + two code comments), and (b) add clickable team pages (schedule,
    results, scores) from any ranking list.

### Coaching staff (M1.7)

11. **5 roles: HC, OC, DC, Recruiting Coordinator, S&C** (expand from the
    shipped HC/OC/DC). **No per-position coaches** — their effect is modeled
    as archetypes, not 9 hireable people. **No separate salary cap**: coaches
    are paid from the program NIL budget, so a stud coordinator is a real
    tradeoff against roster spend. Adds the user-facing fire → browse market →
    hire flow (offseason-only) on top of the existing free-agent pool +
    carousel; carousel extended to poach the 2 new roles.

### Schemes & scheme fit (M1.2.4) — net-new engine layer

12. Build the previously-deferred scheme layer, "robust but bounded":
    **5 offensive** (Pro Style, Air Raid, Spread Option, Ground & Pound, West
    Coast) and **4 defensive** (4-3, 3-4, Aggressive Blitz, 4-2-5 Nickel)
    schemes, each a vector of multipliers over the existing six macro traits.
    **Scheme fit applies to the whole roster** — every starter's attribute
    shape is scored against their scheme's emphasis (one formula, used
    everywhere), aggregating into a team execution bonus/penalty. **Team
    identity is coordinator-driven**: each OC/DC has a preferred scheme, so a
    coordinator hire reshapes identity. Per-game play style reuses the shipped
    per-drive tactics. The **installation/transition penalty is deferred** (it
    adds temporal state + a scheme-thrash harness failure mode for subtle
    payoff). This makes the portal scheme-fit desire (#6), the dashboard
    opponent scheme identity (M1.1), and the roster scheme lever all real at
    once, off one fit formula.

### Roster, dashboard, detail, recap, mandates

13. **Roster (M1.2):** every column sortable (incl. NIL); NIL spend-vs-cap on
    the roster screen; depth-chart reorder feeds the sim (extends the shipped
    `pins`); **side-by-side player comparison** (the one recoverable truncated
    spec note); minor levers (position change, captains) taken as small
    stamina/morale actions.
14. **Player detail (M1.2.5):** ship the full candidate field set. Most are
    free (already on `Player`/`CareerLine`, incl. OVR-by-season). New
    append-only arrays for accolades and injury history; **snap share is a
    derived usage proxy** (touches/target share) — the sim exposes no per-play
    snaps. The **50-year soak test is the gate** for the added save weight.
15. **Dashboard (M1.1):** next-game opponent scouting (record, top players,
    scheme identity), last-result star stat line, new season-stats module,
    coaching-staff entry point. Data plumbing over systems that now exist.
16. **Recap (M1.6):** add Biggest Droppers (mirror of Risers) + surface
    already-computed content (team leaders, records broken, draft departures,
    carousel summary, conference results) + one net-new best/worst-games scan.
17. **Mandates (M1.8):** expand from 4 kinds to ~16 across all 8 categories
    (rivalry, conference, postseason, recruiting, portal, statistical,
    program-building, financial); issue 2–3/season with guaranteed
    rivalry+conference eligibility; keep the single NIL-multiplier reward
    (scaled by count/met) — no bespoke per-mandate rewards.

### Historical dynasty start (M0.2)

18. **Keep it — the served data supports it.** Verified against Supabase
    (public anon key): `cfb_player_ratings` has full real rosters with
    populated overalls for **2010–2025** (13k–21k rows/season), and
    `cfb_teams` conference alignment is **season-scoped and era-correct**
    (2010 shows Nebraska/Colorado/Missouri/Texas in the Big 12, Utah in the
    MWC, Louisville/Rutgers in the defunct Big East). **2023 is absent** (the
    known API-quota gap) and is skipped by the year selector.
19. **Universe rule (a):** the fixed set of programs that are P4 in 2026 is the
    full-sim universe in *every* start year, each placed in its era-correct
    conference; everyone else is a shell. This keeps a stable ~68-team full-sim
    set so all calibration invariants hold identically regardless of start
    year. **Postseason is always the sim's 12-team CFP** even for a 2010 start
    (ZenGM stance: real rosters, sim's modern rules).
20. **One static bake file per supported year** (lazy-load the chosen one, no
    runtime cost); `SEASON` in `build-gm.ts` becomes a parameter over the
    supported range. Save format records the start year.

### Dropped / deferred

21. Truncated spec notes 2 ("Por…") and 3 ("In both dynasty…") are **dropped**
    — unrecoverable; no invented requirements.
22. Deferred (as before): wear-and-tear, academics, watch-mode fatigue, scheme
    installation penalty.

## Alternatives considered

- **Preserve in-season recruiting** (rework only the portal): least
  disruptive, but fights every downstream item that assumes an offseason week
  loop and makes "recruiting impossible outside offseason" unmeetable.
- **Cut M0.2** (2026-only): was the initial recommendation on the assumption
  historical rosters weren't served — reversed once the Supabase probe proved
  full 2010–2025 coverage. Cutting would forgo a now-cheap, high-flavor
  feature.
- **Universe rule (b)** — the era's actual power conferences (6 BCS leagues):
  more authentic, but the full-sim set grows/shrinks by year and breaks the
  harness's closed-league (.500, roster-ecology, win-threshold) assumptions —
  a per-era recalibration for marginal realism.
- **Full EA position-coach tree + coaching salary cap** (M1.7): more sim
  depth, but a 12-person staff to manage and a second economy to balance
  against the harness for little mechanical gain over "great coaches cost real
  money."
- **Bespoke per-mandate rewards** (M1.8): a second reward economy to balance;
  the single NIL lever is tractable and the harness can reason about it.
- **Scheme installation penalty from day one:** realistic, but temporal state
  + a scheme-thrash failure mode; deferred as a tuning add-on.

## Implementation status (2026-07-15, autonomous build session)

Landed and verified green — **128/128 tests pass, `tsc -b` clean, production
build succeeds**:

- **M0.1 (complete):** offseason inversion done. Recruiting/portal are
  offseason-only; `advanceOffseasonWeek` drives an explicit 8-week calendar
  (report → retention → 5 portal rounds → signing day); `simRegularSeason` vs
  `simToSeasonEnd` are the two sim actions; `autoOffseason` ("SIM OFFSEASON")
  is the zero-input path; save bumped to `v:2` with a migration in `db.ts`. The
  calibration harness was rewritten for the new flow and re-baselined.
- **M1.3 (engine complete):** 5 rounds weeks 3-7; `effectiveAsk`/`portalFit`
  give a fit-derived discount to a 60% floor; fit beats money in commit
  utility; per-round commit probability (no round-1 clear); tier-based churn
  (5★8/4★15/3★22/2★30) layered on flight risk. UI depth (interest bars, desires
  display, portal career stats) remains.
- **M1.4 (engine complete):** shared 100/wk stamina pool (`staminaMax`, coach
  RC bonus), recruiting offseason-gated, scout capped 2×, persistent board
  removal, develop/morale/retain stamina actions. UI surfaces recruiting spend;
  develop/morale/retain action buttons remain.
- **M1.5 (complete):** was already implemented; only AP-terminology drop
  needed (done). Clickable team pages remain.
- **M1.6 (complete):** Biggest Droppers (veteran plateau-decline source) +
  wired into the recap; other recap content is already surfaced.
- **M1.8 (complete):** mandates expanded 4→16 kinds across 7 categories,
  2-3/season with guaranteed conference (+rivalry when scheduled), single
  scaled NIL lever. Financial category deferred.

**Session 2 (same day) — everything remaining landed:**

- **M1.2 schemes (complete):** `schemes.ts` — 5 offensive / 4 defensive
  schemes as near-zero-sum trait-reallocation vectors + a small zero-centered
  whole-roster fit bonus, so league scoring calibration is preserved (the
  harness's scoring/upset bands + 50-year soak all held unchanged).
  Coordinator-driven identity (`teamScheme`; OC/DC carry a scheme, hires
  reshape it), applied in the sim path (`sideFor`), `playerSchemeFit` on
  player cards, scheme identity in opponent scouting and the staff panel.
- **M1.7 (complete):** 5 roles (RC feeds `recruitMult`→stamina cap, S&C feeds
  `devBonus`), `coachSalary`/`staffBill` paid from the program NIL pool
  (capped at 35% of a cycle's pool), user fire→market→hire flow + Staff tab,
  carousel staff-integrity pass. Soak re-baselined: coach count bound 260→400
  (68 programs × 5 roles + pruned pool — structural, not a leak).
- **M1.2 roster (complete):** every column sortable asc/desc (flat view;
  grouped-by-position stays the default), expanded player card (draft stock,
  scheme fit, usage-proxy, accolades + injury history — both new append-only
  arrays), side-by-side comparison modal, offseason develop/1-on-1/team-morale
  stamina actions in the UI.
- **M1.1 (complete):** opponent scouting strip (scheme identity + top-3
  players) on the matchup hero, Season Stats module (PPG/opp PPG/diff + six
  leader categories), staff entry point.
- **M1.5 team pages (complete):** any team in the Top 25 or standings opens a
  team page (record, scheme, full season schedule + scores). Standings now
  render whatever P4 conferences exist (era-correct for historical starts).
- **M0.2 (complete):** `build-gm.ts` takes a year; 14 per-year files baked
  (~400 KB each). **Coverage discovery: 2014 joins 2023 as unusable**
  (~46% of rosters served) — both are excluded from the year selector and the
  bake now fails loudly on bad coverage instead of writing a walk-on-filled
  fake universe. 2010 has no served 2009 results, so its Elo seeds from a
  roster-talent spread (mean of top-50 OVR). Era conferences are baked
  as-served (2010 Nebraska = Big 12, Louisville = Big East); the engine
  stages CCGs for every present conference (≥2 members), guarantees the **4
  highest-ranked champions** (the modern four unchanged), and fires a
  **realignment wave at first rollover** to the 2026 map so generated year-2+
  schedules keep their four even pools. Year selector in the new-dynasty flow;
  per-year data lazy-loads. CLAUDE.md + README seam docs updated.

The calibration harness grew from 45 to 55 assertions across the rework
(offseason flow, portal timing/fit, staff hire/fire, schemes, droppers,
mandates coverage, historical universe + realignment) and is green.

## Consequences

- **The calibration harness (`gm.test.ts`) is the acceptance gate and must be
  updated**: the CFP field changes 5→4 champions, portal churn is now
  tier-driven, scheme fit perturbs sim outcomes, and the stamina economy
  replaces RAP. Every affected assertion is re-baselined; the policy benchmark
  (`bench:gm`) is re-run and diffed per the existing discipline.
- **Largest change is the M0.1 offseason inversion** — it touches the shipped,
  working season loop and the save format. M0.2 also touches the save format
  (start year); the two are sequenced, save version bumped, best-effort
  migration written (pre-rework saves carry the roster forward or start
  fresh).
- **Supabase read surface widens** from `season=2026` to historical
  **2010–2025** on `cfb_teams`/`cfb_player_ratings`/`cfb_games`, one static
  bake file per year. **CLAUDE.md's Supabase-seam notes and the README seam
  table must be updated at implementation time** to record the historical read
  path (why the bake loops over years, that 2023 is absent) so future work
  doesn't re-discover or re-litigate it.
- Schemes become a real engine input (scheme-fit desire, dashboard scouting,
  roster lever all read one fit formula) — new but bounded calibration surface
  (a handful of trait-multiplier vectors + one fit formula).
- Player-detail append-only arrays add per-player save weight; the 50-year
  soak test gates it, accolades/injury-history bounded first if it complains.
