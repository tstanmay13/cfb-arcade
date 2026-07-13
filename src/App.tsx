import { lazy, Suspense, useEffect, useState } from "react";
import type { GameData } from "./data/types.ts";
import { loadData } from "./data/loadData.ts";
import { GameProvider, useGame, useTeamTheme } from "./state/store.tsx";
import TeamSelect from "./components/TeamSelect.tsx";
import DraftScreen from "./components/DraftScreen.tsx";
import SeasonScreen from "./components/SeasonScreen.tsx";
import ResultsScreen from "./components/ResultsScreen.tsx";
import GuessSeason from "./components/GuessSeason.tsx";

// Cabinet #3 (ADR-0023) is a lazy chunk — the dailies never pay for it.
const GmCabinet = lazy(() => import("./gm/GmCabinet.tsx"));

/** Which arcade cabinet is on screen (ADR-0017). */
type View = "draft" | "guess" | "gm";

/** Path-per-cabinet serving (ADR-0023): / draft · /guess · /gm. */
const VIEW_PATH: Record<View, string> = { draft: "/", guess: "/guess", gm: "/gm" };

function viewFromPath(pathname: string): View {
  if (pathname.startsWith("/gm")) return "gm";
  if (pathname.startsWith("/guess")) return "guess";
  return "draft";
}

function Screens({ onOpenArcade, onOpenGm }: { onOpenArcade: () => void; onOpenGm: () => void }) {
  const { state } = useGame();
  useTeamTheme(state.favoriteTeam);
  switch (state.phase) {
    case "TEAM_SELECT":
      return <TeamSelect onOpenArcade={onOpenArcade} onOpenGm={onOpenGm} />;
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
  const [view, setViewState] = useState<View>(() => viewFromPath(window.location.pathname));

  const setView = (v: View) => {
    setViewState(v);
    if (window.location.pathname !== VIEW_PATH[v]) {
      window.history.pushState(null, "", VIEW_PATH[v]);
    }
  };

  useEffect(() => {
    const onPop = () => setViewState(viewFromPath(window.location.pathname));
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

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
  if (view === "gm") {
    return (
      <Suspense
        fallback={
          <main className="flex min-h-screen items-center justify-center">
            <p className="font-display text-xl tracking-widest">OPENING THE FRONT OFFICE…</p>
          </main>
        }
      >
        <GmCabinet onBack={() => setView("draft")} />
      </Suspense>
    );
  }
  if (view === "guess") {
    return <GuessSeason teams={data.teams} onBack={() => setView("draft")} />;
  }
  return (
    <GameProvider data={data}>
      <Screens onOpenArcade={() => setView("guess")} onOpenGm={() => setView("gm")} />
    </GameProvider>
  );
}
