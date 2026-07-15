// TEAM_SELECT (§2): pick a favorite program (theme injection) + game mode,
// with the §9 trophy room below the fold.
import { useState } from "react";
import type { Team } from "../data/types.ts";
import { applyTeamTheme, useGame, useGameActions, type Mode } from "../state/store.tsx";
import { loadTrophyRoom, type RunSummary } from "../state/storage.ts";
import TeamMark from "./TeamMark.tsx";

const OUTCOME_LABELS: Record<string, string> = {
  natty: "National Champions",
  semis: "Final Four",
  major: "Playoffs",
  minor: "Bowl Game",
  loss: "",
};

function RunRow({ run }: { run: RunSummary }) {
  const borderClass =
    run.outcome === "natty" ? "trophy-gold" :
    run.outcome === "semis" ? "trophy-silver" :
    run.outcome === "major" ? "trophy-bronze" : "";

  return (
    <div className={`flex items-center gap-3 rounded-lg bg-white/60 px-3 py-2 ${borderClass}`}>
      <span className="font-display text-lg font-bold">{run.record}</span>
      <div className="flex flex-wrap gap-1.5">
        {run.outcome && OUTCOME_LABELS[run.outcome] && (
          <span className="rounded bg-ink/10 px-2 py-0.5 text-xs">{OUTCOME_LABELS[run.outcome]}</span>
        )}
        {run.heisman && (
          <span className="rounded bg-amber-100 px-2 py-0.5 text-xs text-amber-800">Heisman</span>
        )}
        {(run.allAmericansCount ?? 0) > 0 && (
          <span className="rounded bg-blue-100 px-2 py-0.5 text-xs text-blue-800">
            {run.allAmericansCount} All-American{run.allAmericansCount === 1 ? "" : "s"}
          </span>
        )}
        {run.dynasty && (
          <span className="rounded-full bg-amber-500 px-2 py-0.5 text-xs text-white">DYNASTY</span>
        )}
      </div>
      <span className="ml-auto text-xs opacity-50">{run.favorite_team} · {run.mode}</span>
    </div>
  );
}

function TrophyRoom() {
  const [room] = useState(loadTrophyRoom);
  if (room.recent_runs.length === 0) return null;

  const recent = room.recent_runs.slice(0, 5);
  const best = room.top_builds.slice(0, 5);

  return (
    <section aria-label="Trophy room" className="w-full space-y-4">
      <div className="rounded-xl border border-paper-edge bg-white/50 p-4">
        <h2 className="mb-3 font-display text-sm tracking-[0.25em] opacity-70">RECENT RUNS</h2>
        <div className="space-y-2">
          {recent.map((r) => <RunRow key={r.timestamp} run={r} />)}
        </div>
      </div>
      <div className="rounded-xl border border-paper-edge bg-white/50 p-4">
        <h2 className="mb-3 font-display text-sm tracking-[0.25em] opacity-70">BEST BUILDS</h2>
        <div className="space-y-2">
          {best.map((r) => <RunRow key={r.timestamp} run={r} />)}
        </div>
      </div>
    </section>
  );
}

export default function TeamSelect({
  onOpenArcade,
  onOpenGm,
}: {
  onOpenArcade?: () => void;
  onOpenGm?: () => void;
}) {
  const { data } = useGame();
  const { startRun } = useGameActions();
  const [team, setTeam] = useState<Team | null>(null);
  const [mode, setMode] = useState<Mode>("Classic");

  const choose = (t: Team) => {
    setTeam(t);
    applyTeamTheme(t); // live preview
  };

  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col items-center justify-center gap-8 p-6">
      <header className="text-center">
        <p className="font-display text-sm tracking-[0.35em] text-team">SPIN · DRAFT · RUN THE TABLE</p>
        <h1 className="mt-2 font-display text-5xl leading-tight sm:text-6xl">THE 16-0 DRAFT</h1>
        <p className="mx-auto mt-3 max-w-md text-sm opacity-75">
          Nine spins across fifteen seasons of real college football data. Draft a
          star at every position, land a coach, and find out if your team runs the
          table.
        </p>
        <div className="mx-auto mt-4 flex flex-wrap items-center justify-center gap-2">
          {onOpenArcade && (
            <button
              type="button"
              onClick={onOpenArcade}
              className="rounded-full border-2 border-ink/30 bg-white/60 px-5 py-2 font-display text-xs tracking-[0.2em] shadow-sm transition hover:border-ink/60 hover:shadow"
            >
              🕹 ARCADE · GUESS THE SEASON →
            </button>
          )}
          {onOpenGm && (
            <button
              type="button"
              onClick={onOpenGm}
              className="rounded-full border-2 border-ink/30 bg-white/60 px-5 py-2 font-display text-xs tracking-[0.2em] shadow-sm transition hover:border-ink/60 hover:shadow"
            >
              🏈 CFB-GM · RUN A DYNASTY →
            </button>
          )}
        </div>
      </header>

      <section aria-label="Pick your program" className="w-full">
        <h2 className="mb-3 text-center font-display text-lg tracking-widest">PICK YOUR PROGRAM</h2>
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
          {data.teams.map((t) => (
            <button
              key={t.school_id}
              type="button"
              onClick={() => choose(t)}
              aria-pressed={team?.school_id === t.school_id}
              className={`flex items-center gap-2 rounded-md border-2 bg-white/50 px-2 py-2 text-left transition
                ${team?.school_id === t.school_id ? "border-ink shadow-md" : "border-paper-edge hover:border-ink/40"}`}
              style={{ borderLeftWidth: 8, borderLeftColor: t.mainHex }}
            >
              <TeamMark school={t.name} primary={t.mainHex} secondary={t.accentHex} size="m" />
              <span className="min-w-0">
                <span className="block truncate font-display text-sm">{t.name}</span>
                <span className="block truncate text-[10px] uppercase tracking-wide opacity-60">{t.mascot}</span>
              </span>
            </button>
          ))}
        </div>
      </section>

      <section aria-label="Game mode" className="flex items-center gap-3">
        {(["Classic", "Scout"] as Mode[]).map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => setMode(m)}
            aria-pressed={mode === m}
            className={`rounded-full border-2 px-5 py-2 font-display text-sm tracking-widest transition
              ${mode === m ? "border-ink bg-ink text-paper" : "border-paper-edge hover:border-ink/40"}`}
          >
            {m.toUpperCase()}
          </button>
        ))}
        <p className="max-w-[16rem] text-xs opacity-70">
          {mode === "Classic"
            ? "Stat lines visible on every pick."
            : "Stats hidden — draft on name recognition alone."}
        </p>
      </section>

      <button
        type="button"
        disabled={!team}
        onClick={() => team && startRun(team, mode)}
        className="rounded-lg bg-team px-10 py-4 font-display text-xl tracking-[0.2em] text-team-accent shadow-lg transition enabled:hover:scale-105 disabled:opacity-40"
      >
        START THE DRAFT
      </button>

      <TrophyRoom />
    </main>
  );
}
