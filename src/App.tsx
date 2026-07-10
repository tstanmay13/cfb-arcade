import { useEffect, useState } from "react";
import type { GameData } from "./data/types.ts";
import { loadData } from "./data/loadData.ts";
import { GameProvider, useGame, useTeamTheme } from "./state/store.tsx";
import TeamSelect from "./components/TeamSelect.tsx";
import DraftScreen from "./components/DraftScreen.tsx";
import SeasonScreen from "./components/SeasonScreen.tsx";
import ResultsScreen from "./components/ResultsScreen.tsx";
import GuessSeason from "./components/GuessSeason.tsx";

/** Which arcade cabinet is on screen (ADR-0017). */
type View = "draft" | "guess";

function Screens({ onOpenArcade }: { onOpenArcade: () => void }) {
  const { state } = useGame();
  useTeamTheme(state.favoriteTeam);
  switch (state.phase) {
    case "TEAM_SELECT":
      return <TeamSelect onOpenArcade={onOpenArcade} />;
    case "DRAFT":
    case "COACH_SPIN":
      return <DraftScreen />;
    case "SEASON":
      return <SeasonScreen />;
    case "RESULTS":
      return <ResultsScreen />;
    default:
      return null;
  }
}

export default function App() {
  const [data, setData] = useState<GameData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<View>("draft");

  useEffect(() => {
    loadData().then(setData, (e) => setError(String(e)));
  }, []);

  if (error) {
    return (
      <main className="flex min-h-screen items-center justify-center p-8">
        <div className="max-w-md text-center">
          <h1 className="font-display text-2xl">The 16-0 Draft</h1>
          <p className="mt-4 text-sm">
            Couldn't load the player database. Re-bake it with{" "}
            <code className="rounded bg-ink/10 px-1">npm run build:data</code> and reload.
          </p>
          <p className="mt-2 text-xs opacity-60">{error}</p>
        </div>
      </main>
    );
  }
  if (!data) {
    return (
      <main className="flex min-h-screen items-center justify-center">
        <p className="font-display text-xl tracking-widest">LOADING THE BOARD…</p>
      </main>
    );
  }
  if (view === "guess") {
    return <GuessSeason teams={data.teams} onBack={() => setView("draft")} />;
  }
  return (
    <GameProvider data={data}>
      <Screens onOpenArcade={() => setView("guess")} />
    </GameProvider>
  );
}
