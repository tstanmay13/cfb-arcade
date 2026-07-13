// The in-dynasty experience: header (record/rank/phase), advance controls,
// tabbed panels. Owns the loaded DynastyState; every user action mutates via
// the engine, autosaves, and re-renders. Engines stay UI-free.
import { useEffect, useState } from "react";
import type { DynastyState } from "./engine/types.ts";
import { advance, simToSeasonEnd, startNextSeason } from "./engine/dynasty.ts";
import { cutPlayer, resolveRetention, submitPortalRound, type PortalOffer } from "./engine/offseason.ts";
import { fmtMoney } from "./engine/nil.ts";
import { loadDynasty, saveDynasty } from "./db.ts";
import {
  Dashboard, HistoryPanel, OffseasonPanel, PlayoffsPanel, RankingsPanel,
  RosterPanel, SchedulePanel, StandingsPanel,
} from "./panels.tsx";
import RecruitingPanel from "./recruitingPanel.tsx";

type Tab =
  | "dashboard" | "roster" | "recruiting" | "schedule" | "standings"
  | "top25" | "playoffs" | "history" | "offseason";

const TABS: [Tab, string][] = [
  ["dashboard", "Dashboard"],
  ["roster", "Roster"],
  ["recruiting", "Recruiting"],
  ["schedule", "Schedule"],
  ["standings", "Standings"],
  ["top25", "Top 25"],
  ["playoffs", "Postseason"],
  ["history", "History"],
];

export default function GmShell({ slotId, onExit }: { slotId: number; onExit: () => void }) {
  const [state, setState] = useState<DynastyState | null>(null);
  const [tab, setTab] = useState<Tab>("dashboard");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    loadDynasty(slotId).then((s) => setState(s));
  }, [slotId]);

  if (!state) {
    return (
      <main className="flex min-h-screen items-center justify-center">
        <p className="font-display text-xl tracking-widest">LOADING DYNASTY…</p>
      </main>
    );
  }

  const team = state.teams[state.userTid];
  const rankIdx = state.poll.findIndex((e) => e.tid === state.userTid);
  const rank = rankIdx >= 0 ? `#${rankIdx + 1}` : null;

  // Light mutation (recruiting actions etc.): autosave + re-render, no sim.
  const mutate = () => {
    void saveDynasty(slotId, state).catch((e) => console.error("autosave failed", e));
    setState({ ...state });
  };

  const runAction = (fn: (s: DynastyState) => void) => {
    if (busy) return;
    setBusy(true);
    // Yield a frame so the button state paints before a long sync sim.
    window.setTimeout(() => {
      const before = state.phase;
      const prevArchive = state.offseason?.archive;
      fn(state);
      // Departed players persist to the history store once, at rollover.
      const departed =
        before === "offseason" && state.phase === "regular" ? prevArchive : undefined;
      void saveDynasty(slotId, state, departed).catch((e) => console.error("autosave failed", e));
      if (before !== "offseason" && state.phase === "offseason") setTab("offseason");
      if (before === "offseason" && state.phase === "regular") setTab("dashboard");
      setState({ ...state });
      setBusy(false);
    }, 16);
  };

  const advanceLabel =
    state.phase === "regular"
      ? `SIM WEEK ${state.week}`
      : state.phase === "ccg"
        ? "SIM TITLE GAMES"
        : "SIM PLAYOFF ROUND";

  return (
    <main className="mx-auto min-h-screen max-w-6xl p-4 sm:p-6">
      <header className="flex flex-wrap items-center justify-between gap-3 rounded-md border-2 border-paper-edge bg-white/60 px-4 py-3">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={onExit}
            className="rounded-full border-2 border-paper-edge px-3 py-1 font-display text-[10px] tracking-[0.2em] transition hover:border-ink/40"
          >
            ← SAVES
          </button>
          <div>
            <h1 className="font-display text-xl leading-none" style={{ color: team.color ?? undefined }}>
              {team.school}
            </h1>
            <p className="text-xs opacity-70">
              {rank ? `${rank} · ` : ""}
              {team.rec.w}-{team.rec.l} ({team.rec.cw}-{team.rec.cl} conf) · {"★".repeat(team.prestige)} ·{" "}
              {state.season} · Year {state.year} · NIL {fmtMoney(team.nilBudget)}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {state.phase !== "offseason" ? (
            <>
              <button
                type="button"
                disabled={busy}
                onClick={() => runAction(advance)}
                className="rounded-full border-2 border-ink bg-ink px-5 py-2 font-display text-xs tracking-widest text-paper transition hover:opacity-85 disabled:opacity-40"
              >
                {busy ? "SIMMING…" : advanceLabel}
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => runAction(simToSeasonEnd)}
                className="rounded-full border-2 border-paper-edge px-4 py-2 font-display text-[10px] tracking-widest transition hover:border-ink/40 disabled:opacity-40"
              >
                SIM TO SEASON END
              </button>
            </>
          ) : state.offStage === "done" ? (
            <button
              type="button"
              disabled={busy}
              onClick={() => runAction(startNextSeason)}
              className="rounded-full border-2 border-ink bg-ink px-5 py-2 font-display text-xs tracking-widest text-paper transition hover:opacity-85 disabled:opacity-40"
            >
              START {state.season + 1} SEASON
            </button>
          ) : (
            <span className="rounded-full border-2 border-paper-edge px-4 py-2 font-display text-[10px] tracking-widest opacity-70">
              OFFSEASON: {state.offStage.toUpperCase()} IN PROGRESS
            </span>
          )}
        </div>
      </header>

      <nav className="mt-3 flex flex-wrap gap-1">
        {[...TABS, ...(state.phase === "offseason" ? ([["offseason", "Offseason Report"]] as [Tab, string][]) : [])].map(
          ([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => setTab(key)}
              aria-pressed={tab === key}
              className={`rounded-full border-2 px-3 py-1 font-display text-[11px] tracking-widest transition ${
                tab === key ? "border-ink bg-ink text-paper" : "border-paper-edge hover:border-ink/40"
              }`}
            >
              {label.toUpperCase()}
            </button>
          ),
        )}
      </nav>

      <section className="mt-4">
        {tab === "dashboard" && <Dashboard state={state} />}
        {tab === "roster" && (
          <RosterPanel state={state} onCut={(pid) => runAction((s) => void cutPlayer(s, pid))} />
        )}
        {tab === "recruiting" && <RecruitingPanel state={state} onMutate={mutate} />}
        {tab === "schedule" && <SchedulePanel state={state} />}
        {tab === "standings" && <StandingsPanel state={state} />}
        {tab === "top25" && <RankingsPanel state={state} />}
        {tab === "playoffs" && <PlayoffsPanel state={state} />}
        {tab === "history" && <HistoryPanel state={state} slotId={slotId} />}
        {tab === "offseason" && state.offseason && (
          <OffseasonPanel
            state={state}
            onRetention={(pids) => runAction((s) => resolveRetention(s, pids))}
            onPortal={(offers: PortalOffer[]) => runAction((s) => submitPortalRound(s, offers))}
          />
        )}
      </section>
    </main>
  );
}
