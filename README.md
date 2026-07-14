# CFB Arcade

A 100% client-side, serverless single-page web arcade of college-football
games. Cabinet #1, **The 16-0 Draft**: an "all-era team-building" slot machine
(a CFB take on 82-0.com) — spin → land a random team+era → draft one legend
from that roster → fill 8 positions + a head coach → a hidden-OVR power score
maps to a tier → the tier rolls a probabilistic national-title season → copy a
Wordle-style result to share. Cabinet #2 is **Guess the Season** (below).

One static SPA hosts these independent game "cabinets"; they share the design
system but nothing else. The title screen links between them; each cabinet
bakes its own JSON and lazy-loads it.

This repo is deliberately self-sufficient: clone, install, run — **no secrets,
no database, no data pipeline**. Architecture decisions live in
[`docs/adr/`](docs/adr/) — one ADR sequence shared across both repos: the
historical 0001–0021 stay owner-side in the private `cfb` data-platform repo,
this repo owns 0022 onward. The v2 design doc also lives with the platform repo;
the §N references in code comments point at it.

## Run it

```bash
npm install
npm run dev        # → http://localhost:5173
```

## Stack

Vite + React 18 + TypeScript + Tailwind v4. `vitest` for the engine unit
tests, mulberry32 for seeded deterministic RNG. **No backend** — the app is a
static SPA; all data ships as one static `public/data.json`.

## Data

`data.json` is baked owner-side from the platform repo's **local warehouse**
(`cfb.db`, read directly via `node:sqlite` — ADR-0025) and committed, so a
clean clone never needs to re-bake — it builds against the committed file:

```bash
npm run build:data   # reads ../cfb/cfb.db (override: CFB_DB_PATH), writes public/data.json
```

- **2010s + 2020s eras — real data** from the warehouse:
  `player_ratings` (`overall` = the game's `hidden_ovr`), real stat lines
  from `player_season_stats`, jerseys from `rosters`, colors from
  `teams`. Seasons 2010–2022 + 2024–25 (2023 pending API quota).
- **Pre-2010 eras are excluded** (user decision: real data only — CFBD has no
  player data there). The authored rosters remain as dormant source in
  `scripts/content/` behind `EXCLUDED_DECADES` in `build-data.ts`; a handful
  of authored rows survive inside the real eras for icons the sparse
  2010–2015 defensive stats can't rate (Cam Newton, Joey Bosa…), plus all
  coaches (CFBD has no coach data).

Current coverage: **68 programs, 136 team/era cells, 3,624 players, 123 coaches**
(all Power-conference teams — SEC/Big Ten/Big 12/ACC + Notre Dame, ADR-0024). The
18 original blue-bloods are fully hand-authored in `scripts/content/*.json`; the
~50 expansion programs are identity + coach stubs whose modern rosters and branding
are pulled from the warehouse at bake. Expand by adding another `scripts/content/*.json`
file (full or stub) and re-baking; both real eras come along automatically.

The running game never touches a database or API for game data — design
pillar #4. The one deliberate exception is **global stats** (ADR-0019): on
finishing a round the game fire-and-forgets an anonymous result row to
Supabase (`arcade_results`, anon key, append-only under RLS) and the stats
sheet reads aggregate numbers back via an RPC. Offline it degrades silently —
the games themselves never depend on it.

## The data-platform seams

Two ties to the private platform repo, heading toward one (ADR-0025 — the end
state is Supabase serving **runtime stats only**):

1. **The warehouse (owner-side, bake-time):** `npm run build:data` reads the
   platform repo's `cfb.db` directly via `node:sqlite` (read-only; sibling
   checkout by default, `CFB_DB_PATH` to override; restore it with
   `cfb restore` from R2). No credentials — it's a local file. Collaborators
   don't bake; they build against the committed `public/data.json`.
2. **Supabase (anon key, RLS-bounded):** everything below goes through the
   **public anon key** embedded in the scripts (safe to embed by design —
   read-only on the `cfb_*` tables, append-only on `arcade_results`):

| access            | tables / RPC                                                          | when                          |
| ----------------- | --------------------------------------------------------------------- | ----------------------------- |
| read              | `cfb_games`, `cfb_teams`, `cfb_player_ratings` (+ `cfb_rosters` for gm) | `npm run build:seasons` / `build:gm` (bakes — not yet ported to the warehouse) |
| append            | `arcade_results` (INSERT only; raw reads are RLS/privilege-denied)    | runtime, finishing a round    |
| read (aggregates) | `arcade_daily_stats(game, puzzle)` + `arcade_overview(game, days)` RPCs | runtime, stats sheet          |

The pipeline that fills the warehouse and the `cfb_*` tables, the schema
migrations, and the service-role key all live in the private platform repo.
R2 stays warehouse durability, never a serving store. If the data.json bake
warns that something is missing, that's a platform-side ingest/ratings run —
nothing in this repo can (or should) fix it.

## Guess the Season (arcade cabinet #2)

Show a real team's actual season — the game-by-game W/L strip with real scores
(postseason ringed), plus the final record — and identify **which program and
which year** in 6 guesses. Wordle-style: 🟩/🟨/⬛ per guess (team, then year
with a ±2 amber band and a ▲/▼ direction arrow), a 4-rung hint ladder unlocking
one rung per wrong guess (conference → star position+OVR → three opponents →
star name), a date-seeded **daily** puzzle, a free-play random round, and a
copy-paste share. Pure logic + tests: `src/engine/guessSeason.ts`.

```bash
npm run build:seasons   # bake public/seasons.json (18 programs × 2010–2025)
```

`seasons.json` (~260 KB, ~268 team-seasons) is baked from the Supabase serving
layer — completed games from `cfb_games`, season-scoped conference from
`cfb_teams`, and a star-player hint (top-rated real player) from
`cfb_player_ratings`. Kept separate from `data.json` so the draft never loads it
(ADR-0017). Seasons with <6 completed games or no rated star are skipped; 2023
is absent (API quota) and COVID-short 2020 slates are kept as fun puzzles.

## Tests & verification

```bash
npm test                                 # vitest: all engine unit tests
node --no-warnings scripts/screenshot.ts        <baseUrl> <outDir>  # drive a 16-0 Draft run
node --no-warnings scripts/screenshot-guess.ts  <baseUrl> <outDir>  # drive a Guess win + loss
```

`screenshot-guess.ts` plays a full win (it reads `seasons.json` + the engine's
daily pick to know the answer) and a full loss, asserts the share text reaches
the clipboard, and fails on any console error.
