// NIL economics (v1.2): market valuations, program budgets, portal asks.
// Dollars are flavor-scaled to real P4 collectives; the harness owns the
// constants (budgets never go negative, portal churn stays in band).

import type { Player, PosGroup } from "./types.ts";

const POS_MULT: Record<PosGroup, number> = {
  QB: 2.5, WR: 1.3, DL: 1.3, CB: 1.25, OL: 1.1,
  RB: 1.0, TE: 1.0, LB: 1.0, S: 1.0, K: 0.4, P: 0.35,
};

/** Annual market value: exponential in overall, position + youth premiums. */
export function marketValue(p: Player): number {
  const clsMult = [1, 1.25, 1.1, 0.95, 0.7][p.cls] ?? 1;
  const raw = Math.pow(10, (p.ovr - 40) / 18) * 900 * POS_MULT[p.g] * clsMult;
  return Math.max(0, Math.round(raw / 500) * 500);
}

/** Per-cycle NIL pool by prestige tier (CFB_GM_DESIGN NIL tables, scaled). */
export function baseBudget(prestige: number): number {
  const tiers = [0.8, 1.0, 1.6, 2.2, 4.0, 6.0, 8.5];
  return Math.round(tiers[Math.max(0, Math.min(6, prestige))] * 1_000_000);
}

/** Next cycle's budget with performance swings. */
export function nextBudget(prestige: number, wins: number, wonNatty: boolean): number {
  let b = baseBudget(prestige);
  if (wonNatty) b += 2_500_000;
  else if (wins <= 4) b -= 1_000_000;
  return Math.max(600_000, b);
}

export function fmtMoney(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1)}M`;
  if (n >= 1_000) return `$${Math.round(n / 1_000)}k`;
  return `$${n}`;
}
