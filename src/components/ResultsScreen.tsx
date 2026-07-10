// RESULTS placeholder — replaced by the sim/season/awards wiring (build-order
// steps 4–7). For now it proves the full draft loop completes.
import { useGame } from "../state/store.tsx";

export default function ResultsScreen() {
  const { state, dispatch } = useGame();
  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col items-center justify-center gap-6 p-6 text-center">
      <h1 className="font-display text-3xl tracking-widest">ROSTER LOCKED</h1>
      <ul className="w-full space-y-1 text-sm">
        {Object.entries(state.slots).map(([slot, p]) => (
          <li key={slot} className="flex justify-between border-b border-paper-edge py-1">
            <span className="font-display">{slot}</span>
            <span>
              {p?.name} · {p?.school} ({p?.decade})
            </span>
          </li>
        ))}
        <li className="flex justify-between py-1">
          <span className="font-display">HC</span>
          <span>
            {state.hc?.name} · {state.hc?.school} ({state.hc?.decade})
          </span>
        </li>
      </ul>
      <p className="text-sm opacity-70">Season simulation arrives in the next build step.</p>
      <button
        type="button"
        onClick={() => dispatch({ type: "REPLAY" })}
        className="rounded-lg bg-team px-8 py-3 font-display tracking-widest text-team-accent"
      >
        RUN IT BACK
      </button>
    </main>
  );
}
