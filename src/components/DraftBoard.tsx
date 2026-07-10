// RIGHT pane: the draft board (§8.3) — landed-cell masthead, the spin's full
// roster, mode-aware stat visibility (§8.5), greying for unplaceable rows,
// and the spin controls. The slot-machine ticker (§8.6) is pure theater: the
// result is already in state before it plays.
import { useEffect, useRef, useState } from "react";
import type { Coach, GamePosition, Player } from "../data/types.ts";
import { STAT_LABELS, COACH_STAT_LABELS } from "../data/types.ts";
import { eligibleOpenSlots } from "../engine/spin.ts";
import { useGame, useGameActions } from "../state/store.tsx";

const POS_ORDER: GamePosition[] = ["QB", "RB", "WR", "DL", "LB", "CB", "S"];

function useSpinReveal(): boolean {
  // True while the ticker plays after a new spin lands.
  const { state } = useGame();
  const [revealing, setRevealing] = useState(false);
  const last = useRef(state.spinCounter);
  useEffect(() => {
    if (state.spinCounter === last.current) return;
    last.current = state.spinCounter;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    setRevealing(true);
    const t = setTimeout(() => setRevealing(false), 850);
    return () => clearTimeout(t);
  }, [state.spinCounter]);
  return revealing;
}

function Ticker() {
  const { data } = useGame();
  const [i, setI] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setI((n) => n + 1), 90);
    return () => clearInterval(t);
  }, []);
  const teams = data.teams;
  const t = teams[i % teams.length];
  const era = t.eras_present[i % t.eras_present.length];
  return (
    <div className="flex h-40 items-center justify-center overflow-hidden" aria-label="Spinning">
      <p key={i} className="ticker-item font-display text-2xl tracking-widest">
        {era} {t.name.toUpperCase()}
      </p>
    </div>
  );
}

function StatLine({ pos, stats }: { pos: GamePosition; stats: Player["stats"] }) {
  const labels = STAT_LABELS[pos];
  const values = [stats.stat_1, stats.stat_2, stats.stat_3, stats.stat_4, stats.stat_5];
  return (
    <dl className="mt-1 grid grid-cols-5 gap-1 text-[10px] leading-tight">
      {labels.map((label, i) => (
        <div key={label}>
          <dt className="truncate uppercase tracking-wide opacity-50">{label}</dt>
          <dd className="font-display text-xs">{values[i]}</dd>
        </div>
      ))}
    </dl>
  );
}

function PlayerRow({ player }: { player: Player }) {
  const { state, dispatch } = useGame();
  const open = eligibleOpenSlots(player, state.slots);
  const dead = open.length === 0;
  const selected = state.pendingPick?.player_id === player.player_id;
  return (
    <li>
      <button
        type="button"
        disabled={dead}
        onClick={() =>
          dispatch(selected ? { type: "CANCEL_PICK" } : { type: "PICK", player })
        }
        aria-pressed={selected}
        className={`w-full rounded-md border px-3 py-2 text-left transition
          ${dead ? "opacity-35" : "hover:border-ink/50"}
          ${selected ? "border-ink bg-ink/5 shadow-sm" : "border-paper-edge bg-white/60"}`}
      >
        <div className="flex items-baseline justify-between gap-2">
          <span className="truncate font-semibold">
            {player.name}
            {player.jersey_number && (
              <span className="ml-1.5 font-display text-xs opacity-50">#{player.jersey_number}</span>
            )}
          </span>
          <span className="shrink-0 rounded bg-ink/85 px-1.5 py-0.5 font-display text-[10px] tracking-wider text-paper">
            {player.primary_position}
            {player.secondary_position ? `/${player.secondary_position}` : ""}
          </span>
        </div>
        {state.mode === "Classic" && <StatLine pos={player.primary_position} stats={player.stats} />}
        {dead && !state.pendingPick && (
          <p className="mt-1 text-[10px] uppercase tracking-wide opacity-60">
            {Object.values(state.slots).some((s) => s?.name === player.name && s.school_id === player.school_id)
              ? "Already on your roster"
              : "No open position"}
          </p>
        )}
      </button>
    </li>
  );
}

function CoachRow({ coach }: { coach: Coach }) {
  const { state } = useGame();
  const { placeCoach } = useGameActions();
  const values = [coach.stats.stat_1, coach.stats.stat_2, coach.stats.stat_3, coach.stats.stat_4, coach.stats.stat_5];
  return (
    <li>
      <button
        type="button"
        onClick={() => placeCoach(coach)}
        className="w-full rounded-md border border-paper-edge bg-white/60 px-3 py-2 text-left transition hover:border-ink/50"
      >
        <div className="flex items-baseline justify-between gap-2">
          <span className="font-semibold">{coach.name}</span>
          {state.mode === "Classic" && (
            <span className="shrink-0 rounded bg-ink/85 px-1.5 py-0.5 font-display text-[10px] tracking-wider text-paper">
              {coach.coach_tier.toUpperCase()}
            </span>
          )}
        </div>
        {state.mode === "Classic" && (
          <dl className="mt-1 grid grid-cols-5 gap-1 text-[10px] leading-tight">
            {COACH_STAT_LABELS.map((label, i) => (
              <div key={label}>
                <dt className="truncate uppercase tracking-wide opacity-50">{label}</dt>
                <dd className="font-display text-xs">{values[i]}</dd>
              </div>
            ))}
          </dl>
        )}
      </button>
    </li>
  );
}

export default function DraftBoard() {
  const { state, data, dispatch } = useGame();
  const {
    doSpin,
    doTeamRespin,
    doEraRespin,
    doFallbackSpin,
    placePlayer,
    poolIsDead,
  } = useGameActions();
  const revealing = useSpinReveal();

  const coachPhase = state.phase === "COACH_SPIN";
  const cell = coachPhase ? state.currentCoachSpin : state.currentSpin;
  const cellTeam = cell ? data.teams.find((t) => t.school_id === cell.teamId) : null;
  const filled = Object.values(state.slots).filter(Boolean).length;
  const needSpin = !coachPhase && state.currentSpin === null;
  const outOfRespins = state.respins.team <= 0 && state.respins.era <= 0;

  const sortedPool =
    !coachPhase && state.currentSpin
      ? [...state.currentSpin.pool].sort(
          (a, b) =>
            POS_ORDER.indexOf(a.primary_position) - POS_ORDER.indexOf(b.primary_position) ||
            a.name.localeCompare(b.name),
        )
      : [];

  return (
    <section aria-label="Draft board" className="flex min-h-[420px] flex-col rounded-xl border border-paper-edge bg-paper/70 shadow-sm lg:h-full">
      {/* Masthead: the landed cell */}
      <header
        className="rounded-t-xl border-b-4 px-4 py-3"
        style={{
          borderColor: cellTeam?.mainHex ?? "var(--ink)",
          background: `linear-gradient(90deg, ${cellTeam?.mainHex ?? "var(--ink)"}18, transparent 70%)`,
        }}
      >
        <div className="flex items-baseline justify-between">
          <div>
            <p className="text-[10px] uppercase tracking-[0.25em] opacity-60">
              {coachPhase ? "Coach spin · final slot" : `Spin ${filled + 1} of 8 · landed on`}
            </p>
            <h2 className="font-display text-2xl tracking-wide">
              {revealing || !cell ? "· · ·" : `${cell.era} ${cellTeam?.name.toUpperCase() ?? cell.teamId}`}
            </h2>
          </div>
          <p className="font-display text-xs tracking-widest opacity-70">{state.mode.toUpperCase()} MODE</p>
        </div>
      </header>

      {/* Pool */}
      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        {revealing ? (
          <Ticker />
        ) : needSpin ? (
          <div className="flex h-40 flex-col items-center justify-center gap-2 text-center">
            <p className="font-display tracking-widest opacity-70">
              {filled === 0 ? "SPIN TO OPEN THE DRAFT" : "PICK LOCKED IN — SPIN AGAIN"}
            </p>
          </div>
        ) : coachPhase && state.currentCoachSpin ? (
          <ul className="space-y-2">
            {state.currentCoachSpin.pool.map((c) => (
              <CoachRow key={c.coach_id} coach={c} />
            ))}
          </ul>
        ) : (
          <ul className="space-y-2">
            {sortedPool.map((p) => (
              <PlayerRow key={p.player_id} player={p} />
            ))}
          </ul>
        )}
      </div>

      {/* Pending-pick hint (desktop: tap the field) / placement sheet (mobile, §8.4) */}
      {state.pendingPick && !revealing && (
        <div className="border-t border-paper-edge px-4 py-2 text-center text-xs">
          <p className="hidden lg:block">
            Place <strong>{state.pendingPick.display_short}</strong> — tap a glowing slot on the field, or{" "}
            <button type="button" className="underline" onClick={() => dispatch({ type: "CANCEL_PICK" })}>
              cancel
            </button>
          </p>
          <div className="flex flex-wrap items-center justify-center gap-2 lg:hidden">
            <span>
              Place <strong>{state.pendingPick.display_short}</strong> at
            </span>
            {eligibleOpenSlots(state.pendingPick, state.slots).map((slot) => (
              <button
                key={slot}
                type="button"
                onClick={() => placePlayer(state.pendingPick!, slot)}
                className="rounded-md bg-team px-3 py-1.5 font-display text-xs tracking-wider text-team-accent"
              >
                {slot}
              </button>
            ))}
            <button type="button" className="underline opacity-70" onClick={() => dispatch({ type: "CANCEL_PICK" })}>
              cancel
            </button>
          </div>
        </div>
      )}
      {!revealing && !needSpin && !coachPhase && poolIsDead && (
        <p className="border-t border-paper-edge px-4 py-2 text-center text-xs">
          No one here fits an open position —{" "}
          {outOfRespins ? (
            <button type="button" className="font-semibold underline" onClick={doFallbackSpin}>
              take a free re-roll
            </button>
          ) : (
            "use a re-spin below."
          )}
        </p>
      )}

      {/* Actions — sticky thumb bar on mobile (§8.4) */}
      <footer className="sticky bottom-0 flex items-center gap-2 rounded-b-xl border-t border-paper-edge bg-white/90 p-3 backdrop-blur lg:static lg:bg-white/50">
        <button
          type="button"
          disabled={!needSpin || revealing}
          onClick={doSpin}
          className="flex-1 rounded-lg bg-team px-4 py-3 font-display text-lg tracking-[0.25em] text-team-accent shadow transition enabled:hover:brightness-110 disabled:opacity-35"
        >
          SPIN
        </button>
        <button
          type="button"
          disabled={needSpin || revealing || state.respins.team <= 0}
          onClick={doTeamRespin}
          className="rounded-lg border-2 border-ink/70 px-3 py-3 font-display text-xs tracking-wider transition enabled:hover:bg-ink/5 disabled:opacity-35"
          title="Keep the era, re-roll the team"
        >
          TEAM ↻ ×{state.respins.team}
        </button>
        <button
          type="button"
          disabled={needSpin || revealing || state.respins.era <= 0}
          onClick={doEraRespin}
          className="rounded-lg border-2 border-ink/70 px-3 py-3 font-display text-xs tracking-wider transition enabled:hover:bg-ink/5 disabled:opacity-35"
          title="Keep the team, re-roll the era"
        >
          ERA ↻ ×{state.respins.era}
        </button>
      </footer>
    </section>
  );
}
