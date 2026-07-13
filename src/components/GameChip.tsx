// Shared game display components for SeasonScreen and ResultsScreen
import type { ScheduledGame } from "../engine/sim.ts";

const PHASE_LABELS: Record<string, string> = {
  CCG: "Conf Champ",
  QF: "Quarterfinal",
  SF: "Semifinal",
  FINAL: "National Championship",
  BOWL: "Bowl Game",
};

/** Regular season game chip - shows W/L, score, and opponent */
export function RegularGameChip({
  game,
  animate,
}: {
  game: ScheduledGame;
  animate?: boolean;
}) {
  const isWin = game.result === "WIN";
  return (
    <li
      className={`flex flex-col items-center rounded-lg px-2 py-1.5 text-white ${
        isWin ? "bg-emerald-700" : "bg-red-800"
      } ${animate ? "chip-in" : ""}`}
    >
      <span className="text-xs font-bold">
        {isWin ? "W" : "L"} {game.score}
      </span>
      <span className="max-w-[5rem] truncate text-[10px] opacity-80">
        vs {game.opponent}
      </span>
    </li>
  );
}

/** Playoff/bowl game chip - larger, more prominent with phase label */
export function PlayoffGameChip({
  game,
  animate,
}: {
  game: ScheduledGame;
  animate?: boolean;
}) {
  const isWin = game.result === "WIN";
  const phaseLabel = PHASE_LABELS[game.phase] ?? game.phase;

  return (
    <div
      className={`flex flex-col items-center rounded-xl px-4 py-2 text-white ring-2 ring-amber-400 ${
        isWin ? "bg-emerald-700" : "bg-red-800"
      } ${animate ? "chip-in" : ""}`}
    >
      <span className="font-display text-[10px] tracking-wider opacity-70">
        {phaseLabel.toUpperCase()}
      </span>
      <span className="font-display text-lg font-bold">
        {isWin ? "WIN" : "LOSS"}
      </span>
      <span className="text-sm">
        {game.score} vs {game.opponent}
      </span>
    </div>
  );
}
