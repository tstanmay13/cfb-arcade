// Watch mode (v1.4): drive-by-drive viewer with per-drive coaching — chew
// clock / no-huddle / blitz toggles and the one-shot QB spark swap. Runs the
// exact GameSim the fast-sim would (same seeded stream), so watching is a
// choice, not a different game. Outcome commits through the shared path.
import { useMemo, useRef, useState } from "react";
import type { DynastyState, SchedGame } from "./engine/types.ts";
import { GameSim, type SimOutcome, type Tactics } from "./engine/game.ts";
import { prepareGame } from "./engine/dynasty.ts";

export default function WatchGame({
  state,
  game,
  onCommit,
  onClose,
}: {
  state: DynastyState;
  game: SchedGame;
  onCommit: (outcome: SimOutcome) => void;
  onClose: () => void;
}) {
  const simRef = useRef<GameSim | null>(null);
  const sim = useMemo(() => {
    if (!simRef.current) {
      const { home, away, rng, opts } = prepareGame(state, game);
      simRef.current = new GameSim(home, away, rng, opts);
    }
    return simRef.current;
    // The sim is created once per mounted game — state churn must not rebuild it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [game.id]);

  const [, force] = useState(0);
  const [tactics, setTactics] = useState<Tactics>({});
  const [sparkMsg, setSparkMsg] = useState<string | null>(null);
  const [committed, setCommitted] = useState(false);
  const rerender = () => force((x) => x + 1);

  const homeSchool = state.teams[game.home].school;
  const awaySchool = state.teams[game.away].school;

  const next = () => {
    sim.playDrive(tactics);
    rerender();
  };
  const toEnd = () => {
    sim.finish(tactics);
    rerender();
  };
  const doSwap = () => {
    const msg = sim.swapQb();
    if (msg) setSparkMsg(msg);
    rerender();
  };
  const commit = () => {
    if (committed) return;
    setCommitted(true);
    onCommit(sim.outcome());
  };

  const toggle = (k: keyof Tactics) => setTactics((t) => ({ ...t, [k]: !t[k] }));
  const tbtn = (k: keyof Tactics, label: string, hint: string) => (
    <button
      key={k}
      type="button"
      title={hint}
      onClick={() => toggle(k)}
      aria-pressed={!!tactics[k]}
      className={`rounded-full border-2 px-3 py-1 font-display text-[10px] tracking-widest transition ${
        tactics[k] ? "border-ink bg-ink text-paper" : "border-paper-edge hover:border-ink/40"
      }`}
    >
      {label}
    </button>
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/60 p-4" role="presentation">
      <div
        className="flex max-h-[90vh] w-full max-w-2xl flex-col rounded-lg border-2 border-ink bg-paper p-5 shadow-xl"
        role="dialog"
      >
        <div className="flex items-baseline justify-between">
          <h3 className="font-display text-xl">
            {awaySchool} <span className="text-3xl">{sim.as}</span>
            <span className="mx-2 opacity-40">@</span>
            {homeSchool} <span className="text-3xl">{sim.hs}</span>
          </h3>
          <span className="font-display text-sm opacity-70">
            {sim.done ? (sim.ot > 0 ? `FINAL (${sim.ot}OT)` : "FINAL") : `Q${sim.quarter()} · ${sim.clock()}`}
          </span>
        </div>
        {game.name && <p className="text-xs opacity-60">{game.name}</p>}
        {sparkMsg && <p className="mt-1 text-sm">🔥 {sparkMsg}</p>}

        <ul className="mt-3 min-h-32 flex-1 space-y-0.5 overflow-y-auto rounded border border-paper-edge bg-white/50 p-2 text-xs">
          {sim.drives.length === 0 && <li className="opacity-60">Kickoff is yours — call the first drive.</li>}
          {[...sim.drives].reverse().map((d, i) => (
            <li key={sim.drives.length - i}>
              <span className="mr-1 rounded bg-ink/10 px-1 text-[10px]">Q{d.q}</span>
              <span className="font-bold">{state.teams[d.t].school}</span>: {d.r} — {d.d}
            </li>
          ))}
        </ul>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          {tbtn("chew", "CHEW CLOCK", "+run game, burns ~40s more per drive, weaker passing")}
          {tbtn("noHuddle", "NO-HUDDLE", "+pass game, saves ~35s per drive, riskier throws")}
          {tbtn("blitz", "BLITZ HEAVY", "+pass rush on defense, exposes your secondary")}
          <button
            type="button"
            onClick={doSwap}
            className="rounded-full border-2 border-paper-edge px-3 py-1 font-display text-[10px] tracking-widest transition hover:border-ink/40 disabled:opacity-30"
            disabled={sim.done}
            title="One-shot spark: bench the starter (35% inspired / 45% steady / 20% lost)"
          >
            🔄 QB SPARK SWAP
          </button>
        </div>

        <div className="mt-3 flex items-center gap-2">
          {!sim.done ? (
            <>
              <button
                type="button"
                onClick={next}
                className="rounded-full border-2 border-ink bg-ink px-6 py-2 font-display text-xs tracking-widest text-paper transition hover:opacity-85"
              >
                NEXT DRIVE ▶
              </button>
              <button
                type="button"
                onClick={toEnd}
                className="rounded-full border-2 border-paper-edge px-4 py-2 font-display text-[10px] tracking-widest transition hover:border-ink/40"
              >
                SIM TO FINAL
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={() => {
                commit();
                onClose();
              }}
              className="rounded-full border-2 border-ink bg-ink px-6 py-2 font-display text-xs tracking-widest text-paper transition hover:opacity-85"
            >
              APPLY RESULT & CLOSE
            </button>
          )}
          {!sim.done && (
            <button
              type="button"
              onClick={onClose}
              className="ml-auto rounded-full border-2 border-paper-edge px-4 py-2 font-display text-[10px] tracking-widest transition hover:border-ink/40"
              title="Abandon the broadcast — the game will fast-sim with the week"
            >
              EXIT (FAST-SIM LATER)
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
