// The drive engine: Δ-table outcome resolution + seeded synthetic expansion
// (CFB_GM_DESIGN "Sim engine spec"). ~24-28 drives/game; box scores and the
// drive log fall out of the expansion. Pure — returns stat deltas instead of
// mutating players; the season loop applies them.

import type { Rng } from "../../engine/rng.ts";
import type { BoxLine, DriveLine, Player, SeasonStats } from "./types.ts";
import type { Lineup, Traits } from "./lineup.ts";
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
  pts: number;
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
  rng: Rng,
): DriveResult {
  const eo =
    passShare * off.airO + (1 - passShare) * off.gndO + offMod + (rng() * 30 - 15);
  const ed = passShare * def.airD + (1 - passShare) * def.gndD + (rng() * 30 - 15);
  const delta = eo - ed;

  let [pTD, pFG, pPunt, pTO] = baseProbs(delta);
  // Havoc: pass rush beats protection → drives stall, strips happen.
  const havocEdge = def.havoc - off.prot;
  if (havocEdge > 0) {
    const stall = Math.min(12, havocEdge * 0.35);
    pTD -= stall;
    pPunt += stall;
    pTO += Math.min(4, havocEdge * 0.12);
  }
  // Ball security vs turnover hunting.
  const ballShift = clamp((def.hunt - off.sec) * 0.12, -5, 5);
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

  // Red-zone execution swings the TD↔FG boundary.
  const rzSwing = clamp((off.rzO - def.rzD) * 0.008, -0.18, 0.18);
  if (r === "TD" && rzSwing < 0 && rng() < -rzSwing) r = "FG";
  else if (r === "FG" && rzSwing > 0 && rng() < rzSwing) r = "TD";

  let pts = 0;
  let yds: number;
  let fgDist: number | undefined;
  if (r === "TD") {
    pts = 7;
    yds = rangeInt(rng, 55, 85);
  } else if (r === "FG") {
    fgDist = rangeInt(rng, 22, 52);
    const make = clamp(1.02 - 0.011 * (fgDist - 20) + (kacc - 75) * 0.004, 0.35, 0.97);
    if (rng() < make) pts = 3;
    else r = "FGX";
    yds = 92 - fgDist - 17;
  } else if (r === "PUNT") {
    yds = rangeInt(rng, 3, 42);
  } else {
    yds = rangeInt(rng, 0, 45);
  }
  const secs = rangeInt(rng, 105, 215) - Math.round(passShare * 30);
  return { r, pts, yds, secs, passShare, fgDist };
}

/** Weighted index pick over `weights`. */
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

/** Attribute a resolved drive's yardage/score to lineup players. */
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

  // Passing: completions sized off yards-per-completion ~11.5.
  const cmp = passYds > 0 ? Math.max(1, Math.round(passYds / 11.5)) : 0;
  const att = cmp + (passYds > 0 ? rangeInt(rng, 1, 4) : rangeInt(rng, 0, 2));
  sheet.add(qb, "paYd", passYds);
  sheet.add(qb, "paCmp", cmp);
  sheet.add(qb, "paAtt", att);

  // Rushing splits: RB1 / RB2 / QB.
  const ruSplit = [0.62, 0.22, 0.16];
  const runners = [rbs[0], rbs[1], qb];
  let ruLeft = rushYds;
  runners.forEach((p, i) => {
    const share = i === runners.length - 1 ? ruLeft : Math.round(rushYds * ruSplit[i]);
    ruLeft -= share;
    sheet.add(p, "ruYd", share);
    sheet.add(p, "ruAtt", share > 0 ? Math.max(1, Math.round(share / 5)) : 0);
  });

  // Receiving splits across WR1-3 / TE / RB1.
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

  // Defensive counting stats, coarse but plausible over ~12 drives.
  if (defLu) {
    for (const lb of defLu.LB ?? []) defSheet.add(lb, "tkl", rangeInt(rng, 0, 3));
    for (const dl of defLu.DL ?? []) defSheet.add(dl, "tkl", rangeInt(rng, 0, 2));
    for (const s of defLu.S ?? []) defSheet.add(s, "tkl", rangeInt(rng, 0, 2));
    for (const cb of defLu.CB ?? []) defSheet.add(cb, "tkl", rangeInt(rng, 0, 1));
  }

  // Scoring + event lines.
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

/** A sack event when havoc wins a drive — flavor + defender stats. */
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

export function simGame(
  home: SideInput,
  away: SideInput,
  rng: Rng,
  opts: SimOptions = {},
): SimOutcome {
  const drives: DriveLine[] = [];
  const homeSheet = new StatSheet();
  const awaySheet = new StatSheet();
  let hs = 0;
  let as = 0;

  // Flat per-team execution modifiers.
  const rivalryBoost = opts.rivalry ? 6 : 0;
  const weakerSide = home.traits.ovr <= away.traits.ovr ? home.tid : away.tid;
  const modFor = (side: SideInput, isHome: boolean): number => {
    let m = 0;
    if (isHome && !opts.neutral) m += 2;
    if (rivalryBoost && side.tid === weakerSide) m += rivalryBoost;
    if (opts.hostileNoise && !isHome) m -= 4;
    return m;
  };

  let t = 0;
  let offenseHome = false; // away receives the opening kick
  let secondHalfDone = false;
  while (t < 3600) {
    if (t >= 1800 && !secondHalfDone) {
      secondHalfDone = true;
      offenseHome = true; // home receives the second half
    }
    const off = offenseHome ? home : away;
    const def = offenseHome ? away : home;
    const offScore = offenseHome ? hs : as;
    const defScore = offenseHome ? as : hs;
    const q = Math.min(4, Math.floor(t / 900) + 1);

    let passShare = 0.52;
    if (q === 4 && offScore < defScore - 8) passShare = 0.75;
    else if (q === 4 && offScore > defScore + 8) passShare = 0.32;

    const d = resolveDrive(
      off.traits,
      def.traits,
      modFor(off, offenseHome),
      passShare,
      kaccOf(off.lineup, off.traits),
      rng,
    );
    maybeSack(off.traits, def.traits, def.lineup, offenseHome ? awaySheet : homeSheet, rng);

    let desc = d.r === "PUNT" ? "Punt" : d.r;
    if (off.lineup) {
      desc = attributeDrive(
        d,
        off.lineup,
        def.lineup,
        offenseHome ? homeSheet : awaySheet,
        offenseHome ? awaySheet : homeSheet,
        rng,
      );
    }
    if (offenseHome) hs += d.pts;
    else as += d.pts;
    drives.push({ t: off.tid, q, r: d.r, y: d.yds, d: desc });
    t += d.secs;
    offenseHome = !offenseHome;
  }

  // College overtime: alternating possessions from the 25; 2-pt duel from OT3.
  let ot = 0;
  while (hs === as) {
    ot++;
    const order: [SideInput, SideInput] = ot % 2 === 1 ? [away, home] : [home, away];
    for (const side of order) {
      const opp = side === home ? away : home;
      let pts = 0;
      if (ot <= 2) {
        const pTD = clamp(0.42 + (side.traits.rzO - opp.traits.rzD) * 0.004, 0.1, 0.8);
        if (rng() < pTD) pts = 7;
        else if (rng() < clamp(0.72 + (kaccOf(side.lineup, side.traits) - 75) * 0.004, 0.3, 0.95)) pts = 3;
      } else {
        const p2 = clamp(0.45 + (side.traits.rzO - opp.traits.rzD) * 0.003, 0.15, 0.8);
        if (rng() < p2) pts = 2;
      }
      if (side === home) hs += pts;
      else as += pts;
      drives.push({
        t: side.tid,
        q: 5,
        r: pts > 0 ? (pts >= 7 ? "TD" : pts === 3 ? "FG" : "TD") : "OT",
        y: 25,
        d: pts > 0 ? `OT${ot}: ${side.school} scores ${pts}` : `OT${ot}: ${side.school} stopped`,
      });
    }
    if (ot > 6 && hs === as) hs += 1; // pathological guard: home field breaks it
  }

  // Games played + injuries for everyone who suited up.
  const injuries: InjuryEvent[] = [];
  for (const side of [home, away]) {
    if (!side.lineup) continue;
    const sheet = side === home ? homeSheet : awaySheet;
    for (const players of Object.values(side.lineup)) {
      for (const p of players ?? []) {
        sheet.add(p, "gp", 1);
        if (rng() < 0.024) {
          injuries.push({ pid: p.id, weeks: [1, 1, 2, 2, 3, 4, 5, 6][rangeInt(rng, 0, 7)] });
        }
      }
    }
  }

  // Box + star line.
  const box: BoxLine[] = [];
  let star: string | null = null;
  let starScore = -1;
  for (const side of [home, away]) {
    if (!side.lineup) continue;
    const sheet = side === home ? homeSheet : awaySheet;
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

  const perStats: [number, SeasonStats][] = [
    ...homeSheet.map.entries(),
    ...awaySheet.map.entries(),
  ];
  return { hs, as, ot, drives, perStats, box, injuries, star };
}
