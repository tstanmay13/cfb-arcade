# The 16-0 Draft (`game/`)

A 100% client-side, serverless single-page web game: a college-football
"all-era team-building" slot machine (a CFB take on 82-0.com). Spin → land a
random team+era → draft one legend from that roster → fill 8 positions + a head
coach → a hidden-OVR power score maps to a tier → the tier rolls a
probabilistic national-title season → share the card.

Spec: `16-0-Draft_Design_Doc_v2.md` (design doc v2). Decision log: repo
[`docs/adr/`](../docs/adr/) from ADR-0009 onward.

## Run it

```bash
cd game
npm install
npm run dev        # → http://localhost:5173
```

## Stack

Vite + React 18 + TypeScript + Tailwind v4. `vitest` for the engine unit
tests, `html2canvas` for the share card, mulberry32 for seeded deterministic
RNG. **No backend** — the app is a static SPA; all data ships as one static
`public/data.json`.

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

## Tests

```bash
npm test           # vitest: spin/sim/awards engine unit tests
```
