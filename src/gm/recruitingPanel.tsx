// The recruiting board (v1.1): RAP economy, scouting reveals, deal-breaker
// locks, live interest race. Mutations go through engine/recruiting.ts and
// the shell's onMutate (autosave + re-render).
import { useMemo, useState } from "react";
import type { DynastyState, PosGroup, Recruit } from "./engine/types.ts";
import {
  dealBreakerLock, hasHomeGame, shownOvr, userAction, userPoints,
  type RapAction,
} from "./engine/recruiting.ts";
import { STAR_POINTS } from "./engine/recruits.ts";
import { DevBadge } from "./panels.tsx";

const card = "rounded-md border-2 border-paper-edge bg-white/60 p-4";
const th = "px-2 py-1 text-left font-display text-[10px] tracking-widest opacity-60";
const td = "px-2 py-1";

const POS_FILTERS: (PosGroup | "ALL")[] = ["ALL", "QB", "RB", "WR", "TE", "OL", "DL", "LB", "CB", "S", "K", "P"];
type ViewFilter = "board" | "targets" | "commits";

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
  const [flash, setFlash] = useState<string | null>(null);

  const closed = state.phase !== "regular";
  const myCommits = useMemo(
    () => state.recruits.filter((r) => r.committed === state.userTid),
    [state],
  );
  const classPts = myCommits.reduce((a, r) => a + (STAR_POINTS[r.stars] ?? 0), 0);

  const rows = useMemo(() => {
    let list = state.recruits;
    if (view === "targets") list = list.filter((r) => userPoints(r, state.userTid) > 0 && r.committed === null);
    if (view === "commits") list = list.filter((r) => r.committed === state.userTid);
    if (pos !== "ALL") list = list.filter((r) => r.g === pos);
    list = list.filter((r) => r.stars >= minStars);
    return list.slice(0, 150);
  }, [state, pos, minStars, view]);

  const act = (rid: number, a: RapAction) => {
    const err = userAction(state, rid, a);
    if (err) {
      setFlash(err);
      window.setTimeout(() => setFlash(null), 2500);
    } else {
      onMutate();
    }
  };

  return (
    <div className={card}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-display text-xs tracking-[0.25em] opacity-60">
          RECRUITING BOARD{closed ? " · CLOSED (SIGNING DAY PASSED)" : ""}
        </h3>
        <div className="flex items-center gap-3 text-sm">
          <span data-tour="rap">
            RAP: <span className="font-display">{state.rapLeft}</span>/600
          </span>
          <span>
            Commits: <span className="font-display">{myCommits.length}</span> ({classPts.toFixed(1)} pts)
          </span>
          {!closed && hasHomeGame(state) && (
            <span className="rounded bg-green-800/10 px-2 py-0.5 text-xs text-green-900">
              🏟 Home game this week — visits available
            </span>
          )}
        </div>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
        {(["board", "targets", "commits"] as ViewFilter[]).map((v) => (
          <button
            key={v}
            type="button"
            onClick={() => setView(v)}
            className={`rounded-full border px-2 py-0.5 font-display tracking-widest ${view === v ? "border-ink bg-ink text-paper" : "border-paper-edge"}`}
          >
            {v.toUpperCase()}
          </button>
        ))}
        <select
          value={pos}
          onChange={(e) => setPos(e.target.value as PosGroup | "ALL")}
          className="rounded border border-paper-edge bg-white/70 px-1 py-0.5"
        >
          {POS_FILTERS.map((p) => (
            <option key={p} value={p}>{p}</option>
          ))}
        </select>
        <select
          value={minStars}
          onChange={(e) => setMinStars(Number(e.target.value))}
          className="rounded border border-paper-edge bg-white/70 px-1 py-0.5"
        >
          {[2, 3, 4, 5].map((s) => (
            <option key={s} value={s}>{s}★+</option>
          ))}
        </select>
        {flash && <span className="rounded bg-red-800/10 px-2 py-0.5 text-red-900">{flash}</span>}
      </div>

      <div className="mt-2 overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-paper-edge">
              <th className={th}>★</th>
              <th className={th}>NAME</th>
              <th className={th}>POS</th>
              <th className={th}>OVR</th>
              <th className={th}>DEV</th>
              <th className={th}>STATUS</th>
              <th className={th}>MY PTS</th>
              <th className={th} data-tour="recruit-actions">ACTIONS</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <RecruitRow key={r.id} state={state} r={r} closed={closed} act={act} />
            ))}
          </tbody>
        </table>
        {rows.length === 150 && (
          <p className="mt-1 text-xs opacity-60">Showing top 150 — narrow with the filters.</p>
        )}
      </div>
    </div>
  );
}

function RecruitRow({
  state,
  r,
  closed,
  act,
}: {
  state: DynastyState;
  r: Recruit;
  closed: boolean;
  act: (rid: number, a: RapAction) => void;
}) {
  const lock = dealBreakerLock(state, r, state.userTid);
  const mine = userPoints(r, state.userTid);
  const leader = r.leads[0];
  const status =
    r.committed !== null ? (
      <span className={r.committed === state.userTid ? "font-bold text-green-900" : "opacity-70"}>
        ✓ {state.teams[r.committed].school}
      </span>
    ) : lock ? (
      <span className="text-red-900/80">🔒 {lock}</span>
    ) : leader ? (
      <span className="text-xs">
        {state.teams[leader.t].school} leads ({Math.round(leader.p)})
      </span>
    ) : (
      <span className="opacity-40">open</span>
    );

  const btn = (a: RapAction, label: string, disabled: boolean, title: string) => (
    <button
      key={a}
      type="button"
      disabled={disabled}
      title={title}
      onClick={() => act(r.id, a)}
      className="rounded border border-paper-edge px-1.5 py-0.5 text-[10px] font-bold transition hover:border-ink/50 disabled:opacity-25"
    >
      {label}
    </button>
  );

  const done = closed || r.committed !== null;
  const lockActions = !!lock || done;

  return (
    <tr className="border-b border-paper-edge/50">
      <td className={`${td} whitespace-nowrap`}>{"★".repeat(r.stars)}</td>
      <td className={`${td} font-bold`}>{r.name}</td>
      <td className={`${td} font-display`}>{r.g}</td>
      <td className={`${td} font-mono`}>{shownOvr(r)}</td>
      <td className={td}>
        {r.scouted >= 2 ? (
          <span className="flex items-center gap-1">
            <DevBadge tier={r.devTier} />
            {r.gb === 1 ? <span title="Gem — plays above the badge">💎</span> : null}
            {r.gb === -1 ? <span title="Bust risk — plays below the badge">⚠️</span> : null}
          </span>
        ) : (
          <span className="opacity-30">?</span>
        )}
      </td>
      <td className={td}>{status}</td>
      <td className={`${td} font-mono`}>{Math.round(mine) || "—"}</td>
      <td className={`${td} whitespace-nowrap`}>
        <span className="flex gap-1">
          {btn("dm", "DM 10", lockActions || state.rapLeft < 10, "+15 interest")}
          {btn("coach", "PC 25", lockActions || state.rapLeft < 25, "+40 interest")}
          {btn("hc", "HC 75", lockActions || r.hcUsed || state.rapLeft < 75, "+130, once per recruit")}
          {btn(
            "visit",
            "VIS 150",
            lockActions || state.rapLeft < 150 || !hasHomeGame(state) || state.pendingVisits.includes(r.id),
            "+300, needs a home game; +50 if you win it",
          )}
          {btn("s1", "S1 30", closed || r.scouted >= 1 || state.rapLeft < 30, "Reveal tighter OVR band")}
          {btn("s2", "S2 60", closed || r.scouted !== 1 || state.rapLeft < 60, "Reveal dev tier + gem/bust")}
        </span>
      </td>
    </tr>
  );
}
