// Watch mode (v1.4): drive-by-drive viewer with per-drive coaching — chew
// clock / no-huddle / blitz toggles and the one-shot QB spark swap. Runs the
// exact GameSim the fast-sim would (same seeded stream), so watching is a
// choice, not a different game. Outcome commits through the shared path.
import { useEffect, useMemo, useRef, useState } from "react";
import type { DynastyState, SchedGame } from "./engine/types.ts";
import { GameSim, type SimOutcome, type Tactics } from "./engine/game.ts";
import { prepareGame } from "./engine/dynasty.ts";
import { getTeamColors } from "./theme.ts";
import { TeamMark } from "./ui.tsx";

/** Drive-outcome chip tone: scores read positive, giveaways read negative. */
function driveChip(r: string): { label: string; cls: string } {
  if (r === "TD") return { label: "TD", cls: "bg-pos-soft text-pos" };
  if (r === "FG") return { label: "FG", cls: "bg-surface-sunken text-ink/70" };
  if (r === "FGX") return { label: "FG ✗", cls: "bg-neg-soft text-neg" };
  if (r === "TO" || r === "FUM" || r === "INT") return { label: r, cls: "bg-neg-soft text-neg" };
  if (r === "DOWNS") return { label: "4TH ✗", cls: "bg-neg-soft text-neg" };
  return { label: r, cls: "bg-surface-sunken text-ink/55" };
}

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
  const [auto, setAuto] = useState(false);
  const rerender = () => force((x) => x + 1);

  // Broadcast mode: one drive every ~0.8s until the final gun (or toggle off).
  useEffect(() => {
    if (!auto || sim.done) return;
    const id = window.setInterval(() => {
      sim.playDrive(tactics);
      force((x) => x + 1);
      if (sim.done) setAuto(false);
    }, 800);
    return () => window.clearInterval(id);
  }, [auto, tactics, sim, sim.done]);

  const homeTeam = state.teams[game.home];
  const awayTeam = state.teams[game.away];
  const homeColors = getTeamColors(homeTeam);
  const awayColors = getTeamColors(awayTeam);
  // offenseHome flips after each drive, so at rest it names who's up next.
  const possHome = !sim.done && sim.offenseHome;
  const possAway = !sim.done && !sim.offenseHome;

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
        {/* Broadcast scoreboard (V1): team-color slabs, clock, possession dot. */}
        <div className="grid grid-cols-[1fr_auto_1fr] overflow-hidden rounded-lg border border-line">
          <div
            className="flex items-center gap-2.5 px-3 py-2.5"
            style={{ background: awayColors.primary, color: awayColors.onPrimary }}
          >
            <TeamMark team={awayTeam} size="m" inverse />
            <span className="hidden truncate font-display text-sm tracking-wide sm:inline">
              {awayTeam.school.toUpperCase()}
            </span>
            {possAway && <span aria-label="on offense" className="h-2 w-2 shrink-0 rounded-full bg-current" />}
            <span className="ml-auto font-display text-3xl leading-none tabular-nums">{sim.as}</span>
          </div>
          <div className="flex flex-col items-center justify-center gap-0.5 bg-ink px-3 py-1 text-paper">
            <span className="font-display text-[9px] tracking-[0.25em] text-paper/60">
              {sim.done ? "" : `Q${sim.quarter()}`}
            </span>
            <span className="font-display text-sm">
              {sim.done ? (sim.ot > 0 ? `FINAL ${sim.ot}OT` : "FINAL") : sim.clock()}
            </span>
          </div>
          <div
            className="flex items-center gap-2.5 px-3 py-2.5"
            style={{ background: homeColors.primary, color: homeColors.onPrimary }}
          >
            <span className="font-display text-3xl leading-none tabular-nums">{sim.hs}</span>
            {possHome && <span aria-label="on offense" className="h-2 w-2 shrink-0 rounded-full bg-current" />}
            <span className="ml-auto hidden truncate font-display text-sm tracking-wide sm:inline">
              {homeTeam.school.toUpperCase()}
            </span>
            <TeamMark team={homeTeam} size="m" inverse />
          </div>
        </div>
        {game.name && <p className="mt-1 text-xs opacity-60">{game.name}</p>}
        {sparkMsg && <p className="mt-1 text-sm">🔥 {sparkMsg}</p>}

        {/* Drive log, railed by who had the ball; newest slides in on top. */}
        <ul className="mt-3 min-h-32 flex-1 space-y-0.5 overflow-y-auto rounded border border-paper-edge bg-white/50 p-2 text-xs">
          {sim.drives.length === 0 && <li className="opacity-60">Kickoff is yours — call the first drive.</li>}
          {[...sim.drives].reverse().map((d, i) => {
            const chip = driveChip(d.r);
            const c = getTeamColors(state.teams[d.t]);
            return (
              <li
                key={sim.drives.length - i}
                className={`flex items-center gap-1.5 rounded-r py-0.5 pl-2 ${i === 0 && !sim.done ? "gm-slide-in" : ""}`}
                style={{ boxShadow: `inset 3px 0 0 ${c.primary}` }}
              >
                <span className="rounded bg-ink/10 px-1 text-[10px]">Q{d.q}</span>
                <span className={`rounded px-1.5 py-px font-display text-[9px] tracking-wide ${chip.cls}`}>
                  {chip.label}
                </span>
                <span>
                  <span className="font-bold">{state.teams[d.t].school}</span> — {d.d}
                </span>
              </li>
            );
          })}
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
                onClick={() => setAuto(!auto)}
                aria-pressed={auto}
                className={`rounded-full border-2 px-4 py-2 font-display text-[10px] tracking-widest transition ${
                  auto ? "border-ink bg-ink text-paper" : "border-paper-edge hover:border-ink/40"
                }`}
                title="Broadcast mode: a drive every ~0.8s"
              >
                {auto ? "⏸ PAUSE" : "▶▶ AUTO"}
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
