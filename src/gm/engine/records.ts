// Record books (v1.2): national single-season + career top-10s, maintained
// in state each offseason. Old holders persist after their players are
// pruned — records are never erased, only beaten.

import type { ArchivedPlayer, CareerLine, DynastyState, RecordEntry } from "./types.ts";

export const RECORD_CATS: [string, (l: CareerLine) => number][] = [
  ["Passing yards", (l) => l.paYd],
  ["Passing TD", (l) => l.paTD],
  ["Rushing yards", (l) => l.ruYd],
  ["Rushing TD", (l) => l.ruTD],
  ["Receiving yards", (l) => l.reYd],
  ["Receiving TD", (l) => l.reTD],
  ["Receptions", (l) => l.rec],
  ["Sacks", (l) => l.sck],
  ["Interceptions", (l) => l.int],
  ["Tackles", (l) => l.tkl],
];

function merge(list: RecordEntry[], cands: RecordEntry[], cap = 10): RecordEntry[] {
  const key = (e: RecordEntry) => `${e.name}|${e.school}|${e.season}`;
  const seen = new Map(list.map((e) => [key(e), e]));
  for (const c of cands) {
    if (c.value <= 0) continue;
    const k = key(c);
    const prev = seen.get(k);
    if (!prev || c.value > prev.value) seen.set(k, c);
  }
  return [...seen.values()].sort((a, b) => b.value - a.value).slice(0, cap);
}

/** Fold this season's lines + this cycle's departures into the books. */
export function updateRecords(state: DynastyState, departed: ArchivedPlayer[]): void {
  interface Cand {
    name: string;
    school: string;
    lines: CareerLine[];
  }
  const cands: Cand[] = [];
  for (const team of state.teams) {
    for (const pid of team.roster) {
      const p = state.players[pid];
      if (p.career.length) cands.push({ name: p.name, school: team.school, lines: p.career });
    }
  }
  for (const a of departed) {
    if (a.career.length) {
      cands.push({ name: a.name, school: state.teams[a.tid].school, lines: a.career });
    }
  }

  for (const [cat, get] of RECORD_CATS) {
    const book = state.records[cat] ?? { season: [], career: [] };
    const seasonCands: RecordEntry[] = [];
    const careerCands: RecordEntry[] = [];
    for (const c of cands) {
      let total = 0;
      let best = 0;
      let bestSeason = c.lines[0].season;
      for (const l of c.lines) {
        const v = get(l);
        total += v;
        if (v > best) {
          best = v;
          bestSeason = l.season;
        }
      }
      seasonCands.push({ name: c.name, school: c.school, value: best, season: bestSeason });
      careerCands.push({ name: c.name, school: c.school, value: total, season: c.lines[0].season });
    }
    book.season = merge(book.season, seasonCands);
    book.career = merge(book.career, careerCands);
    state.records[cat] = book;
  }
}
