// The recruiting board (v1.1): RAP economy, scouting reveals, deal-breaker
// locks, live interest race. Mutations go through engine/recruiting.ts and
// the shell's onMutate (autosave + re-render). Presentation is the V0 system.
import { useMemo, useState } from "react";
import type { DynastyState, PosGroup, Recruit } from "./engine/types.ts";
import {
  COMMIT_THRESHOLD, dealBreakerLock, RAP_ACTIONS, removeFromBoard, shownOvr, staminaMax,
  teamNeeds, userAction, userPoints, type RapAction,
} from "./engine/recruiting.ts";
import { STAR_POINTS } from "./engine/recruits.ts";
import { DevBadge } from "./panels.tsx";
import { Card, Meter, Pill, SectionLabel, StatusText, TeamBadge, TeamName } from "./ui.tsx";

const th = "px-2 py-1.5 text-left font-display text-[10px] tracking-widest text-ink/50";
const td = "px-2 py-1.5";

const POS_FILTERS: (PosGroup | "ALL")[] = ["ALL", "QB", "RB", "WR", "TE", "OL", "DL", "LB", "CB", "S", "K", "P"];
type ViewFilter = "board" | "targets" | "commits";
type SortKey = "stars" | "ovr" | "pos" | "interest" | "mine";

// The four outreach actions, written out — read what each does before spending.
const OUTREACH: { key: RapAction; label: string; blurb: string }[] = [
  { key: "dm", label: "DM", blurb: `+${RAP_ACTIONS.dm.pts} interest` },
  { key: "coach", label: "Position coach", blurb: `+${RAP_ACTIONS.coach.pts} interest` },
  { key: "hc", label: "HC in-home", blurb: `+${RAP_ACTIONS.hc.pts}, once each` },
  { key: "visit", label: "Official visit", blurb: `+${RAP_ACTIONS.visit.pts} interest` },
];

export default function RecruitingPanel({
  state,
  onMutate,
}: {
  state: DynastyState;
  onMutate: () => void;
}) {
  const [pos, setPos] = useState<PosGroup | "ALL">("ALL");
  const [minStars, setMinStars] = useState(2);
  const [view, setView] = useState<ViewFilter>("board");
  const [sort, setSort] = useState<SortKey>("stars");
  const [flash, setFlash] = useState<string | null>(null);
  // One open action tray at a time — rows stay quiet until you're working one (V1).
  const [sel, setSel] = useState<number | null>(null);

  // Recruiting is offseason-only now (M0.1): the board is CLOSED in-season.
  const closed = state.phase !== "offseason";
  const removedCount = useMemo(() => state.recruits.filter((r) => r.hidden).length, [state]);
  const myCommits = useMemo(
    () => state.recruits.filter((r) => r.committed === state.userTid),
    [state],
  );
  const classPts = myCommits.reduce((a, r) => a + (STAR_POINTS[r.stars] ?? 0), 0);

  const rows = useMemo(() => {
    let list = state.recruits.filter((r) => !r.hidden);
    if (view === "targets") list = list.filter((r) => userPoints(r, state.userTid) > 0 && r.committed === null);
    if (view === "commits") list = list.filter((r) => r.committed === state.userTid);
    if (pos !== "ALL") list = list.filter((r) => r.g === pos);
    list = list.filter((r) => r.stars >= minStars);
    const cmp: Record<SortKey, (a: Recruit, b: Recruit) => number> = {
      stars: (a, b) => b.stars - a.stars || b.ovr - a.ovr,
      ovr: (a, b) => b.ovr - a.ovr,
      pos: (a, b) => a.g.localeCompare(b.g) || b.ovr - a.ovr,
      interest: (a, b) => (b.leads[0]?.p ?? 0) - (a.leads[0]?.p ?? 0),
      mine: (a, b) => userPoints(b, state.userTid) - userPoints(a, state.userTid),
    };
    return [...list].sort(cmp[sort]).slice(0, 150);
  }, [state, pos, minStars, view, sort]);

  const act = (rid: number, a: RapAction) => {
    const err = userAction(state, rid, a);
    if (err) {
      setFlash(err);
      window.setTimeout(() => setFlash(null), 2500);
    } else {
      onMutate();
    }
  };

  const sortableTh = (key: SortKey, label: string, extra = "") => (
    <th className={`${th} ${extra} cursor-pointer select-none hover:text-ink`} onClick={() => setSort(key)}>
      {label}{sort === key ? " ▾" : ""}
    </th>
  );

  return (
    <Card
      title={`RECRUITING BOARD${closed ? " · CLOSED (OFFSEASON ONLY)" : ` · OFFSEASON WEEK ${state.offWeek}/8`}`}
      right={
        <span className="text-sm">
          Commits <span className="font-display">{myCommits.length}</span>
          <span className="text-ink/55"> ({classPts.toFixed(1)} pts)</span>
        </span>
      }
    >
      {/* Prominent weekly stamina meter (V4.6) */}
      <div className="flex flex-wrap items-center gap-4" data-tour="rap">
        <div className="min-w-[220px] flex-1">
          <div className="flex items-baseline justify-between">
            <SectionLabel>WEEKLY STAMINA</SectionLabel>
            <span className="font-display text-sm">
              {state.stamina}<span className="text-ink/45"> / {staminaMax(state)}</span>
            </span>
          </div>
          <Meter
            value={state.stamina}
            max={staminaMax(state)}
            color={state.stamina < staminaMax(state) * 0.25 ? "var(--neg)" : "var(--accent)"}
            className="mt-1"
            height={10}
          />
          <p className="mt-1 text-[10px] text-ink/50">
            One shared pool — recruiting, development &amp; morale. Resets each offseason week.
          </p>
        </div>
        {!closed && <Pill tone="pos">🏈 Recruiting open — advance weeks in the Offseason tab</Pill>}
      </div>

      {/* Action legend — every action written out (V4.2) */}
      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg border border-line bg-surface-sunken/40 px-3 py-2 text-[11px] text-ink/70">
        <span className="font-display tracking-widest text-ink/50">SPEND</span>
        {OUTREACH.map((o) => (
          <span key={o.key}>
            <span className="font-bold">{o.label}</span>{" "}
            <span className="text-ink/50">{o.blurb} · {RAP_ACTIONS[o.key].cost} stam</span>
          </span>
        ))}
        <span className="flex items-center gap-1">
          <span className="rounded border border-accent/60 px-1 font-bold text-accent">🔍 SCOUT</span>
          <span className="text-ink/50">reveals true OVR, then dev + 💎/⚠️</span>
        </span>
      </div>

      <NeedsStrip state={state} />

      <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
        {(["board", "targets", "commits"] as ViewFilter[]).map((v) => (
          <button
            key={v}
            type="button"
            onClick={() => setView(v)}
            className={`rounded-full border px-2.5 py-0.5 font-display tracking-widest ${view === v ? "border-ink bg-ink text-paper" : "border-line hover:border-ink/40"}`}
          >
            {v.toUpperCase()}
          </button>
        ))}
        <select
          value={pos}
          onChange={(e) => setPos(e.target.value as PosGroup | "ALL")}
          className="rounded border border-line bg-surface-raised px-1 py-0.5"
        >
          {POS_FILTERS.map((p) => (
            <option key={p} value={p}>{p}</option>
          ))}
        </select>
        <select
          value={minStars}
          onChange={(e) => setMinStars(Number(e.target.value))}
          className="rounded border border-line bg-surface-raised px-1 py-0.5"
        >
          {[2, 3, 4, 5].map((s) => (
            <option key={s} value={s}>{s}★+</option>
          ))}
        </select>
        {removedCount > 0 && (
          <button
            type="button"
            onClick={() => {
              for (const r of state.recruits) r.hidden = false;
              onMutate();
            }}
            className="rounded-full border border-line px-2.5 py-0.5 font-display tracking-widest hover:border-ink/40"
          >
            RESTORE {removedCount} REMOVED
          </button>
        )}
        {flash && <StatusText tone="neg" className="rounded bg-neg-soft px-2 py-0.5">{flash}</StatusText>}
      </div>

      <div className="mt-2 overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-line bg-surface-sunken/50">
              {sortableTh("stars", "★")}
              <th className={th}>NAME</th>
              {sortableTh("pos", "POS")}
              {sortableTh("ovr", "OVR")}
              <th className={`${th} hidden sm:table-cell`}>DEV</th>
              {sortableTh("interest", "LEADER / INTEREST")}
              {sortableTh("mine", "MY PTS", "hidden sm:table-cell")}
              <th className={th} data-tour="recruit-actions">ACTIONS</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <RecruitRow
                key={r.id}
                state={state}
                r={r}
                closed={closed}
                act={act}
                sel={sel === r.id}
                onSel={() => setSel(sel === r.id ? null : r.id)}
                onRemove={() => {
                  removeFromBoard(state, r.id);
                  onMutate();
                }}
              />
            ))}
          </tbody>
        </table>
        {rows.length === 150 && (
          <p className="mt-1 text-xs text-ink/55">Showing top 150 — narrow with the filters.</p>
        )}
        <p className="mt-1 text-[10px] text-ink/40">Distance &amp; NIL-ask columns arrive with the mechanical update.</p>
      </div>
    </Card>
  );
}

function NeedsStrip({ state }: { state: DynastyState }) {
  const team = state.teams[state.userTid];
  const needs = teamNeeds(state, team);
  const leaving = new Map<string, number>();
  for (const pid of team.roster) {
    const p = state.players[pid];
    if (p.cls >= 4) leaving.set(p.g, (leaving.get(p.g) ?? 0) + 1);
  }
  const commits = new Map<string, number>();
  for (const r of state.recruits) {
    if (r.committed === state.userTid) commits.set(r.g, (commits.get(r.g) ?? 0) + 1);
  }
  const groups = [...needs.entries()].filter(
    ([g, n]) => n > 0 || (leaving.get(g) ?? 0) > 0 || (commits.get(g) ?? 0) > 0,
  );
  if (!groups.length) return null;
  return (
    <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[11px]">
      <span className="font-display tracking-widest text-ink/50">NEEDS</span>
      {groups.map(([g, n]) => (
        <span
          key={g}
          className={`rounded border px-1.5 py-0.5 ${n > (commits.get(g) ?? 0) ? "border-neg/40 bg-neg-soft/50" : "border-line bg-surface-sunken/50"}`}
          title={`${leaving.get(g) ?? 0} seniors leaving · ${commits.get(g) ?? 0} committed`}
        >
          <span className="font-display">{g}</span> {n > 0 ? `need ${n}` : "ok"}
          {(leaving.get(g) ?? 0) > 0 && <span className="text-ink/55"> · −{leaving.get(g)}SR</span>}
          {(commits.get(g) ?? 0) > 0 && <StatusText tone="pos"> · +{commits.get(g)}✓</StatusText>}
        </span>
      ))}
    </div>
  );
}

function RecruitRow({
  state,
  r,
  closed,
  act,
  sel,
  onSel,
  onRemove,
}: {
  state: DynastyState;
  r: Recruit;
  closed: boolean;
  act: (rid: number, a: RapAction) => void;
  sel: boolean;
  onSel: () => void;
  onRemove: () => void;
}) {
  const lock = dealBreakerLock(state, r, state.userTid);
  const mine = userPoints(r, state.userTid);
  const leader = r.leads[0];
  const leaderPct = leader ? Math.min(100, (leader.p / COMMIT_THRESHOLD) * 100) : 0;

  const status =
    r.committed !== null ? (
      // Commit destination badge in the school's colors (V3.2 pattern).
      <TeamBadge team={state.teams[r.committed]} prefix="✓" />
    ) : lock ? (
      <StatusText tone="neg">🔒 {lock}</StatusText>
    ) : leader ? (
      <div className="min-w-[150px]">
        <div className="flex items-baseline justify-between gap-2">
          {/* Leader carries its mark; the name stays ink (V1). */}
          <span>
            <TeamName team={state.teams[leader.t]} lead /> <span className="text-ink/50 text-xs">leads</span>
          </span>
          <span className="text-[10px] text-ink/50">{Math.round(leader.p)}</span>
        </div>
        <Meter value={leaderPct} max={100} color="var(--accent)" height={5} className="mt-0.5" />
      </div>
    ) : (
      <span className="text-ink/40">open</span>
    );

  const btn = (a: RapAction, label: string, disabled: boolean, title: string) => (
    <button
      key={a}
      type="button"
      disabled={disabled}
      title={title}
      onClick={(e) => {
        e.stopPropagation();
        act(r.id, a);
      }}
      className="rounded border border-line px-2 py-1 text-[10px] font-bold transition hover:border-ink/50 hover:bg-accent-soft disabled:opacity-25"
    >
      {label}
    </button>
  );

  const done = closed || r.committed !== null;
  const lockActions = !!lock || done;
  // Progressive scouting: one clearly-separated Scout button.
  const nextScout: RapAction | null = r.scouted === 0 ? "s1" : r.scouted === 1 ? "s2" : null;
  const scoutCost = nextScout ? RAP_ACTIONS[nextScout].cost : 0;
  const selStyle = { boxShadow: "inset 3px 0 0 var(--accent)", background: "color-mix(in srgb, var(--accent) 5%, transparent)" };

  return (
    <>
      {/* Quiet row — the full action tray opens only on the row you're working. */}
      <tr
        className={`cursor-pointer align-middle ${sel ? "" : "border-b border-line/50"} transition hover:bg-accent-soft/30`}
        style={sel ? selStyle : undefined}
        onClick={onSel}
      >
        <td className={`${td} whitespace-nowrap text-gold`}>{"★".repeat(r.stars)}</td>
        <td className={`${td} font-bold`}>{r.name}</td>
        <td className={`${td} font-display`}>{r.g}</td>
        <td className={`${td} font-mono ${r.scouted > 0 ? "font-bold text-accent" : ""}`}>{shownOvr(r)}</td>
        <td className={`${td} hidden sm:table-cell`}>
          {r.scouted >= 2 ? (
            <span className="flex items-center gap-1">
              <DevBadge tier={r.devTier} />
              {r.gb === 1 ? <span title="Gem — plays above the badge">💎</span> : null}
              {r.gb === -1 ? <span title="Bust risk — plays below the badge">⚠️</span> : null}
            </span>
          ) : (
            <span className="text-ink/30">?</span>
          )}
        </td>
        <td className={td}>{status}</td>
        <td className={`${td} hidden font-mono sm:table-cell`}>{Math.round(mine) || "—"}</td>
        <td className={`${td} whitespace-nowrap`}>
          <span className={`font-display text-[10px] tracking-widest ${sel ? "text-accent" : "text-ink/45"}`}>
            {done ? "—" : sel ? "▾ CLOSE" : "▸ RECRUIT"}
          </span>
        </td>
      </tr>
      {sel && (
        <tr className="border-b border-line/50" style={selStyle}>
          <td colSpan={8} className="px-3 pb-2.5 pt-0.5">
            <div className="flex flex-wrap items-center gap-1.5">
              {!done && (
                <>
                  {btn("dm", `✉ DM · ${RAP_ACTIONS.dm.cost}`, lockActions || state.stamina < RAP_ACTIONS.dm.cost, "+15 interest")}
                  {btn("coach", `POSITION COACH · ${RAP_ACTIONS.coach.cost}`, lockActions || state.stamina < RAP_ACTIONS.coach.cost, "+40 interest")}
                  {btn("hc", `HC IN-HOME · ${RAP_ACTIONS.hc.cost}`, lockActions || r.hcUsed || state.stamina < RAP_ACTIONS.hc.cost, "+130, once per recruit")}
                  {btn(
                    "visit",
                    `OFFICIAL VISIT · ${RAP_ACTIONS.visit.cost}`,
                    lockActions || state.stamina < RAP_ACTIONS.visit.cost,
                    "+300 interest",
                  )}
                  <span className="mx-1 h-4 w-px bg-line" />
                </>
              )}
              {/* Scout — visually distinct + set apart (V4.1) */}
              {nextScout ? (
                <button
                  type="button"
                  disabled={closed || state.stamina < scoutCost}
                  title={r.scouted === 0 ? "Reveal a tighter OVR band" : "Reveal dev tier + gem/bust"}
                  onClick={(e) => {
                    e.stopPropagation();
                    act(r.id, nextScout);
                  }}
                  className="rounded-md border border-accent/70 bg-accent-soft px-2 py-1 text-[10px] font-bold tracking-wide text-accent transition hover:bg-accent hover:text-white disabled:opacity-30"
                >
                  🔍 SCOUT {r.scouted === 0 ? "I" : "II"} · {scoutCost}
                </button>
              ) : (
                <span className="text-[10px] text-ink/40">fully scouted</span>
              )}
              {/* Remove-from-board (V4.4) */}
              <button
                type="button"
                title="Remove from board"
                onClick={(e) => {
                  e.stopPropagation();
                  onRemove();
                }}
                className="ml-auto rounded-full border border-line px-2 py-0.5 text-[10px] text-ink/45 transition hover:border-neg/50 hover:text-neg"
              >
                ✕ REMOVE
              </button>
              <span className="text-[10px] text-ink/50">Stamina left {state.stamina}</span>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}
