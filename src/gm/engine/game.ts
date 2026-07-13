// The drive engine (v1.4: steppable): Δ-table outcome resolution + seeded
// synthetic expansion. GameSim plays one drive at a time so watch-mode can
// pause for coaching input (tactics, QB spark swap); simGame() runs it
// wholesale for fast-sim. Pure — returns stat deltas instead of mutating
// players; the season loop applies them.

import type { Rng } from "../../engine/rng.ts";
import type { BoxLine, DriveLine, Player, SeasonStats, TeamGameTotals } from "./types.ts";
import { traitsFromLineup, type Lineup, type Traits } from "./lineup.ts";
import { clamp, rangeInt } from "./streams.ts";
import { emptyStats } from "./player.ts";

export interface SideInput {
  tid: number;
  school: string;
  traits: Traits;
  /** null for shell opponents (no player stats generated). */
  lineup: Lineup | null;
}

export interface SimOptions {
  neutral?: boolean;
  /** Late-season conference showdown boost for the underdog. */
  rivalry?: boolean;
  /** Elite home crowd debuffs the away offense. */
  hostileNoise?: boolean;
  /** Which side the user coaches (tactics apply to it). */
  userSide?: "home" | "away" | null;
}

/** Per-drive coaching toggles (watch mode). */
export interface Tactics {
  chew?: boolean;
  noHuddle?: boolean;
  blitz?: boolean;
}

export interface InjuryEvent {
  pid: number;
  weeks: number;
}

export interface SimOutcome {
  hs: number;
  as: number;
  ot: number;
  drives: DriveLine[];
  /** Per-player stat lines for this game (P4 sides only). */
  perStats: [number, SeasonStats][];
  box: BoxLine[];
  injuries: InjuryEvent[];
  star: string | null;
  totals: { h: TeamGameTotals; a: TeamGameTotals };
}

/** PRD drive-outcome table: Δ → [TD, FG-attempt, punt, turnover] in %. */
function baseProbs(delta: number): [number, number, number, number] {
  if (delta >= 20) return [65, 20, 10, 5];
  if (delta >= 10) return [45, 25, 20, 10];
  if (delta >= -5) return [25, 25, 35, 15];
  if (delta >= -15) return [15, 20, 45, 20];
  return [5, 15, 55, 25];
}

interface DriveResult {
  r: "TD" | "FG" | "FGX" | "PUNT" | "INT" | "FUM";
  yds: number;
  secs: number;
  passShare: number;
  fgDist?: number;
}

function resolveDrive(
  off: Traits,
  def: Traits,
  offMod: number,
  passShare: number,
  kacc: number,
  toShift: number,
  rng: Rng,
): DriveResult {
  const eo =
    passShare * off.airO + (1 - passShare) * off.gndO + offMod + (rng() * 30 - 15);
  const ed = passShare * def.airD + (1 - passShare) * def.gndD + (rng() * 30 - 15);
  const delta = eo - ed;

  let [pTD, pFG, pPunt, pTO] = baseProbs(delta);
  const havocEdge = def.havoc - off.prot;
  if (havocEdge > 0) {
    const stall = Math.min(12, havocEdge * 0.35);
    pTD -= stall;
    pPunt += stall;
    pTO += Math.min(4, havocEdge * 0.12);
  }
  const ballShift = clamp((def.hunt - off.sec) * 0.12, -5, 5) + toShift;
  pTO += ballShift;
  pPunt -= ballShift;
  pTD = Math.max(1, pTD);
  pFG = Math.max(1, pFG);
  pPunt = Math.max(1, pPunt);
  pTO = Math.max(1, pTO);

  const total = pTD + pFG + pPunt + pTO;
  let roll = rng() * total;
  let r: DriveResult["r"];
  if ((roll -= pTD) < 0) r = "TD";
  else if ((roll -= pFG) < 0) r = "FG";
  else if ((roll -= pPunt) < 0) r = "PUNT";
  else r = rng() < 0.55 ? "INT" : "FUM";

  const rzSwing = clamp((off.rzO - def.rzD) * 0.008, -0.18, 0.18);
  if (r === "TD" && rzSwing < 0 && rng() < -rzSwing) r = "FG";
  else if (r === "FG" && rzSwing > 0 && rng() < rzSwing) r = "TD";

  let yds: number;
  let fgDist: number | undefined;
  if (r === "TD") {
    yds = rangeInt(rng, 55, 85);
  } else if (r === "FG") {
    fgDist = rangeInt(rng, 22, 52);
    const make = clamp(1.02 - 0.011 * (fgDist - 20) + (kacc - 75) * 0.004, 0.35, 0.97);
    if (rng() >= make) r = "FGX";
    yds = 92 - fgDist - 17;
  } else if (r === "PUNT") {
    yds = rangeInt(rng, 3, 42);
  } else {
    yds = rangeInt(rng, 0, 45);
  }
  const secs = rangeInt(rng, 105, 215) - Math.round(passShare * 30);
  return { r, yds, secs, passShare, fgDist };
}

function wpick(weights: number[], rng: Rng): number {
  const total = weights.reduce((a, b) => a + b, 0);
  let roll = rng() * total;
  for (let i = 0; i < weights.length; i++) {
    roll -= weights[i];
    if (roll <= 0) return i;
  }
  return weights.length - 1;
}

class StatSheet {
  map = new Map<number, SeasonStats>();
  add(p: Player | undefined, k: keyof SeasonStats, v: number): void {
    if (!p || v === 0) return;
    let s = this.map.get(p.id);
    if (!s) {
      s = emptyStats();
      this.map.set(p.id, s);
    }
    s[k] += v;
  }
}

function attributeDrive(
  d: DriveResult,
  lu: Lineup,
  defLu: Lineup | null,
  sheet: StatSheet,
  defSheet: StatSheet,
  rng: Rng,
): string {
  const qb = lu.QB?.[0];
  const rbs = lu.RB ?? [];
  const wrs = lu.WR ?? [];
  const te = lu.TE?.[0];
  const passYds = Math.max(0, Math.round(d.yds * d.passShare * (0.85 + rng() * 0.4)));
  const rushYds = Math.max(0, d.yds - passYds);

  const cmp = passYds > 0 ? Math.max(1, Math.round(passYds / 11.5)) : 0;
  const att = cmp + (passYds > 0 ? rangeInt(rng, 1, 4) : rangeInt(rng, 0, 2));
  sheet.add(qb, "paYd", passYds);
  sheet.add(qb, "paCmp", cmp);
  sheet.add(qb, "paAtt", att);

  const ruSplit = [0.62, 0.22, 0.16];
  const runners = [rbs[0], rbs[1], qb];
  let ruLeft = rushYds;
  runners.forEach((p, i) => {
    const share = i === runners.length - 1 ? ruLeft : Math.round(rushYds * ruSplit[i]);
    ruLeft -= share;
    sheet.add(p, "ruYd", share);
    sheet.add(p, "ruAtt", share > 0 ? Math.max(1, Math.round(share / 5)) : 0);
  });

  const targets = [wrs[0], wrs[1], wrs[2], te, rbs[0]];
  const tw = [0.28, 0.2, 0.13, 0.21, 0.18];
  let reLeft = passYds;
  let recLeft = cmp;
  targets.forEach((p, i) => {
    const last = i === targets.length - 1;
    const yds = last ? reLeft : Math.round(passYds * tw[i]);
    const catches = last ? recLeft : Math.min(recLeft, Math.round(cmp * tw[i]));
    reLeft -= yds;
    recLeft -= catches;
    sheet.add(p, "reYd", yds);
    sheet.add(p, "rec", catches);
  });

  if (defLu) {
    for (const lb of defLu.LB ?? []) defSheet.add(lb, "tkl", rangeInt(rng, 0, 3));
    for (const dl of defLu.DL ?? []) defSheet.add(dl, "tkl", rangeInt(rng, 0, 2));
    for (const s of defLu.S ?? []) defSheet.add(s, "tkl", rangeInt(rng, 0, 2));
    for (const cb of defLu.CB ?? []) defSheet.add(cb, "tkl", rangeInt(rng, 0, 1));
  }

  let desc: string;
  if (d.r === "TD") {
    const passTD = rng() < d.passShare;
    if (passTD && qb) {
      const ti = wpick(tw, rng);
      const scorer = targets[ti];
      sheet.add(qb, "paTD", 1);
      sheet.add(scorer, "reTD", 1);
      desc = `${scorer?.name ?? "—"} ${rangeInt(rng, 4, 45)}-yd TD catch`;
    } else {
      const ri = wpick(ruSplit, rng);
      const scorer = runners[ri];
      sheet.add(scorer, "ruTD", 1);
      desc = `${scorer?.name ?? "—"} ${rangeInt(rng, 1, 30)}-yd TD run`;
    }
  } else if (d.r === "FG" || d.r === "FGX") {
    const k = lu.K?.[0];
    sheet.add(k, "fga", 1);
    if (d.r === "FG") sheet.add(k, "fgm", 1);
    desc = `${k?.name ?? "K"} ${d.fgDist}-yd FG ${d.r === "FG" ? "good" : "no good"}`;
  } else if (d.r === "INT") {
    sheet.add(qb, "paInt", 1);
    const dbs = [...(defLu?.CB ?? []), ...(defLu?.S ?? []), ...(defLu?.LB ?? [])];
    const picker = dbs.length
      ? dbs[wpick(dbs.map((p) => p.attrs.ball ?? p.ovr), rng)]
      : undefined;
    defSheet.add(picker, "int", 1);
    desc = `INT${picker ? ` by ${picker.name}` : ""}`;
  } else if (d.r === "FUM") {
    desc = "Fumble lost";
  } else {
    desc = "Punt";
  }
  return desc;
}

function maybeSack(off: Traits, def: Traits, defLu: Lineup | null, defSheet: StatSheet, rng: Rng): void {
  const edge = def.havoc - off.prot;
  if (edge <= 0 || rng() > Math.min(0.5, 0.1 + edge * 0.02)) return;
  const rushers = [...(defLu?.DL ?? []), ...(defLu?.LB ?? [])];
  if (!rushers.length) return;
  const p = rushers[wpick(rushers.map((r) => (r.attrs.rush ?? r.attrs.blitz ?? r.ovr)), rng)];
  defSheet.add(p, "sck", 1);
  defSheet.add(p, "tkl", 1);
}

function kaccOf(lu: Lineup | null, traits: Traits): number {
  const k = lu?.K?.[0];
  return k ? (k.attrs.kacc ?? k.ovr) : traits.st;
}

/** Steppable game simulation. `playDrive()` until `done`, then `outcome()`. */
export class GameSim {
  hs = 0;
  as = 0;
  ot = 0;
  t = 0;
  done = false;
  drives: DriveLine[] = [];
  offenseHome = false; // away receives the opening kick
  private secondHalfDone = false;
  private homeSheet = new StatSheet();
  private awaySheet = new StatSheet();
  private sparkUsed = false;
  private finished = false;

  readonly home: SideInput;
  readonly away: SideInput;
  readonly opts: SimOptions;
  private rng: Rng;

  constructor(home: SideInput, away: SideInput, rng: Rng, opts: SimOptions = {}) {
    this.home = home;
    this.away = away;
    this.rng = rng;
    this.opts = opts;
  }

  quarter(): number {
    return this.t >= 3600 ? 5 : Math.min(4, Math.floor(this.t / 900) + 1);
  }

  /** Clock string for the UI. */
  clock(): string {
    if (this.t >= 3600) return "OT";
    const left = 900 - (this.t % 900);
    return `${Math.floor(left / 60)}:${String(left % 60).padStart(2, "0")}`;
  }

  private modFor(side: SideInput, isHome: boolean): number {
    let m = 0;
    if (isHome && !this.opts.neutral) m += 2;
    if (this.opts.rivalry) {
      const weaker = this.home.traits.ovr <= this.away.traits.ovr ? this.home.tid : this.away.tid;
      if (side.tid === weaker) m += 6;
    }
    if (this.opts.hostileNoise && !isHome) m -= 4;
    return m;
  }

  /**
   * Bench the user's QB1 for QB2 with the PRD spark roll: 35% inspired (+8),
   * 45% steady, 20% lost (−6). Once per game.
   */
  swapQb(): string | null {
    const side = this.opts.userSide === "home" ? this.home : this.opts.userSide === "away" ? this.away : null;
    if (!side?.lineup || this.sparkUsed) return null;
    const qbs = side.lineup.QB ?? [];
    if (qbs.length < 2) return "No backup QB available";
    this.sparkUsed = true;
    side.lineup.QB = [qbs[1], qbs[0], ...qbs.slice(2)];
    const fresh = traitsFromLineup(side.lineup);
    const roll = this.rng();
    const spark = roll < 0.35 ? 8 : roll < 0.8 ? 0 : -6;
    side.traits.airO = fresh.airO + spark;
    side.traits.gndO = fresh.gndO + spark * 0.5;
    side.traits.rzO = fresh.rzO + spark;
    side.traits.sec = fresh.sec + spark * 0.5;
    return spark > 0
      ? `${qbs[1].name} comes in hot — the sideline believes!`
      : spark < 0
        ? `${qbs[1].name} looks lost out there.`
        : `${qbs[1].name} takes over under center.`;
  }

  /** Play one drive. Tactics apply to the user's side (offense or defense). */
  playDrive(tactics: Tactics = {}): DriveLine | null {
    if (this.done) return null;
    if (this.t >= 1800 && !this.secondHalfDone) {
      this.secondHalfDone = true;
      this.offenseHome = true; // home receives the second half
    }
    const off = this.offenseHome ? this.home : this.away;
    const def = this.offenseHome ? this.away : this.home;
    const userOnOffense =
      (this.opts.userSide === "home") === this.offenseHome && this.opts.userSide != null;
    const userOnDefense = this.opts.userSide != null && !userOnOffense;

    const offScore = this.offenseHome ? this.hs : this.as;
    const defScore = this.offenseHome ? this.as : this.hs;
    const q = this.quarter();

    let passShare = 0.52;
    if (q === 4 && offScore < defScore - 8) passShare = 0.75;
    else if (q === 4 && offScore > defScore + 8) passShare = 0.32;

    // Tactics: copy traits so toggles are strictly per-drive.
    let offT = off.traits;
    let defT = def.traits;
    let timeAdj = 0;
    let toShift = 0;
    if (userOnOffense && tactics.chew) {
      offT = { ...offT, gndO: offT.gndO + 10, airO: offT.airO - 15 };
      passShare = Math.max(0.2, passShare - 0.15);
      timeAdj += 40;
    }
    if (userOnOffense && tactics.noHuddle) {
      offT = { ...offT, airO: offT.airO + 10 };
      passShare = Math.min(0.85, passShare + 0.1);
      timeAdj -= 35;
      toShift += 4;
    }
    if (userOnDefense && tactics.blitz) {
      defT = { ...defT, havoc: defT.havoc + 15, airD: defT.airD - 12 };
    }

    const d = resolveDrive(
      offT,
      defT,
      this.modFor(off, this.offenseHome),
      passShare,
      kaccOf(off.lineup, off.traits),
      toShift,
      this.rng,
    );
    maybeSack(offT, defT, def.lineup, this.offenseHome ? this.awaySheet : this.homeSheet, this.rng);

    // Scoring with the football edges (v1.4).
    let offPts = 0;
    let defPts = 0;
    let desc = d.r === "PUNT" ? "Punt" : d.r;
    if (off.lineup) {
      desc = attributeDrive(
        d,
        off.lineup,
        def.lineup,
        this.offenseHome ? this.homeSheet : this.awaySheet,
        this.offenseHome ? this.awaySheet : this.homeSheet,
        this.rng,
      );
    }
    if (d.r === "TD") {
      offPts = 6;
      const downAfterTd = defScore - (offScore + 6);
      if (q === 4 && downAfterTd === 2) {
        if (this.rng() < 0.48) {
          offPts += 2;
          desc += " (2-pt good)";
        } else {
          desc += " (2-pt failed)";
        }
      } else {
        if (this.rng() < 0.98) offPts += 1;
        else desc += " (XP missed)";
      }
    } else if (d.r === "FG") {
      offPts = 3;
    } else if (d.r === "PUNT") {
      const roll = this.rng();
      if (roll < 0.015) {
        defPts = 7;
        desc = "Punt returned to the house!";
      } else if (roll < 0.022) {
        defPts = 2;
        desc = "Punter tackled — safety!";
      }
    } else if (d.r === "INT") {
      if (this.rng() < 0.04) {
        defPts = 7;
        desc += " — pick six!";
      }
    }
    if (this.offenseHome) {
      this.hs += offPts;
      this.as += defPts;
    } else {
      this.as += offPts;
      this.hs += defPts;
    }

    const line: DriveLine = { t: off.tid, q, r: d.r, y: d.yds, d: desc };
    this.drives.push(line);
    this.t += Math.max(45, d.secs + timeAdj);
    this.offenseHome = !this.offenseHome;

    if (this.t >= 3600) {
      if (this.hs === this.as) this.playOvertime();
      this.done = true;
    }
    return line;
  }

  private playOvertime(): void {
    while (this.hs === this.as) {
      this.ot++;
      const order: [SideInput, SideInput] = this.ot % 2 === 1 ? [this.away, this.home] : [this.home, this.away];
      for (const side of order) {
        const opp = side === this.home ? this.away : this.home;
        let pts = 0;
        if (this.ot <= 2) {
          const pTD = clamp(0.42 + (side.traits.rzO - opp.traits.rzD) * 0.004, 0.1, 0.8);
          if (this.rng() < pTD) pts = 7;
          else if (this.rng() < clamp(0.72 + (kaccOf(side.lineup, side.traits) - 75) * 0.004, 0.3, 0.95)) pts = 3;
        } else {
          const p2 = clamp(0.45 + (side.traits.rzO - opp.traits.rzD) * 0.003, 0.15, 0.8);
          if (this.rng() < p2) pts = 2;
        }
        if (side === this.home) this.hs += pts;
        else this.as += pts;
        this.drives.push({
          t: side.tid,
          q: 5,
          r: pts >= 3 ? (pts >= 7 ? "TD" : "FG") : pts > 0 ? "TD" : "OT",
          y: 25,
          d: pts > 0 ? `OT${this.ot}: ${side.school} scores ${pts}` : `OT${this.ot}: ${side.school} stopped`,
        });
      }
      if (this.ot > 6 && this.hs === this.as) this.hs += 1; // pathological guard
    }
  }

  finish(tactics: Tactics = {}): void {
    let guard = 0;
    while (!this.done && guard++ < 80) this.playDrive(tactics);
  }

  /** Injury severity tiers: minor 1-2wk (70%), moderate 3-5 (22%), severe (8%). */
  private rollInjuries(): InjuryEvent[] {
    const injuries: InjuryEvent[] = [];
    for (const side of [this.home, this.away]) {
      if (!side.lineup) continue;
      const sheet = side === this.home ? this.homeSheet : this.awaySheet;
      for (const [g, players] of Object.entries(side.lineup)) {
        // The backup QB only "plays" if the spark swap fired.
        const active = g === "QB" && !this.sparkUsed ? (players ?? []).slice(0, 1) : (players ?? []);
        for (const p of active) {
          sheet.add(p, "gp", 1);
          if (this.rng() < 0.024) {
            const sev = this.rng();
            const weeks =
              sev < 0.7 ? rangeInt(this.rng, 1, 2) : sev < 0.92 ? rangeInt(this.rng, 3, 5) : 20;
            injuries.push({ pid: p.id, weeks });
          }
        }
      }
    }
    return injuries;
  }

  outcome(): SimOutcome {
    if (!this.finished) {
      this.finished = true;
      this.injuriesCache = this.rollInjuries();
    }
    const box: BoxLine[] = [];
    let star: string | null = null;
    let starScore = -1;
    for (const side of [this.home, this.away]) {
      if (!side.lineup) continue;
      const sheet = side === this.home ? this.homeSheet : this.awaySheet;
      const all = ([] as Player[]).concat(...Object.values(side.lineup).map((x) => x ?? []));
      for (const p of all) {
        const s = sheet.map.get(p.id);
        if (!s) continue;
        const parts: string[] = [];
        if (s.paAtt > 0) parts.push(`${s.paCmp}/${s.paAtt}, ${s.paYd} yds, ${s.paTD} TD${s.paInt ? `, ${s.paInt} INT` : ""}`);
        if (s.ruYd > 0 || s.ruTD > 0) parts.push(`${s.ruAtt} car, ${s.ruYd} yds${s.ruTD ? `, ${s.ruTD} TD` : ""}`);
        if (s.rec > 0) parts.push(`${s.rec} rec, ${s.reYd} yds${s.reTD ? `, ${s.reTD} TD` : ""}`);
        if (s.sck > 0) parts.push(`${s.sck} sack${s.sck > 1 ? "s" : ""}`);
        if (s.int > 0) parts.push(`${s.int} INT`);
        if (s.fga > 0) parts.push(`${s.fgm}/${s.fga} FG`);
        if (!parts.length) continue;
        box.push({ pid: p.id, name: p.name, pos: p.pos, t: side.tid, line: parts.join(" · ") });
        const score =
          s.paYd * 0.04 + s.paTD * 5 - s.paInt * 3 + s.ruYd * 0.1 + s.ruTD * 6 +
          s.reYd * 0.1 + s.reTD * 6 + s.sck * 4 + s.int * 5;
        if (score > starScore) {
          starScore = score;
          star = `${p.name} (${side.school}): ${parts[0]}`;
        }
      }
    }
    const sideTotals = (tid: number, sheet: StatSheet): TeamGameTotals => {
      let py = 0;
      let ry = 0;
      for (const s of sheet.map.values()) {
        py += s.paYd;
        ry += s.ruYd;
      }
      const mine = this.drives.filter((d) => d.t === tid && d.q <= 4);
      return {
        py,
        ry,
        yd: mine.reduce((a, d) => a + d.y, 0),
        to: mine.filter((d) => d.r === "INT" || d.r === "FUM").length,
      };
    };
    return {
      hs: this.hs,
      as: this.as,
      ot: this.ot,
      drives: this.drives,
      perStats: [...this.homeSheet.map.entries(), ...this.awaySheet.map.entries()],
      box,
      injuries: this.injuriesCache,
      star,
      totals: {
        h: sideTotals(this.home.tid, this.homeSheet),
        a: sideTotals(this.away.tid, this.awaySheet),
      },
    };
  }

  private injuriesCache: InjuryEvent[] = [];
}

/** Fast-sim: run the whole game with default coaching. */
export function simGame(
  home: SideInput,
  away: SideInput,
  rng: Rng,
  opts: SimOptions = {},
): SimOutcome {
  const sim = new GameSim(home, away, rng, opts);
  sim.finish();
  return sim.outcome();
}
