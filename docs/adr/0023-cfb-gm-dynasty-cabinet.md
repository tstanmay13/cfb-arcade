# ADR 0023: CFB-GM dynasty sim incubates as cabinet #3

- Status: Accepted
- Date: 2026-07-13

## Context

The end goal of the whole platform (ADR-0001: "clone Basketball GM for CFB")
is a client-side dynasty management sim. A full PRD for it ("CFB-GM") was
drafted externally, assuming a greenfield standalone app — it needed
reconciling against the actual two-repo architecture (ADR-0020: private
platform writes the Supabase seam; products read it). The reconciled design
lives in [`docs/CFB_GM_DESIGN.md`](../CFB_GM_DESIGN.md); this ADR records
where the game lives and what that binds it to.

## Decision

Build CFB-GM as **cabinet #3 in cfb-arcade**, not a third repo.

- Standard cabinet rules apply (ADR-0017): own engine modules under
  `src/engine/`, own screens rendered from the `App` `view` union, own baked
  JSON (`scripts/build-gm.ts` → `public/gm-data.json`) — never appended to
  another cabinet's bake. Shares only the design system, `rng.ts`, and
  `scripts/lib.ts`. Never touches the draft's `runState`/reducer.
- 100% client-side stands: no LLM calls, no API keys, no runtime network
  beyond the existing fail-silent anon-stats pattern (ADR-0019). All game AI
  is deterministic policy code over the seeded RNG.
- **First cabinet with persistent saves.** Dynasty state lives in IndexedDB
  (one Dexie database per dynasty slot) — the ARCHITECTURE.md tier-2 model.
  Dexie is an approved new dependency for this cabinet only; engine code
  stays storage-free (drivers persist, engines compute).
- **Split trigger** (the ADR-0020 precedent, pre-agreed): the cabinet moves
  to its own repo when any of — its bundle dominates arcade load, its release
  cadence needs save-format versioning discipline the arcade doesn't want, or
  collaborator sets diverge. Until then it incubates here, like the draft
  game incubated in the platform repo (ADR-0009 → 0020).

## Alternatives considered

- **Third repo from day one**: cleanest separation and the dynasty will
  likely outgrow the arcade — rejected for now to reuse the design system,
  deploy, and test infra immediately; the split path is proven and cheap.
- **Inside the platform repo**: direct warehouse access during dev — rejected;
  re-creates the exact separation-of-powers problem ADR-0020 solved.

## Consequences

- The arcade is no longer "stateless dailies only"; deploy remains static
  file upload.
- The Supabase seam gains two consumer needs the platform must serve
  (owner-side migrations, ADR-0021 amendment): `team_ratings` (G5 shell
  opponents + Elo seeding) and a recruiting-class distribution export
  (recruit generation templates). The bake script consumes them with the
  public anon key like every other cabinet bake.
- The shared ADR sequence continues here (0024+ for subsequent dynasty
  decisions).
- **Serving intent**: one static deploy, path-per-cabinet on a custom domain
  (e.g. `cfb-games.com/gm`). Requires mapping URL paths onto the `view` union
  (History API + Vercel SPA rewrite) — and the GM cabinet loads as a lazy
  chunk on its path, so the dailies never pay for the dynasty bundle (this
  also relieves the bundle-dominance split trigger above).
