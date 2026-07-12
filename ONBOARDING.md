# Onboarding — CFB Arcade

Welcome! You're joining the **CFB Arcade** — a 100% client-side SPA (Vite +
React 18 + TypeScript + Tailwind) with two games ("cabinets"): **The 16-0
Draft** and **Guess the Season**.

Repo: `github.com/tstanmay13/cfb-arcade` (private — ask the owner for
collaborator access). **It needs no secrets**: game data is baked into
committed static JSON, and the only credential anywhere is Supabase's public
anon key, already embedded in the scripts. The data pipeline that produces
the underlying stats lives in a separate private platform repo you won't need.

## Prerequisites

- **Node ≥ 22.5** (24 recommended). Nothing installed globally.

## Run & edit the game (start here)

```bash
git clone https://github.com/tstanmay13/cfb-arcade.git
cd cfb-arcade
npm install
npm run dev        # → http://localhost:5173
```

No `.env`, no database, no API keys. The app reads two committed static files:
`public/data.json` and `public/seasons.json`. Deploy = upload the static
build; that constraint is load-bearing, so don't add runtime API/DB calls for
game data. (The one sanctioned runtime network call is the anonymous
global-stats reporting — `src/data/stats.ts` — and it must stay fail-silent:
offline, the games play on and the stats sheet shows personal numbers only.)

## The verify loop (run before you commit)

```bash
npm test           # vitest — engine + bake-helper unit tests
npm run build      # tsc typecheck + vite production build. Must be clean.
npm run lint       # oxlint
```

Drive the real app headlessly (screenshots at each state + a console-error gate):

```bash
npm run dev -- --port 5199 --strictPort                                            # terminal 1
node --no-warnings scripts/screenshot.ts        http://localhost:5199 /tmp/shots   # 16-0 Draft playthrough
node --no-warnings scripts/screenshot-guess.ts  http://localhost:5199 /tmp/shots   # Guess the Season: win + loss + stats sheet
```

The guess harness also intercepts and blocks the global-stats reporting, so
your test runs never pollute real player numbers.

## Learn the codebase (read these first)

- **`CLAUDE.md`** — conventions & gotchas. Read this before editing.
- `README.md` — game overview, the data bakes, and **"The Supabase seam"**
  (exactly which tables this repo reads with the anon key, and the append-only
  stats table).

### Layout

- `src/engine/` — pure, unit-tested game logic. **No React imports here.**
- `src/components/` — React screens; they consume the engines.
- `src/state/` — the 16-0 Draft's runState/reducer + localStorage helpers.
- `src/data/` — types, lazy static-JSON loaders, and the global-stats client.
- `scripts/build-*.ts` — bake the static JSON under `public/` (Supabase anon
  key; works from a clean clone). `scripts/content/*.json` — authored
  per-program source data.

### Non-negotiable conventions

- **Seeded RNG only in engine code** (`mulberry32`) — never `Math.random()` in
  `src/engine/`. A run is reproducible from its seed; that's what makes the
  engines testable.
- **Relative imports include the `.ts` extension** (`import … from "./rng.ts"`).
  We run `.ts` directly via type-stripping, so: no enums/namespaces/decorators.
- **Don't touch the 16-0 Draft's `runState`/reducer** (`src/state/store.tsx`)
  when adding a game — it's the shipped product. New games are self-contained
  "cabinets": own engine + own baked JSON under `public/` + a lazily mounted
  screen wired into `App`'s `view`. Never add to `data.json` for a different
  game.
- **Never add a credential beyond the public anon key.**
- Pure engine logic gets vitest tests. Commit per milestone, not one big blob.

## Contributing

```bash
git switch -c my-change
# …edit, then run the verify loop above…
git commit -m "clear, present-tense summary"
git push -u origin my-change      # then open a PR on GitHub
```
