// DRAFT + COACH_SPIN layout shell: desktop split-screen (§8.3), stacking on
// small viewports (§8.4 refined in the mobile pass).
import { useEffect, useState } from "react";
import FieldPane from "./FieldPane.tsx";
import DraftBoard from "./DraftBoard.tsx";
import { useGame } from "../state/store.tsx";
import { markColors } from "./TeamMark.tsx";

export default function DraftScreen() {
  const { state, dispatch } = useGame();
  const team = state.favoriteTeam;
  const badge = team ? markColors(team.mainHex, team.accentHex) : null;
  const [confirmRestart, setConfirmRestart] = useState(false);

  useEffect(() => {
    if (!confirmRestart) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setConfirmRestart(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [confirmRestart]);

  return (
    <main className="mx-auto grid max-w-6xl grid-cols-1 gap-4 p-4 lg:h-screen lg:grid-cols-2">
      <div className="flex flex-col gap-2 lg:min-h-0">
        <header className="flex items-center justify-between gap-2 px-1">
          <h1 className="font-display text-xl tracking-widest">THE 16-0 DRAFT</h1>
          {team && badge && (
            <div className="flex items-center gap-2">
              <span
                className="rounded-md px-3 py-1.5 font-display text-xs tracking-wider shadow-sm"
                style={{ backgroundColor: badge.bg, color: badge.fg }}
              >
                {team.name.toUpperCase()}
              </span>
              <button
                type="button"
                onClick={() => setConfirmRestart(true)}
                aria-label="Restart draft"
                title="Restart draft"
                className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-ink/25 bg-white/70 text-sm text-ink/55 transition hover:rotate-[-45deg] hover:border-ink/50 hover:text-ink"
              >
                ↺
              </button>
            </div>
          )}
        </header>
        <FieldPane />
      </div>
      <div className="lg:min-h-0">
        <DraftBoard />
      </div>

      {confirmRestart && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Restart draft"
          onClick={() => setConfirmRestart(false)}
          className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 p-4 backdrop-blur-sm"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-sm rounded-xl border border-paper-edge bg-paper p-5 text-center shadow-2xl"
          >
            <h2 className="font-display text-xl tracking-wide">RESTART DRAFT?</h2>
            <p className="mx-auto mt-2 max-w-xs text-sm opacity-70">
              Your current board will be cleared and you'll head back to team select to start a fresh run.
            </p>
            <div className="mt-5 flex justify-center gap-2">
              <button
                type="button"
                onClick={() => setConfirmRestart(false)}
                className="rounded-lg border-2 border-paper-edge px-5 py-2 font-display text-sm tracking-wider transition hover:border-ink/40"
              >
                CANCEL
              </button>
              <button
                type="button"
                onClick={() => {
                  setConfirmRestart(false);
                  dispatch({ type: "REPLAY" });
                }}
                className="rounded-lg bg-team px-5 py-2 font-display text-sm tracking-wider text-team-accent shadow transition hover:brightness-110"
              >
                RESTART
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
