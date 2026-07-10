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

- **Modern era ("2020s")** — real players from `player_ratings`
  (`overall` = the game's `hidden_ovr`) + real stat lines from
  `player_season_stats` + real team colors from `teams`.
- **Historical eras (1980s–2010s)** — LLM-authored rosters (design doc §4.5),
  OVR-calibrated against the real modern scale, kept as human-readable source
  files under `scripts/historical/` and compiled into `data.json`.

The running game never touches a database or API — design pillar #4.

## Tests

```bash
npm test           # vitest: spin/sim/awards engine unit tests
```
