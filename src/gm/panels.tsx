// Read-only dynasty panels + modals. All data comes off DynastyState; the
// only I/O is HistoryPanel lazily reading the departed-player archive.
import { useEffect, useMemo, useState } from "react";
import type { DynastyState, GameResult, Player } from "./engine/types.ts";
import { CLASS_LABELS, DEV_TIER_LABELS, expandSheet } from "./engine/player.ts";
import { confStandings, REAL_CONFS } from "./engine/postseason.ts";
import { committeeOrder } from "./engine/poll.ts";
import { archiveFor, type ArchiveRow } from "./db.ts";

const card = "rounded-md border-2 border-paper-edge bg-white/60 p-4";
const th = "px-2 py-1 text-left font-display text-[10px] tracking-widest opacity-60";
const td = "px-2 py-1";

function school(state: DynastyState, tid: number): string {
  return state.teams[tid].school;
}

function rankOf(state: DynastyState, tid: number): number {
  const i = state.poll.findIndex((e) => e.tid === tid);
  return i >= 0 ? i + 1 : 0;
}

function nameWithRank(state: DynastyState, tid: number): string {
  const r = rankOf(state, tid);
  return r ? `#${r} ${school(state, tid)}` : school(state, tid);
}

function userGames(state: DynastyState) {
  return state.schedule
    .filter((g) => g.home === state.userTid || g.away === state.userTid)
    .sort((a, b) => a.week - b.week)
    .map((g) => ({ game: g, result: state.results.find((r) => r.gid === g.id) ?? null }));
}

// --- Dashboard ---------------------------------------------------------------

export function Dashboard({ state }: { state: DynastyState }) {
  const games = userGames(state);
  const next = games.find((g) => !g.result);
  const played = games.filter((g) => g.result);
  const last = played[played.length - 1] ?? null;
  const [showBox, setShowBox] = useState(false);

  return (
    <div className="grid gap-3 md:grid-cols-2">
      <div className={card}>
        <h3 className="font-display text-xs tracking-[0.25em] opacity-60">NEXT GAME</h3>
        {next ? (
          <p className="mt-2 text-lg">
            <span className="font-display">Week {next.game.week}:</span>{" "}
            {next.game.home === state.userTid
              ? `vs ${nameWithRank(state, next.game.away)}`
              : `at ${nameWithRank(state, next.game.home)}`}
            {next.game.name ? <span className="block text-sm opacity-70">{next.game.name}</span> : null}
          </p>
        ) : (
          <p className="mt-2 text-sm opacity-70">
            {state.phase === "offseason" ? "Season complete — see the Offseason Report." : "Season done."}
          </p>
        )}
        {last?.result && (
          <div className="mt-4 border-t border-paper-edge pt-3">
            <h4 className="font-display text-xs tracking-[0.25em] opacity-60">LAST RESULT</h4>
            <ResultLine state={state} r={last.result} />
            <button
              type="button"
              className="mt-1 text-xs underline opacity-70 hover:opacity-100"
              onClick={() => setShowBox(true)}
            >
              Box score + drive log
            </button>
            {showBox && <BoxModal state={state} result={last.result} onClose={() => setShowBox(false)} />}
          </div>
        )}
      </div>

      <div className={card}>
        <h3 className="font-display text-xs tracking-[0.25em] opacity-60">AP TOP 10</h3>
        <ol className="mt-2 space-y-1 text-sm">
          {state.poll.slice(0, 10).map((e, i) => (
            <li key={e.tid} className={e.tid === state.userTid ? "font-bold" : ""}>
              <span className="inline-block w-6 font-display">{i + 1}.</span>
              {school(state, e.tid)}{" "}
              <span className="text-xs opacity-60">
                {state.teams[e.tid].rec.w}-{state.teams[e.tid].rec.l}
                {e.prev === 0 ? " · NEW" : e.prev > i + 1 ? ` · ▲${e.prev - i - 1}` : e.prev < i + 1 ? ` · ▼${i + 1 - e.prev}` : ""}
              </span>
            </li>
          ))}
        </ol>
      </div>

      <div className={`${card} md:col-span-2`}>
        <h3 className="font-display text-xs tracking-[0.25em] opacity-60">#CFB_PULSE</h3>
        <ul className="mt-2 space-y-1 text-sm">
          {state.news.slice(0, 12).map((n, i) => (
            <li key={i}>
              <span className="mr-2 rounded bg-ink/10 px-1 text-[10px]">{n.season} wk{n.week}</span>
              {n.text}
            </li>
          ))}
          {state.news.length === 0 && <li className="opacity-60">Quiet so far. Sim a week.</li>}
        </ul>
      </div>
    </div>
  );
}

function ResultLine({ state, r }: { state: DynastyState; r: GameResult }) {
  const userHome = r.home === state.userTid;
  const us = userHome ? r.hs : r.as;
  const them = userHome ? r.as : r.hs;
  const opp = userHome ? r.away : r.home;
  return (
    <p className="mt-1 text-lg">
      <span className={`font-display ${us > them ? "text-green-800" : "text-red-800"}`}>
        {us > them ? "W" : "L"} {us}-{them}
      </span>{" "}
      {userHome ? "vs" : "at"} {school(state, opp)}
      {r.ot > 0 ? ` (${r.ot}OT)` : ""}
      {r.name ? ` · ${r.name}` : ""}
    </p>
  );
}

// --- Roster ------------------------------------------------------------------

type SortKey = "pos" | "name" | "cls" | "ovr" | "dev";

export function RosterPanel({ state }: { state: DynastyState }) {
  const [sort, setSort] = useState<SortKey>("ovr");
  const [sel, setSel] = useState<Player | null>(null);
  const roster = useMemo(() => {
    const players = state.teams[state.userTid].roster.map((pid) => state.players[pid]);
    const by: Record<SortKey, (a: Player, b: Player) => number> = {
      pos: (a, b) => a.g.localeCompare(b.g) || b.ovr - a.ovr,
      name: (a, b) => a.name.localeCompare(b.name),
      cls: (a, b) => b.cls - a.cls || b.ovr - a.ovr,
      ovr: (a, b) => b.ovr - a.ovr,
      dev: (a, b) => b.devTier - a.devTier || b.ovr - a.ovr,
    };
    return [...players].sort(by[sort]);
  }, [state, sort]);

  const header = (key: SortKey, label: string) => (
    <th className={`${th} cursor-pointer select-none hover:opacity-100`} onClick={() => setSort(key)}>
      {label}
      {sort === key ? " ▾" : ""}
    </th>
  );

  return (
    <div className={card}>
      <h3 className="font-display text-xs tracking-[0.25em] opacity-60">
        ROSTER · {roster.length} PLAYERS
      </h3>
      <div className="mt-2 overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-paper-edge">
              {header("pos", "POS")}
              {header("name", "NAME")}
              {header("cls", "YR")}
              {header("ovr", "OVR")}
              {header("dev", "DEV")}
              <th className={th}>STARS</th>
              <th className={th}>STATUS</th>
            </tr>
          </thead>
          <tbody>
            {roster.map((p) => (
              <tr
                key={p.id}
                className="cursor-pointer border-b border-paper-edge/50 hover:bg-ink/5"
                onClick={() => setSel(p)}
              >
                <td className={`${td} font-display`}>{p.pos}</td>
                <td className={td}>{p.name}</td>
                <td className={td}>{CLASS_LABELS[p.cls] ?? p.cls}</td>
                <td className={`${td} font-bold`}>{p.ovr}</td>
                <td className={td}>
                  <DevBadge tier={p.devTier} />
                </td>
                <td className={td}>{"★".repeat(p.stars)}</td>
                <td className={`${td} text-xs`}>
                  {p.inj > 0 ? <span className="text-red-800">OUT {p.inj}w</span> : <span className="opacity-50">—</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {sel && <PlayerCard state={state} player={sel} onClose={() => setSel(null)} />}
    </div>
  );
}

function DevBadge({ tier }: { tier: number }) {
  const styles = [
    "border-stone-400 text-stone-600",
    "border-slate-500 text-slate-700",
    "border-amber-500 text-amber-700",
    "border-purple-600 text-purple-800",
  ];
  return (
    <span className={`rounded border px-1 text-[10px] font-bold tracking-wide ${styles[tier]}`}>
      {DEV_TIER_LABELS[tier].toUpperCase()}
    </span>
  );
}

function PlayerCard({ state, player, onClose }: { state: DynastyState; player: Player; onClose: () => void }) {
  const sheet = expandSheet(player);
  return (
    <Modal onClose={onClose}>
      <div className="flex items-baseline justify-between">
        <h3 className="font-display text-2xl">{player.name}</h3>
        <span className="font-display text-3xl">{player.ovr}</span>
      </div>
      <p className="mt-1 text-sm opacity-70">
        {player.pos} · {CLASS_LABELS[player.cls] ?? player.cls} · {"★".repeat(player.stars)} ·{" "}
        <DevBadge tier={player.devTier} />
        {player.inj > 0 ? <span className="ml-2 text-red-800">OUT {player.inj} week(s)</span> : null}
      </p>

      <h4 className="mt-4 font-display text-xs tracking-[0.25em] opacity-60">RATINGS</h4>
      <div className="mt-1 grid grid-cols-2 gap-x-6 gap-y-1 text-sm sm:grid-cols-3">
        {sheet.map((e) => (
          <div key={e.label} className="flex items-center justify-between gap-2">
            <span className="text-xs opacity-70">{e.label}</span>
            <span className="font-mono font-bold">{e.value}</span>
          </div>
        ))}
      </div>

      <h4 className="mt-4 font-display text-xs tracking-[0.25em] opacity-60">SEASON</h4>
      <p className="mt-1 text-sm">{statLine(player) || "No stats yet."}</p>

      {player.career.length > 0 && (
        <>
          <h4 className="mt-4 font-display text-xs tracking-[0.25em] opacity-60">CAREER</h4>
          <table className="mt-1 w-full text-xs">
            <thead>
              <tr className="border-b border-paper-edge">
                <th className={th}>YEAR</th>
                <th className={th}>YR</th>
                <th className={th}>OVR</th>
                <th className={th}>LINE</th>
              </tr>
            </thead>
            <tbody>
              {player.career.map((c) => (
                <tr key={c.season} className="border-b border-paper-edge/50">
                  <td className={td}>{c.season}</td>
                  <td className={td}>{CLASS_LABELS[c.cls] ?? c.cls}</td>
                  <td className={td}>{c.ovr}</td>
                  <td className={td}>{careerLine(c) || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
      <p className="mt-4 text-[10px] opacity-50">
        Playing for {school(state, state.userTid)} · hidden dev + ceiling stay hidden — scout with your eyes.
      </p>
    </Modal>
  );
}

interface AnyLine {
  gp: number; paYd: number; paTD: number; paInt: number; ruYd: number; ruTD: number;
  rec: number; reYd: number; reTD: number; tkl: number; sck: number; int: number;
  fgm: number; fga: number;
}

function careerLine(s: AnyLine): string {
  const bits: string[] = [];
  if (s.paYd) bits.push(`${s.paYd} pass yds, ${s.paTD} TD, ${s.paInt} INT`);
  if (s.ruYd > 50) bits.push(`${s.ruYd} rush yds, ${s.ruTD} TD`);
  if (s.rec) bits.push(`${s.rec} rec, ${s.reYd} yds, ${s.reTD} TD`);
  if (s.tkl > 5) bits.push(`${s.tkl} tkl`);
  if (s.sck) bits.push(`${s.sck} sacks`);
  if (s.int) bits.push(`${s.int} INT`);
  if (s.fga) bits.push(`${s.fgm}/${s.fga} FG`);
  return bits.join(" · ");
}

function statLine(p: Player): string {
  return careerLine(p.stats);
}

// --- Schedule ------------------------------------------------------------------

export function SchedulePanel({ state }: { state: DynastyState }) {
  const [boxFor, setBoxFor] = useState<GameResult | null>(null);
  const games = userGames(state);
  return (
    <div className={card}>
      <h3 className="font-display text-xs tracking-[0.25em] opacity-60">
        {state.season} SCHEDULE · {school(state, state.userTid)}
      </h3>
      <table className="mt-2 w-full text-sm">
        <thead>
          <tr className="border-b border-paper-edge">
            <th className={th}>WK</th>
            <th className={th}>OPPONENT</th>
            <th className={th}>RESULT</th>
            <th className={th}></th>
          </tr>
        </thead>
        <tbody>
          {games.map(({ game, result }) => {
            const home = game.home === state.userTid;
            const opp = home ? game.away : game.home;
            const us = result ? (home ? result.hs : result.as) : null;
            const them = result ? (home ? result.as : result.hs) : null;
            return (
              <tr key={game.id} className="border-b border-paper-edge/50">
                <td className={`${td} font-display`}>{game.week}</td>
                <td className={td}>
                  {home ? "vs" : "at"} {nameWithRank(state, opp)}
                  {game.name ? <span className="ml-2 text-xs opacity-60">{game.name}</span> : null}
                  {game.conf ? <span className="ml-2 rounded bg-ink/10 px-1 text-[10px]">CONF</span> : null}
                </td>
                <td className={td}>
                  {result ? (
                    <span className={`font-display ${us! > them! ? "text-green-800" : "text-red-800"}`}>
                      {us! > them! ? "W" : "L"} {us}-{them}
                      {result.ot > 0 ? ` (${result.ot}OT)` : ""}
                    </span>
                  ) : (
                    <span className="opacity-40">—</span>
                  )}
                </td>
                <td className={td}>
                  {result?.box && (
                    <button
                      type="button"
                      className="text-xs underline opacity-70 hover:opacity-100"
                      onClick={() => setBoxFor(result)}
                    >
                      Box
                    </button>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {boxFor && <BoxModal state={state} result={boxFor} onClose={() => setBoxFor(null)} />}
    </div>
  );
}

function BoxModal({ state, result, onClose }: { state: DynastyState; result: GameResult; onClose: () => void }) {
  const [showDrives, setShowDrives] = useState(false);
  return (
    <Modal onClose={onClose}>
      <h3 className="font-display text-xl">
        {school(state, result.away)} {result.as} — {result.hs} {school(state, result.home)}
        {result.ot > 0 ? ` (${result.ot}OT)` : ""}
      </h3>
      {result.name && <p className="text-xs opacity-60">{result.name}</p>}
      {result.star && <p className="mt-1 text-sm">⭐ {result.star}</p>}

      {result.box && (
        <>
          <h4 className="mt-4 font-display text-xs tracking-[0.25em] opacity-60">BOX SCORE</h4>
          {[result.away, result.home].map((tid) => {
            const lines = result.box!.filter((b) => b.t === tid);
            if (!lines.length) return null;
            return (
              <div key={tid} className="mt-2">
                <p className="font-display text-sm">{school(state, tid)}</p>
                <ul className="mt-1 space-y-0.5 text-xs">
                  {lines.map((b) => (
                    <li key={b.pid}>
                      <span className="font-bold">{b.name}</span> <span className="opacity-60">{b.pos}</span> — {b.line}
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </>
      )}

      {result.drives && (
        <>
          <button
            type="button"
            className="mt-4 text-xs underline opacity-70 hover:opacity-100"
            onClick={() => setShowDrives(!showDrives)}
          >
            {showDrives ? "Hide" : "Show"} drive log ({result.drives.length} drives)
          </button>
          {showDrives && (
            <ul className="mt-2 max-h-64 space-y-0.5 overflow-y-auto text-xs">
              {result.drives.map((d, i) => (
                <li key={i}>
                  <span className="mr-1 rounded bg-ink/10 px-1 text-[10px]">Q{d.q}</span>
                  <span className="font-bold">{school(state, d.t)}</span>: {d.r} — {d.d} ({d.y} yds)
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </Modal>
  );
}

// --- Standings / Rankings ------------------------------------------------------

export function StandingsPanel({ state }: { state: DynastyState }) {
  return (
    <div className="grid gap-3 md:grid-cols-2">
      {REAL_CONFS.map((conf) => (
        <div key={conf} className={card}>
          <h3 className="font-display text-xs tracking-[0.25em] opacity-60">{conf.toUpperCase()}</h3>
          <table className="mt-2 w-full text-sm">
            <thead>
              <tr className="border-b border-paper-edge">
                <th className={th}>TEAM</th>
                <th className={th}>CONF</th>
                <th className={th}>OVERALL</th>
                <th className={th}>PF-PA</th>
              </tr>
            </thead>
            <tbody>
              {confStandings(state.teams, conf).map((t) => (
                <tr key={t.id} className={`border-b border-paper-edge/50 ${t.id === state.userTid ? "font-bold" : ""}`}>
                  <td className={td}>{nameWithRank(state, t.id)}</td>
                  <td className={td}>{t.rec.cw}-{t.rec.cl}</td>
                  <td className={td}>{t.rec.w}-{t.rec.l}</td>
                  <td className={`${td} text-xs opacity-70`}>{t.rec.pf}-{t.rec.pa}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
    </div>
  );
}

export function RankingsPanel({ state }: { state: DynastyState }) {
  return (
    <div className={card}>
      <h3 className="font-display text-xs tracking-[0.25em] opacity-60">AP TOP 25</h3>
      <ol className="mt-2 columns-1 gap-8 text-sm sm:columns-2">
        {state.poll.map((e, i) => {
          const t = state.teams[e.tid];
          return (
            <li key={e.tid} className={`mb-1 ${e.tid === state.userTid ? "font-bold" : ""}`}>
              <span className="inline-block w-7 font-display">{i + 1}.</span>
              {t.school}{" "}
              <span className="text-xs opacity-60">
                {t.rec.w}-{t.rec.l}
                {e.prev === 0 ? " · NEW" : e.prev > i + 1 ? ` · ▲${e.prev - i - 1}` : e.prev < i + 1 ? ` · ▼${i + 1 - e.prev}` : ""}
              </span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

// --- Postseason ------------------------------------------------------------------

export function PlayoffsPanel({ state }: { state: DynastyState }) {
  if (!state.cfp) {
    const proj = committeeOrder(state.teams).slice(0, 12);
    return (
      <div className={card}>
        <h3 className="font-display text-xs tracking-[0.25em] opacity-60">CFP PROJECTION</h3>
        <p className="mt-1 text-xs opacity-60">
          Committee's current 12 (4 champs auto-bid at season's end):
        </p>
        <ol className="mt-2 text-sm">
          {proj.map((tid, i) => (
            <li key={tid} className={tid === state.userTid ? "font-bold" : ""}>
              <span className="inline-block w-7 font-display">{i + 1}.</span>
              {school(state, tid)} ({state.teams[tid].rec.w}-{state.teams[tid].rec.l})
            </li>
          ))}
        </ol>
      </div>
    );
  }

  const rounds: [string, GameResult[]][] = [
    ["FIRST ROUND", state.cfp.results.filter((r) => r.kind === "cfp-r1")],
    ["QUARTERFINALS", state.cfp.results.filter((r) => r.kind === "cfp-qf")],
    ["SEMIFINALS", state.cfp.results.filter((r) => r.kind === "cfp-sf")],
    ["NATIONAL CHAMPIONSHIP", state.cfp.results.filter((r) => r.kind === "cfp-nc")],
  ];
  const bowls = state.results.filter((r) => r.kind === "bowl");

  return (
    <div className="grid gap-3 md:grid-cols-2">
      <div className={card}>
        <h3 className="font-display text-xs tracking-[0.25em] opacity-60">CFP BRACKET</h3>
        {state.cfp.champion !== null && (
          <p className="mt-2 rounded bg-amber-100 px-2 py-1 font-display">
            🏆 {school(state, state.cfp.champion)} — National Champions
          </p>
        )}
        <p className="mt-2 text-xs opacity-60">
          Field: {state.cfp.field.map((tid, i) => `${i + 1} ${school(state, tid)}`).join(" · ")}
        </p>
        {rounds.map(([label, games]) =>
          games.length ? (
            <div key={label} className="mt-3">
              <h4 className="font-display text-[10px] tracking-[0.25em] opacity-60">{label}</h4>
              <ul className="mt-1 space-y-1 text-sm">
                {games.map((r) => (
                  <li key={r.gid}>
                    {r.name && <span className="mr-1 text-xs opacity-60">{r.name}:</span>}
                    <ScoreInline state={state} r={r} />
                  </li>
                ))}
              </ul>
            </div>
          ) : null,
        )}
      </div>
      <div className={card}>
        <h3 className="font-display text-xs tracking-[0.25em] opacity-60">BOWL SEASON</h3>
        <ul className="mt-2 space-y-1 text-sm">
          {bowls.map((r) => (
            <li key={r.gid}>
              <span className="mr-1 text-xs opacity-60">{r.name}:</span>
              <ScoreInline state={state} r={r} />
            </li>
          ))}
          {bowls.length === 0 && <li className="text-xs opacity-60">Bowls play in playoff week 1.</li>}
        </ul>
      </div>
    </div>
  );
}

function ScoreInline({ state, r }: { state: DynastyState; r: GameResult }) {
  const winHome = r.hs > r.as;
  return (
    <span>
      <span className={winHome ? "" : "font-bold"}>{school(state, r.away)} {r.as}</span>
      {" — "}
      <span className={winHome ? "font-bold" : ""}>{r.hs} {school(state, r.home)}</span>
      {r.ot > 0 ? ` (${r.ot}OT)` : ""}
    </span>
  );
}

// --- History -----------------------------------------------------------------

export function HistoryPanel({ state, slotId }: { state: DynastyState; slotId: number }) {
  const [rows, setRows] = useState<ArchiveRow[] | null>(null);
  useEffect(() => {
    archiveFor(slotId).then(setRows, () => setRows([]));
  }, [slotId, state.season]);

  const legends = useMemo(() => {
    if (!rows) return [];
    return rows
      .filter((r) => r.player.tid === state.userTid)
      .map((r) => {
        const tot = r.player.career.reduce(
          (a, c) => a + c.paYd * 0.04 + c.paTD * 6 + c.ruYd * 0.09 + c.ruTD * 6 + c.reYd * 0.09 + c.reTD * 6 + c.sck * 7 + c.int * 8 + c.tkl * 0.35,
          0,
        );
        return { ...r, value: tot };
      })
      .sort((a, b) => b.value - a.value)
      .slice(0, 15);
  }, [rows, state.userTid]);

  return (
    <div className="grid gap-3 md:grid-cols-2">
      <div className={card}>
        <h3 className="font-display text-xs tracking-[0.25em] opacity-60">SEASON LEDGER</h3>
        <table className="mt-2 w-full text-sm">
          <thead>
            <tr className="border-b border-paper-edge">
              <th className={th}>SEASON</th>
              <th className={th}>CHAMPION</th>
              <th className={th}>YOU</th>
              <th className={th}>POY</th>
            </tr>
          </thead>
          <tbody>
            {[...state.honors].reverse().map((h) => (
              <tr key={h.season} className="border-b border-paper-edge/50 align-top">
                <td className={`${td} font-display`}>{h.season}</td>
                <td className={td}>{h.champion !== null ? school(state, h.champion) : "—"}</td>
                <td className={td}>
                  {h.userRecord}
                  {h.userPollRank ? ` · #${h.userPollRank}` : ""}
                </td>
                <td className={`${td} text-xs`}>{h.poy ?? "—"}</td>
              </tr>
            ))}
            {state.honors.length === 0 && (
              <tr>
                <td className={td} colSpan={4}>
                  <span className="text-xs opacity-60">Finish a season to start the ledger.</span>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <div className={card}>
        <h3 className="font-display text-xs tracking-[0.25em] opacity-60">
          PROGRAM LEGENDS · {rows ? rows.filter((r) => r.player.tid === state.userTid).length : "…"} DEPARTED
        </h3>
        <ul className="mt-2 space-y-1 text-sm">
          {legends.map((r) => (
            <li key={r.id}>
              <span className="font-bold">{r.player.name}</span>{" "}
              <span className="text-xs opacity-60">
                {r.player.pos} · left {r.season} ({r.player.reason}) · peaked {r.player.ovr} OVR
              </span>
            </li>
          ))}
          {legends.length === 0 && (
            <li className="text-xs opacity-60">Your departed greats will be remembered here.</li>
          )}
        </ul>
      </div>
    </div>
  );
}

// --- Offseason ------------------------------------------------------------------

export function OffseasonPanel({ state }: { state: DynastyState }) {
  const r = state.offseason!;
  const honors = state.honors[state.honors.length - 1];
  return (
    <div className="grid gap-3 md:grid-cols-2">
      <div className={`${card} md:col-span-2`}>
        <h3 className="font-display text-lg">{r.season} Season Wrapped</h3>
        <p className="mt-1 text-sm">
          {honors?.champion !== null && honors ? (
            <>🏆 <span className="font-bold">{school(state, honors.champion)}</span> won it all. </>
          ) : null}
          You went <span className="font-bold">{honors?.userRecord}</span>
          {honors?.userPollRank ? ` and finished #${honors.userPollRank}` : ""}.
          {honors?.poy ? ` POY: ${honors.poy}.` : ""}
        </p>
        <p className="mt-1 text-sm">
          Your recruiting class ranked <span className="font-display">#{r.classRank}</span> nationally.
        </p>
      </div>

      <div className={card}>
        <h3 className="font-display text-xs tracking-[0.25em] opacity-60">DEPARTURES</h3>
        <ul className="mt-2 space-y-0.5 text-sm">
          {r.departures.map((d, i) => (
            <li key={i}>
              <span className="font-bold">{d.name}</span>{" "}
              <span className="text-xs opacity-60">{d.pos} · {d.ovr} OVR · {d.reason}</span>
            </li>
          ))}
          {r.departures.length === 0 && <li className="text-xs opacity-60">Everyone returns!</li>}
        </ul>
      </div>

      <div className={card}>
        <h3 className="font-display text-xs tracking-[0.25em] opacity-60">SIGNING CLASS</h3>
        <ul className="mt-2 space-y-0.5 text-sm">
          {r.signees.map((s, i) => (
            <li key={i}>
              {"★".repeat(s.stars)} <span className="font-bold">{s.name}</span>{" "}
              <span className="text-xs opacity-60">{s.pos} · {s.ovr} OVR</span>
            </li>
          ))}
        </ul>
      </div>

      <div className={card}>
        <h3 className="font-display text-xs tracking-[0.25em] opacity-60">BIGGEST RISERS</h3>
        <ul className="mt-2 space-y-0.5 text-sm">
          {r.risers.map((x, i) => (
            <li key={i}>
              <span className="font-bold">{x.name}</span>{" "}
              <span className="text-xs opacity-60">{x.pos} · {x.from} → {x.to}</span>
            </li>
          ))}
          {r.risers.length === 0 && <li className="text-xs opacity-60">A quiet camp.</li>}
        </ul>
      </div>

      <div className={card}>
        <h3 className="font-display text-xs tracking-[0.25em] opacity-60">PRESTIGE MOVES</h3>
        <ul className="mt-2 space-y-0.5 text-sm">
          {r.prestigeChanges.map((c, i) => (
            <li key={i}>
              <span className="font-bold">{c.school}</span>{" "}
              <span className="text-xs opacity-60">
                {"★".repeat(c.from)} → {"★".repeat(c.to)} {c.to > c.from ? "📈" : "📉"}
              </span>
            </li>
          ))}
          {r.prestigeChanges.length === 0 && <li className="text-xs opacity-60">The order holds.</li>}
        </ul>
      </div>
    </div>
  );
}

// --- Shared modal ---------------------------------------------------------------

function Modal({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink/50 p-4"
      onClick={onClose}
      role="presentation"
    >
      <div
        className="max-h-[85vh] w-full max-w-lg overflow-y-auto rounded-lg border-2 border-ink bg-paper p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
      >
        {children}
        <button
          type="button"
          onClick={onClose}
          className="mt-4 rounded-full border-2 border-paper-edge px-4 py-1 font-display text-xs tracking-widest transition hover:border-ink/40"
        >
          CLOSE
        </button>
      </div>
    </div>
  );
}
