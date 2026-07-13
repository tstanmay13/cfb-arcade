// Interactive recruiting (v1.1, CFB_GM_DESIGN "Recruiting & game-AI policy"):
// the RAP action economy, 2-stage scouting with gem/bust reveals,
// deal-breaker hard locks, the same-rules AI policy for the other 67
// programs, weekly commitment checks, and signing-day flips. All seeded —
// zero LLM/network; user actions add fixed constants so determinism holds.

import type { Rng } from "../../engine/rng.ts";
import type { DealBreaker, DynastyState, Player, PosGroup, Recruit, Team } from "./types.ts";
import { clamp, rangeInt, stream, subSeed } from "./streams.ts";
import { CEILING_BANDS, devTierOf, generatePlayer, rollDev, synthAttrs, emptyStats } from "./player.ts";
import { genName } from "./names.ts";
import { ovrForStars, rollPos, rollStars } from "./recruits.ts";

export const WEEKLY_RAP = 600;
export const COMMIT_THRESHOLD = 1000;
const MAX_LEADS = 8;

export const RAP_ACTIONS = {
  dm: { cost: 10, pts: 15, label: "DM" },
  coach: { cost: 25, pts: 40, label: "Position coach" },
  hc: { cost: 75, pts: 130, label: "HC in-home visit" },
  visit: { cost: 150, pts: 300, label: "Official visit" },
  s1: { cost: 30, pts: 0, label: "Scout I" },
  s2: { cost: 60, pts: 0, label: "Scout II" },
} as const;
export type RapAction = keyof typeof RAP_ACTIONS;

/** Ceiling band per tier (shared table), shiftable ±1 tier for gems/busts. */
function ceilingFor(tier: number, ovr: number, rng: Rng): number {
  const [lo, hi] = CEILING_BANDS[clamp(tier, 0, 3)];
  return clamp(Math.max(rangeInt(rng, lo, hi), ovr + 3), 40, 99);
}

export function generateRecruitPool(state: DynastyState, count: number): void {
  const rng = stream(state.seed, "recruit-pool", state.season);
  const seen = new Set<string>();
  const pool: Recruit[] = [];
  for (let i = 0; i < count; i++) {
    const stars = rollStars(rng);
    const g = rollPos(rng);
    const ovr = ovrForStars(stars, rng);
    const dev = rollDev(rng);
    // Gem/bust = the hidden ceiling comes from a tier above/below the badge.
    const gbRoll = rng();
    const gb: -1 | 0 | 1 = gbRoll < 0.15 ? 1 : gbRoll < 0.3 ? -1 : 0;
    const tier = devTierOf(dev);
    const ceil = ceilingFor(tier + gb, ovr, rng);
    const dbRoll = rng();
    const db: DealBreaker =
      dbRoll < 0.4 ? null : dbRoll < 0.65 ? "PLAYING_TIME" : dbRoll < 0.85 ? "CONTENDER" : "PRO_POTENTIAL";
    let name = genName(rng);
    while (seen.has(name)) name = genName(rng);
    seen.add(name);
    pool.push({
      id: state.nextRid++,
      name,
      pos: g,
      g,
      stars,
      ovr,
      dev,
      devTier: tier,
      ceil,
      gb,
      db,
      leads: [],
      committed: null,
      scouted: 0,
      hcUsed: false,
    });
  }
  pool.sort((a, b) => b.stars - a.stars || b.ovr - a.ovr);
  state.recruits = pool;
  state.pendingVisits = [];
}

/** Fuzzy displayed OVR band by scouting stage. */
export function shownOvr(r: Recruit): string {
  if (r.scouted >= 2) return String(r.ovr);
  const spread = r.scouted === 1 ? 2 : 6;
  const center = r.ovr + ((subSeed(r.id, "fuzz") % 5) - 2); // stable, seeded fuzz
  return `${clamp(center - spread, 40, 99)}–${clamp(center + spread, 40, 99)}`;
}

/** Hard deal-breaker lock: can `tid` even recruit this player? */
export function dealBreakerLock(state: DynastyState, r: Recruit, tid: number): string | null {
  const team = state.teams[tid];
  if (r.db === "PLAYING_TIME") {
    const blocker = team.roster
      .map((pid) => state.players[pid])
      .find((p) => p.g === r.g && p.cls <= 2 && p.ovr > r.ovr + 3);
    return blocker ? `wants playing time (${blocker.name} blocks)` : null;
  }
  if (r.db === "CONTENDER") {
    const ranked = state.poll.some((e) => e.tid === tid);
    return ranked || team.prevW >= 9 ? null : "wants a contender (be ranked or 9+ wins)";
  }
  if (r.db === "PRO_POTENTIAL") {
    return team.prestige >= 5 ? null : "wants an NFL factory (5★+ prestige)";
  }
  return null;
}

export function addInterest(r: Recruit, tid: number, pts: number): void {
  const lead = r.leads.find((l) => l.t === tid);
  if (lead) lead.p += pts;
  else r.leads.push({ t: tid, p: pts });
  r.leads.sort((a, b) => b.p - a.p);
  r.leads.splice(MAX_LEADS);
}

export function userPoints(r: Recruit, tid: number): number {
  return r.leads.find((l) => l.t === tid)?.p ?? 0;
}

/** Does the user's team have a home game scheduled this week? */
export function hasHomeGame(state: DynastyState): boolean {
  return state.schedule.some(
    (g) => g.week === state.week && g.home === state.userTid && g.kind === "reg",
  );
}

/** Execute a user RAP action. Returns an error string or null on success. */
export function userAction(state: DynastyState, rid: number, action: RapAction): string | null {
  const r = state.recruits.find((x) => x.id === rid);
  if (!r) return "Unknown recruit";
  if (state.phase !== "regular") return "Recruiting is closed for the season";
  if (r.committed !== null && r.committed !== state.userTid) return "Committed elsewhere";
  const def = RAP_ACTIONS[action];
  if (state.rapLeft < def.cost) return "Not enough RAP this week";
  const lock = dealBreakerLock(state, r, state.userTid);
  if (lock && action !== "s1" && action !== "s2") return `Locked: ${lock}`;

  if (action === "s1") {
    if (r.scouted >= 1) return "Already scouted";
    r.scouted = 1;
  } else if (action === "s2") {
    if (r.scouted < 1) return "Run Scout I first";
    if (r.scouted >= 2) return "Fully scouted";
    r.scouted = 2;
  } else if (action === "hc") {
    if (r.hcUsed) return "HC visit already used on this recruit";
    r.hcUsed = true;
    addInterest(r, state.userTid, def.pts);
  } else if (action === "visit") {
    if (!hasHomeGame(state)) return "Official visits need a home game this week";
    if (state.pendingVisits.includes(rid)) return "Visit already scheduled";
    state.pendingVisits.push(rid);
    addInterest(r, state.userTid, def.pts);
  } else {
    addInterest(r, state.userTid, def.pts);
  }
  state.rapLeft -= def.cost;
  return null;
}

/** Positional need for AI targeting: departing seniors + thin groups. */
export function teamNeeds(state: DynastyState, team: Team): Map<PosGroup, number> {
  const targets: [PosGroup, number][] = [
    ["QB", 4], ["RB", 6], ["WR", 9], ["TE", 4], ["OL", 14],
    ["DL", 12], ["LB", 9], ["CB", 7], ["S", 6], ["K", 2], ["P", 2],
  ];
  const have = new Map<PosGroup, number>();
  for (const pid of team.roster) {
    const p = state.players[pid];
    if (p.cls >= 4) continue; // seniors leave
    have.set(p.g, (have.get(p.g) ?? 0) + 1);
  }
  const needs = new Map<PosGroup, number>();
  for (const [g, want] of targets) {
    needs.set(g, Math.max(0, want - (have.get(g) ?? 0)));
  }
  return needs;
}

/** Star ceiling an AI program realistically chases. */
function maxStarsFor(prestige: number): number {
  return prestige >= 5 ? 5 : prestige >= 4 ? 5 : prestige >= 3 ? 4 : 3;
}

function aiWeeklyPoints(state: DynastyState, team: Team, rng: Rng): void {
  const needs = teamNeeds(state, team);
  const maxStars = maxStarsFor(team.prestige);
  const candidates: { r: Recruit; score: number }[] = [];
  for (const r of state.recruits) {
    if (r.committed !== null) continue;
    if (r.stars > maxStars && rng() > 0.06) continue; // rare reach
    if (dealBreakerLock(state, r, team.id)) continue;
    const need = needs.get(r.g) ?? 0;
    if (need <= 0 && rng() > 0.15) continue;
    const myPts = userPoints(r, team.id);
    const score =
      r.ovr + r.stars * 4 + need * 3 + (myPts > 0 ? 8 : 0) + team.prestige * 2 + rng() * 10;
    candidates.push({ r, score });
  }
  candidates.sort((a, b) => b.score - a.score);
  // Same 600-RAP budget as the user, converted at blended action efficiency.
  let budget = Math.round(WEEKLY_RAP * (1.35 + team.prestige * 0.05));
  for (const { r } of candidates.slice(0, 9)) {
    const spend = Math.min(budget, rangeInt(rng, 60, 190));
    addInterest(r, team.id, spend);
    budget -= spend;
    if (budget <= 0) break;
  }
}

function commitChecks(state: DynastyState, rng: Rng): void {
  for (const r of state.recruits) {
    if (r.committed !== null || r.leads.length === 0) continue;
    const [first, second] = r.leads;
    if (first.p < COMMIT_THRESHOLD) continue;
    const margin = first.p - (second?.p ?? 0);
    const prob = clamp(0.3 + margin / 2000, 0.3, 0.85);
    if (rng() < prob) {
      r.committed = first.t;
      if (r.stars >= 4 || first.t === state.userTid) {
        state.news.unshift({
          season: state.season,
          week: state.week,
          text: `🤝 ${"★".repeat(r.stars)} ${r.g} ${r.name} commits to ${state.teams[first.t].school}.`,
        });
        state.news.splice(60);
      }
    }
  }
}

/** Weekly recruiting tick — run after the week's games (regular season). */
export function recruitingTick(state: DynastyState): void {
  const rng = stream(state.seed, "recruiting", state.season, state.week);
  // Official-visit game-day bonus: +50 if the visit's host won at home.
  const userWonHome = state.results.some(
    (r) => r.week === state.week && r.home === state.userTid && r.hs > r.as,
  );
  for (const rid of state.pendingVisits) {
    const r = state.recruits.find((x) => x.id === rid);
    if (r && userWonHome) addInterest(r, state.userTid, 50);
  }
  state.pendingVisits = [];

  for (const team of state.teams) {
    if (!team.p4 || team.id === state.userTid) continue;
    aiWeeklyPoints(state, team, rng);
  }
  commitChecks(state, rng);
  state.rapLeft = WEEKLY_RAP;
}

/** Signing day (after CCGs): last-second flips, then force the fence-sitters. */
export function signingDay(state: DynastyState): void {
  const rng = stream(state.seed, "signing-day", state.season);
  for (const r of state.recruits) {
    if (r.committed !== null) {
      // PRD flip check: 10% an outbid attempt even triggers.
      const rival = r.leads.find((l) => l.t !== r.committed);
      if (rival && rival.p > userPoints(r, r.committed) * 0.85 && rng() < 0.1) {
        const from = state.teams[r.committed].school;
        r.committed = rival.t;
        state.news.unshift({
          season: state.season,
          week: state.week,
          text: `🚨 FLIP: ${"★".repeat(r.stars)} ${r.g} ${r.name} flips from ${from} to ${state.teams[rival.t].school} on Signing Day!`,
        });
        state.news.splice(60);
      }
      continue;
    }
    const first = r.leads[0];
    if (first && first.p >= 600 && rng() < 0.8) {
      r.committed = first.t;
    }
  }
}

/** Convert a signed recruit into a roster player (hidden rolls preserved). */
export function recruitToPlayer(r: Recruit, pid: number, rootSeed: number): Player {
  const rng = stream(rootSeed, "signee", pid);
  return {
    id: pid,
    name: r.name,
    pos: r.pos,
    g: r.g,
    cls: 1,
    ovr: r.ovr,
    attrs: synthAttrs(r.g, r.ovr, rng),
    dev: r.dev,
    devTier: r.devTier,
    ceil: r.ceil,
    stars: r.stars,
    seed: subSeed(rootSeed, "p", pid),
    inj: 0,
    nil: 0,
    morale: 65,
    loyalty: rangeInt(rng, 20, 95),
    stats: emptyStats(),
    career: [],
  };
}

/**
 * Late signing period: every unsigned recruit (best first) picks among teams
 * that still have need, weighted by prestige gravity — so leftovers land
 * where real leftovers land, and weak classes stay weak.
 */
export function lateSigningPeriod(
  state: DynastyState,
  needs: Map<number, number>,
  rng: Rng,
): Map<number, Player[]> {
  const out = new Map<number, Player[]>();
  for (const r of state.recruits) {
    if (r.committed !== null) continue;
    const open = [...needs.entries()].filter(
      ([tid, n]) => n > 0 && !dealBreakerLock(state, r, tid),
    );
    if (open.length === 0) continue;
    const weights = open.map(([tid]) => Math.pow(state.teams[tid].prestige + 0.5, 2.5));
    const total = weights.reduce((a, b) => a + b, 0);
    let roll = rng() * total;
    let idx = 0;
    for (; idx < open.length - 1; idx++) {
      roll -= weights[idx];
      if (roll <= 0) break;
    }
    const tid = open[idx][0];
    needs.set(tid, needs.get(tid)! - 1);
    r.committed = tid;
    const p = recruitToPlayer(r, state.nextPid++, state.seed);
    out.set(tid, [...(out.get(tid) ?? []), p]);
  }
  return out;
}

/** True walk-ons for any shortfall the pool couldn't cover. */
export function walkOns(state: DynastyState, count: number, rng: Rng): Player[] {
  const out: Player[] = [];
  for (let i = 0; i < count; i++) {
    out.push(generatePlayer(rollPos(rng), rangeInt(rng, 46, 56), 1, state.nextPid++, state.seed, rng));
  }
  return out;
}
