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
import { clamp, stream } from "./streams.ts";
import { playerOfTheYear } from "./awards.ts";
import { emptyStats } from "./player.ts";
import { declaresForDraft, facilityMult, progressPlayer } from "./progression.ts";
import { STAR_POINTS } from "./recruits.ts";
import { lateSigningPeriod, recruitToPlayer, teamNeeds, walkOns } from "./recruiting.ts";
import { selectLineup } from "./lineup.ts";
import { marketValue, nextBudget, fmtMoney } from "./nil.ts";
import { updateRecords } from "./records.ts";
import { coachCarousel, devBonus, evalMandates } from "./coaches.ts";

export const ROSTER_CAP = 85;
const PORTAL_ROUNDS = 3;

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
      if (best.tid === state.userTid) {
        pushNews(state, `🎖️ ${best.p.name} named first-team All-American.`);
        best.p.morale = clamp(best.p.morale + 5, 0, 100);
      }
    }
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
  const userRank = state.poll.findIndex((e) => e.tid === state.userTid);
  state.honors.push({
    season: state.season,
    champion: championTid,
    poy: poy ? `${poy.player.name} (${state.teams[poy.tid].school}) — ${poy.line}` : null,
    userRecord: `${user.rec.w}-${user.rec.l}`,
    userPollRank: userRank >= 0 ? userRank + 1 : null,
    allAmericans: allAmericans(state),
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
      // Redshirt rule (v1.4): ≤4 games played banks the year, once.
      const gpLastSeason = p.career[p.career.length - 1]?.gp ?? 0;
      if (!p.rs && gpLastSeason <= 4 && p.cls <= 3) {
        p.rs = true;
      } else {
        p.cls += 1;
      }
      if (team.id === state.userTid && p.ovr - from >= 4) {
        report.risers.push({ name: p.name, pos: p.pos, from, to: p.ovr });
      }
    }
  }
  report.risers.sort((a, b) => b.to - b.from - (a.to - a.from)).splice(8);

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
      if (flight < 55 && !benchOut) continue;
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
  state.offStage = "retention";
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
    if (paid && rng() < 0.6 + p.loyalty / 200) {
      user.nilBudget -= c.ask;
      p.nil = c.ask;
      p.morale = clamp(p.morale + 25, 0, 100);
      state.portalLog.push(`STAY: ${p.pos} ${p.name} (${p.ovr}) re-signed for ${fmtMoney(c.ask)}`);
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
  state.offStage = "portal";
}

export interface PortalOffer {
  pid: number;
  amount: number;
}

/** Stage 3 (×3): one bidding round. User offers compete under the same rules. */
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
    }
    const bids: Bid[] = [];

    const userOffer = userOffers.find((o) => o.pid === entry.pid);
    if (
      userOffer &&
      userOffer.amount >= entry.ask * 0.9 && // the PRD's 90%-of-valuation rule
      userOffer.amount <= user.nilBudget &&
      user.roster.length < ROSTER_CAP + 5
    ) {
      bids.push({
        tid: state.userTid,
        amount: userOffer.amount,
        utility: userOffer.amount * (1 + user.prestige * 0.04),
      });
    }

    // A seeded sample of AI programs evaluates each portal player.
    const sampleSize = 8;
    for (let i = 0; i < sampleSize; i++) {
      const team = state.teams[Math.floor(rng() * 68)];
      if (!team?.p4 || team.id === state.userTid || team.id === entry.fromTid) continue;
      if (team.roster.length >= ROSTER_CAP || team.nilBudget < entry.ask) continue;
      const need = teamNeeds(state, team).get(p.g) ?? 0;
      if (need <= 0 && p.ovr < 80 && rng() > 0.2) continue;
      const amount = Math.min(team.nilBudget, Math.round((entry.ask * (0.95 + rng() * 0.35)) / 500) * 500);
      if (amount < entry.ask * 0.9) continue;
      bids.push({
        tid: team.id,
        amount,
        utility: amount * (1 + team.prestige * 0.04) * (1 + need * 0.03) * (0.9 + rng() * 0.2),
      });
    }

    if (bids.length === 0) {
      remaining.push(entry);
      continue;
    }
    bids.sort((a, b) => b.utility - a.utility);
    const win = bids[0];
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
    finishOffseason(state);
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
    const mult = team.id === state.userTid ? mandateMult : 1;
    team.nilBudget = Math.round(nextBudget(team.prestige, team.rec.w, team.id === championTid) * mult);
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
