// SEASON_ANIMATION (§8.6): replays the pre-computed schedule week by week,
// accelerating toward the postseason reveal. The record is already decided —
// this is pure theater, so it's always skippable and honors reduced motion.
import { useEffect, useRef, useState } from "react";
import { useGame } from "../state/store.tsx";
import { RegularGameChip, PlayoffGameChip } from "./GameChip.tsx";

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

  const shownGames = schedule.slice(0, shown);
  const wins = shownGames.filter((g) => g.result === "WIN").length;
  const losses = shown - wins;
  const regularGames = shownGames.filter((g) => g.phase === "REG");
  const postseasonGames = shownGames.filter((g) => g.phase !== "REG");

  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col items-center justify-center gap-6 p-6">
      <header className="text-center">
        <p className="font-display text-xs tracking-[0.3em] opacity-60">THE SEASON</p>
        <p className="mt-2 font-display text-6xl tabular-nums tracking-wider">
          {wins}-{losses}
        </p>
      </header>

      {/* Regular Season Games */}
      {regularGames.length > 0 && (
        <section className="w-full max-w-2xl">
          <h3 className="mb-2 text-center font-display text-[10px] tracking-[0.3em] opacity-50">
            REGULAR SEASON
          </h3>
          <ol className="flex flex-wrap justify-center gap-2" aria-label="Regular season results">
            {regularGames.map((g) => (
              <RegularGameChip key={g.week} game={g} animate />
            ))}
          </ol>
        </section>
      )}

      {/* Postseason Games - Separate section, larger */}
      {postseasonGames.length > 0 && (
        <section className="w-full max-w-2xl">
          <h3 className="mb-2 text-center font-display text-[10px] tracking-[0.3em] opacity-50">
            POSTSEASON
          </h3>
          <div className="flex flex-wrap justify-center gap-3" aria-label="Postseason results">
            {postseasonGames.map((g) => (
              <PlayoffGameChip key={g.week} game={g} animate />
            ))}
          </div>
        </section>
      )}

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
