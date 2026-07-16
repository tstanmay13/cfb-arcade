// RIGHT pane: the draft board (§8.3) — landed-cell masthead, the spin's full
// roster, mode-aware stat visibility (§8.5), greying for unplaceable rows,
// and the spin controls. The slot-machine ticker (§8.6) is pure theater: the
// result is already in state before it plays.
import { useEffect, useRef, useState } from "react";
import type { Coach, GamePosition, Player } from "../data/types.ts";
import { STAT_LABELS, COACH_STAT_LABELS, PLAYER_SLOTS, POS_SLOTS } from "../data/types.ts";
import { eligibleOpenSlots } from "../engine/spin.ts";
import { useGame, useGameActions } from "../state/store.tsx";
import TeamMark, { softTeamFill } from "./TeamMark.tsx";

const POS_ORDER: GamePosition[] = ["QB", "RB", "WR", "DL", "LB", "CB", "S"];

// Pool ordering the user controls (§8.5). We only ever sort on things the game
// is willing to show — position and name — never `hidden_ovr`, which stays
// hidden by design. Unplaceable rows always sink below the placeable ones
// regardless of key (see DraftBoard partition), so "can't pick a QB anymore"
// drops those QBs to the bottom instead of stranding them up top.
type SortKey = "position" | "name";
const SORT_LABELS: Record<SortKey, string> = { position: "Position", name: "A–Z" };

const compareName = (a: Player, b: Player): number => a.name.localeCompare(b.name);
const POOL_COMPARATORS: Record<SortKey, (a: Player, b: Player) => number> = {
  position: (a, b) =>
    POS_ORDER.indexOf(a.primary_position) - POS_ORDER.indexOf(b.primary_position) ||
    compareName(a, b),
  name: compareName,
};

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
        {dead && (
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
    doKeepTeam,
    doTeamRespin,
    doEraRespin,
    doFallbackSpin,
    placePlayer,
    poolIsDead,
  } = useGameActions();
  const revealing = useSpinReveal();
  const [sortBy, setSortBy] = useState<SortKey>("position");
  const [posFilter, setPosFilter] = useState<GamePosition | "ALL">("ALL");

  const coachPhase = state.phase === "COACH_SPIN";
  const cell = coachPhase ? state.currentCoachSpin : state.currentSpin;
  const cellTeam = cell ? data.teams.find((t) => t.school_id === cell.teamId) : null;
  // Stay neutral while the ticker is spinning so the header color doesn't
  // reveal the landed team before the ticker does.
  const masthead = cellTeam && !revealing ? softTeamFill(cellTeam.mainHex, 0.15) : null;
  const filled = Object.values(state.slots).filter(Boolean).length;
  const needSpin = !coachPhase && state.currentSpin === null;
  const outOfRespins = state.respins.team <= 0 && state.respins.era <= 0;

  // Keep-team token (§5.2): lock your next spin to this pick's {team, era} cell.
  // Needs at least two open player slots left (this pick + the locked next one).
  const openPlayerSlots = PLAYER_SLOTS.filter((s) => !state.slots[s]).length;
  const keepTeamName = cellTeam?.name;
  const stickyTeam = state.stickyCell
    ? data.teams.find((t) => t.school_id === state.stickyCell!.teamId)
    : null;
  const canKeepTeam =
    !coachPhase && !needSpin && !revealing && openPlayerSlots > 1 &&
    (state.keepArmed || state.respins.keepTeam > 0);

  // Split the spin's roster into who you can still draft vs. who's blocked
  // (position already filled, or a duplicate of someone rostered), then sort
  // each group by the chosen key. Rendering the two groups separately keeps
  // unplaceable rows pinned to the bottom under a divider no matter the sort.
  const pool = !coachPhase && state.currentSpin ? state.currentSpin.pool : [];
  const available: Player[] = [];
  const unavailable: Player[] = [];
  for (const p of pool) {
    (eligibleOpenSlots(p, state.slots).length > 0 ? available : unavailable).push(p);
  }
  const cmp = POOL_COMPARATORS[sortBy];
  available.sort(cmp);
  unavailable.sort(cmp);

  // Position filter chips: only positions you still have an open slot for (a
  // position whose slots are all filled drops off — you can't draft it anyway).
  // Slots never un-fill mid-draft, so a stale filter just falls back to ALL.
  const neededPositions = POS_ORDER.filter((pos) =>
    POS_SLOTS[pos].some((slot) => state.slots[slot] === null),
  );
  const activeFilter =
    posFilter !== "ALL" && neededPositions.includes(posFilter) ? posFilter : "ALL";
  const matchesFilter = (p: Player) =>
    activeFilter === "ALL" ||
    p.primary_position === activeFilter ||
    p.secondary_position === activeFilter;
  const shownAvailable = available.filter(matchesFilter);
  const shownUnavailable = unavailable.filter(matchesFilter);

  return (
    <section aria-label="Draft board" className="flex min-h-[420px] flex-col rounded-xl border border-paper-edge bg-paper/70 shadow-sm lg:h-full">
      {/* Masthead: the landed cell — a solid, softened team-color slab with a
          crisp white line underneath (auto-contrast text for legibility). */}
      <header
        className="rounded-t-xl border-b-4 border-white px-4 py-3 transition-colors"
        style={
          masthead
            ? { background: masthead.bg, color: masthead.fg }
            : { background: "var(--paper)", color: "var(--ink)" }
        }
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

      {/* Keep-team armed banner — your next spin will stay on this program. */}
      {state.keepArmed && !revealing && (
        <div className="border-b border-paper-edge bg-team/10 px-4 py-1.5 text-center text-[11px] tracking-wide">
          <span className="font-display tracking-wider">KEEP TEAM ON</span> — draft anyone here, then your
          next spin stays on <strong>{cell?.era} {keepTeamName}</strong>.{" "}
          <button type="button" className="underline opacity-70" onClick={doKeepTeam}>
            cancel
          </button>
        </div>
      )}

      {/* Pool */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        {revealing ? (
          <div className="p-3">
            <Ticker />
          </div>
        ) : needSpin ? (
          <div className="flex flex-col gap-3 p-3">
            <p className="pt-2 text-center font-display tracking-widest opacity-70">
              {filled === 0
                ? "SPIN TO OPEN THE DRAFT"
                : stickyTeam && state.stickyCell
                  ? `STAYING WITH ${state.stickyCell.era} ${stickyTeam.name.toUpperCase()} — SPIN AGAIN`
                  : "PICK LOCKED IN — SPIN AGAIN"}
            </p>
            {/* Between spins the pane recaps the board so far instead of
                sitting empty — identity marks make it scannable. */}
            {filled > 0 && (
              <div className="rounded-lg border border-paper-edge bg-white/50 p-3">
                <div className="mb-2 flex items-baseline justify-between">
                  <span className="font-display text-[10px] tracking-[0.25em] opacity-60">
                    YOUR BOARD SO FAR
                  </span>
                  <span className="font-display text-xs opacity-70">{filled} / 8 drafted</span>
                </div>
                <ul className="space-y-1.5">
                  {PLAYER_SLOTS.map((slot) => {
                    const p = state.slots[slot];
                    if (!p) return null;
                    const team = data.teams.find((t) => t.school_id === p.school_id);
                    return (
                      <li key={slot} className="flex items-center gap-2 text-sm">
                        <span className="w-9 font-display text-[10px] tracking-widest opacity-55">
                          {slot}
                        </span>
                        <TeamMark
                          school={p.school}
                          primary={team?.mainHex ?? null}
                          secondary={team?.accentHex ?? null}
                          size="s"
                        />
                        <span className="truncate font-bold">{p.name}</span>
                        <span className="ml-auto shrink-0 text-[10px] uppercase tracking-wide opacity-50">
                          {p.decade}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}
          </div>
        ) : coachPhase && state.currentCoachSpin ? (
          <ul className="space-y-2 p-3">
            {state.currentCoachSpin.pool.map((c) => (
              <CoachRow key={c.coach_id} coach={c} />
            ))}
          </ul>
        ) : (
          <div>
            {/* Sort + count bar and position filters — stick to the top of the pool */}
            <div className="sticky top-0 z-10 border-b border-paper-edge bg-paper/95 px-3 py-2 backdrop-blur">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-[11px] uppercase tracking-[0.15em] opacity-60">
                  {available.length} available
                  {unavailable.length > 0 && (
                    <span className="opacity-70"> · {unavailable.length} out</span>
                  )}
                </p>
                <div role="group" aria-label="Sort players" className="flex items-center gap-1.5">
                  <span className="text-[10px] uppercase tracking-[0.15em] opacity-45">Sort</span>
                  <div className="flex overflow-hidden rounded-md border border-paper-edge font-display text-[10px] tracking-wider">
                    {(Object.keys(SORT_LABELS) as SortKey[]).map((key) => (
                      <button
                        key={key}
                        type="button"
                        onClick={() => setSortBy(key)}
                        aria-pressed={sortBy === key}
                        className={`px-2.5 py-1 transition ${
                          sortBy === key ? "bg-ink text-paper" : "bg-white/60 hover:bg-ink/5"
                        }`}
                      >
                        {SORT_LABELS[key]}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
              {/* Position filter chips — only slots you still need to fill. */}
              {neededPositions.length > 0 && (
                <div
                  role="group"
                  aria-label="Filter by position"
                  className="mt-2 flex flex-wrap gap-1.5 font-display text-xs tracking-wider"
                >
                  {(["ALL", ...neededPositions] as (GamePosition | "ALL")[]).map((pos) => (
                    <button
                      key={pos}
                      type="button"
                      onClick={() => setPosFilter(pos)}
                      aria-pressed={activeFilter === pos}
                      className={`min-w-[3rem] rounded-md border px-3.5 py-2 text-center transition ${
                        activeFilter === pos
                          ? "border-ink bg-ink text-paper"
                          : "border-paper-edge bg-white/60 hover:bg-ink/5"
                      }`}
                    >
                      {pos}
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div className="p-3">
              {shownAvailable.length > 0 && (
                <ul className="space-y-2">
                  {shownAvailable.map((p) => (
                    <PlayerRow key={p.player_id} player={p} />
                  ))}
                </ul>
              )}
              {shownUnavailable.length > 0 && (
                <>
                  {shownAvailable.length > 0 && (
                    <div className="my-3 flex items-center gap-2" aria-hidden>
                      <span className="h-px flex-1 bg-paper-edge" />
                      <span className="text-[10px] uppercase tracking-[0.15em] opacity-45">
                        Can't place
                      </span>
                      <span className="h-px flex-1 bg-paper-edge" />
                    </div>
                  )}
                  <ul className="space-y-2">
                    {shownUnavailable.map((p) => (
                      <PlayerRow key={p.player_id} player={p} />
                    ))}
                  </ul>
                </>
              )}
              {shownAvailable.length === 0 && shownUnavailable.length === 0 && (
                <p className="py-6 text-center text-xs opacity-55">
                  No {activeFilter === "ALL" ? "players" : `${activeFilter}s`} in this spin.
                </p>
              )}
            </div>
          </div>
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
          disabled={!canKeepTeam}
          aria-pressed={state.keepArmed}
          onClick={doKeepTeam}
          className={`rounded-lg border-2 px-3 py-3 font-display text-xs tracking-wider transition disabled:opacity-35
            ${state.keepArmed ? "border-team bg-team text-team-accent shadow" : "border-ink/70 enabled:hover:bg-ink/5"}`}
          title="Draft here, then lock your next spin to the same team + era (×2 per run)"
        >
          KEEP ⇢ ×{state.respins.keepTeam}
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
