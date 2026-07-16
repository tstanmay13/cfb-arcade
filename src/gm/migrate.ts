// Save-format migration (pure — unit-tested; db.ts applies it on load).
// v1 → v2 (ADR-0027 M0.1): the offseason inversion added the offseason
// calendar + shared stamina pool and retired the in-season recruiting fields.

import type { DynastyState } from "./engine/types.ts";

export function migrateDynasty(state: DynastyState): DynastyState {
  const s = state as DynastyState & { rapLeft?: number; pendingVisits?: number[] };
  if ((s.v ?? 1) < 2) {
    s.startYear ??= s.season;
    s.offWeek ??= s.phase === "offseason" ? 1 : 0;
    s.stamina ??= 0;
    delete s.rapLeft;
    delete s.pendingVisits;
    s.v = 2;
  }
  return s;
}
