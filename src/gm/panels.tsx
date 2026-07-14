// Read-only dynasty panels + modals. All data comes off DynastyState; the
// only I/O is HistoryPanel lazily reading the departed-player archive.
// Presentation is built entirely from the V0 design system (ui.tsx / theme.ts).
import { useEffect, useMemo, useState } from "react";
import type { DynastyState, GameResult, Player, PosGroup } from "./engine/types.ts";
import { CLASS_LABELS, DEV_TIER_LABELS, expandSheet } from "./engine/player.ts";
import { confStandings, REAL_CONFS } from "./engine/postseason.ts";
import { committeeOrder } from "./engine/poll.ts";
import { fmtMoney, marketValue } from "./engine/nil.ts";
import { LINEUP_COUNTS, selectLineup } from "./engine/lineup.ts";
import type { PortalOffer } from "./engine/offseason.ts";
import { ARCHETYPE_LABELS, BOOSTER_LABELS, staffOf } from "./engine/coaches.ts";
import { buildSeasonRecap } from "./engine/recap.ts";
import { archiveFor, type ArchiveRow } from "./db.ts";
import { getTeamColors } from "./theme.ts";
import {
  Card, Delta, Meter, Pill, SectionLabel, StatusText, TeamName,
} from "./ui.tsx";

const th = "px-2 py-1.5 text-left font-display text-[10px] tracking-widest text-ink/50";
const td = "px-2 py-1.5";

function school(state: DynastyState, tid: number): string {
  return state.teams[tid].school;
}

function rankOf(state: DynastyState, tid: number): number {
  const i = state.poll.findIndex((e) => e.tid === tid);
  return i >= 0 ? i + 1 : 0;
}

/** A school name rendered in its own colors, with its AP rank when ranked. */
function TeamRef({ state, tid, lead }: { state: DynastyState; tid: number; lead?: boolean }) {
  const r = rankOf(state, tid);
  return <TeamName team={state.teams[tid]} rank={r || undefined} lead={lead ?? tid === state.userTid} />;
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
    <div className="grid gap-3 lg:grid-cols-2">
      <NextGameCard state={state} next={next?.game ?? null} />

      <Card title="LAST RESULT" tour="last-result">
        {last?.result ? (
          <LastResult state={state} r={last.result} onBox={() => setShowBox(true)} />
        ) : (
          <p className="text-sm text-ink/60">No games in the books yet — sim a week.</p>
        )}
        {showBox && last?.result && (
          <BoxModal state={state} result={last.result} onClose={() => setShowBox(false)} />
        )}
      </Card>

      <Card title="RANKINGS · TOP 10">
        <ol className="space-y-1 text-sm">
          {state.poll.slice(0, 10).map((e, i) => (
            <li key={e.tid} className="flex items-baseline gap-2">
              <span className="w-5 text-right font-display text-ink/45">{i + 1}</span>
              <TeamRef state={state} tid={e.tid} />
              <span className="text-xs text-ink/50">
                {state.teams[e.tid].rec.w}-{state.teams[e.tid].rec.l}
              </span>
              <span className="ml-auto text-xs">
                <Delta prev={e.prev} rank={i + 1} />
              </span>
            </li>
          ))}
        </ol>
      </Card>

      <Card title={`BOOSTER MANDATES · ${BOOSTER_LABELS[state.teams[state.userTid].boosterType]}`} tour="mandates">
        <ul className="space-y-1.5 text-sm">
          {state.mandates.map((m, i) => (
            <li key={i} className="flex items-start gap-2">
              <span>{m.met === null ? "⏳" : m.met ? "✅" : "❌"}</span>
              <span>{m.text}</span>
            </li>
          ))}
          {state.mandates.length === 0 && <li className="text-xs text-ink/55">The board is quiet.</li>}
        </ul>
        <p className="mt-3 border-t border-line/70 pt-2 text-[10px] text-ink/55">
          Hit every mandate: +25% NIL next cycle. Miss them all: −20% and a locker-room hit.
        </p>
      </Card>

      <Card title="YOUR STAFF" tour="staff">
        <ul className="space-y-1.5 text-sm">
          {(["HC", "OC", "DC"] as const).map((role) => {
            const c = staffOf(state, state.userTid)[role];
            return (
              <li key={role} className="flex items-baseline gap-2">
                <span className="w-8 font-display text-ink/60">{role}</span>
                {c ? (
                  <>
                    <span className="font-bold">{c.name}</span>
                    <span className="text-xs text-ink/55">
                      {c.rating} · {ARCHETYPE_LABELS[c.archetype]} · {c.w}-{c.l}
                    </span>
                  </>
                ) : (
                  <span className="text-ink/40">vacant</span>
                )}
              </li>
            );
          })}
        </ul>
        <p className="mt-3 border-t border-line/70 pt-2 text-[10px] text-ink/55">
          Recruiters boost interest · Tacticians boost execution · Developers boost camp gains.
        </p>
      </Card>

      <InjuryReport state={state} />

      <Card title="#CFB_PULSE" tour="news" className="lg:col-span-2">
        <ul className="space-y-1.5 text-sm">
          {state.news.slice(0, 12).map((n, i) => (
            <li key={i} className="flex gap-2">
              <span className="mt-0.5 shrink-0 rounded bg-surface-sunken px-1.5 text-[10px] font-bold text-ink/60">
                {n.season} wk{n.week}
              </span>
              <span>{n.text}</span>
            </li>
          ))}
          {state.news.length === 0 && <li className="text-ink/55">Quiet so far. Sim a week.</li>}
        </ul>
      </Card>
    </div>
  );
}

function NextGameCard({ state, next }: { state: DynastyState; next: DynastyState["schedule"][number] | null }) {
  if (!next) {
    return (
      <Card title="NEXT GAME" tour="next-game">
        <p className="text-sm text-ink/60">
          {state.phase === "offseason" ? "Season complete — see the Offseason Report." : "Regular season done."}
        </p>
      </Card>
    );
  }
  const home = next.home === state.userTid;
  const oppTid = home ? next.away : next.home;
  const opp = state.teams[oppTid];
  const rival = (state.teams[state.userTid].rivals ?? []).includes(oppTid);
  return (
    <Card
      title="NEXT GAME"
      tour="next-game"
      right={<span className="font-display text-[11px] text-ink/55">WEEK {next.week}</span>}
      accent={rival ? "var(--accent)" : undefined}
    >
      <div className="flex items-baseline gap-2">
        <span className="font-display text-sm text-ink/55">{home ? "vs" : "at"}</span>
        <span className="font-display text-2xl leading-none">
          <TeamRef state={state} tid={oppTid} />
        </span>
        {rival && <Pill tone="accent">RIVALRY</Pill>}
      </div>
      {next.name && <p className="mt-1 text-sm text-ink/70">{next.name}</p>}

      {/* Opponent snapshot slot — record/rank/prestige today; key players & */}
      {/* play-style land here from the mechanical PR. */}
      <div className="mt-3 rounded-lg border border-line/70 bg-surface-sunken/60 p-3">
        <SectionLabel>SCOUTING REPORT</SectionLabel>
        <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
          <span>
            <span className="text-ink/55">Record </span>
            <span className="font-bold">{opp.rec.w}-{opp.rec.l}</span>
          </span>
          <span>
            <span className="text-ink/55">Conf </span>
            <span className="font-bold">{opp.rec.cw}-{opp.rec.cl}</span>
          </span>
          <span className="text-gold">{"★".repeat(opp.prestige)}</span>
          {rankOf(state, oppTid) > 0 && <Pill tone="neu">AP #{rankOf(state, oppTid)}</Pill>}
        </div>
        <p className="mt-2 text-[11px] text-ink/45">Key players &amp; play style — coming with scouting.</p>
      </div>
    </Card>
  );
}

function LastResult({ state, r, onBox }: { state: DynastyState; r: GameResult; onBox: () => void }) {
  const userHome = r.home === state.userTid;
  const us = userHome ? r.hs : r.as;
  const them = userHome ? r.as : r.hs;
  const oppTid = userHome ? r.away : r.home;
  const win = us > them;
  return (
    <div>
      <div className="flex items-center gap-3">
        <div
          className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg font-display text-2xl"
          style={{
            background: win ? "var(--pos-soft)" : "var(--neg-soft)",
            color: win ? "var(--pos)" : "var(--neg)",
          }}
        >
          {win ? "W" : "L"}
        </div>
        <div>
          <p className="font-display text-2xl leading-none">
            <StatusText tone={win ? "pos" : "neg"}>{us}–{them}</StatusText>
          </p>
          <p className="mt-0.5 text-sm text-ink/70">
            {userHome ? "vs" : "at"} <TeamRef state={state} tid={oppTid} />
            {r.ot > 0 ? ` (${r.ot}OT)` : ""}
            {r.name ? ` · ${r.name}` : ""}
          </p>
        </div>
      </div>
      {/* Star-player-of-the-game stat line (mechanical PR fills richer data). */}
      {r.star && (
        <div className="mt-3 flex items-start gap-2 rounded-lg border border-line/70 bg-surface-sunken/60 p-2.5">
          <span className="text-lg leading-none">⭐</span>
          <div>
            <SectionLabel>PLAYER OF THE GAME</SectionLabel>
            <p className="mt-0.5 text-sm">{r.star}</p>
          </div>
        </div>
      )}
      <button
        type="button"
        className="mt-3 text-xs font-bold text-accent underline-offset-2 hover:underline"
        onClick={onBox}
      >
        Box score + drive log →
      </button>
    </div>
  );
}

function InjuryReport({ state }: { state: DynastyState }) {
  const hurt = state.teams[state.userTid].roster
    .map((pid) => state.players[pid])
    .filter((p) => p.inj > 0)
    .sort((a, b) => b.inj - a.inj);
  return (
    <Card title={`INJURY REPORT · ${hurt.length} OUT`} className="lg:col-span-2">
      {hurt.length === 0 ? (
        <p className="text-sm text-ink/60">Clean bill of health.</p>
      ) : (
        <ul className="flex flex-wrap gap-x-6 gap-y-1.5 text-sm">
          {hurt.map((p) => (
            <li key={p.id} className="flex items-baseline gap-1.5">
              <span className="font-display text-ink/60">{p.pos}</span>
              <span className="font-bold">{p.name}</span>
              <StatusText tone="neg" className="text-xs">
                {p.inj >= 15 ? "out for season" : `${p.inj} wk${p.inj > 1 ? "s" : ""}`}
              </StatusText>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

// --- Roster ------------------------------------------------------------------

/** Group order for the depth chart formation and the grouped roster table. */
const OFFENSE: PosGroup[] = ["QB", "RB", "WR", "TE", "OL"];
const DEFENSE: PosGroup[] = ["DL", "LB", "CB", "S"];
const SPECIAL: PosGroup[] = ["K", "P"];
const GROUP_ORDER: PosGroup[] = [...OFFENSE, ...DEFENSE, ...SPECIAL];
const GROUP_LABELS: Record<PosGroup, string> = {
  QB: "Quarterbacks", RB: "Running Backs", WR: "Wide Receivers", TE: "Tight Ends",
  OL: "Offensive Line", DL: "Defensive Line", LB: "Linebackers", CB: "Cornerbacks",
  S: "Safeties", K: "Kickers", P: "Punters",
};
const STARTER_COUNT = new Map(LINEUP_COUNTS);

export function RosterPanel({
  state,
  onCut,
  onPin,
}: {
  state: DynastyState;
  onCut?: (pid: number) => void;
  onPin?: (pid: number) => void;
}) {
  const [sel, setSel] = useState<Player | null>(null);
  const canCut = state.phase === "offseason" && !!onCut;
  const team = state.teams[state.userTid];
  const pins = useMemo(() => new Set(team.pins ?? []), [team.pins]);

  // Players grouped by position, pins-first then OVR (matches sim depth order).
  const byGroup = useMemo(() => {
    const map = new Map<PosGroup, Player[]>();
    for (const pid of team.roster) {
      const p = state.players[pid];
      (map.get(p.g) ?? map.set(p.g, []).get(p.g)!).push(p);
    }
    for (const list of map.values()) {
      list.sort((a, b) => Number(pins.has(b.id)) - Number(pins.has(a.id)) || b.ovr - a.ovr);
    }
    return map;
  }, [state, team.roster, pins]);

  return (
    <div className="space-y-3">
      <NilHeader state={state} />
      <DepthChart state={state} byGroup={byGroup} onSelect={setSel} />

      <Card title={`ROSTER · ${team.roster.length} PLAYERS`} tour="roster-table" bodyClassName="p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line bg-surface-sunken/50">
                <th className={th}>NAME</th>
                <th className={th}>YR</th>
                <th className={th}>OVR</th>
                <th className={th}>DEV</th>
                <th className={`${th} hidden sm:table-cell`}>NIL</th>
                <th className={`${th} hidden sm:table-cell`}>MOR</th>
                <th className={th}>STATUS</th>
                {canCut && <th className={th}></th>}
              </tr>
            </thead>
            {GROUP_ORDER.filter((g) => (byGroup.get(g)?.length ?? 0) > 0).map((g) => {
              const list = byGroup.get(g)!;
              const starters = STARTER_COUNT.get(g) ?? 1;
              return (
                <tbody key={g}>
                  <tr>
                    <td colSpan={canCut ? 8 : 7} className="border-b border-line bg-surface-sunken/70 px-2 py-1">
                      <span className="font-display text-[11px] tracking-[0.2em] text-ink/70">
                        {GROUP_LABELS[g]}
                      </span>
                      <span className="ml-2 text-[10px] text-ink/45">{list.length}</span>
                    </td>
                  </tr>
                  {list.map((p, i) => (
                    <tr
                      key={p.id}
                      className="cursor-pointer border-b border-line/50 transition hover:bg-accent-soft/40"
                      onClick={() => setSel(p)}
                    >
                      <td className={td}>
                        <span className="flex items-center gap-1.5">
                          {onPin && (
                            <button
                              type="button"
                              title={pins.has(p.id) ? "Unpin from the starting lineup" : "Pin as starter"}
                              className={pins.has(p.id) ? "" : "opacity-25 hover:opacity-70"}
                              onClick={(e) => {
                                e.stopPropagation();
                                onPin(p.id);
                              }}
                            >
                              📌
                            </button>
                          )}
                          <span className="font-medium">{p.name}</span>
                          {i < starters && <Pill tone="pos" className="!px-1.5 !py-0">ST</Pill>}
                        </span>
                      </td>
                      <td className={`${td} whitespace-nowrap text-ink/70`}>
                        {p.rs ? "rs-" : ""}
                        {CLASS_LABELS[p.cls] ?? p.cls}
                      </td>
                      <td className={`${td} font-display`}>{p.ovr}</td>
                      <td className={td}><DevBadge tier={p.devTier} /></td>
                      <td className={`${td} hidden font-mono text-xs sm:table-cell`}>{p.nil > 0 ? fmtMoney(p.nil) : "—"}</td>
                      <td className={`${td} hidden font-mono text-xs sm:table-cell`}>
                        <span className={p.morale <= 35 ? "text-neg" : ""}>{p.morale}</span>
                      </td>
                      <td className={`${td} text-xs`}>
                        {p.inj > 0 ? <StatusText tone="neg">OUT {p.inj}w</StatusText> : <span className="text-ink/35">—</span>}
                      </td>
                      {canCut && (
                        <td className={td}>
                          <button
                            type="button"
                            className="rounded border border-line px-1.5 py-0.5 text-[10px] font-bold text-neg transition hover:border-neg/50 hover:bg-neg-soft"
                            onClick={(e) => {
                              e.stopPropagation();
                              if (window.confirm(`Cut ${p.name}?`)) onCut!(p.id);
                            }}
                          >
                            CUT
                          </button>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              );
            })}
          </table>
        </div>
      </Card>

      {sel && <PlayerCard state={state} player={sel} onClose={() => setSel(null)} />}
    </div>
  );
}

function NilHeader({ state }: { state: DynastyState }) {
  const team = state.teams[state.userTid];
  const paid = team.roster.map((pid) => state.players[pid]).filter((p) => p && p.nil > 0);
  const payroll = paid.reduce((a, p) => a + p.nil, 0);
  const pool = team.nilBudget;
  const colors = getTeamColors(team);
  return (
    <Card accent={colors.primary} bodyClassName="p-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <SectionLabel>NIL PAYROLL</SectionLabel>
          <p className="mt-0.5 font-display text-2xl leading-none">{fmtMoney(payroll)}</p>
          <p className="mt-1 text-xs text-ink/55">{paid.length} players on NIL deals</p>
        </div>
        <div className="text-right">
          <SectionLabel>THIS CYCLE'S POOL</SectionLabel>
          <p className="mt-0.5 font-display text-2xl leading-none">{fmtMoney(pool)}</p>
          <p className="mt-1 text-xs text-ink/55">retention + portal budget</p>
        </div>
      </div>
      <Meter value={Math.min(payroll, pool)} max={pool || 1} color={colors.primary} className="mt-3" height={10} />
    </Card>
  );
}

/**
 * Football-field depth chart (V2.1) — the headline visual. Position clusters
 * sit in offense/defense/special bands on a turf cross-section; each cluster
 * shows its depth stack, starter chips in the program's colors.
 */
function DepthChart({
  state,
  byGroup,
  onSelect,
}: {
  state: DynastyState;
  byGroup: Map<PosGroup, Player[]>;
  onSelect: (p: Player) => void;
}) {
  const team = state.teams[state.userTid];
  const colors = getTeamColors(team);
  const lineup = useMemo(() => selectLineup(team.roster.map((pid) => state.players[pid]), team.pins), [state, team]);

  const band = (label: string, groups: PosGroup[]) => (
    <div>
      <div className="mb-2 flex items-center gap-2">
        <span className="font-display text-[10px] tracking-[0.3em] text-chalk/90 drop-shadow">{label}</span>
        <span className="h-px flex-1 bg-chalk/25" />
      </div>
      <div className="flex flex-wrap gap-2">
        {groups.map((g) => {
          const stack = byGroup.get(g) ?? [];
          const starters = STARTER_COUNT.get(g) ?? 1;
          const starterIds = new Set((lineup[g] ?? []).map((p) => p.id));
          return (
            <div key={g} className="min-w-[92px] flex-1 rounded-lg bg-black/25 p-2 backdrop-blur-[1px]">
              <div className="mb-1 text-center font-display text-[11px] tracking-widest text-chalk/95">{g}</div>
              <div className="space-y-1">
                {stack.slice(0, Math.max(starters + 1, 2)).map((p) => {
                  const isStarter = starterIds.has(p.id);
                  return (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => onSelect(p)}
                      style={
                        isStarter
                          ? ({ ["--chip"]: colors.primary, ["--chip-ink"]: colors.onPrimary } as React.CSSProperties)
                          : undefined
                      }
                      className={`block w-full rounded px-1.5 py-1 text-left transition hover:brightness-110 ${
                        isStarter ? "gm-chip shadow" : "bg-chalk/90 text-ink"
                      }`}
                      title={`${p.name} · ${p.pos} · ${p.ovr} OVR`}
                    >
                      <span className="flex items-baseline justify-between gap-1">
                        <span className="truncate text-[11px] font-bold leading-tight">{p.name}</span>
                        <span className="font-display text-[11px] tabular-nums">{p.ovr}</span>
                      </span>
                      <span className="block text-[9px] uppercase tracking-wide opacity-80">
                        {p.rs ? "rs-" : ""}{CLASS_LABELS[p.cls] ?? p.cls}
                        {p.inj > 0 ? " · OUT" : isStarter ? "" : " · depth"}
                      </span>
                    </button>
                  );
                })}
                {stack.length === 0 && (
                  <div className="rounded bg-black/20 px-1.5 py-1 text-center text-[10px] text-chalk/70">empty</div>
                )}
                {stack.length > Math.max(starters + 1, 2) && (
                  <div className="text-center text-[9px] text-chalk/70">
                    +{stack.length - Math.max(starters + 1, 2)} more
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );

  return (
    <Card title="DEPTH CHART" tour="depth-chart" bodyClassName="p-0">
      <div className="gm-field space-y-4 rounded-b-card p-4">
        {band("OFFENSE", OFFENSE)}
        {band("DEFENSE", DEFENSE)}
        {band("SPECIAL TEAMS", SPECIAL)}
      </div>
      <p className="px-4 py-2 text-[11px] text-ink/55">
        Program-colored chips are this week's starters (📌 pins override OVR). Tap any player for their card.
        Depth-chart editing arrives with the mechanical update.
      </p>
    </Card>
  );
}

export function DevBadge({ tier }: { tier: number }) {
  const styles = [
    "border-stone-400 text-stone-600",
    "border-slate-500 text-slate-700",
    "border-amber-500 text-amber-700",
    "border-purple-600 text-purple-800",
  ];
  return (
    <span className={`inline-block rounded border px-1 text-[10px] font-bold tracking-wide ${styles[tier]}`}>
      {DEV_TIER_LABELS[tier].toUpperCase()}
    </span>
  );
}

function PlayerCard({ state, player, onClose }: { state: DynastyState; player: Player; onClose: () => void }) {
  const sheet = expandSheet(player);
  const colors = getTeamColors(state.teams[state.userTid]);
  const career = player.career;
  const peak = Math.max(player.ovr, ...career.map((c) => c.ovr));
  const floor = Math.min(player.ovr, ...career.map((c) => c.ovr));
  return (
    <Modal onClose={onClose}>
      {/* Header band in program colors */}
      <div className="-mx-5 -mt-5 mb-4 flex items-center justify-between px-5 py-4" style={{ background: colors.primary, color: colors.onPrimary }}>
        <div>
          <h3 className="font-display text-2xl leading-none">{player.name}</h3>
          <p className="mt-1 text-sm opacity-90">
            {player.pos} · {CLASS_LABELS[player.cls] ?? player.cls}
            {player.rs ? " (rs)" : ""} · {"★".repeat(player.stars)}
          </p>
        </div>
        <div className="text-right">
          <div className="font-display text-4xl leading-none">{player.ovr}</div>
          <div className="text-[10px] uppercase tracking-widest opacity-80">Overall</div>
        </div>
      </div>

      {/* Vitals row */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Vital label="Dev"><DevBadge tier={player.devTier} /></Vital>
        <Vital label="Morale">
          <span className={player.morale <= 35 ? "text-neg" : ""}>{player.morale}</span>
          <Meter value={player.morale} max={100} color={player.morale <= 35 ? "var(--neg)" : "var(--pos)"} height={5} className="mt-1" />
        </Vital>
        <Vital label="NIL">{player.nil > 0 ? fmtMoney(player.nil) : "unpaid"}</Vital>
        <Vital label="Market">{fmtMoney(marketValue(player))}</Vital>
      </div>
      {player.inj > 0 && (
        <p className="mt-2">
          <Pill tone="neg">OUT {player.inj} week{player.inj > 1 ? "s" : ""}</Pill>
        </p>
      )}

      <SectionLabel className="mt-5">RATINGS</SectionLabel>
      <div className="mt-1.5 grid grid-cols-2 gap-x-6 gap-y-1 text-sm sm:grid-cols-3">
        {sheet.map((e) => (
          <div key={e.label} className="flex items-center justify-between gap-2 border-b border-line/40 pb-0.5">
            <span className="text-xs text-ink/65">{e.label}</span>
            <span className="font-mono font-bold">{e.value}</span>
          </div>
        ))}
      </div>

      <SectionLabel className="mt-5">{state.season} SEASON</SectionLabel>
      <p className="mt-1 text-sm">{statLine(player) || "No stats yet."}</p>

      {career.length > 0 && (
        <>
          <SectionLabel className="mt-5">CAREER PROGRESSION</SectionLabel>
          <ProgressionBars career={career} current={{ season: state.season, ovr: player.ovr }} floor={floor} peak={peak} />
          <table className="mt-3 w-full text-xs">
            <thead>
              <tr className="border-b border-line text-ink/50">
                <th className={th}>YEAR</th>
                <th className={th}>YR</th>
                <th className={th}>OVR</th>
                <th className={th}>LINE</th>
              </tr>
            </thead>
            <tbody>
              {career.map((c) => (
                <tr key={c.season} className="border-b border-line/50">
                  <td className={td}>{c.season}</td>
                  <td className={td}>{CLASS_LABELS[c.cls] ?? c.cls}</td>
                  <td className={`${td} font-display`}>{c.ovr}</td>
                  <td className={td}>{careerLine(c) || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </Modal>
  );
}

function Vital({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-line/70 bg-surface-sunken/50 p-2">
      <div className="text-[10px] uppercase tracking-widest text-ink/50">{label}</div>
      <div className="mt-0.5 text-sm font-bold">{children}</div>
    </div>
  );
}

function ProgressionBars({
  career,
  current,
  floor,
  peak,
}: {
  career: { season: number; ovr: number }[];
  current: { season: number; ovr: number };
  floor: number;
  peak: number;
}) {
  const points = career.some((c) => c.season === current.season) ? career : [...career, current];
  const span = Math.max(1, peak - floor);
  return (
    <div className="mt-1.5 flex items-end gap-2">
      {points.map((c) => {
        const h = 16 + ((c.ovr - floor) / span) * 44;
        return (
          <div key={c.season} className="flex flex-1 flex-col items-center gap-1">
            <span className="font-display text-[11px]">{c.ovr}</span>
            <div className="w-full rounded-t bg-accent/80" style={{ height: h }} />
            <span className="text-[10px] text-ink/50">'{String(c.season).slice(2)}</span>
          </div>
        );
      })}
    </div>
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
  const rivals = new Set(state.teams[state.userTid].rivals ?? []);
  return (
    <Card
      title={`${state.season} SCHEDULE · ${school(state, state.userTid)}`}
      tour="schedule-table"
      bodyClassName="p-0"
    >
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-line bg-surface-sunken/50">
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
              const rival = rivals.has(opp);
              const win = us != null && them != null && us > them;
              return (
                <tr
                  key={game.id}
                  className="border-b border-line/50"
                  style={rival ? { boxShadow: "inset 3px 0 0 var(--accent)" } : undefined}
                >
                  <td className={`${td} font-display text-ink/60`}>{game.week}</td>
                  <td className={td}>
                    <span className="flex flex-wrap items-center gap-1.5">
                      <span className="text-ink/55">{home ? "vs" : "at"}</span>
                      <TeamRef state={state} tid={opp} />
                      {rival && <Pill tone="accent">RIVALRY</Pill>}
                      {game.name && <span className="text-xs text-ink/55">{game.name}</span>}
                      {game.conf && <Pill tone="neu">CONF</Pill>}
                    </span>
                  </td>
                  <td className={td}>
                    {result ? (
                      <StatusText tone={win ? "pos" : "neg"} className="font-display">
                        {win ? "W" : "L"} {us}-{them}{result.ot > 0 ? ` (${result.ot}OT)` : ""}
                      </StatusText>
                    ) : (
                      <span className="text-ink/35">—</span>
                    )}
                  </td>
                  <td className={td}>
                    {result?.box && (
                      <button
                        type="button"
                        className="text-xs font-bold text-accent hover:underline"
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
      </div>
      {boxFor && <BoxModal state={state} result={boxFor} onClose={() => setBoxFor(null)} />}
    </Card>
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
      {result.name && <p className="text-xs text-ink/55">{result.name}</p>}
      {result.totals && (
        <p className="mt-1 text-xs text-ink/70">
          {school(state, result.away)}: {result.totals.a.yd} yds ({result.totals.a.py} pass · {result.totals.a.ry} rush),{" "}
          {result.totals.a.to} TO — {school(state, result.home)}: {result.totals.h.yd} yds ({result.totals.h.py} pass ·{" "}
          {result.totals.h.ry} rush), {result.totals.h.to} TO
        </p>
      )}
      {result.star && <p className="mt-1 text-sm">⭐ {result.star}</p>}

      {result.box && (
        <>
          <SectionLabel className="mt-4">BOX SCORE</SectionLabel>
          {[result.away, result.home].map((tid) => {
            const lines = result.box!.filter((b) => b.t === tid);
            if (!lines.length) return null;
            return (
              <div key={tid} className="mt-2">
                <p className="font-display text-sm"><TeamName team={state.teams[tid]} /></p>
                <ul className="mt-1 space-y-0.5 text-xs">
                  {lines.map((b) => (
                    <li key={b.pid}>
                      <span className="font-bold">{b.name}</span> <span className="text-ink/55">{b.pos}</span> — {b.line}
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
            className="mt-4 text-xs font-bold text-accent hover:underline"
            onClick={() => setShowDrives(!showDrives)}
          >
            {showDrives ? "Hide" : "Show"} drive log ({result.drives.length} drives)
          </button>
          {showDrives && (
            <ul className="mt-2 max-h-64 space-y-0.5 overflow-y-auto text-xs">
              {result.drives.map((d, i) => (
                <li key={i}>
                  <span className="mr-1 rounded bg-surface-sunken px-1 text-[10px]">Q{d.q}</span>
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

// --- Standings -----------------------------------------------------------------

export function StandingsPanel({ state }: { state: DynastyState }) {
  return (
    <div className="grid gap-3 md:grid-cols-2" data-tour="standings-grid">
      {REAL_CONFS.map((conf) => (
        <Card key={conf} title={conf.toUpperCase()} bodyClassName="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line bg-surface-sunken/50">
                  <th className={th}>TEAM</th>
                  <th className={th}>CONF</th>
                  <th className={th}>OVERALL</th>
                  <th className={th}>PF-PA</th>
                </tr>
              </thead>
              <tbody>
                {confStandings(state.teams, conf).map((t) => (
                  <tr key={t.id} className="border-b border-line/50">
                    <td className={td}><TeamRef state={state} tid={t.id} /></td>
                    <td className={td}>{t.rec.cw}-{t.rec.cl}</td>
                    <td className={td}>{t.rec.w}-{t.rec.l}</td>
                    <td className={`${td} text-xs text-ink/60`}>{t.rec.pf}-{t.rec.pa}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      ))}
    </div>
  );
}

// --- Top 25 (merged rankings + postseason, V5) ---------------------------------

export function RankingsPanel({ state }: { state: DynastyState }) {
  return (
    <div className="space-y-3">
      <Top25Card state={state} />
      <PostseasonSection state={state} />
    </div>
  );
}

function Top25Card({ state }: { state: DynastyState }) {
  const rows = state.poll.slice(0, 25).map((e, i) => ({ e, rank: i + 1 }));
  const hopefuls = rows.slice(0, 12);
  const rest = rows.slice(12);
  const rankRow = ({ e, rank }: { e: DynastyState["poll"][number]; rank: number }) => {
    const t = state.teams[e.tid];
    return (
      <li key={e.tid} className="flex items-baseline gap-2 break-inside-avoid py-0.5">
        <span className="w-6 text-right font-display text-ink/45">{rank}</span>
        <TeamRef state={state} tid={e.tid} />
        <span className="text-xs text-ink/50">{t.rec.w}-{t.rec.l}</span>
        <span className="ml-auto text-xs"><Delta prev={e.prev} rank={rank} /></span>
      </li>
    );
  };
  return (
    <Card title={`TOP 25 · ${state.season}`} tour="poll">
      <div className="rounded-lg border border-pos/30 bg-pos-soft/40 p-3">
        <div className="mb-1.5 flex items-center gap-2">
          <SectionLabel className="!text-pos">🏈 PLAYOFF HOPEFULS · TOP 12</SectionLabel>
          <span className="h-px flex-1 bg-pos/20" />
        </div>
        <ol className="gap-x-8 text-sm sm:columns-2">{hopefuls.map(rankRow)}</ol>
      </div>
      <div className="mt-3 px-1">
        <div className="mb-1.5 flex items-center gap-2">
          <SectionLabel>13 – 25 · IN THE HUNT</SectionLabel>
          <span className="h-px flex-1 bg-line" />
        </div>
        <ol className="gap-x-8 text-sm sm:columns-2">{rest.map(rankRow)}</ol>
      </div>
    </Card>
  );
}

function PostseasonSection({ state }: { state: DynastyState }) {
  // Pre-bracket: the committee's live projected field, drawn as a bracket.
  if (!state.cfp) {
    const proj = committeeOrder(state.teams).slice(0, 12);
    return (
      <Card title="CFP PROJECTION" tour="cfp" right={<Pill tone="neu">LIVE · 12-TEAM</Pill>}>
        <p className="mb-3 text-xs text-ink/55">
          The committee's current 12 — 4 conference champions auto-bid at season's end.
        </p>
        <CfpBracket state={state} field={proj} results={[]} champion={null} />
      </Card>
    );
  }

  const bowls = state.results.filter((r) => r.kind === "bowl");
  return (
    <>
      <Card
        title="CFP BRACKET"
        tour="cfp"
        right={state.cfp.champion !== null ? <Pill tone="accent">🏆 CHAMPION CROWNED</Pill> : undefined}
      >
        {state.cfp.champion !== null && (
          <p className="mb-3 rounded-lg px-3 py-2 font-display" style={{ background: "var(--pos-soft)", color: "var(--pos)" }}>
            🏆 <TeamName team={state.teams[state.cfp.champion]} /> — National Champions
          </p>
        )}
        <CfpBracket state={state} field={state.cfp.field} results={state.cfp.results} champion={state.cfp.champion} />
      </Card>
      <Card title="BOWL SEASON">
        <ul className="space-y-1.5 text-sm">
          {bowls.map((r) => (
            <li key={r.gid} className="flex flex-wrap items-baseline gap-x-2">
              <span className="text-xs text-ink/55">{r.name}:</span>
              <ScoreInline state={state} r={r} />
            </li>
          ))}
          {bowls.length === 0 && <li className="text-xs text-ink/55">Bowls play in playoff week 1.</li>}
        </ul>
      </Card>
    </>
  );
}

// The fixed 12-team bracket order (byes fold into round 1 → a clean 8→4→2→1
// tree). Each pair = a top-4 bye seed + the first-round matchup that feeds it.
const BRACKET_PAIRS: { bye: number; r1: [number, number] }[] = [
  { bye: 1, r1: [8, 9] },
  { bye: 4, r1: [5, 12] },
  { bye: 2, r1: [7, 10] },
  { bye: 3, r1: [6, 11] },
];

function findResult(results: GameResult[], a: number, b: number): GameResult | null {
  return results.find((r) => (r.home === a && r.away === b) || (r.home === b && r.away === a)) ?? null;
}
function winnerOf(r: GameResult): number {
  return r.hs >= r.as ? r.home : r.away;
}

function CfpBracket({
  state,
  field,
  results,
  champion,
}: {
  state: DynastyState;
  field: number[];
  results: GameResult[];
  champion: number | null;
}) {
  const seed = (n: number): number | undefined => field[n - 1];
  const r1res = results.filter((r) => r.kind === "cfp-r1");
  const qfres = results.filter((r) => r.kind === "cfp-qf");
  const sfres = results.filter((r) => r.kind === "cfp-sf");
  const ncres = results.filter((r) => r.kind === "cfp-nc");

  // Round 1 column: 8 slots (bye seed, then its feeder matchup), pair by pair.
  const r1slots = BRACKET_PAIRS.flatMap((p) => {
    const [aS, bS] = p.r1;
    const a = seed(aS);
    const b = seed(bS);
    const res = a != null && b != null ? findResult(r1res, a, b) : null;
    return [
      { kind: "bye" as const, tids: [seed(p.bye)], seeds: [p.bye], res: null },
      { kind: "match" as const, tids: [a, b], seeds: [aS, bS], res },
    ];
  });

  // Quarterfinals: bye seed vs round-1 winner, one per pair.
  const qfMatches = BRACKET_PAIRS.map((p) => {
    const byeTid = seed(p.bye);
    const [aS, bS] = p.r1;
    const a = seed(aS);
    const b = seed(bS);
    const r1 = a != null && b != null ? findResult(r1res, a, b) : null;
    const r1w = r1 ? winnerOf(r1) : undefined;
    const res = byeTid != null && r1w != null ? findResult(qfres, byeTid, r1w) : null;
    return { tids: [byeTid, r1w], res, byeTid };
  });

  // Semifinals: top pair (0,1) and bottom pair (2,3) of the QF.
  const sfMatches = [[0, 1], [2, 3]].map((pair) => {
    const w0 = qfMatches[pair[0]].res ? winnerOf(qfMatches[pair[0]].res!) : undefined;
    const w1 = qfMatches[pair[1]].res ? winnerOf(qfMatches[pair[1]].res!) : undefined;
    const res = w0 != null && w1 != null ? findResult(sfres, w0, w1) : null;
    return { tids: [w0, w1], res };
  });

  const ncW0 = sfMatches[0].res ? winnerOf(sfMatches[0].res!) : undefined;
  const ncW1 = sfMatches[1].res ? winnerOf(sfMatches[1].res!) : undefined;
  const ncMatch = { tids: [ncW0, ncW1], res: ncW0 != null && ncW1 != null ? findResult(ncres, ncW0, ncW1) : null };

  return (
    <div className="overflow-x-auto">
      <div className="gm-bracket flex min-w-[640px] gap-0">
        <BracketRound label="First Round" first>
          {r1slots.map((s, i) => (
            <BracketMatch key={i} state={state} tids={s.tids} seeds={s.seeds} res={s.res} bye={s.kind === "bye"} champion={champion} />
          ))}
        </BracketRound>
        <BracketRound label="Quarterfinals">
          {qfMatches.map((m, i) => (
            <BracketMatch key={i} state={state} tids={m.tids} res={m.res} champion={champion} />
          ))}
        </BracketRound>
        <BracketRound label="Semifinals">
          {sfMatches.map((m, i) => (
            <BracketMatch key={i} state={state} tids={m.tids} res={m.res} champion={champion} />
          ))}
        </BracketRound>
        <BracketRound label="Championship" last>
          <BracketMatch state={state} tids={ncMatch.tids} res={ncMatch.res} champion={champion} />
        </BracketRound>
      </div>
    </div>
  );
}

function BracketRound({
  label,
  children,
  first,
  last,
}: {
  label: string;
  children: React.ReactNode;
  first?: boolean;
  last?: boolean;
}) {
  return (
    <div className="flex flex-1 flex-col">
      <div className="mb-2 text-center font-display text-[10px] tracking-[0.2em] text-ink/50">{label}</div>
      <div className={`flex flex-1 flex-col ${last ? "" : "gm-bracket-feeds"} ${first ? "" : "gm-bracket-fed"}`}>
        {children}
      </div>
    </div>
  );
}

function BracketMatch({
  state,
  tids,
  seeds,
  res,
  bye,
  champion,
}: {
  state: DynastyState;
  tids: (number | undefined)[];
  seeds?: number[];
  res: GameResult | null;
  bye?: boolean;
  champion?: number | null;
}) {
  const winner = res ? winnerOf(res) : null;
  const row = (tid: number | undefined, idx: number) => {
    if (tid == null) {
      return (
        <div key={idx} className="flex items-center justify-between gap-1 px-2 py-1 text-xs text-ink/35">
          <span>{seeds ? `Seed ${seeds[idx]}` : "TBD"}</span>
        </div>
      );
    }
    const t = state.teams[tid];
    const isW = winner === tid;
    const isChamp = champion != null && champion === tid;
    const sc = res ? (res.home === tid ? res.hs : res.as) : null;
    return (
      <div
        key={idx}
        className={`flex items-center justify-between gap-1 px-2 py-1 text-xs ${isW ? "bg-pos-soft/50" : ""}`}
      >
        <span className="flex items-center gap-1 truncate">
          {seeds && <span className="text-ink/40">{seeds[idx]}</span>}
          <TeamName team={t} lead={isW || isChamp} />
          {isChamp && <span>🏆</span>}
        </span>
        {sc != null && <span className={`font-display tabular-nums ${isW ? "text-pos" : "text-ink/45"}`}>{sc}</span>}
      </div>
    );
  };
  return (
    <div className="gm-bracket-match relative flex flex-1 flex-col justify-center px-3">
      <div className={`rounded-lg border ${bye ? "border-dashed border-line/60 bg-surface-sunken/40" : "border-line bg-surface-raised"} shadow-card`}>
        {bye ? (
          <div className="flex items-center justify-between px-2 py-1.5 text-xs">
            <span className="flex items-center gap-1">
              {seeds && <span className="text-ink/40">{seeds[0]}</span>}
              {tids[0] != null ? <TeamName team={state.teams[tids[0]]} /> : "TBD"}
            </span>
            <span className="text-[9px] uppercase tracking-widest text-ink/40">bye</span>
          </div>
        ) : (
          <>
            {row(tids[0], 0)}
            <div className="border-t border-line/60" />
            {row(tids[1], 1)}
          </>
        )}
      </div>
    </div>
  );
}

function ScoreInline({ state, r }: { state: DynastyState; r: GameResult }) {
  const winHome = r.hs > r.as;
  return (
    <span className="text-sm">
      <TeamName team={state.teams[r.away]} lead={!winHome} /> <span className="tabular-nums">{r.as}</span>
      <span className="mx-1 text-ink/40">—</span>
      <span className="tabular-nums">{r.hs}</span> <TeamName team={state.teams[r.home]} lead={winHome} />
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
      <TrophyCase state={state} />
      <Card title="SEASON LEDGER" tour="history-ledger" bodyClassName="p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line bg-surface-sunken/50">
                <th className={th}>SEASON</th>
                <th className={th}>CHAMPION</th>
                <th className={th}>YOU</th>
                <th className={th}>POY</th>
              </tr>
            </thead>
            <tbody>
              {[...state.honors].reverse().map((h) => (
                <tr key={h.season} className="border-b border-line/50 align-top">
                  <td className={`${td} font-display`}>{h.season}</td>
                  <td className={td}>{h.champion !== null ? <TeamName team={state.teams[h.champion]} /> : "—"}</td>
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
                    <span className="text-xs text-ink/55">Finish a season to start the ledger.</span>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>
      <RecordBookCard state={state} />
      <Card title={`PROGRAM LEGENDS · ${rows ? rows.filter((r) => r.player.tid === state.userTid).length : "…"} DEPARTED`}>
        <ul className="space-y-1.5 text-sm">
          {legends.map((r) => (
            <li key={r.id}>
              <span className="font-bold">{r.player.name}</span>{" "}
              <span className="text-xs text-ink/55">
                {r.player.pos} · left {r.season} ({r.player.reason}) · peaked {r.player.ovr} OVR
              </span>
            </li>
          ))}
          {legends.length === 0 && (
            <li className="text-xs text-ink/55">Your departed greats will be remembered here.</li>
          )}
        </ul>
      </Card>
    </div>
  );
}

function TrophyCase({ state }: { state: DynastyState }) {
  const natties = state.honors.filter((h) => h.champion === state.userTid);
  const ccgs = state.honors.filter((h) => h.userCcg);
  const cfps = state.honors.filter((h) => h.userCfp).length;
  if (natties.length === 0 && ccgs.length === 0 && cfps === 0) return null;
  return (
    <Card title="YOUR TROPHY CASE" className="md:col-span-2">
      <div className="flex flex-wrap gap-2">
        {natties.map((h) => (
          <span
            key={`n${h.season}`}
            className="rounded-lg border-2 border-gold bg-gold/10 px-3 py-2 font-display text-sm text-gold shadow-sm"
          >
            🏆 {h.season} NATIONAL CHAMPIONS
          </span>
        ))}
        {ccgs.map((h) => (
          <span
            key={`c${h.season}`}
            className="rounded-lg border-2 border-line-strong bg-surface-sunken px-3 py-2 font-display text-xs"
          >
            🥇 {h.season} CONFERENCE CHAMPS
          </span>
        ))}
        {cfps > 0 && (
          <span className="rounded-lg border-2 border-line bg-surface-sunken px-3 py-2 font-display text-xs">
            🎟️ {cfps} CFP APPEARANCE{cfps > 1 ? "S" : ""}
          </span>
        )}
      </div>
    </Card>
  );
}

function RecordBookCard({ state }: { state: DynastyState }) {
  const cats = Object.keys(state.records);
  const [cat, setCat] = useState<string>(cats[0] ?? "Passing yards");
  const [mode, setMode] = useState<"season" | "career">("season");
  const book = state.records[cat];
  return (
    <Card
      title="NATIONAL RECORD BOOK"
      className="md:col-span-2"
      right={
        <div className="flex items-center gap-2 text-xs">
          <select
            value={cat}
            onChange={(e) => setCat(e.target.value)}
            className="rounded border border-line bg-surface-raised px-1 py-0.5"
          >
            {cats.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
          {(["season", "career"] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setMode(m)}
              className={`rounded-full border px-2 py-0.5 font-display tracking-widest ${mode === m ? "border-ink bg-ink text-paper" : "border-line"}`}
            >
              {m.toUpperCase()}
            </button>
          ))}
        </div>
      }
    >
      {book ? (
        <ol className="columns-1 text-sm sm:columns-2">
          {book[mode].map((e, i) => (
            <li key={`${e.name}-${e.season}-${i}`} className="mb-0.5 break-inside-avoid">
              <span className="inline-block w-6 font-display text-ink/45">{i + 1}.</span>
              <span className="font-bold">{e.name}</span>{" "}
              <span className="text-xs text-ink/55">
                {e.school} · {mode === "season" ? e.season : `since ${e.season}`}
              </span>{" "}
              <span className="font-mono">{e.value}</span>
            </li>
          ))}
        </ol>
      ) : (
        <p className="text-xs text-ink/55">Finish a season to open the book.</p>
      )}
    </Card>
  );
}

// --- Offseason (stage-driven, v1.2) ---------------------------------------------

export function OffseasonPanel({
  state,
  onRetention,
  onPortal,
  onTakeJob,
}: {
  state: DynastyState;
  onRetention: (paidPids: number[]) => void;
  onPortal: (offers: PortalOffer[]) => void;
  onTakeJob?: (tid: number) => void;
}) {
  if (state.offStage === "retention") {
    return <RetentionStage state={state} onRetention={onRetention} />;
  }
  if (state.offStage === "portal") {
    return <PortalStage state={state} onPortal={onPortal} />;
  }
  return <OffseasonReportView state={state} onTakeJob={onTakeJob} />;
}

function BudgetBar({ state, committed }: { state: DynastyState; committed: number }) {
  const budget = state.teams[state.userTid].nilBudget;
  const over = committed > budget;
  return (
    <div className="text-sm">
      <span className="text-ink/60">NIL pool </span>
      <span className="font-display">{fmtMoney(budget)}</span>
      {committed > 0 && (
        <>
          <span className="text-ink/60"> · committed </span>
          <StatusText tone={over ? "neg" : "pos"} className="font-display">{fmtMoney(committed)}</StatusText>
          {over ? <span className="text-neg"> — over budget, trim your offers</span> : ""}
        </>
      )}
      <Meter value={committed} max={budget || 1} color={over ? "var(--neg)" : "var(--pos)"} className="mt-1" height={6} />
    </div>
  );
}

function RetentionStage({
  state,
  onRetention,
}: {
  state: DynastyState;
  onRetention: (paidPids: number[]) => void;
}) {
  const [picked, setPicked] = useState<number[]>([]);
  const committed = state.retention
    .filter((c) => picked.includes(c.pid))
    .reduce((a, c) => a + c.ask, 0);
  const budget = state.teams[state.userTid].nilBudget;
  return (
    <Card title="RETENTION WINDOW" right={<Pill tone="neu">OFFSEASON · STAGE 1</Pill>}>
      <p className="text-sm text-ink/75">
        These players have one foot in the portal. Pay their ask and they'll probably stay (loyalty helps); pass
        and they're gone. Money only leaves your pool on a successful re-sign.
      </p>
      <div className="mt-3">
        <BudgetBar state={state} committed={committed} />
      </div>
      <ul className="mt-3 space-y-2">
        {state.retention.map((c) => {
          const p = state.players[c.pid];
          const on = picked.includes(c.pid);
          return (
            <li key={c.pid} className="flex items-center justify-between rounded-lg border border-line bg-surface-sunken/40 px-3 py-2">
              <div>
                <span className="font-bold">{p.name}</span>{" "}
                <span className="text-xs text-ink/55">
                  {p.pos} · {p.ovr} OVR · morale {p.morale} · {c.reason}
                </span>
              </div>
              <button
                type="button"
                onClick={() => setPicked(on ? picked.filter((x) => x !== c.pid) : [...picked, c.pid])}
                className={`rounded-full border-2 px-4 py-1 font-display text-xs tracking-widest transition ${
                  on ? "border-ink bg-ink text-paper" : "border-line hover:border-ink/40"
                }`}
              >
                {on ? `PAYING ${fmtMoney(c.ask)}` : `PAY ${fmtMoney(c.ask)}`}
              </button>
            </li>
          );
        })}
        {state.retention.length === 0 && (
          <li className="text-sm text-ink/55">Nobody is threatening to leave. Lucky you.</li>
        )}
      </ul>
      <button
        type="button"
        disabled={committed > budget}
        onClick={() => onRetention(picked)}
        className="mt-4 rounded-full border-2 border-ink bg-ink px-6 py-2 font-display text-xs tracking-widest text-paper transition hover:opacity-85 disabled:opacity-40"
      >
        CONFIRM → OPEN THE PORTAL
      </button>
    </Card>
  );
}

type PortalSort = "ovr" | "ask" | "pos" | "from";

function PortalStage({
  state,
  onPortal,
}: {
  state: DynastyState;
  onPortal: (offers: PortalOffer[]) => void;
}) {
  const [offers, setOffers] = useState<Record<number, number>>({});
  const [posFilter, setPosFilter] = useState<string>("ALL");
  const [sort, setSort] = useState<PortalSort>("ovr");
  const committed = Object.values(offers).reduce((a, b) => a + b, 0);
  const budget = state.teams[state.userTid].nilBudget;
  const needs = useMemo(() => {
    const have = new Map<string, number>();
    for (const pid of state.teams[state.userTid].roster) {
      const p = state.players[pid];
      have.set(p.g, (have.get(p.g) ?? 0) + 1);
    }
    const targets: [string, number][] = [
      ["QB", 4], ["RB", 6], ["WR", 9], ["TE", 4], ["OL", 14],
      ["DL", 12], ["LB", 9], ["CB", 7], ["S", 6], ["K", 2], ["P", 2],
    ];
    return new Map(targets.map(([g, want]) => [g, Math.max(0, want - (have.get(g) ?? 0))]));
  }, [state]);
  const rows = useMemo(() => {
    let list = state.portal;
    if (posFilter !== "ALL") list = list.filter((e) => state.players[e.pid]?.g === posFilter);
    const cmp: Record<PortalSort, (a: typeof list[number], b: typeof list[number]) => number> = {
      ovr: (a, b) => state.players[b.pid].ovr - state.players[a.pid].ovr,
      ask: (a, b) => b.ask - a.ask,
      pos: (a, b) => state.players[a.pid].g.localeCompare(state.players[b.pid].g) || state.players[b.pid].ovr - state.players[a.pid].ovr,
      from: (a, b) => school(state, a.fromTid).localeCompare(school(state, b.fromTid)),
    };
    return [...list].sort(cmp[sort]).slice(0, 40);
  }, [state, posFilter, sort]);

  const sortableTh = (key: PortalSort, label: string, extra = "") => (
    <th className={`${th} ${extra} cursor-pointer select-none hover:text-ink`} onClick={() => setSort(key)}>
      {label}{sort === key ? " ▾" : ""}
    </th>
  );

  return (
    <div className="grid gap-3 lg:grid-cols-3">
      <Card
        title="TRANSFER PORTAL"
        className="lg:col-span-2"
        right={<Pill tone="accent">ROUND {state.portalRound} / 3</Pill>}
        bodyClassName="p-4"
      >
        <BudgetBar state={state} committed={committed} />
        <p className="mt-2 text-xs text-ink/60">
          Bids need to clear ~90% of the ask to register. Everyone else is bidding too.
        </p>
        <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
          <select
            value={posFilter}
            onChange={(e) => setPosFilter(e.target.value)}
            className="rounded border border-line bg-surface-raised px-1 py-0.5"
          >
            {["ALL", "QB", "RB", "WR", "TE", "OL", "DL", "LB", "CB", "S", "K", "P"].map((p) => (
              <option key={p} value={p}>{p}</option>
            ))}
          </select>
          <span className="text-ink/55">
            Open needs:{" "}
            {[...needs.entries()].filter(([, n]) => n > 0).map(([g, n]) => `${g}×${n}`).join(" ") || "none"}
          </span>
        </div>
        <div className="mt-2 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line bg-surface-sunken/50">
                <th className={th}>PLAYER</th>
                {sortableTh("pos", "POS")}
                {sortableTh("ovr", "OVR")}
                {sortableTh("from", "FROM")}
                {sortableTh("ask", "ASK")}
                <th className={th}>PROGRESS</th>
                <th className={th}>MY OFFER</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((e) => {
                const p = state.players[e.pid];
                const need = (needs.get(p.g) ?? 0) > 0;
                const myOffer = offers[e.pid] ?? 0;
                // Commitment progress slot: your bid vs the ask is the visible
                // signal today; the mechanical PR wires the real interest race.
                const progress = e.ask > 0 ? Math.min(100, (myOffer / e.ask) * 100) : 0;
                return (
                  <tr key={e.pid} className="border-b border-line/50">
                    <td className={td}>
                      <span className="font-bold">{p.name}</span>{" "}
                      <span className="text-xs text-ink/45">{CLASS_LABELS[p.cls] ?? p.cls}</span>
                      {need && <Pill tone="pos" className="ml-1 !px-1.5 !py-0">NEED</Pill>}
                    </td>
                    <td className={`${td} font-display`}>{p.g}</td>
                    <td className={`${td} font-mono`}>{p.ovr}</td>
                    <td className={`${td} text-xs`}><TeamName team={state.teams[e.fromTid]} /></td>
                    <td className={`${td} font-mono text-xs`}>{fmtMoney(e.ask)}</td>
                    <td className={td}>
                      <div className="flex items-center gap-1">
                        <Meter value={progress} max={100} color={progress >= 90 ? "var(--pos)" : "var(--accent)"} height={6} className="w-16" />
                        <span className="text-[10px] text-ink/50">{Math.round(progress)}%</span>
                      </div>
                    </td>
                    <td className={td}>
                      <input
                        type="number"
                        min={0}
                        step={50}
                        value={offers[e.pid] ? offers[e.pid] / 1000 : ""}
                        placeholder="$k"
                        onChange={(ev) => {
                          const v = Math.max(0, Number(ev.target.value)) * 1000;
                          setOffers((o) => {
                            const next = { ...o };
                            if (v > 0) next[e.pid] = v;
                            else delete next[e.pid];
                            return next;
                          });
                        }}
                        className="w-20 rounded border border-line bg-surface-raised px-1 py-0.5 font-mono text-xs"
                      />
                    </td>
                  </tr>
                );
              })}
              {rows.length === 0 && (
                <tr>
                  <td className={td} colSpan={7}>
                    <span className="text-sm text-ink/55">The portal is empty this round.</span>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <button
          type="button"
          disabled={committed > budget}
          onClick={() => {
            onPortal(Object.entries(offers).map(([pid, amount]) => ({ pid: Number(pid), amount })));
            setOffers({});
          }}
          className="mt-4 rounded-full border-2 border-ink bg-ink px-6 py-2 font-display text-xs tracking-widest text-paper transition hover:opacity-85 disabled:opacity-40"
        >
          SUBMIT ROUND {state.portalRound}
        </button>
      </Card>
      <Card title="YOUR PORTAL LEDGER">
        <ul className="space-y-1 text-xs">
          {state.portalLog.map((l, i) => (
            <li key={i} className={l.startsWith("IN") ? "text-pos" : l.startsWith("STAY") ? "" : "text-neg"}>
              {l}
            </li>
          ))}
          {state.portalLog.length === 0 && <li className="text-ink/55">Quiet so far.</li>}
        </ul>
      </Card>
    </div>
  );
}

function OffseasonReportView({
  state,
  onTakeJob,
}: {
  state: DynastyState;
  onTakeJob?: (tid: number) => void;
}) {
  const r = state.offseason!;
  const honors = state.honors[state.honors.length - 1];
  const userTeam = state.teams[state.userTid];
  const colors = getTeamColors(userTeam);
  const allConf = honors?.allConf?.[userTeam.conference];

  return (
    <div className="space-y-3">
      {/* Big hero wrap-up */}
      <Card accent={colors.primary} bodyClassName="p-0">
        <div className="px-5 py-5" style={{ background: `linear-gradient(180deg, ${colors.primary}14, transparent)` }}>
          <SectionLabel>SEASON WRAPPED</SectionLabel>
          <h2 className="mt-1 font-display text-3xl leading-none sm:text-4xl">{r.season} in the books</h2>
          <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
            {honors && honors.champion !== null && (
              <Pill tone="accent">🏆 {school(state, honors.champion)} — National Champions</Pill>
            )}
            <span className="rounded-lg border border-line bg-surface-raised px-3 py-1.5">
              You finished <span className="font-display text-base">{honors?.userRecord}</span>
              {honors?.userPollRank ? <> · <span className="font-display">#{honors.userPollRank}</span></> : ""}
            </span>
            <span className="rounded-lg border border-line bg-surface-raised px-3 py-1.5">
              Class rank <span className="font-display text-base">#{r.classRank}</span>
            </span>
            <span className="rounded-lg border border-line bg-surface-raised px-3 py-1.5">
              Next NIL pool <span className="font-display text-base">{fmtMoney(userTeam.nilBudget)}</span>
            </span>
            {honors?.poy && (
              <span className="rounded-lg border border-line bg-surface-raised px-3 py-1.5">POY: {honors.poy}</span>
            )}
          </div>
          {state.mandates.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-2 text-sm">
              {state.mandates.map((m, i) => (
                <span key={i} className="rounded-lg border border-line bg-surface-raised px-2.5 py-1">
                  {m.met === null ? "⏳" : m.met ? "✅" : "❌"} {m.text}
                </span>
              ))}
            </div>
          )}
          <ShareRecapButton state={state} />
        </div>
      </Card>

      {/* Risers & Droppers — headline, side by side (V6.3) */}
      <div className="grid gap-3 md:grid-cols-2">
        <Card title="📈 BIGGEST RISERS" accent="var(--pos)">
          <ul className="space-y-2">
            {r.risers.map((x, i) => (
              <li key={i} className="flex items-center justify-between gap-2">
                <span>
                  <span className="font-bold">{x.name}</span>{" "}
                  <span className="text-xs text-ink/55">{x.pos}</span>
                </span>
                <span className="flex items-center gap-2 text-sm">
                  <span className="text-ink/50">{x.from}</span>
                  <span className="text-ink/40">→</span>
                  <span className="font-display text-lg text-pos">{x.to}</span>
                  <Pill tone="pos">+{x.to - x.from}</Pill>
                </span>
              </li>
            ))}
            {r.risers.length === 0 && <li className="text-sm text-ink/55">A quiet development camp.</li>}
          </ul>
        </Card>
        <Card title="📉 BIGGEST DROPPERS" accent="var(--neg)">
          {/* Droppers feed comes from the mechanical progression PR. */}
          <div className="flex h-full min-h-[80px] flex-col items-center justify-center text-center">
            <p className="text-sm text-ink/55">No regressions to report this camp.</p>
            <p className="mt-1 text-[11px] text-ink/40">Decline tracking arrives with the mechanical update.</p>
          </div>
        </Card>
      </div>

      {/* All-Americans / All-Conference by unit (V6.2) */}
      {(honors?.allAmericans?.length || allConf?.length) && (
        <Card title="POSTSEASON HONORS">
          <div className="grid gap-4 md:grid-cols-2">
            {honors?.allAmericans && honors.allAmericans.length > 0 && (
              <HonorsList label="ALL-AMERICANS (1ST TEAM)" entries={honors.allAmericans} />
            )}
            {allConf && allConf.length > 0 && (
              <HonorsList label={`ALL-${userTeam.conference.toUpperCase()} (1ST TEAM)`} entries={allConf} />
            )}
          </div>
        </Card>
      )}

      {state.openJobs.length > 0 && onTakeJob && (
        <Card title="🧳 OPEN JOBS — THE CAROUSEL IS SPINNING" accent="var(--accent)">
          <ul className="space-y-2">
            {state.openJobs.map((tid) => {
              const t = state.teams[tid];
              return (
                <li key={tid} className="flex items-center justify-between gap-2">
                  <span className="flex items-center gap-2">
                    <TeamName team={t} />
                    <span className="text-xs text-ink/55">
                      {"★".repeat(t.prestige)} · {t.conference} · NIL {fmtMoney(t.nilBudget)}
                    </span>
                  </span>
                  <button
                    type="button"
                    className="rounded-full border-2 border-line px-3 py-0.5 font-display text-[10px] tracking-widest transition hover:border-ink/50"
                    onClick={() => {
                      if (window.confirm(`Leave ${school(state, state.userTid)} for ${t.school}?`)) {
                        onTakeJob(tid);
                      }
                    }}
                  >
                    TAKE JOB
                  </button>
                </li>
              );
            })}
          </ul>
        </Card>
      )}

      <div className="grid gap-3 md:grid-cols-2">
        <Card title="DEPARTURES">
          <ul className="space-y-1 text-sm">
            {r.departures.map((d, i) => (
              <li key={i}>
                <span className="font-bold">{d.name}</span>{" "}
                <span className="text-xs text-ink/55">
                  {d.pos} · {d.ovr} OVR · {d.reason}
                  {d.detail ? ` (${d.detail})` : ""}
                </span>
              </li>
            ))}
            {r.departures.length === 0 && <li className="text-xs text-ink/55">Everyone returns!</li>}
          </ul>
        </Card>

        <Card title="SIGNING CLASS + PORTAL">
          <ul className="space-y-1 text-sm">
            {r.signees.map((s, i) => (
              <li key={i}>
                <span className="text-gold">{"★".repeat(s.stars)}</span> <span className="font-bold">{s.name}</span>{" "}
                <span className="text-xs text-ink/55">{s.pos} · {s.ovr} OVR</span>
              </li>
            ))}
          </ul>
          {state.portalLog.length > 0 && (
            <ul className="mt-3 space-y-0.5 border-t border-line/70 pt-2 text-xs">
              {state.portalLog.map((l, i) => (
                <li key={i} className={l.startsWith("IN") ? "text-pos" : l.startsWith("STAY") ? "" : "text-neg"}>
                  {l}
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <Card title="PRESTIGE MOVES">
        <ul className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
          {r.prestigeChanges.map((c, i) => (
            <li key={i} className="flex items-center gap-1.5">
              <span className="font-bold">{c.school}</span>
              <span className="text-xs text-ink/55">{"★".repeat(c.from)} → {"★".repeat(c.to)}</span>
              <StatusText tone={c.to > c.from ? "pos" : "neg"}>{c.to > c.from ? "📈" : "📉"}</StatusText>
            </li>
          ))}
          {r.prestigeChanges.length === 0 && <li className="text-xs text-ink/55">The order holds.</li>}
        </ul>
      </Card>
    </div>
  );
}

/** Group an "POS Name (School)" honors list by offense/defense/special unit. */
function HonorsList({ label, entries }: { label: string; entries: string[] }) {
  const UNIT: Record<string, PosGroup[]> = {
    OFFENSE: ["QB", "RB", "WR", "TE", "OL"],
    DEFENSE: ["DL", "LB", "CB", "S"],
    "SPECIAL TEAMS": ["K", "P"],
  };
  const posOf = (s: string) => s.trim().split(/\s+/)[0];
  const grouped = Object.entries(UNIT)
    .map(([unit, groups]) => ({
      unit,
      list: entries.filter((e) => groups.some((g) => posOf(e).startsWith(g))),
    }))
    .filter((u) => u.list.length > 0);
  const leftover = entries.filter((e) => !grouped.some((u) => u.list.includes(e)));

  return (
    <div className="rounded-lg border border-line bg-surface-sunken/40 p-3">
      <SectionLabel>{label}</SectionLabel>
      <div className="mt-2 space-y-2">
        {grouped.map((u) => (
          <div key={u.unit}>
            <div className="text-[10px] font-bold uppercase tracking-widest text-ink/45">{u.unit}</div>
            <ul className="mt-0.5 space-y-0.5 text-sm">
              {u.list.map((e, i) => (
                <li key={i}>{e}</li>
              ))}
            </ul>
          </div>
        ))}
        {leftover.length > 0 && (
          <ul className="space-y-0.5 text-sm">
            {leftover.map((e, i) => (
              <li key={i}>{e}</li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function ShareRecapButton({ state }: { state: DynastyState }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className="mt-4 rounded-full border-2 border-line bg-surface-raised px-4 py-1.5 font-display text-[10px] tracking-widest transition hover:border-ink/40"
      onClick={() => {
        void navigator.clipboard.writeText(buildSeasonRecap(state)).then(() => {
          setCopied(true);
          window.setTimeout(() => setCopied(false), 2000);
        });
      }}
    >
      {copied ? "COPIED ✓" : "📋 COPY SEASON RECAP"}
    </button>
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
        className="max-h-[85vh] w-full max-w-lg overflow-y-auto rounded-card border border-line bg-surface-raised p-5 shadow-raised"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
      >
        {children}
        <button
          type="button"
          onClick={onClose}
          className="mt-4 rounded-full border-2 border-line px-4 py-1 font-display text-xs tracking-widest transition hover:border-ink/40"
        >
          CLOSE
        </button>
      </div>
    </div>
  );
}
