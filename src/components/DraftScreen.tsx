// DRAFT + COACH_SPIN layout shell: desktop split-screen (§8.3), stacking on
// small viewports (§8.4 refined in the mobile pass).
import FieldPane from "./FieldPane.tsx";
import DraftBoard from "./DraftBoard.tsx";
import { useGame } from "../state/store.tsx";
import { markColors } from "./TeamMark.tsx";

export default function DraftScreen() {
  const { state } = useGame();
  const team = state.favoriteTeam;
  const badge = team ? markColors(team.mainHex, team.accentHex) : null;
  return (
    <main className="mx-auto grid max-w-6xl grid-cols-1 gap-4 p-4 lg:h-screen lg:grid-cols-2">
      <div className="flex flex-col gap-2 lg:min-h-0">
        <header className="flex items-center justify-between gap-2 px-1">
          <h1 className="font-display text-xl tracking-widest">THE 16-0 DRAFT</h1>
          {team && badge && (
            <span
              className="rounded-md px-3 py-1.5 font-display text-xs tracking-wider shadow-sm"
              style={{ backgroundColor: badge.bg, color: badge.fg }}
            >
              {team.name.toUpperCase()}
            </span>
          )}
        </header>
        <FieldPane />
      </div>
      <div className="lg:min-h-0">
        <DraftBoard />
      </div>
    </main>
  );
}
