# ADR 0022: Draft pool ordering — sink unplaceable rows, sort only on player-visible keys

- Status: Accepted
- Date: 2026-07-12

## Context

The draft board (`src/components/DraftBoard.tsx`) shows the full roster of the
spun `{team, era}` cell. Some rows can't be drafted right now: the player's
board slot is already filled (you drafted a QB, so every other QB in later
spins is unplaceable) or the player is a duplicate already on your roster. These
rows were greyed out but stayed in the same position-then-name order as
everyone else, so a filled QB slot stranded that era's quarterbacks at the *top*
of the list — the first thing you saw was a wall of players you couldn't pick.
The order was also fixed, with no user control.

The wrinkle: the 16-0 Draft is a game of drafting under uncertainty. The only
simulation input is `hidden_ovr`, and it is **hidden by design** (§12). Visible
stats are cosmetic, correlate with OVR only loosely, and are *per position* —
`stat_1` is Passing Yards for a QB and Rushing Yards for a RB. So any "sort by
overall / best available" would either leak the hidden signal the whole game is
built on, or (for a per-stat sort over a mixed-position pool) be meaningless.

## Decision

- **Partition each spin's roster into placeable vs. unplaceable** and render
  them as two groups, with a "Can't place" divider between. Unplaceable rows
  always sink below the placeable ones regardless of the sort key — the thing
  you can't act on is never above the thing you can.
- **Add a sort toggle** over the pool with two keys: **Position**
  (offense→defense, the prior default) and **A–Z**. The choice is a sticky bar
  with a live "*N* available · *M* out" count and persists for the run.
- **Ordering may key only on player-visible attributes** — position and name.
  No sort by `hidden_ovr`, and no per-stat sort. This is the load-bearing part:
  it keeps the hidden-rating premise (§12) intact at the UI layer.
- Unplaceable rows always show *why* ("No open position" / "Already on your
  roster"), including mid-pick.

## Alternatives considered

- **Sort by rating / "best available"**: rejected — `hidden_ovr` is the game's
  central hidden variable (§12); an ordering keyed on it defeats the
  draft-under-uncertainty premise. A per-position stat sort was rejected for the
  same spirit plus the mixed-pool incomparability problem.
- **Leave unplaceable rows greyed in place** (status quo): rejected — it's
  exactly the clutter the change targets; unpickable QBs kept sitting at the top.
- **Filter unplaceable rows out entirely**: rejected — seeing who else was on
  that team+era is part of the flavor even when you can't draft them; greying +
  sinking keeps the context while getting it out of the way.

## Consequences

- Placeable players are always the head of the list; the "can't pick this" set
  is one glance away at the bottom, self-explaining.
- **New invariant for pool UI:** ordering keys are restricted to player-visible
  attributes. A future "filter to one position, then sort by that position's
  stat" is compatible with this; a global best-player sort is not.
- Scoped to `DraftBoard.tsx` (no engine change). Verified end-to-end with
  Playwright: dead-to-bottom holds, the divider renders, A–Z alphabetizes the
  available rows, no console errors.
