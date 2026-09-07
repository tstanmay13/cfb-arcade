// The in-dynasty experience: header (record/rank/phase), advance controls,
// tabbed panels. Owns the loaded DynastyState; every user action mutates via
// the engine, autosaves, and re-renders. Engines stay UI-free.
import { useEffect, useRef, useState } from "react";
import type { ArchivedPlayer, DynastyState } from "./engine/types.ts";
import { advance, autoOffseason, simRegularSeason, simToSeasonEnd, startNextSeason } from "./engine/dynasty.ts";
import { commitOutcome, togglePin } from "./engine/dynasty.ts";
import { advanceOffseasonWeek, cutPlayer, type PortalOffer } from "./engine/offseason.ts";
import { takeJob } from "./engine/coaches.ts";
import { fmtMoney } from "./engine/nil.ts";
import type { SimOutcome } from "./engine/game.ts";
import { archiveFor, loadDynasty, saveDynasty } from "./db.ts";
import WatchGame from "./WatchGame.tsx";
import {
  Dashboard, HistoryPanel, OffseasonPanel, RankingsPanel,
  RosterPanel, SchedulePanel, StaffPanel, StandingsPanel,
} from "./panels.tsx";
import SeasonLeaders from "./SeasonLeaders.tsx";
import RecruitingPanel from "./recruitingPanel.tsx";
import HelpPanel from "./helpPanel.tsx";
import TourOverlay, { TOUR_STEPS } from "./tour.tsx";
import { getTeamColors } from "./theme.ts";
import { TeamMark } from "./ui.tsx";

const TOUR_DONE_KEY = "cfbgm:tour-done";

type Tab =
  | "dashboard" | "roster" | "staff" | "recruiting" | "schedule" | "standings"
  | "top25" | "stats" | "history" | "help" | "offseason";

const TABS: [Tab, string][] = [
  ["dashboard", "Dashboard"],
  ["roster", "Roster"],
  ["staff", "Staff"],
  ["recruiting", "Recruiting"],
  ["schedule", "Schedule"],
  ["standings", "Standings"],
  ["top25", "Top 25"],
  ["stats", "Stats"],
  ["history", "History"],
  ["help", "How to Play"],
];

export default function GmShell({ slotId, onExit }: { slotId: number; onExit: () => void }) {
  const [state, setState] = useState<DynastyState | null>(null);
  const [tab, setTab] = useState<Tab>("dashboard");
  const [busy, setBusy] = useState(false);
  const actionLock = useRef(false);
  const pendingArchive = useRef<ArchivedPlayer[] | undefined>(undefined);
  const [saveStatus, setSaveStatus] = useState<"saved" | "saving" | "error">("saved");
  const [error, setError] = useState<string | null>(null);
  const [watching, setWatching] = useState(false);
  const [tourStep, setTourStep] = useState<number | null>(null);

  useEffect(() => {
    let active = true;
    loadDynasty(slotId).then((s) => {
      if (!active) return;
      if (!s) setError("This dynasty could not be found. Return to your saves and choose another slot.");
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
    }).catch(() => {
      if (active) setError("Could not open this dynasty. Browser storage may be unavailable. Return to saves and try again.");
    });
    return () => { active = false; };
  }, [slotId]);

  useEffect(() => {
    if (saveStatus === "saved" && !busy) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [saveStatus, busy]);

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
        <div className="max-w-md p-4 text-center">
          <p className="font-display text-xl tracking-widest">{error ?? "LOADING DYNASTY…"}</p>
          {error && <button className="mt-4 rounded border border-line p-3" onClick={onExit}>Return to saves</button>}
        </div>
      </main>
    );
  }

  const team = state.teams[state.userTid];
  const teamColors = getTeamColors(team);
  const rankIdx = state.poll.findIndex((e) => e.tid === state.userTid);
  const rank = rankIdx >= 0 ? `#${rankIdx + 1}` : null;

  const persist = async (next: DynastyState) => {
    setSaveStatus("saving");
    try {
      await saveDynasty(slotId, next, pendingArchive.current);
      pendingArchive.current = undefined;
      setSaveStatus("saved");
      setError(null);
    } catch {
      setSaveStatus("error");
      setError("Your latest changes are in memory but could not be saved. Keep this tab open and retry saving.");
    } finally {
      actionLock.current = false;
      setBusy(false);
    }
  };

  // Panel actions mutate the current snapshot; lock further actions while
  // persisting so a rollover can never race a recruiting or roster write.
  const mutate = () => {
    if (actionLock.current) return;
    actionLock.current = true;
    setBusy(true);
    setState({ ...state });
    void persist(state);
  };

  const runAction = (fn: (s: DynastyState) => void) => {
    if (actionLock.current || saveStatus === "error") return;
    actionLock.current = true;
    setBusy(true);
    window.setTimeout(() => {
      try {
        // Engines mutate a working copy. An exception leaves the last playable
        // state intact instead of leaving half a season applied and SIMMING stuck.
        const next = structuredClone(state);
        const before = next.phase;
        const prevArchive = next.offseason?.archive;
        fn(next);
        if (before === "offseason" && next.phase === "regular") pendingArchive.current = prevArchive;
        if (before !== "offseason" && next.phase === "offseason") setTab("offseason");
        if (before === "offseason" && next.phase === "regular") setTab("dashboard");
        setState(next);
        void persist(next);
      } catch {
        setError("That action could not finish. Your previous state is intact; try again or return to saves.");
        actionLock.current = false;
        setBusy(false);
      }
    }, 16);
  };

  const downloadRecovery = async () => {
    try {
      const archive = (await archiveFor(slotId)).map(row => ({ season: row.season, player: row.player }));
      archive.push(...(pendingArchive.current ?? []).map(player => ({ season: state.season, player })));
      const json = JSON.stringify({ kind: "cfbgm-dynasty", version: 1, state, archive });
      const url = URL.createObjectURL(new Blob([json], { type: "application/json" }));
      const link = document.createElement("a");
      link.href = url;
      link.download = `cfbgm-recovery-${state.season}.json`;
      link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch {
      setError("Could not read the player archive for a recovery download. Keep this tab open and retry saving.");
    }
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
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-xs" aria-live="polite">
        <span>{saveStatus === "saving" ? "Saving dynasty…" : saveStatus === "error" ? "Unsaved changes" : "All changes saved on this device"}</span>
        {saveStatus === "error" && <button className="rounded border border-line px-3 py-1 font-bold" disabled={busy} onClick={() => {
          actionLock.current = true; setBusy(true); void persist(state);
        }}>Retry save</button>}
        {saveStatus === "error" && <button className="rounded border border-line px-3 py-1 font-bold" onClick={() => void downloadRecovery()}>Download recovery save</button>}
      </div>
      {error && <p role="alert" className="mb-3 rounded border border-neg/40 bg-neg-soft p-3 text-sm">{error}</p>}
      <fieldset disabled={busy || saveStatus === "error"} className="min-w-0 border-0 p-0 m-0">
      <header
        className="flex flex-wrap items-center justify-between gap-3 overflow-hidden rounded-card border border-line bg-surface-raised px-4 py-3 shadow-card"
        style={{
          borderLeft: `6px solid ${teamColors.primary}`,
          backgroundImage: `linear-gradient(90deg, ${teamColors.primary}14, transparent 45%)`,
        }}
      >
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={onExit}
            disabled={busy || saveStatus !== "saved"}
            className="rounded-full border-2 border-line px-3 py-1 font-display text-[10px] tracking-[0.2em] transition hover:border-ink/40"
          >
            ← SAVES
          </button>
          <div data-tour="header-team" className="flex items-center gap-2.5">
            <TeamMark team={team} size="l" />
            <div>
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
              {state.phase === "regular" && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => runAction(simRegularSeason)}
                  className="rounded-full border-2 border-paper-edge px-4 py-2 font-display text-[10px] tracking-widest transition hover:border-ink/40 disabled:opacity-40"
                >
                  SIM REG SEASON
                </button>
              )}
              <button
                type="button"
                disabled={busy}
                onClick={() => runAction(simToSeasonEnd)}
                className="rounded-full border-2 border-paper-edge px-4 py-2 font-display text-[10px] tracking-widest transition hover:border-ink/40 disabled:opacity-40"
              >
                SIM WHOLE SEASON
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
            <>
              <span className="rounded-full border-2 border-paper-edge px-4 py-2 font-display text-[10px] tracking-widest opacity-70">
                OFFSEASON · WEEK {state.offWeek}/8 · {state.offStage.toUpperCase()}
              </span>
              <button
                type="button"
                disabled={busy}
                onClick={() => runAction(autoOffseason)}
                className="rounded-full border-2 border-paper-edge px-4 py-2 font-display text-[10px] tracking-widest transition hover:border-ink/40 disabled:opacity-40"
                title="Auto-resolve the rest of the offseason (recruiting + portal)"
              >
                SIM OFFSEASON
              </button>
            </>
          )}
        </div>
      </header>

      {state.phase === "offseason" && state.offStage !== "done" && (
        <section className="mt-3 rounded-card border border-line bg-surface-raised p-3" aria-label="Offseason calendar">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm"><strong>Week {state.offWeek} of 8</strong> · {state.offWeek === 1 ? "Review the season and scout your class" : state.offWeek === 2 ? "Keep your core together" : state.offWeek < 8 ? "Recruit and compete for transfers" : "Finalize your class"}</p>
            <span className="text-xs font-bold">{state.stamina} stamina left this week</span>
          </div>
          <ol className="mt-2 grid grid-cols-8 gap-1" aria-label="Eight-week offseason progress">
            {Array.from({ length: 8 }, (_, i) => <li key={i} aria-current={state.offWeek === i + 1 ? "step" : undefined}
              className={`rounded p-1 text-center text-xs ${i + 1 === state.offWeek ? "bg-ink text-paper" : i + 1 < state.offWeek ? "bg-pos-soft text-pos" : "bg-surface-sunken text-ink/50"}`}>{i + 1}</li>)}
          </ol>
          <div className="mt-2 flex flex-wrap gap-2">
            <button className="rounded border border-line px-3 py-1 text-xs" onClick={() => setTab("recruiting")}>Recruit & scout</button>
            <button className="rounded border border-line px-3 py-1 text-xs" onClick={() => setTab("roster")}>Develop your roster</button>
            <button className="rounded border border-line px-3 py-1 text-xs font-bold" onClick={() => setTab("offseason")}>{state.offStage === "retention" ? "Review retention" : state.offStage === "portal" ? "Review transfer offers" : "Review & advance week"}</button>
          </div>
          <p className="mt-2 text-xs text-ink/55">Stamina refreshes each week. Spend it on your priorities before advancing; recruiting and roster work share the same pool.</p>
        </section>
      )}
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
            onMutate={mutate}
          />
        )}
        {tab === "staff" && <StaffPanel state={state} onMutate={mutate} />}
        {tab === "recruiting" && <RecruitingPanel state={state} onMutate={mutate} />}
        {tab === "schedule" && <SchedulePanel state={state} />}
        {tab === "standings" && <StandingsPanel state={state} />}
        {tab === "top25" && <RankingsPanel state={state} />}
        {tab === "stats" && <SeasonLeaders state={state} />}
        {tab === "history" && <HistoryPanel state={state} slotId={slotId} />}
        {tab === "help" && <HelpPanel onStartTour={startTour} />}
        {tab === "offseason" && state.offseason && (
          <OffseasonPanel
            state={state}
            onRetention={(pids) => runAction((s) => advanceOffseasonWeek(s, { paidPids: pids }))}
            onPortal={(offers: PortalOffer[]) => runAction((s) => advanceOffseasonWeek(s, { portalOffers: offers }))}
            onTakeJob={(tid) => runAction((s) => void takeJob(s, tid))}
            onAdvanceWeek={() => runAction((s) => advanceOffseasonWeek(s))}
            onMutate={mutate}
          />
        )}
      </section>

      </fieldset>

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
