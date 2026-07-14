// The in-dynasty experience: header (record/rank/phase), advance controls,
// tabbed panels. Owns the loaded DynastyState; every user action mutates via
// the engine, autosaves, and re-renders. Engines stay UI-free.
import { useEffect, useState } from "react";
import type { DynastyState } from "./engine/types.ts";
import { advance, simToSeasonEnd, startNextSeason } from "./engine/dynasty.ts";
import { commitOutcome, togglePin } from "./engine/dynasty.ts";
import { cutPlayer, resolveRetention, submitPortalRound, type PortalOffer } from "./engine/offseason.ts";
import { takeJob } from "./engine/coaches.ts";
import { fmtMoney } from "./engine/nil.ts";
import type { SimOutcome } from "./engine/game.ts";
import { loadDynasty, saveDynasty } from "./db.ts";
import WatchGame from "./WatchGame.tsx";
import {
  Dashboard, HistoryPanel, OffseasonPanel, RankingsPanel,
  RosterPanel, SchedulePanel, StandingsPanel,
} from "./panels.tsx";
import RecruitingPanel from "./recruitingPanel.tsx";
import HelpPanel from "./helpPanel.tsx";
import TourOverlay, { TOUR_STEPS } from "./tour.tsx";
import { getTeamColors } from "./theme.ts";

const TOUR_DONE_KEY = "cfbgm:tour-done";

type Tab =
  | "dashboard" | "roster" | "recruiting" | "schedule" | "standings"
  | "top25" | "history" | "help" | "offseason";

const TABS: [Tab, string][] = [
  ["dashboard", "Dashboard"],
  ["roster", "Roster"],
  ["recruiting", "Recruiting"],
  ["schedule", "Schedule"],
  ["standings", "Standings"],
  ["top25", "Top 25"],
  ["history", "History"],
  ["help", "How to Play"],
];

export default function GmShell({ slotId, onExit }: { slotId: number; onExit: () => void }) {
  const [state, setState] = useState<DynastyState | null>(null);
  const [tab, setTab] = useState<Tab>("dashboard");
  const [busy, setBusy] = useState(false);
  const [watching, setWatching] = useState(false);
  const [tourStep, setTourStep] = useState<number | null>(null);

  useEffect(() => {
    loadDynasty(slotId).then((s) => {
      setState(s);
      // First-ever dynasty week: walk the new coach through the building.
      let seen = "1";
      try {
        seen = localStorage.getItem(TOUR_DONE_KEY) ?? "";
      } catch {
        /* private mode — skip the auto-tour */
      }
      if (s && s.year === 1 && s.week === 1 && s.results.length === 0 && !seen) {
        setTourStep(0);
      }
    });
  }, [slotId]);

  const startTour = () => {
    setTab(TOUR_STEPS[0].tab as Tab);
    setTourStep(0);
  };
  const endTour = () => {
    try {
      localStorage.setItem(TOUR_DONE_KEY, "1");
    } catch {
      /* fine */
    }
    setTourStep(null);
  };
  const gotoTourStep = (i: number) => {
    if (i < 0 || i >= TOUR_STEPS.length) {
      endTour();
      return;
    }
    setTab(TOUR_STEPS[i].tab as Tab);
    setTourStep(i);
  };

  if (!state) {
    return (
      <main className="flex min-h-screen items-center justify-center">
        <p className="font-display text-xl tracking-widest">LOADING DYNASTY…</p>
      </main>
    );
  }

  const team = state.teams[state.userTid];
  const teamColors = getTeamColors(team);
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
      // Busy releases only once the autosave lands — leaving the page right
      // after a click can never abort a rollover write mid-transaction.
      saveDynasty(slotId, state, departed)
        .catch((e) => console.error("autosave failed", e))
        .finally(() => {
          if (before !== "offseason" && state.phase === "offseason") setTab("offseason");
          if (before === "offseason" && state.phase === "regular") setTab("dashboard");
          setState({ ...state });
          setBusy(false);
        });
    }, 16);
  };

  const advanceLabel =
    state.phase === "regular"
      ? `SIM WEEK ${state.week}`
      : state.phase === "ccg"
        ? "SIM TITLE GAMES"
        : "SIM PLAYOFF ROUND";

  // The user's unplayed game this week (watchable).
  const played = new Set(state.results.map((r) => r.gid));
  const userGame =
    state.phase !== "offseason"
      ? state.schedule.find(
          (g) =>
            g.week === state.week &&
            !played.has(g.id) &&
            (g.home === state.userTid || g.away === state.userTid),
        )
      : undefined;

  return (
    <main className="mx-auto min-h-screen max-w-6xl p-4 sm:p-6">
      <header
        className="flex flex-wrap items-center justify-between gap-3 overflow-hidden rounded-card border border-line bg-surface-raised px-4 py-3 shadow-card"
        style={{ borderLeft: `6px solid ${teamColors.primary}` }}
      >
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={onExit}
            className="rounded-full border-2 border-line px-3 py-1 font-display text-[10px] tracking-[0.2em] transition hover:border-ink/40"
          >
            ← SAVES
          </button>
          <div data-tour="header-team">
            <h1 className="font-display text-xl leading-none" style={{ color: teamColors.ink }}>
              {team.school}
            </h1>
            <p className="mt-0.5 text-xs text-ink/70">
              {rank ? `${rank} · ` : ""}
              {team.rec.w}-{team.rec.l} ({team.rec.cw}-{team.rec.cl} conf) · <span className="text-gold">{"★".repeat(team.prestige)}</span> ·{" "}
              {state.season} · Year {state.year} · NIL {fmtMoney(team.nilBudget)}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {state.phase !== "offseason" ? (
            <>
              {userGame && (
                <button
                  type="button"
                  data-tour="play-game"
                  disabled={busy}
                  onClick={() => setWatching(true)}
                  className="rounded-full border-2 border-ink px-5 py-2 font-display text-xs tracking-widest transition hover:bg-ink hover:text-paper disabled:opacity-40"
                >
                  🏈 PLAY GAME
                </button>
              )}
              <button
                type="button"
                data-tour="advance"
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
                tab === key ? "border-ink bg-ink text-paper" : "border-line hover:border-ink/40"
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
          <RosterPanel
            state={state}
            onCut={(pid) => runAction((s) => void cutPlayer(s, pid))}
            onPin={(pid) => runAction((s) => togglePin(s, pid))}
          />
        )}
        {tab === "recruiting" && <RecruitingPanel state={state} onMutate={mutate} />}
        {tab === "schedule" && <SchedulePanel state={state} />}
        {tab === "standings" && <StandingsPanel state={state} />}
        {tab === "top25" && <RankingsPanel state={state} />}
        {tab === "history" && <HistoryPanel state={state} slotId={slotId} />}
        {tab === "help" && <HelpPanel onStartTour={startTour} />}
        {tab === "offseason" && state.offseason && (
          <OffseasonPanel
            state={state}
            onRetention={(pids) => runAction((s) => resolveRetention(s, pids))}
            onPortal={(offers: PortalOffer[]) => runAction((s) => submitPortalRound(s, offers))}
            onTakeJob={(tid) => runAction((s) => void takeJob(s, tid))}
          />
        )}
      </section>

      {tourStep !== null && (
        <TourOverlay
          step={tourStep}
          onNext={() => gotoTourStep(tourStep + 1)}
          onBack={() => gotoTourStep(tourStep - 1)}
          onSkip={endTour}
        />
      )}

      {watching && userGame && (
        <WatchGame
          state={state}
          game={userGame}
          onCommit={(outcome: SimOutcome) =>
            runAction((s) => void commitOutcome(s, userGame, outcome, true))
          }
          onClose={() => setWatching(false)}
        />
      )}
    </main>
  );
}
