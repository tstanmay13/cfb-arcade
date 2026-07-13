// TEAM_SELECT (§2): pick a favorite program (theme injection) + game mode,
// with the §9 trophy room below the fold.
import { useState } from "react";
import type { Team } from "../data/types.ts";
import { applyTeamTheme, useGame, useGameActions, type Mode } from "../state/store.tsx";
import { loadTrophyRoom } from "../state/storage.ts";

const OUTCOME_LABELS: Record<string, string> = {
  natty: "National Champions",
  semis: "Final Four",
  major: "Playoffs",
  minor: "Bowl Game",
  loss: "",
};

function TrophyRoom() {
  const [room] = useState(loadTrophyRoom);
  if (room.recent_runs.length === 0) return null;
  const best = room.top_builds[0];
  return (
    <section aria-label="Trophy room" className="w-full rounded-xl border border-paper-edge bg-white/50 p-4">
      <h2 className="mb-2 font-display text-sm tracking-[0.25em] opacity-70">TROPHY ROOM</h2>
      {best && (
        <p className="mb-2 text-sm">
          Best build: <strong>{best.record}</strong>
          {best.heisman && " · Heisman"}
          {(best.allAmericansCount ?? 0) > 0 && ` · ${best.allAmericansCount} All-American${best.allAmericansCount === 1 ? "" : "s"}`}
          {best.outcome && OUTCOME_LABELS[best.outcome] && ` · ${OUTCOME_LABELS[best.outcome]}`}
          {best.dynasty && (
            <span className="ml-1.5 rounded-full bg-amber-500 px-2 py-0.5 font-display text-[9px] tracking-wider text-white">
              DYNASTY
            </span>
          )}
          <span className="opacity-60"> · {best.mode}</span>
        </p>
      )}
      <ol className="flex flex-wrap gap-1.5" aria-label="Recent runs">
        {room.recent_runs.slice(0, 10).map((r) => (
          <li
            key={r.timestamp}
            title={`${r.record}${r.heisman ? " · Heisman" : ""}${(r.allAmericansCount ?? 0) > 0 ? ` · ${r.allAmericansCount} AA` : ""}${r.outcome && OUTCOME_LABELS[r.outcome] ? ` · ${OUTCOME_LABELS[r.outcome]}` : ""} · ${r.mode}${r.dynasty ? " · DYNASTY" : ""}`}
            className={`rounded px-2 py-1 font-display text-xs text-white ${
              r.record.endsWith("-0") ? "bg-emerald-700" : r.dynasty ? "bg-amber-500" : "bg-ink/70"
            }`}
          >
            {r.record}
          </li>
        ))}
      </ol>
    </section>
  );
}

export default function TeamSelect({ onOpenArcade }: { onOpenArcade?: () => void }) {
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
        {onOpenArcade && (
          <button
            type="button"
            onClick={onOpenArcade}
            className="mx-auto mt-4 block rounded-full border-2 border-ink/30 bg-white/60 px-5 py-2 font-display text-xs tracking-[0.2em] shadow-sm transition hover:border-ink/60 hover:shadow"
          >
            🕹 ARCADE · GUESS THE SEASON →
          </button>
        )}
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
              className={`rounded-md border-2 bg-white/50 px-2 py-3 text-center transition
                ${team?.school_id === t.school_id ? "border-ink shadow-md" : "border-paper-edge hover:border-ink/40"}`}
              style={{ borderLeftWidth: 8, borderLeftColor: t.mainHex }}
            >
              <span className="font-display text-sm">{t.name}</span>
              <span className="block text-[10px] uppercase tracking-wide opacity-60">{t.mascot}</span>
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
