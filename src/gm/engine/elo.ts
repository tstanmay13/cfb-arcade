// Elo power ratings — the engine truth behind rankings, shell strength, and
// upset odds (CFB_GM_DESIGN "Elo core + poll-bias layer"). Pure math; used by
// both the bake (2025 results → preseason 2026 seeds) and the in-season loop.

export const ELO_BASE = 1500;
export const ELO_HOME_ADV = 65;
export const ELO_K = 30;
/** Preseason regression toward the mean between seasons. */
export const ELO_REGRESS = 0.25;
/** Fixed strength for generic FCS opponents (buy games). */
export const ELO_FCS = 1150;

/** Expected score (win probability) for `a` vs `b`, no home adjustment. */
export function eloExpected(a: number, b: number): number {
  return 1 / (1 + Math.pow(10, (b - a) / 400));
}

/**
 * Post-game rating deltas with a 538-style margin-of-victory multiplier
 * (log-damped, autocorrelation-adjusted). Returns the winner's gain — the
 * loser loses the same amount. `homeIsWinner` folds home advantage in.
 */
export function eloDelta(
  winnerElo: number,
  loserElo: number,
  margin: number,
  homeIsWinner: boolean | null,
): number {
  const adv = homeIsWinner === null ? 0 : homeIsWinner ? ELO_HOME_ADV : -ELO_HOME_ADV;
  const expected = eloExpected(winnerElo + adv, loserElo);
  const mov =
    Math.log(Math.abs(margin) + 1) *
    (2.2 / ((winnerElo + adv - loserElo) * 0.001 + 2.2));
  return ELO_K * mov * (1 - expected);
}

/** Preseason seed: regress last season's final rating toward the base. */
export function eloPreseason(finalElo: number): number {
  return ELO_BASE + (1 - ELO_REGRESS) * (finalElo - ELO_BASE);
}

/** Win probability for home team given both Elos (home advantage applied). */
export function eloWinProbHome(homeElo: number, awayElo: number): number {
  return eloExpected(homeElo + ELO_HOME_ADV, awayElo);
}
