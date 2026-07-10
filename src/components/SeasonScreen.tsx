// SEASON_ANIMATION (§8.6): replays the pre-computed schedule week by week,
// accelerating toward the postseason reveal. The record is already decided —
// this is pure theater, so it's always skippable and honors reduced motion.
import { useEffect, useRef, useState } from "react";
import { useGame } from "../state/store.tsx";

const PHASE_LABEL: Record<string, string> = {
  REG: "",
  CCG: "Conference Championship",
  QF: "Playoff Quarterfinal",
  SF: "National Semifinal",
  FINAL: "National Championship",
  BOWL: "Bowl Game",
};

export default function SeasonScreen() {
  const { state, dispatch } = useGame();
  const resolved = state.resolved!;
  const schedule = resolved.schedule;
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const [shown, setShown] = useState(reduced ? schedule.length : 0);
  const done = shown >= schedule.length;
  const timer = useRef<number>(0);

  useEffect(() => {
    if (done) return;
    // Accelerate through the regular season, breathe before postseason games.
    const next = schedule[shown];
    const base = shown < 4 ? 420 : shown < 12 ? 240 : 850;
    timer.current = window.setTimeout(() => setShown((n) => n + 1), next ? base : 0);
    return () => clearTimeout(timer.current);
  }, [shown, done, schedule]);

  const wins = schedule.slice(0, shown).filter((g) => g.result === "WIN").length;
  const losses = shown - wins;
  const current = shown > 0 ? schedule[Math.min(shown, schedule.length) - 1] : null;

  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col items-center justify-center gap-8 p-6">
      <header className="text-center">
        <p className="font-display text-xs tracking-[0.3em] opacity-60">THE SEASON</p>
        <p className="mt-2 font-display text-6xl tabular-nums tracking-wider">
          {wins}-{losses}
        </p>
        <p className="mt-1 min-h-5 text-sm opacity-70">
          {current && PHASE_LABEL[current.phase]
            ? `${PHASE_LABEL[current.phase]} · ${current.result === "WIN" ? "won" : "lost"} ${current.score}`
            : current
              ? `Week ${current.week} · ${current.result === "WIN" ? "beat" : "fell to"} ${current.opponent} ${current.score}`
              : "Kickoff…"}
        </p>
      </header>

      <ol className="flex max-w-xl flex-wrap justify-center gap-1.5" aria-label="Season results so far">
        {schedule.slice(0, shown).map((g) => (
          <li
            key={g.week}
            className={`chip-in flex h-9 w-9 items-center justify-center rounded font-display text-sm text-white shadow
              ${g.result === "WIN" ? "bg-emerald-700" : "bg-red-800"}`}
            title={`${g.phase === "REG" ? `Week ${g.week}` : PHASE_LABEL[g.phase]}: ${g.score} vs ${g.opponent}`}
          >
            {g.result === "WIN" ? "W" : "L"}
          </li>
        ))}
      </ol>

      {done ? (
        <button
          type="button"
          onClick={() => dispatch({ type: "SEASON_DONE" })}
          className="rounded-lg bg-team px-10 py-4 font-display text-lg tracking-[0.2em] text-team-accent shadow-lg transition hover:scale-105"
        >
          SEE THE FINAL VERDICT
        </button>
      ) : (
        <button
          type="button"
          onClick={() => setShown(schedule.length)}
          className="text-xs underline opacity-60 hover:opacity-100"
        >
          skip to the end
        </button>
      )}
    </main>
  );
}
