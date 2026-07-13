// Coaching staffs + booster mandates (v1.3). Three-man staffs (HC/OC/DC)
// with archetypes that hook into recruiting, game execution, and player
// development; an offseason carousel that fires, promotes, and poaches
// (including the user's coordinators); and seasonal booster mandates with
// NIL consequences. All seeded policy code.

import type { DynastyState } from "./types.ts";
import { clamp, rangeInt, stream, subSeed } from "./streams.ts";
import { genName } from "./names.ts";

export type CoachRole = "HC" | "OC" | "DC";
export type CoachArchetype = "recruiter" | "tactician" | "developer";

export interface Coach {
  id: number;
  name: string;
  role: CoachRole;
  archetype: CoachArchetype;
  rating: number;
  /** Team id, or null = free agent. */
  tid: number | null;
  seasons: number;
  w: number;
  l: number;
  /** Recent season win totals (hot-seat memory). */
  lastW: number[];
}

export interface Mandate {
  kind: "wins" | "beat-rival" | "cfp" | "class";
  text: string;
  target: number;
  met: boolean | null;
}

export const ARCHETYPE_LABELS: Record<CoachArchetype, string> = {
  recruiter: "Recruiter",
  tactician: "Tactician",
  developer: "Developer",
};

const ARCHES: CoachArchetype[] = ["recruiter", "tactician", "developer"];

function genCoach(
  state: DynastyState,
  role: CoachRole,
  quality: number,
  tid: number | null,
): Coach {
  const id = state.nextCoachId++;
  const rng = stream(state.seed, "coach", id);
  return {
    id,
    name: genName(rng),
    role,
    archetype: ARCHES[rangeInt(rng, 0, 2)],
    rating: clamp(quality + rangeInt(rng, -8, 8), 40, 95),
    tid,
    seasons: 0,
    w: 0,
    l: 0,
    lastW: [],
  };
}

export function initCoaches(state: DynastyState): void {
  for (const team of state.teams) {
    if (!team.p4) continue;
    state.coaches.push(genCoach(state, "HC", 52 + team.prestige * 6, team.id));
    state.coaches.push(genCoach(state, "OC", 48 + team.prestige * 5, team.id));
    state.coaches.push(genCoach(state, "DC", 48 + team.prestige * 5, team.id));
  }
  for (let i = 0; i < 30; i++) {
    state.coaches.push(genCoach(state, "HC", rangeInt(stream(state.seed, "fa", i), 50, 74), null));
  }
}

export function staffOf(state: DynastyState, tid: number): Partial<Record<CoachRole, Coach>> {
  const out: Partial<Record<CoachRole, Coach>> = {};
  for (const c of state.coaches) {
    if (c.tid === tid) out[c.role] = c;
  }
  return out;
}

/** Recruiting interest multiplier from staff (Recruiter archetype + quality). */
export function recruitMult(state: DynastyState, tid: number): number {
  const staff = staffOf(state, tid);
  let m = 1;
  if (staff.HC) {
    if (staff.HC.archetype === "recruiter") m += 0.15;
    m += (staff.HC.rating - 70) * 0.002;
  }
  for (const role of ["OC", "DC"] as const) {
    if (staff[role]?.archetype === "recruiter") m += 0.06;
  }
  return clamp(m, 0.8, 1.4);
}

/** Flat execution bump for the game engine (Tactician archetype + quality). */
export function gameBonus(state: DynastyState, tid: number): number {
  const staff = staffOf(state, tid);
  let b = 0;
  if (staff.HC) {
    if (staff.HC.archetype === "tactician") b += 2.2;
    b += (staff.HC.rating - 70) * 0.04;
  }
  for (const role of ["OC", "DC"] as const) {
    if (staff[role]?.archetype === "tactician") b += 1.2;
  }
  return clamp(b, -2, 6);
}

/** Development multiplier bonus (Developer archetype), added to facilityMult. */
export function devBonus(state: DynastyState, tid: number): number {
  const staff = staffOf(state, tid);
  let b = 0;
  if (staff.HC?.archetype === "developer") b += 0.06;
  for (const role of ["OC", "DC"] as const) {
    if (staff[role]?.archetype === "developer") b += 0.04;
  }
  if (staff.HC) b += (staff.HC.rating - 70) * 0.0008;
  return clamp(b, -0.05, 0.15);
}

function pushNews(state: DynastyState, text: string): void {
  state.news.unshift({ season: state.season, week: state.week, text });
  state.news.splice(60);
}

function freeAgents(state: DynastyState): Coach[] {
  return state.coaches.filter((c) => c.tid === null).sort((a, b) => b.rating - a.rating);
}

/** Growth, firings, promotions, poaching. Runs in finishOffseason. */
export function coachCarousel(state: DynastyState, championTid: number | null): void {
  const rng = stream(state.seed, "carousel", state.season);

  // Growth + records.
  for (const c of state.coaches) {
    if (c.tid === null) continue;
    const team = state.teams[c.tid];
    c.seasons += 1;
    c.w += team.rec.w;
    c.l += team.rec.l;
    if (c.role === "HC") c.lastW.push(team.rec.w);
    c.lastW.splice(0, Math.max(0, c.lastW.length - 3));
    let delta = 0;
    if (team.rec.w >= 10) delta += 2;
    if (team.rec.w <= 4) delta -= 2;
    if (c.tid === championTid) delta += 3;
    c.rating = clamp(c.rating + delta, 40, 99);
  }

  // Hot seat: AI programs fire underperforming head coaches.
  const vacancies: number[] = [];
  for (const team of state.teams) {
    if (!team.p4 || team.id === state.userTid) continue;
    const hc = staffOf(state, team.id).HC;
    if (!hc || hc.lastW.length < 2) continue;
    const [a, b] = hc.lastW.slice(-2);
    const bar = team.prestige >= 5 ? 6 : 4;
    if (a <= bar && b <= bar) {
      hc.tid = null;
      hc.rating = clamp(hc.rating - 4, 40, 99);
      vacancies.push(team.id);
      pushNews(state, `🔥 ${team.school} fires head coach ${hc.name} after a ${b}-win season.`);
    }
  }
  state.openJobs = [...vacancies];

  // Fill vacancies: best available — free agents and other programs' coordinators.
  for (const tid of vacancies) {
    const team = state.teams[tid];
    // User coordinators can get poached into open jobs.
    const userStaff = staffOf(state, state.userTid);
    const poachable = (["OC", "DC"] as const)
      .map((r) => userStaff[r])
      .filter(
        (c): c is Coach =>
          !!c && c.rating >= 76 && state.teams[state.userTid].rec.w >= 9 && rng() < 0.35,
      );
    const coordPool = state.coaches.filter(
      (c) =>
        c.tid !== null && c.tid !== tid && c.role !== "HC" &&
        c.tid !== state.userTid && c.rating >= 70,
    );
    const candidates = [...freeAgents(state), ...poachable, ...coordPool].sort(
      (a, b) => b.rating - a.rating,
    );
    const hire = candidates[Math.min(rangeInt(rng, 0, 2), candidates.length - 1)];
    if (!hire) continue;
    const wasUser = hire.tid === state.userTid;
    const fromTid = hire.tid;
    hire.tid = tid;
    hire.role = "HC";
    hire.lastW = [];
    pushNews(state, `📋 ${team.school} hires ${hire.name} as head coach.`);
    if (wasUser) {
      pushNews(state, `⚠️ Your coordinator ${hire.name} left to run ${team.school}.`);
    }
    // Backfill the coordinator slot the hire vacated.
    if (fromTid !== null) {
      const missing = (["OC", "DC"] as const).find((r) => !staffOf(state, fromTid)[r]);
      if (missing) {
        const fa = freeAgents(state)[0] ?? genCoach(state, missing, 55, null);
        fa.tid = fromTid;
        fa.role = missing;
        if (fromTid === state.userTid) {
          pushNews(state, `📋 You hired ${fa.name} (${fa.rating} OVR ${ARCHETYPE_LABELS[fa.archetype]}) as your new ${missing}.`);
        }
      }
    }
  }

  // Keep the free-agent pool stocked.
  while (freeAgents(state).length < 15) {
    state.coaches.push(genCoach(state, "HC", rangeInt(rng, 48, 72), null));
  }
}

/** User takes an open job: swap programs; the old school hires from the pool. */
export function takeJob(state: DynastyState, tid: number): boolean {
  if (state.phase !== "offseason" || state.offStage !== "done") return false;
  if (!state.openJobs.includes(tid)) return false;
  const oldTid = state.userTid;
  // Displace whoever the AI just hired there back to the market.
  const incumbent = staffOf(state, tid).HC;
  if (incumbent) incumbent.tid = null;
  // The old program hires the best free agent.
  const fa = freeAgents(state)[0];
  if (fa) {
    fa.tid = oldTid;
    fa.role = "HC";
    fa.lastW = [];
  }
  state.userTid = tid;
  state.openJobs = state.openJobs.filter((t) => t !== tid);
  pushNews(state, `🧳 You take over at ${state.teams[tid].school}. ${state.teams[oldTid].school} moves on.`);
  return true;
}

// ---------------------------------------------------------------------------
// Booster mandates
// ---------------------------------------------------------------------------

export const BOOSTER_LABELS = ["The Old Guard", "New Money", "The Win-Now Syndicate"];

export function genMandates(state: DynastyState): void {
  const user = state.teams[state.userTid];
  const rng = stream(state.seed, "mandates", state.season, state.userTid);
  const mandates: Mandate[] = [];
  const winTarget = clamp(user.prevW + (user.boosterType === 2 ? 2 : 1), 6, 11);
  mandates.push({
    kind: "wins",
    text: `Win at least ${winTarget} games`,
    target: winTarget,
    met: null,
  });
  const rivalOnSchedule = (user.rivals ?? []).find((r) =>
    state.schedule.some(
      (g) => (g.home === state.userTid && g.away === r) || (g.away === state.userTid && g.home === r),
    ),
  );
  if (user.boosterType === 2 && user.prestige >= 4) {
    mandates.push({ kind: "cfp", text: "Make the College Football Playoff", target: 0, met: null });
  } else if (user.boosterType === 1) {
    mandates.push({ kind: "class", text: "Sign a top-15 recruiting class", target: 15, met: null });
  } else if (rivalOnSchedule !== undefined) {
    mandates.push({
      kind: "beat-rival",
      text: `Beat ${state.teams[rivalOnSchedule].school}`,
      target: rivalOnSchedule,
      met: null,
    });
  } else if (rng() < 0.5) {
    mandates.push({ kind: "class", text: "Sign a top-15 recruiting class", target: 15, met: null });
  }
  state.mandates = mandates;
}

/** Evaluate at finishOffseason; returns the NIL multiplier for next cycle. */
export function evalMandates(state: DynastyState, classRank: number): number {
  const user = state.teams[state.userTid];
  for (const m of state.mandates) {
    if (m.kind === "wins") m.met = user.rec.w >= m.target;
    else if (m.kind === "cfp") m.met = state.cfp?.field.includes(state.userTid) ?? false;
    else if (m.kind === "class") m.met = classRank <= m.target;
    else if (m.kind === "beat-rival") {
      m.met = state.results.some((r) => {
        const usHome = r.home === state.userTid && r.away === m.target;
        const usAway = r.away === state.userTid && r.home === m.target;
        return (usHome && r.hs > r.as) || (usAway && r.as > r.hs);
      });
    }
  }
  const met = state.mandates.filter((m) => m.met).length;
  if (state.mandates.length === 0) return 1;
  if (met === state.mandates.length) {
    pushNews(state, `💰 ${BOOSTER_LABELS[user.boosterType]} reward the program — NIL pool boosted 25%.`);
    return 1.25;
  }
  if (met === 0) {
    pushNews(state, `🧨 ${BOOSTER_LABELS[user.boosterType]} revolt — NIL pool slashed 20%.`);
    for (const pid of user.roster) {
      const p = state.players[pid];
      p.morale = clamp(p.morale - 8, 0, 100);
    }
    return 0.8;
  }
  return 1;
}

/** Booster board profile per program (flavor + mandate mix), seeded. */
export function boosterTypeFor(seed: number, tid: number): number {
  return subSeed(seed, "booster", tid) % 3;
}
