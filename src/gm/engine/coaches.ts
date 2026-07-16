// Coaching staffs + booster mandates (v1.3). Three-man staffs (HC/OC/DC)
// with archetypes that hook into recruiting, game execution, and player
// development; an offseason carousel that fires, promotes, and poaches
// (including the user's coordinators); and seasonal booster mandates with
// NIL consequences. All seeded policy code.

import type { DynastyState } from "./types.ts";
import { clamp, rangeInt, stream, subSeed } from "./streams.ts";
import { genName } from "./names.ts";
import { confStandings } from "./postseason.ts";
import { DEF_SCHEMES, OFF_SCHEMES, type DefScheme, type OffScheme } from "./schemes.ts";

export type CoachRole = "HC" | "OC" | "DC" | "RC" | "SC";
export type CoachArchetype = "recruiter" | "tactician" | "developer";

/** Five hireable staff roles (M1.7). RC feeds the stamina/recruiting pool; S&C
 *  feeds player development. Labels drive the UI. */
export const ROLE_LABELS: Record<CoachRole, string> = {
  HC: "Head Coach",
  OC: "Offensive Coordinator",
  DC: "Defensive Coordinator",
  RC: "Recruiting Coordinator",
  SC: "Strength & Conditioning",
};
export const STAFF_ROLES: CoachRole[] = ["HC", "OC", "DC", "RC", "SC"];

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
  /** Preferred scheme (M1.2): OC carries an OffScheme, DC a DefScheme. */
  scheme?: string;
}

/** Booster mandate kinds across 7 categories (M1.8). `target` is kind-scoped:
 *  win count / class rank / star count / rival team id, or 0 when unused. */
export type MandateKind =
  // program-building
  | "wins" | "improve" | "develop90" | "beat-ranked"
  // rivalry
  | "beat-rival" | "sweep-rivals"
  // conference
  | "win-conf" | "conf-top2"
  // postseason
  | "cfp" | "reach-semi" | "win-title"
  // recruiting
  | "class" | "sign-5stars"
  // portal
  | "land-transfer"
  // statistical
  | "heisman" | "lead-scoring";

export interface Mandate {
  kind: MandateKind;
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
  const scheme =
    role === "OC"
      ? OFF_SCHEMES[rangeInt(rng, 0, OFF_SCHEMES.length - 1)]
      : role === "DC"
        ? DEF_SCHEMES[rangeInt(rng, 0, DEF_SCHEMES.length - 1)]
        : undefined;
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
    scheme,
  };
}

/** A team's scheme identity, taken from its coordinators (M1.2). */
export function teamScheme(state: DynastyState, tid: number): { off: OffScheme; def: DefScheme } {
  const staff = staffOf(state, tid);
  const off = staff.OC?.scheme as OffScheme | undefined;
  const def = staff.DC?.scheme as DefScheme | undefined;
  return {
    off: off && OFF_SCHEMES.includes(off) ? off : "pro",
    def: def && DEF_SCHEMES.includes(def) ? def : "base43",
  };
}

export function initCoaches(state: DynastyState): void {
  for (const team of state.teams) {
    if (!team.p4) continue;
    state.coaches.push(genCoach(state, "HC", 52 + team.prestige * 6, team.id));
    state.coaches.push(genCoach(state, "OC", 48 + team.prestige * 5, team.id));
    state.coaches.push(genCoach(state, "DC", 48 + team.prestige * 5, team.id));
    state.coaches.push(genCoach(state, "RC", 46 + team.prestige * 5, team.id));
    state.coaches.push(genCoach(state, "SC", 46 + team.prestige * 5, team.id));
  }
  for (let i = 0; i < 30; i++) {
    state.coaches.push(genCoach(state, "HC", rangeInt(stream(state.seed, "fa", i), 50, 74), null));
  }
}

/**
 * Per-cycle staff salary (M1.7): coaches are paid from the SAME program NIL
 * pool as the roster — a stud coordinator is money the portal doesn't get.
 */
export function coachSalary(c: Coach): number {
  return Math.max(100_000, Math.round(((c.rating - 40) * 4000) / 500) * 500);
}

/** Whole-staff bill for a program's employed coaches. */
export function staffBill(state: DynastyState, tid: number): number {
  return state.coaches.filter((c) => c.tid === tid).reduce((a, c) => a + coachSalary(c), 0);
}

export function staffOf(state: DynastyState, tid: number): Partial<Record<CoachRole, Coach>> {
  const out: Partial<Record<CoachRole, Coach>> = {};
  for (const c of state.coaches) {
    if (c.tid === tid) out[c.role] = c;
  }
  return out;
}

/** Recruiting interest multiplier from staff (Recruiter archetype + quality).
 *  The RC's whole job is this — their quality feeds it directly (M1.7), which
 *  also raises the user's weekly stamina cap via staminaMax. */
export function recruitMult(state: DynastyState, tid: number): number {
  const staff = staffOf(state, tid);
  let m = 1;
  if (staff.HC) {
    if (staff.HC.archetype === "recruiter") m += 0.15;
    m += (staff.HC.rating - 70) * 0.002;
  }
  if (staff.RC) {
    m += 0.05 + (staff.RC.rating - 70) * 0.003;
    if (staff.RC.archetype === "recruiter") m += 0.06;
  }
  for (const role of ["OC", "DC"] as const) {
    if (staff[role]?.archetype === "recruiter") m += 0.06;
  }
  return clamp(m, 0.8, 1.5);
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

/** Development multiplier bonus (Developer archetype), added to facilityMult.
 *  S&C quality feeds this directly (M1.7). */
export function devBonus(state: DynastyState, tid: number): number {
  const staff = staffOf(state, tid);
  let b = 0;
  if (staff.HC?.archetype === "developer") b += 0.06;
  if (staff.SC) {
    b += 0.02 + (staff.SC.rating - 70) * 0.0008;
    if (staff.SC.archetype === "developer") b += 0.03;
  }
  for (const role of ["OC", "DC"] as const) {
    if (staff[role]?.archetype === "developer") b += 0.04;
  }
  if (staff.HC) b += (staff.HC.rating - 70) * 0.0008;
  return clamp(b, -0.05, 0.18);
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
    // Backfill the staff slot the hire vacated.
    if (fromTid !== null) {
      const missing = (["OC", "DC", "RC", "SC"] as const).find((r) => !staffOf(state, fromTid)[r]);
      if (missing) {
        const fa = freeAgents(state)[0] ?? genCoach(state, missing, 55, null);
        if (!state.coaches.includes(fa)) state.coaches.push(fa);
        fa.tid = fromTid;
        fa.role = missing;
        if (missing === "OC" && !fa.scheme) {
          fa.scheme = OFF_SCHEMES[rangeInt(stream(state.seed, "oc-scheme", fa.id), 0, OFF_SCHEMES.length - 1)];
        } else if (missing === "DC" && !fa.scheme) {
          fa.scheme = DEF_SCHEMES[rangeInt(stream(state.seed, "dc-scheme", fa.id), 0, DEF_SCHEMES.length - 1)];
        }
        if (fromTid === state.userTid) {
          pushNews(state, `📋 You hired ${fa.name} (${fa.rating} OVR ${ARCHETYPE_LABELS[fa.archetype]}) as your new ${missing}.`);
        }
      }
    }
  }

  // Staff integrity (M1.7): AI programs never run with an empty staff slot —
  // any missing OC/DC/RC/SC gets filled from the market. The user's vacancies
  // are their own to fill (that's the hire flow).
  for (const team of state.teams) {
    if (!team.p4 || team.id === state.userTid) continue;
    for (const role of ["OC", "DC", "RC", "SC"] as const) {
      if (staffOf(state, team.id)[role]) continue;
      const fa = freeAgents(state)[0] ?? genCoach(state, role, 52, null);
      if (!state.coaches.includes(fa)) state.coaches.push(fa);
      fa.tid = team.id;
      fa.role = role;
      // A coach stepping into a coordinator job needs a scheme identity.
      if (role === "OC" && !fa.scheme) {
        fa.scheme = OFF_SCHEMES[rangeInt(stream(state.seed, "oc-scheme", fa.id), 0, OFF_SCHEMES.length - 1)];
      } else if (role === "DC" && !fa.scheme) {
        fa.scheme = DEF_SCHEMES[rangeInt(stream(state.seed, "dc-scheme", fa.id), 0, DEF_SCHEMES.length - 1)];
      }
    }
  }

  // Keep the free-agent pool stocked — and pruned (50-year hygiene).
  while (freeAgents(state).length < 15) {
    state.coaches.push(genCoach(state, "HC", rangeInt(rng, 48, 72), null));
  }
  const pool = freeAgents(state);
  if (pool.length > 40) {
    const drop = new Set(pool.slice(40).map((c) => c.id));
    state.coaches = state.coaches.filter((c) => !drop.has(c.id));
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
// User staff management (M1.7) — fire → browse the market → hire, offseason-only
// ---------------------------------------------------------------------------

/** Fire one of your coordinators/staff (never your own HC seat). */
export function fireCoach(state: DynastyState, coachId: number): string | null {
  if (state.phase !== "offseason") return "Staff moves happen in the offseason";
  const c = state.coaches.find((x) => x.id === coachId);
  if (!c || c.tid !== state.userTid) return "Not on your staff";
  if (c.role === "HC") return "That's your seat — you can't fire yourself";
  c.tid = null;
  pushNews(state, `📋 You parted ways with ${ROLE_LABELS[c.role]} ${c.name}.`);
  return null;
}

/** Hire a free agent into an empty staff slot. Salary comes out of the pool. */
export function hireCoach(state: DynastyState, coachId: number, role: CoachRole): string | null {
  if (state.phase !== "offseason") return "Staff moves happen in the offseason";
  if (role === "HC") return "You are the head coach";
  const c = state.coaches.find((x) => x.id === coachId);
  if (!c || c.tid !== null) return "Not on the market";
  if (staffOf(state, state.userTid)[role]) return `You already employ a ${ROLE_LABELS[role]}`;
  const user = state.teams[state.userTid];
  const salary = coachSalary(c);
  if (user.nilBudget < salary) return `Can't cover the ${fmtSalary(salary)} salary`;
  c.tid = state.userTid;
  c.role = role;
  c.lastW = [];
  if (role === "OC" && !c.scheme) {
    c.scheme = OFF_SCHEMES[rangeInt(stream(state.seed, "oc-scheme", c.id), 0, OFF_SCHEMES.length - 1)];
  } else if (role === "DC" && !c.scheme) {
    c.scheme = DEF_SCHEMES[rangeInt(stream(state.seed, "dc-scheme", c.id), 0, DEF_SCHEMES.length - 1)];
  }
  user.nilBudget -= salary; // first year's salary leaves the pool on signing
  pushNews(state, `📋 You hired ${c.name} (${c.rating} OVR ${ARCHETYPE_LABELS[c.archetype]}) as ${ROLE_LABELS[role]}.`);
  return null;
}

/** The hiring market: free agents, best first. */
export function coachMarket(state: DynastyState): Coach[] {
  return freeAgents(state);
}

function fmtSalary(n: number): string {
  return n >= 1_000_000 ? `$${(n / 1_000_000).toFixed(1)}M` : `$${Math.round(n / 1000)}k`;
}

// ---------------------------------------------------------------------------
// Booster mandates
// ---------------------------------------------------------------------------

export const BOOSTER_LABELS = ["The Old Guard", "New Money", "The Win-Now Syndicate"];

export function genMandates(state: DynastyState): void {
  const user = state.teams[state.userTid];
  const rng = stream(state.seed, "mandates", state.season, state.userTid);
  const mandates: Mandate[] = [];
  const winTarget = clamp(
    user.prevW + (user.boosterType === 2 ? 2 : 1) + (state.difficulty >= 2 ? 1 : 0),
    6,
    11,
  );

  // 1) Conference mandate — always eligible each season (M1.8 acceptance).
  if (user.prestige >= 4) {
    mandates.push({ kind: "win-conf", text: `Win the ${user.conference}`, target: 0, met: null });
  } else {
    mandates.push({ kind: "conf-top2", text: `Finish top 2 in the ${user.conference}`, target: 0, met: null });
  }

  // 2) Rivalry mandate when a rival is on the slate; else a program floor.
  const rival = (user.rivals ?? []).find((r) =>
    state.schedule.some(
      (g) => (g.home === state.userTid && g.away === r) || (g.away === state.userTid && g.home === r),
    ),
  );
  if (rival !== undefined) {
    if ((user.rivals?.length ?? 0) >= 2 && rng() < 0.35) {
      mandates.push({ kind: "sweep-rivals", text: "Sweep your rivalry games", target: 0, met: null });
    } else {
      mandates.push({ kind: "beat-rival", text: `Beat ${state.teams[rival].school}`, target: rival, met: null });
    }
  } else {
    mandates.push({ kind: "wins", text: `Win at least ${winTarget} games`, target: winTarget, met: null });
  }

  // 3) A scaled third mandate, drawn to fit the program's expectations.
  if (rng() < 0.85) {
    const pool: Mandate[] = [];
    if (user.prestige >= 5) {
      pool.push({ kind: "win-title", text: "Win the national championship", target: 0, met: null });
      pool.push({ kind: "cfp", text: "Make the College Football Playoff", target: 0, met: null });
      pool.push({ kind: "heisman", text: "Produce a Heisman finalist", target: 0, met: null });
    } else if (user.prestige >= 3) {
      pool.push({ kind: "cfp", text: "Make the College Football Playoff", target: 0, met: null });
      pool.push({ kind: "reach-semi", text: "Reach the CFP semifinal", target: 0, met: null });
      pool.push({ kind: "class", text: "Sign a top-15 recruiting class", target: 15, met: null });
      pool.push({ kind: "develop90", text: "Develop a player to 90+ overall", target: 90, met: null });
      pool.push({ kind: "beat-ranked", text: "Beat a top-10 team", target: 0, met: null });
    } else {
      pool.push({ kind: "wins", text: `Win at least ${winTarget} games`, target: winTarget, met: null });
      pool.push({ kind: "improve", text: "Improve on last year's win total", target: user.prevW, met: null });
      pool.push({ kind: "class", text: "Sign a top-25 recruiting class", target: 25, met: null });
      pool.push({ kind: "lead-scoring", text: `Lead the ${user.conference} in scoring`, target: 0, met: null });
    }
    pool.push({ kind: "sign-5stars", text: "Sign a 5-star recruit", target: 1, met: null });
    pool.push({ kind: "land-transfer", text: "Land a transfer-portal addition", target: 0, met: null });
    const pick = pool[rangeInt(rng, 0, pool.length - 1)];
    if (!mandates.some((m) => m.kind === pick.kind)) mandates.push(pick);
  }
  state.mandates = mandates;
}

/** Evaluate at finishOffseason; returns the NIL multiplier for next cycle. */
export function evalMandates(state: DynastyState, classRank: number): number {
  const user = state.teams[state.userTid];
  const honors = state.honors[state.honors.length - 1];
  const cfp = state.cfp;
  const top10 = new Set(state.poll.slice(0, 10).map((e) => e.tid));
  const userWonVs = (tid: number) =>
    state.results.some((r) => {
      const uh = r.home === state.userTid && r.away === tid && r.hs > r.as;
      const ua = r.away === state.userTid && r.home === tid && r.as > r.hs;
      return uh || ua;
    });
  for (const m of state.mandates) {
    switch (m.kind) {
      case "wins": m.met = user.rec.w >= m.target; break;
      case "improve": m.met = user.rec.w > m.target; break;
      case "develop90": m.met = user.roster.some((pid) => state.players[pid].ovr >= 90); break;
      case "beat-ranked":
        m.met = state.results.some((r) => {
          const uh = r.home === state.userTid && r.hs > r.as && top10.has(r.away);
          const ua = r.away === state.userTid && r.as > r.hs && top10.has(r.home);
          return uh || ua;
        });
        break;
      case "beat-rival": m.met = userWonVs(m.target); break;
      case "sweep-rivals": {
        const played = (user.rivals ?? []).filter((r) =>
          state.results.some((g) => (g.home === state.userTid && g.away === r) || (g.away === state.userTid && g.home === r)),
        );
        m.met = played.length > 0 && played.every(userWonVs);
        break;
      }
      case "win-conf": m.met = honors?.userCcg ?? false; break;
      case "conf-top2":
        m.met = confStandings(state.teams, user.conference).slice(0, 2).some((t) => t.id === state.userTid);
        break;
      case "cfp": m.met = cfp?.field.includes(state.userTid) ?? false; break;
      case "reach-semi":
        m.met = cfp?.results.some((r) => r.kind === "cfp-sf" && (r.home === state.userTid || r.away === state.userTid)) ?? false;
        break;
      case "win-title": m.met = cfp?.champion === state.userTid; break;
      case "class": m.met = classRank <= m.target; break;
      case "sign-5stars": m.met = (state.offseason?.signees.filter((s) => s.stars >= 5).length ?? 0) >= m.target; break;
      case "land-transfer": m.met = state.portalLog.some((l) => l.startsWith("IN:")); break;
      case "heisman": m.met = honors?.poy?.includes(`(${user.school})`) ?? false; break;
      case "lead-scoring": {
        const conf = state.teams.filter((t) => t.p4 && t.conference === user.conference);
        m.met = user.rec.pf >= Math.max(...conf.map((t) => t.rec.pf));
        break;
      }
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
