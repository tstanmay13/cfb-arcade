# The 16-0 Draft (`game/`)

A 100% client-side, serverless single-page web game: a college-football
"all-era team-building" slot machine (a CFB take on 82-0.com). Spin → land a
random team+era → draft one legend from that roster → fill 8 positions + a head
coach → a hidden-OVR power score maps to a tier → the tier rolls a
probabilistic national-title season → copy a Wordle-style result to share.

Spec: `16-0-Draft_Design_Doc_v2.md` (design doc v2). Decision log: repo
[`docs/adr/`](../docs/adr/) from ADR-0009 onward.

This directory is a small **arcade**: one static SPA hosting independent game
"cabinets" that share the design system but nothing else (ADR-0017). The 16-0
Draft is cabinet #1; **Guess the Season** is cabinet #2 (see below). The title
screen links between them; each cabinet bakes its own JSON and lazy-loads it.

## Run it

```bash
cd game
npm install
npm run dev        # → http://localhost:5173
```

## Stack

Vite + React 18 + TypeScript + Tailwind v4. `vitest` for the engine unit
tests, mulberry32 for seeded deterministic RNG. **No backend** — the app is a
static SPA; all data ships as one static `public/data.json`.

## Data

`data.json` is baked at build time from this repo's local warehouse
(`../cfb.db`):

```bash
npm run build:data   # reads ../cfb.db, writes public/data.json
```

- **2010s + 2020s eras — real data** from the Supabase serving layer:
  `cfb_player_ratings` (`overall` = the game's `hidden_ovr`), real stat lines
  from `cfb_player_season_stats`, jerseys from `cfb_rosters`, colors from
  `cfb_teams`. Seasons 2010–2022 + 2024–25 (2023 pending API quota).
- **Pre-2010 eras are excluded** (user decision: real data only — CFBD has no
  player data there). The authored rosters remain as dormant source in
  `scripts/content/` behind `EXCLUDED_DECADES` in `build-data.ts`; a handful
  of authored rows survive inside the real eras for icons the sparse
  2010–2015 defensive stats can't rate (Cam Newton, Joey Bosa…), plus all
  coaches (CFBD has no coach data).

Current coverage: **18 programs, 36 team/era cells, ~1,000 players** — expand
by adding `scripts/content/*.json` program files and re-baking; both real
eras come along automatically.

The running game never touches a database or API — design pillar #4.

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
