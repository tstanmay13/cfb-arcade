// The minimal v1.0 offseason (CFB_GM_DESIGN roadmap): honors → career
// archival → graduation + NFL draft → ceiling progression → auto recruiting
// classes → attrition/cuts to the 85 cap → prestige drift. Returns the
// user-facing report; departed players ride along for the history store.

import type {
  ArchivedPlayer, DepartureLine, DynastyState, OffseasonReport, Player, Team,
} from "./types.ts";
import { stream } from "./streams.ts";
import { playerOfTheYear } from "./awards.ts";
import { emptyStats } from "./player.ts";
import { declaresForDraft, facilityMult, progressPlayer } from "./progression.ts";
import { generateClasses } from "./recruits.ts";

export const ROSTER_CAP = 85;

function archive(p: Player, tid: number, reason: DepartureLine["reason"]): ArchivedPlayer {
  return {
    name: p.name, pos: p.pos, ovr: p.ovr, stars: p.stars, cls: p.cls,
    tid, reason, career: p.career,
  };
}

export function runOffseason(state: DynastyState, championTid: number | null): OffseasonReport {
  const rng = stream(state.seed, "offseason", state.season);
  const user = state.teams[state.userTid];
  const departures: DepartureLine[] = [];
  const archived: ArchivedPlayer[] = [];

  // --- Honors (uses this season's stats before they're archived) -----------
  const poy = playerOfTheYear(state);
  const userRank = state.poll.findIndex((e) => e.tid === state.userTid);
  state.honors.push({
    season: state.season,
    champion: championTid,
    poy: poy ? `${poy.player.name} (${state.teams[poy.tid].school}) — ${poy.line}` : null,
    userRecord: `${user.rec.w}-${user.rec.l}`,
    userPollRank: userRank >= 0 ? userRank + 1 : null,
  });

  // --- Archive the season into careers, reset stat lines --------------------
  for (const team of state.teams) {
    for (const pid of team.roster) {
      const p = state.players[pid];
      p.career.push({ ...p.stats, season: state.season, cls: p.cls, ovr: p.ovr });
      p.stats = emptyStats();
      p.inj = 0;
    }
  }

  // --- Departures: graduation + NFL draft -----------------------------------
  const draftPool: { p: Player; tid: number }[] = [];
  for (const team of state.teams) {
    if (!team.p4) continue;
    for (const pid of [...team.roster]) {
      const p = state.players[pid];
      if (p.cls >= 3) draftPool.push({ p, tid: team.id });
    }
  }
  draftPool.sort((a, b) => b.p.ovr - a.p.ovr);
  const depart = (p: Player, team: Team, reason: DepartureLine["reason"]) => {
    team.roster = team.roster.filter((id) => id !== p.id);
    delete state.players[p.id];
    archived.push(archive(p, team.id, reason));
    if (team.id === state.userTid) {
      departures.push({ name: p.name, pos: p.pos, ovr: p.ovr, reason });
    }
  };
  draftPool.forEach(({ p, tid }, i) => {
    const team = state.teams[tid];
    if (p.cls >= 4) {
      depart(p, team, "graduated");
    } else if (declaresForDraft(i + 1, stream(state.seed, "draft", state.season, p.id))) {
      depart(p, team, "nfl-draft");
    }
  });

  // --- Progression toward ceilings + class advance --------------------------
  const risers: OffseasonReport["risers"] = [];
  for (const team of state.teams) {
    if (!team.p4) continue;
    const fac = facilityMult(team.prestige);
    for (const pid of team.roster) {
      const p = state.players[pid];
      const from = p.ovr;
      progressPlayer(p, fac, stream(state.seed, "prog", state.season, pid));
      p.cls += 1;
      if (team.id === state.userTid && p.ovr - from >= 4) {
        risers.push({ name: p.name, pos: p.pos, from, to: p.ovr });
      }
    }
  }
  risers.sort((a, b) => b.to - b.from - (a.to - a.from)).splice(8);

  // --- Attrition out the bottom (closed-universe exit valve) ----------------
  for (const team of state.teams) {
    if (!team.p4) continue;
    let leavers = 0;
    for (const pid of [...team.roster]) {
      if (leavers >= 3) break;
      const p = state.players[pid];
      if (p.cls >= 2 && p.cls <= 4 && p.ovr < 58 && p.dev < 45) {
        depart(p, team, "transfer-down");
        leavers++;
      }
    }
  }

  // --- Recruiting classes (prestige gravity, auto for everyone in v1.0) -----
  const needs = new Map<number, number>();
  for (const team of state.teams) {
    if (!team.p4) continue;
    needs.set(team.id, Math.max(0, ROSTER_CAP - team.roster.length));
  }
  const classes = generateClasses(state.teams, needs, state.nextPid, state.seed, rng);
  const signees: OffseasonReport["signees"] = [];
  for (const [tid, players] of classes.byTeam) {
    const team = state.teams[tid];
    for (const p of players) {
      state.players[p.id] = p;
      team.roster.push(p.id);
      state.nextPid = Math.max(state.nextPid, p.id + 1);
      if (tid === state.userTid) {
        signees.push({ name: p.name, pos: p.pos, stars: p.stars, ovr: p.ovr });
      }
    }
  }
  signees.sort((a, b) => b.stars - a.stars || b.ovr - a.ovr);
  const classRank =
    1 +
    [...classes.points.entries()]
      .sort((a, b) => b[1] - a[1])
      .findIndex(([tid]) => tid === state.userTid);

  // --- Hard cap: cut the lowest-value overflow -------------------------------
  for (const team of state.teams) {
    if (!team.p4 || team.roster.length <= ROSTER_CAP) continue;
    const byValue = [...team.roster].sort((x, y) => {
      const px = state.players[x];
      const py = state.players[y];
      return px.ovr + (4 - px.cls) * 2 - (py.ovr + (4 - py.cls) * 2);
    });
    while (team.roster.length > ROSTER_CAP) {
      const pid = byValue.shift()!;
      depart(state.players[pid], team, "cut");
    }
  }

  // --- Prestige drift --------------------------------------------------------
  const prestigeChanges: OffseasonReport["prestigeChanges"] = [];
  for (const team of state.teams) {
    if (!team.p4) continue;
    const from = team.prestige;
    if (team.id === championTid) team.prestige = Math.min(6, team.prestige + 2);
    else if (team.rec.w >= 10) team.prestige = Math.min(6, team.prestige + 1);
    else if (team.rec.w <= 4) team.prestige = Math.max(1, team.prestige - 1);
    if (team.prestige !== from) {
      prestigeChanges.push({ school: team.school, from, to: team.prestige });
    }
  }

  return {
    season: state.season,
    departures,
    archive: archived,
    signees,
    risers,
    prestigeChanges,
    classRank,
  };
}
