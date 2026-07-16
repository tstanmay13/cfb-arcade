# Architecture Decision Records

Each ADR captures one significant decision: the context, what we chose, the
alternatives we rejected, and the consequences we accepted. They're the durable
record of *why* the code looks the way it does — read them before reversing a
decision.

## Numbering — one shared sequence across both repos

The 16-0 Draft grew up inside the private `cfb` data-platform repo and was
split out into this repo for separation of powers (ADR-0020). ADR numbers are a
**single global sequence shared across both repos**, so a number means the same
thing everywhere and the `ADR-NNNN` references in this repo's code comments
never go stale:

- **0001–0021 live in the platform (`cfb`) repo, owner-side.** They're the
  historical record — many are arcade decisions made while the game still lived
  there (see the map below). They stay put; we don't copy them here.
- **This repo owns 0022 onward** — every new arcade-authored decision continues
  the shared sequence right here.

Arcade collaborators only have this repo (the platform repo is owner-only), so
the arcade-relevant history is glossed below rather than linked — enough to
understand the *why* without needing platform access.

## Arcade ADRs (this repo)

| # | Decision | Status |
|---|----------|--------|
| [0022](0022-draft-board-pool-ordering.md) | Draft pool ordering: sink unplaceable rows, sort only on player-visible keys | Accepted |
| [0023](0023-cfb-gm-dynasty-cabinet.md) | CFB-GM dynasty sim incubates as cabinet #3 | Accepted |
| [0024](0024-16-0-team-expansion.md) | The 16-0 Draft expands to 68 P4 teams with talent-weighted spins | Accepted |
| [0025](0025-bake-reads-warehouse.md) | The data.json bake reads the warehouse directly; Supabase heads toward stats-only | Accepted |
| [0026](0026-outcome-odds-ramp.md) | 16-0 odds ramp + varied records: no mid-range cliffs, loss counts drawn per outcome (ten live records) — 16-0 stays rare (skilled ~8%, oracle ~12%, random ~5%) | Accepted |
| [0027](0027-gm-mode-mechanical-rework.md) | CFB-GM mechanical rework (PR 2): offseason-gated recruiting/portal, shared stamina pool, fit-discounted portal NIL, 5-role staff, scheme-fit layer, historical 2010+ starts (revises design-doc calendar + 5-champ CFP) | Accepted |
| [0028](0028-five-year-era-windows.md) | 16-0 eras re-bucketed to 5-year windows (2010-14 / 2015-19 / 2020-25): dynasty-core rosters, tenure-scoped coaches, era re-spin no longer a solved flip | Accepted |
| [0029](0029-skill-ladder-retune.md) | 16-0 skill ladder: permanent 3-policy balance harness + flat-then-steep odds ramp — random ~4.7%, skilled ~10%, oracle ~23% (≥2× / ≥2.2× ratio gates) | Accepted |

## Historical arcade decisions (in the platform repo, owner-side)

These predate the split and are referenced by number from code comments. They
live in `cfb/docs/adr/` and are not duplicated here.

| # | Decision |
|---|----------|
| 0009 | Build "The 16-0 Draft" inside the platform repo (`game/`) — later reversed by 0020 |
| 0010 | Game data is a static `data.json` baked from Supabase + authored content |
| 0011 | Modern-slice mapping: positions, notability, stat blocks, served branding |
| 0012 | Spin-engine spec resolutions (duplicates, re-spin exclusion, coach cells) |
| 0013 | Bracket-coherent loss placement in the season sim |
| 0014 | Backfill 2010–2023 so the 2010s + full 2020s eras are real data |
| 0015 | Ship real eras only (1980s/1990s/2000s removed from the game) |
| 0016 | Quantile rating calibration + §12 balance pass (16-0 rarity) |
| 0017 | The CFB arcade: one SPA, per-cabinet baked JSON, lazy screens |
| 0019 | Anonymous global stats via `arcade_results` (anon key, append-only, fail-silent) |
| 0020 | Separation of powers: split the arcade into this repo |

## Template

```markdown
# ADR NNNN: <short title>

- Status: Proposed | Accepted | Superseded by ADR-XXXX
- Date: YYYY-MM-DD

## Context
What forces are at play — constraints, requirements, prior state.

## Decision
What we're doing, stated plainly.

## Alternatives considered
What else we weighed and why we rejected it.

## Consequences
What this makes easy, what it makes hard, and the risks we accepted.
```
