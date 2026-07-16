// The offseason (v1.2 — interactive stages, CFB_GM_DESIGN "Season calendar"):
//   stage 1  runOffseason: honors/All-America → careers → morale → graduation
//            + NFL draft (with rounds) → progression → retention cases + AI
//            retention → portal pool
//   stage 2  resolveRetention(user picks)
//   stage 3  submitPortalRound ×3 (user offers + AI bids, same rules)
//   stage 4  finishOffseason: signing day classes → cuts → prestige drift →
//            next NIL budgets → record books
// The user-facing report accumulates across stages; departed players ride in
// report.archive and persist to the history store at rollover.

import type {
  ArchivedPlayer, DepartureLine, DynastyState, OffseasonReport, Player, PortalEntry, Team,
} from "./types.ts";
import { clamp, rangeInt, stream } from "./streams.ts";
import { playerOfTheYear } from "./awards.ts";
import { emptyStats } from "./player.ts";
import { declaresForDraft, facilityMult, progressPlayer } from "./progression.ts";
import { STAR_POINTS } from "./recruits.ts";
import {
  generateRecruitPool, lateSigningPeriod, offseasonRecruitingTick, recruitToPlayer,
  RECRUIT_POOL, signingDay, staminaMax, teamNeeds, walkOns,
} from "./recruiting.ts";
import { selectLineup } from "./lineup.ts";
import { marketValue, nextBudget, fmtMoney } from "./nil.ts";
import { updateRecords } from "./records.ts";
import { coachCarousel, devBonus, evalMandates, staffBill } from "./coaches.ts";

export const ROSTER_CAP = 85;
/** Five portal rounds mapped onto offseason weeks 3-7 (M1.3). */
export const PORTAL_ROUNDS = 5;
/** Offseason length in explicit user-turn weeks (M0.1). */
export const OFFSEASON_WEEKS = 8;
/**
 * Baseline annual portal-entry rate by star tier (M1.3). Layered ON TOP of the
 * morale/loyalty flight-risk model: churn concentrates at the bottom, a handful
 * of blue-chips move each year, not a mass 4-star exodus. Lands league churn in
 * the design's ~15-25%/year band.
 */
const STAR_CHURN: Record<number, number> = { 2: 0.3, 3: 0.22, 4: 0.15, 5: 0.08 };

function archive(p: Player, tid: number, reason: DepartureLine["reason"]): ArchivedPlayer {
  return {
    name: p.name, pos: p.pos, ovr: p.ovr, stars: p.stars, cls: p.cls,
    tid, reason, career: p.career,
  };
}

function pushNews(state: DynastyState, text: string): void {
  state.news.unshift({ season: state.season, week: state.week, text });
  state.news.splice(60);
}

function depart(
  state: DynastyState,
  report: OffseasonReport,
  p: Player,
  team: Team,
  reason: DepartureLine["reason"],
  detail?: string,
): ArchivedPlayer {
  team.roster = team.roster.filter((id) => id !== p.id);
  delete state.players[p.id];
  const a = archive(p, team.id, reason);
  report.archive.push(a);
  if (team.id === state.userTid) {
    report.departures.push({ name: p.name, pos: p.pos, ovr: p.ovr, reason, detail });
  }
  return a;
}

const AA_GROUPS = ["QB", "RB", "WR", "TE", "DL", "LB", "CB", "S", "K"] as const;

function statValue(p: Player): number {
  const s = p.stats;
  return (
    s.paYd * 0.04 + s.paTD * 6 - s.paInt * 4 + s.ruYd * 0.09 + s.ruTD * 6 +
    s.reYd * 0.09 + s.reTD * 6 + s.sck * 7 + s.int * 8 + s.tkl * 0.3 + s.fgm * 3
  );
}

function allAmericans(state: DynastyState): string[] {
  const out: string[] = [];
  for (const g of AA_GROUPS) {
    let best: { p: Player; tid: number; v: number } | null = null;
    for (const team of state.teams) {
      if (!team.p4) continue;
      for (const pid of team.roster) {
        const p = state.players[pid];
        if (p.g !== g) continue;
        const v = statValue(p);
        if (!best || v > best.v) best = { p, tid: team.id, v };
      }
    }
    if (best) {
      out.push(`${g} ${best.p.name} (${state.teams[best.tid].school})`);
      (best.p.accolades ??= []).push({ season: state.season, award: "First-team All-American" });
      if (best.tid === state.userTid) {
        pushNews(state, `🎖️ ${best.p.name} named first-team All-American.`);
        best.p.morale = clamp(best.p.morale + 5, 0, 100);
      }
    }
  }
  return out;
}

/** First-team all-conference: top stat player per group per conference. */
function allConference(state: DynastyState): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  const confs = new Set(state.teams.filter((t) => t.p4).map((t) => t.conference));
  for (const conf of confs) {
    const list: string[] = [];
    for (const g of AA_GROUPS) {
      let best: { p: Player; tid: number; v: number } | null = null;
      for (const team of state.teams) {
        if (!team.p4 || team.conference !== conf) continue;
        for (const pid of team.roster) {
          const p = state.players[pid];
          if (p.g !== g) continue;
          const v = statValue(p);
          if (!best || v > best.v) best = { p, tid: team.id, v };
        }
      }
      if (best) {
        list.push(`${g} ${best.p.name} (${state.teams[best.tid].school})`);
        (best.p.accolades ??= []).push({ season: state.season, award: `First-team All-${conf}` });
      }
    }
    out[conf] = list;
  }
  const userConf = state.teams[state.userTid].conference;
  const mine = (out[userConf] ?? []).filter((s) => s.includes(`(${state.teams[state.userTid].school})`)).length;
  if (mine > 0) {
    pushNews(state, `🎖️ ${mine} of yours named first-team All-${userConf}.`);
  }
  return out;
}

/** Stage 1: everything up to the interactive decisions. */
export function runOffseason(state: DynastyState, championTid: number | null): OffseasonReport {
  const user = state.teams[state.userTid];

  const report: OffseasonReport = {
    season: state.season,
    departures: [],
    archive: [],
    signees: [],
    risers: [],
    droppers: [],
    prestigeChanges: [],
    classRank: 0,
  };
  state.offseason = report;
  state.retention = [];
  state.portal = [];
  state.portalRound = 1;
  state.portalLog = [];

  // --- Honors ----------------------------------------------------------------
  const poy = playerOfTheYear(state);
  if (poy) (poy.player.accolades ??= []).push({ season: state.season, award: "Player of the Year" });
  const userRank = state.poll.findIndex((e) => e.tid === state.userTid);
  state.honors.push({
    season: state.season,
    champion: championTid,
    poy: poy ? `${poy.player.name} (${state.teams[poy.tid].school}) — ${poy.line}` : null,
    userRecord: `${user.rec.w}-${user.rec.l}`,
    userPollRank: userRank >= 0 ? userRank + 1 : null,
    allAmericans: allAmericans(state),
    allConf: allConference(state),
    userCcg: state.results.some(
      (r) =>
        r.kind === "ccg" &&
        ((r.home === state.userTid && r.hs > r.as) || (r.away === state.userTid && r.as > r.hs)),
    ),
    userCfp: state.cfp?.field.includes(state.userTid) ?? false,
  });

  // --- Morale (before careers reset; uses this season's context) --------------
  for (const team of state.teams) {
    if (!team.p4) continue;
    const starters = new Set(
      Object.values(selectLineup(team.roster.map((pid) => state.players[pid])))
        .flatMap((players) => players ?? [])
        .map((p) => p.id),
    );
    for (const pid of team.roster) {
      const p = state.players[pid];
      let m = p.morale + (58 - p.morale) * 0.25; // drift home
      if (team.rec.w >= 10) m += 10;
      if (team.rec.w <= 4) m -= 15;
      if (team.id === championTid) m += 15;
      if (!starters.has(pid) && p.ovr >= 78) m -= 25;
      else if (!starters.has(pid) && p.ovr >= 70) m -= 10;
      if (p.ovr >= 75 && p.nil < marketValue(p) / 2) m -= 20;
      p.morale = clamp(Math.round(m), 0, 100);
    }
  }

  // --- Archive careers, reset stat lines --------------------------------------
  for (const team of state.teams) {
    for (const pid of team.roster) {
      const p = state.players[pid];
      p.career.push({ ...p.stats, season: state.season, cls: p.cls, ovr: p.ovr });
      p.stats = emptyStats();
      p.inj = 0;
    }
  }

  // --- Graduation + NFL draft declarations ------------------------------------
  const draftPool: { p: Player; tid: number }[] = [];
  for (const team of state.teams) {
    if (!team.p4) continue;
    for (const pid of [...team.roster]) {
      const p = state.players[pid];
      if (p.cls >= 3) draftPool.push({ p, tid: team.id });
    }
  }
  draftPool.sort((a, b) => b.p.ovr - a.p.ovr);
  const departedForDraft: { a: ArchivedPlayer; line: DepartureLine | null }[] = [];
  draftPool.forEach(({ p, tid }, i) => {
    const team = state.teams[tid];
    if (p.cls >= 4) {
      const a = depart(state, report, p, team, "graduated");
      if (p.ovr >= 74) departedForDraft.push({ a, line: null });
    } else if (declaresForDraft(i + 1, stream(state.seed, "draft", state.season, p.id))) {
      const a = depart(state, report, p, team, "nfl-draft");
      departedForDraft.push({ a, line: report.departures[report.departures.length - 1] ?? null });
    }
  });
  // Assign draft slots: 7 rounds × 32 picks by overall.
  departedForDraft
    .sort((x, y) => y.a.ovr - x.a.ovr)
    .forEach(({ a, line }, i) => {
      if (i >= 224) return;
      const round = Math.floor(i / 32) + 1;
      const pick = i + 1;
      a.draft = { round, pick };
      if (line && a.tid === state.userTid) line.detail = `Rd ${round}, #${pick}`;
      if (round === 1) {
        pushNews(state, `🏈 ${a.name} (${state.teams[a.tid].school}) goes Round 1, pick ${pick}.`);
      }
    });

  // --- Progression toward ceilings + class advance -----------------------------
  for (const team of state.teams) {
    if (!team.p4) continue;
    const fac = facilityMult(team.prestige) + devBonus(state, team.id);
    for (const pid of team.roster) {
      const p = state.players[pid];
      const from = p.ovr;
      progressPlayer(p, fac, stream(state.seed, "prog", state.season, pid));
      // Veteran plateau-decline (M1.6): peaked, low-ceiling upperclassmen slip a
      // little — the source of the recap's "Biggest Droppers". Small + gated so
      // it doesn't move league OVR (the 50-year soak gates this).
      if (p.cls >= 3 && p.devTier === 0 && p.ovr >= p.ceil - 2) {
        const dRng = stream(state.seed, "decline", state.season, pid);
        if (dRng() < 0.35) {
          const drop = rangeInt(dRng, 1, 3);
          p.ovr = clamp(p.ovr - drop, 40, 99);
          for (const k of Object.keys(p.attrs)) p.attrs[k] = clamp(p.attrs[k] - drop, 40, 99);
        }
      }
      // Redshirt rule (v1.4): ≤4 games played banks the year, once.
      const gpLastSeason = p.career[p.career.length - 1]?.gp ?? 0;
      if (!p.rs && gpLastSeason <= 4 && p.cls <= 3) {
        p.rs = true;
      } else {
        p.cls += 1;
      }
      if (team.id === state.userTid) {
        if (p.ovr - from >= 4) report.risers.push({ name: p.name, pos: p.pos, from, to: p.ovr });
        else if (from - p.ovr >= 1) report.droppers.push({ name: p.name, pos: p.pos, from, to: p.ovr });
      }
    }
  }
  report.risers.sort((a, b) => b.to - b.from - (a.to - a.from)).splice(8);
  report.droppers.sort((a, b) => a.to - a.from - (b.to - b.from)).splice(8);

  // --- Flight risk → retention cases (user) / instant AI resolution ------------
  for (const team of state.teams) {
    if (!team.p4) continue;
    let benchExits = 0;
    // Depth-chart rank: players buried past the two-deep chase snaps elsewhere.
    const byOvr = [...team.roster].sort((a, b) => state.players[b].ovr - state.players[a].ovr);
    const buried = new Set(byOvr.slice(48)); // beyond the two-deep (post-departure roster)
    for (const pid of [...team.roster]) {
      const p = state.players[pid];
      const frRng = stream(state.seed, "flight", state.season, pid);
      const flight = 100 - p.morale - p.loyalty / 2 + (frRng() * 20 - 10);
      const benchOut =
        buried.has(pid) && p.cls >= 2 && p.cls <= 3 && benchExits < 6 && frRng() < 0.4;
      // Tier-based baseline churn (M1.3): even content players move at a rate set
      // by their star tier, so the portal has real volume every year.
      const churnOut = p.cls <= 3 && frRng() < (STAR_CHURN[p.stars] ?? 0.2);
      if (flight < 55 && !benchOut && !churnOut) continue;
      if (benchOut) benchExits++;
      const ask = Math.round((marketValue(p) * (p.ovr >= 76 ? 1.2 : 0.8)) / 500) * 500;
      if (team.id === state.userTid && p.ovr >= 68 && !benchOut) {
        state.retention.push({
          pid,
          ask,
          reason:
            p.ovr >= 80 && p.nil < marketValue(p) / 2
              ? "wants a market NIL deal"
              : p.morale <= 35
                ? "unhappy with the program's direction"
                : "hearing from other programs",
        });
      } else if (!benchOut && p.ovr >= 76 && team.nilBudget >= ask && frRng() < 0.7) {
        // AI retains its stars when it can afford to.
        team.nilBudget -= ask;
        p.nil = ask;
        p.morale = clamp(p.morale + 20, 0, 100);
      } else {
        team.roster = team.roster.filter((id) => id !== pid);
        state.portal.push({ pid, fromTid: team.id, ask });
        if (team.id === state.userTid) {
          report.departures.push({ name: p.name, pos: p.pos, ovr: p.ovr, reason: "portal" });
          state.portalLog.push(`OUT: ${p.pos} ${p.name} (${p.ovr}) entered the portal`);
        }
      }
    }
  }
  state.retention.sort((a, b) => state.players[b.pid].ovr - state.players[a.pid].ovr).splice(12);
  state.portal.sort((a, b) => state.players[b.pid].ovr - state.players[a.pid].ovr);
  // The offseason is now an 8-week calendar (M0.1): week 1 is the report, and
  // recruiting opens here (the pool is an offseason artifact). Retention becomes
  // actionable in week 2, the portal runs weeks 3-7, signing day is week 8.
  generateRecruitPool(state, RECRUIT_POOL);
  state.offWeek = 1;
  state.offStage = "report";
  state.stamina = staminaMax(state);
  return report;
}

/** Stage 2: user retention decisions. Money is only spent on successes. */
export function resolveRetention(state: DynastyState, paidPids: number[]): void {
  if (state.offStage !== "retention") return;
  const user = state.teams[state.userTid];
  const report = state.offseason!;
  for (const c of state.retention) {
    const p = state.players[c.pid];
    if (!p) continue;
    const paid = paidPids.includes(c.pid) && user.nilBudget >= c.ask;
    const rng = stream(state.seed, "retain", state.season, c.pid);
    // A non-NIL courting effort (M1.4) adds a flat stay-odds bump on its own,
    // and stacks with a paid deal.
    const courtBonus = c.courted ? 0.25 : 0;
    const stay = paid
      ? rng() < 0.6 + p.loyalty / 200 + courtBonus
      : c.courted && rng() < 0.35 + p.loyalty / 200;
    if (stay) {
      if (paid) {
        user.nilBudget -= c.ask;
        p.nil = c.ask;
        state.portalLog.push(`STAY: ${p.pos} ${p.name} (${p.ovr}) re-signed for ${fmtMoney(c.ask)}`);
      } else {
        state.portalLog.push(`STAY: ${p.pos} ${p.name} (${p.ovr}) talked out of the portal`);
      }
      p.morale = clamp(p.morale + 25, 0, 100);
      pushNews(state, `🤝 ${p.name} spurns the portal and returns to ${user.school}.`);
    } else {
      user.roster = user.roster.filter((id) => id !== c.pid);
      state.portal.push({ pid: c.pid, fromTid: state.userTid, ask: c.ask });
      report.departures.push({ name: p.name, pos: p.pos, ovr: p.ovr, reason: "portal" });
      state.portalLog.push(`OUT: ${p.pos} ${p.name} (${p.ovr}) entered the portal`);
    }
  }
  state.retention = [];
  state.portal.sort((a, b) => state.players[b.pid].ovr - state.players[a.pid].ovr);
  state.portalRound = 1;
}

export interface PortalOffer {
  pid: number;
  amount: number;
}

/**
 * How well a program fits a portal player's (derived) desires, 0..1 (M1.3).
 * Fit comes from real program signals — title contention/prestige, positional
 * need (playing time), and being a ranked contender — rather than a stored
 * weighted profile. Fit discounts the ask (below) AND boosts commit utility, so
 * a great-fit school can beat a richer bad-fit school.
 */
export function portalFit(state: DynastyState, team: Team, g: string): number {
  const need = teamNeeds(state, team).get(g as never) ?? 0;
  const contender = state.poll.some((e) => e.tid === team.id) || team.prevW >= 9;
  const fit =
    Math.min(0.4, team.prestige * 0.07) + // prestige / title contention
    Math.min(0.35, need * 0.09) + // positional need = playing time
    (contender ? 0.15 : 0);
  return clamp(fit, 0, 1);
}

/** Effective ask after the fit discount: 40% max off, a 60%-of-ask floor (M1.3). */
export function effectiveAsk(ask: number, fit: number): number {
  return Math.round(ask * (1 - 0.4 * fit));
}

/** One portal bidding round (of five, M1.3). User offers compete under the same rules. */
export function submitPortalRound(state: DynastyState, userOffers: PortalOffer[]): void {
  if (state.offStage !== "portal") return;
  const rng = stream(state.seed, "portal", state.season, state.portalRound);
  const user = state.teams[state.userTid];
  const report = state.offseason!;
  const remaining: PortalEntry[] = [];

  for (const entry of state.portal) {
    const p = state.players[entry.pid];
    if (!p) continue;
    interface Bid {
      tid: number;
      amount: number;
      utility: number;
      fit: number;
    }
    const bids: Bid[] = [];

    const userOffer = userOffers.find((o) => o.pid === entry.pid);
    if (userOffer) {
      const uFit = portalFit(state, user, p.g);
      if (
        userOffer.amount >= effectiveAsk(entry.ask, uFit) && // fit-discounted ask, 60% floor
        userOffer.amount <= user.nilBudget &&
        user.roster.length < ROSTER_CAP + 5
      ) {
        bids.push({
          tid: state.userTid,
          amount: userOffer.amount,
          utility: userOffer.amount * (1 + user.prestige * 0.04) * (1 + uFit * 0.5),
          fit: uFit,
        });
      }
    }

    // A seeded sample of AI programs evaluates each portal player.
    const sampleSize = 8;
    for (let i = 0; i < sampleSize; i++) {
      const team = state.teams[Math.floor(rng() * 68)];
      if (!team?.p4 || team.id === state.userTid || team.id === entry.fromTid) continue;
      const fit = portalFit(state, team, p.g);
      const floor = effectiveAsk(entry.ask, fit);
      if (team.roster.length >= ROSTER_CAP || team.nilBudget < floor) continue;
      const need = teamNeeds(state, team).get(p.g) ?? 0;
      if (need <= 0 && p.ovr < 80 && rng() > 0.2) continue;
      const amount = Math.min(
        team.nilBudget,
        Math.round((floor * (1.0 + rng() * 0.3 + state.difficulty * 0.08)) / 500) * 500,
      );
      if (amount < floor) continue;
      bids.push({
        tid: team.id,
        amount,
        utility: amount * (1 + team.prestige * 0.04) * (1 + need * 0.03) * (1 + fit * 0.5) * (0.9 + rng() * 0.2),
        fit,
      });
    }

    if (bids.length === 0) {
      remaining.push(entry);
      continue;
    }
    bids.sort((a, b) => b.utility - a.utility);
    const win = bids[0];
    // Commit timing (M1.3): players take 2-4 rounds; a strong fit closes faster.
    const commitProb = clamp(0.22 + 0.17 * (state.portalRound - 1) + win.fit * 0.2, 0.2, 0.98);
    if (rng() > commitProb) {
      remaining.push(entry); // still being courted — no money moves until a commit
      continue;
    }
    const team = state.teams[win.tid];
    team.nilBudget -= win.amount;
    team.roster.push(p.id);
    p.nil = win.amount;
    p.morale = 70;
    if (win.tid === state.userTid) {
      state.portalLog.push(`IN: ${p.pos} ${p.name} (${p.ovr}) signed for ${fmtMoney(win.amount)}`);
      report.signees.push({ name: p.name, pos: p.pos, stars: p.stars, ovr: p.ovr });
    }
    if (p.ovr >= 84) {
      pushNews(state, `🌀 Portal splash: ${p.pos} ${p.name} (${p.ovr}) lands at ${team.school}.`);
    }
  }

  state.portal = remaining;
  state.portalRound += 1;
  if (state.portalRound > PORTAL_ROUNDS) {
    // Unclaimed portal players step down out of the P4.
    for (const entry of state.portal) {
      const p = state.players[entry.pid];
      if (!p) continue;
      report.archive.push(archive(p, entry.fromTid, "transfer-down"));
      delete state.players[entry.pid];
    }
    state.portal = [];
  }
}

/** Decisions the user can attach to a single offseason-week advance (M0.1). */
export interface OffseasonWeekInput {
  /** Retention week (2): flight-risk players to pay to keep. */
  paidPids?: number[];
  /** Portal weeks (3-7): NIL offers to make this round. */
  portalOffers?: PortalOffer[];
}

/**
 * Advance one offseason week (M0.1). The offseason is an explicit 8-week
 * calendar: week 1 report, week 2 retention, weeks 3-7 the five portal rounds,
 * week 8 signing day + close. Each call resolves the CURRENT week's interactive
 * decision, runs the AI recruiting tick, then rolls the calendar forward. With
 * no input (auto-sim) the week still resolves — the AI just gets its way.
 */
export function advanceOffseasonWeek(state: DynastyState, input: OffseasonWeekInput = {}): void {
  if (state.phase !== "offseason" || state.offStage === "done") return;

  if (state.offStage === "retention") {
    resolveRetention(state, input.paidPids ?? []);
  } else if (state.offStage === "portal") {
    submitPortalRound(state, input.portalOffers ?? []);
  } else if (state.offStage === "signing") {
    signingDay(state); // last-second flips + force fence-sitters
    finishOffseason(state); // enroll classes, cuts, prestige, budgets → "done"
    return;
  }

  // The 67 AI programs work their boards; commits fire; stamina refreshes.
  offseasonRecruitingTick(state);

  state.offWeek = Math.min(OFFSEASON_WEEKS, state.offWeek + 1);
  state.offStage =
    state.offWeek >= 8 ? "signing"
      : state.offWeek >= 3 ? "portal"
        : state.offWeek === 2 ? "retention"
          : "report";
}

/** Headless: run the whole offseason with no user input (auto-sim / harness). */
export function autoAdvanceOffseason(state: DynastyState): void {
  let guard = 0;
  while (state.phase === "offseason" && state.offStage !== "done" && guard++ < 20) {
    advanceOffseasonWeek(state);
  }
}

/** Stage 4: signing day intake, cuts, prestige, next budgets, record books. */
export function finishOffseason(state: DynastyState): void {
  const rng = stream(state.seed, "offseason-finish", state.season);
  const report = state.offseason!;
  const championTid = state.honors[state.honors.length - 1]?.champion ?? null;

  // Sign the committed class (recruiting, v1.1).
  const classPoints = new Map<number, number>();
  for (const r of state.recruits) {
    if (r.committed === null) continue;
    const team = state.teams[r.committed];
    if (team.roster.length >= ROSTER_CAP + 6) continue;
    const p = recruitToPlayer(r, state.nextPid++, state.seed);
    state.players[p.id] = p;
    team.roster.push(p.id);
    classPoints.set(team.id, (classPoints.get(team.id) ?? 0) + STAR_POINTS[r.stars]);
    if (team.id === state.userTid) {
      report.signees.push({ name: r.name, pos: r.pos, stars: r.stars, ovr: p.ovr });
    }
  }
  // Late signing period + walk-ons.
  const needs = new Map<number, number>();
  for (const team of state.teams) {
    if (team.p4) needs.set(team.id, Math.max(0, ROSTER_CAP - team.roster.length));
  }
  const late = lateSigningPeriod(state, needs, rng);
  for (const [tid, players] of late) {
    const team = state.teams[tid];
    for (const p of players) {
      state.players[p.id] = p;
      team.roster.push(p.id);
      if (tid === state.userTid) {
        report.signees.push({ name: p.name, pos: p.pos, stars: p.stars, ovr: p.ovr });
      }
    }
  }
  for (const team of state.teams) {
    if (!team.p4) continue;
    const short = ROSTER_CAP - team.roster.length;
    if (short <= 0) continue;
    for (const p of walkOns(state, short, rng)) {
      state.players[p.id] = p;
      team.roster.push(p.id);
      if (team.id === state.userTid) {
        report.signees.push({ name: p.name, pos: p.pos, stars: p.stars, ovr: p.ovr });
      }
    }
  }
  report.signees.sort((a, b) => b.stars - a.stars || b.ovr - a.ovr);
  const rankIdx = [...classPoints.entries()]
    .sort((a, b) => b[1] - a[1])
    .findIndex(([tid]) => tid === state.userTid);
  report.classRank = rankIdx >= 0 ? rankIdx + 1 : classPoints.size + 1;
  state.recruits = [];

  // Hard cap: cut the lowest-value overflow.
  for (const team of state.teams) {
    if (!team.p4 || team.roster.length <= ROSTER_CAP) continue;
    const byValue = [...team.roster].sort((x, y) => {
      const px = state.players[x];
      const py = state.players[y];
      return px.ovr + (4 - px.cls) * 2 - (py.ovr + (4 - py.cls) * 2);
    });
    while (team.roster.length > ROSTER_CAP) {
      const pid = byValue.shift()!;
      depart(state, report, state.players[pid], team, "cut");
    }
  }

  // Mandates + coaching carousel (v1.3), then prestige + next NIL budgets.
  const mandateMult = evalMandates(state, report.classRank);
  coachCarousel(state, championTid);
  for (const team of state.teams) {
    if (!team.p4) continue;
    const from = team.prestige;
    if (team.id === championTid) team.prestige = Math.min(6, team.prestige + 2);
    else if (team.rec.w >= 10) team.prestige = Math.min(6, team.prestige + 1);
    else if (team.rec.w <= 4) team.prestige = Math.max(1, team.prestige - 1);
    if (team.prestige !== from) {
      report.prestigeChanges.push({ school: team.school, from, to: team.prestige });
    }
    // Difficulty squeezes the user's collective, never the AI's.
    const diffMult = team.id === state.userTid ? 1 - state.difficulty * 0.15 : 1;
    const mult = (team.id === state.userTid ? mandateMult : 1) * diffMult;
    team.nilBudget = Math.round(nextBudget(team.prestige, team.rec.w, team.id === championTid) * mult);
    // Staff salaries come out of the same pool (M1.7) — a stud coordinator is
    // money the portal never sees. Capped so no program starts a cycle broke.
    const bill = Math.min(staffBill(state, team.id), Math.round(team.nilBudget * 0.35));
    team.nilBudget -= bill;
    if (team.id === state.userTid && team.rec.w <= 4) {
      pushNews(state, `💰 Boosters slash ${team.school}'s NIL pool after a ${team.rec.w}-win season.`);
    }
  }

  updateRecords(state, report.archive);
  state.offStage = "done";
}

/** Manual roster cut (offseason only) — returns the archive row to persist. */
export function cutPlayer(state: DynastyState, pid: number): ArchivedPlayer | null {
  if (state.phase !== "offseason") return null;
  const team = state.teams[state.userTid];
  if (!team.roster.includes(pid) || team.roster.length <= 60) return null;
  const p = state.players[pid];
  const a = depart(state, state.offseason!, p, team, "cut");
  return a;
}
