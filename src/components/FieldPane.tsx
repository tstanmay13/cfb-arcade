// LEFT pane: the turf field (§8.3). Jersey-bubble nodes for the 8 player
// slots + head coach plate. Nodes theme to the DRAFTED player's school colors
// (Appendix A #1, recommended option). Eligible open slots pulse chalk when a
// pick is pending; tapping one places the pick.
import type { SlotId, Team } from "../data/types.ts";
import { eligibleOpenSlots } from "../engine/spin.ts";
import { useGame, useGameActions } from "../state/store.tsx";

const OFFENSE: Exclude<SlotId, "HC">[] = ["WR1", "QB", "RB", "WR2"];
const DEFENSE: Exclude<SlotId, "HC">[] = ["CB", "LB", "DL", "S"];

function initials(name: string): string {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((t) => t[0])
    .join("");
}

function SlotNode({
  slot,
  teamsById,
}: {
  slot: Exclude<SlotId, "HC">;
  teamsById: Map<string, Team>;
}) {
  const { state } = useGame();
  const { placePlayer } = useGameActions();
  const player = state.slots[slot];
  const pending = state.pendingPick;
  const eligible =
    pending !== null && eligibleOpenSlots(pending, state.slots).includes(slot);
  const school = player ? teamsById.get(player.school_id) : null;

  return (
    <button
      type="button"
      disabled={!eligible}
      onClick={() => pending && placePlayer(pending, slot)}
      aria-label={player ? `${slot}: ${player.name}` : `${slot} open`}
      className={`group relative flex w-16 flex-col items-center gap-1 sm:w-24 ${eligible ? "cursor-pointer" : "cursor-default"}`}
    >
      {/* jersey-bubble (the solid team-color ball) applies ONLY when filled —
          as an unlayered class its background/color always beat the Tailwind
          utilities, so putting it on empty slots painted white balls over the
          designed chalk-dashed outlines. */}
      <span
        className={`relative flex h-12 w-12 items-center justify-center rounded-full border-2 font-display text-base sm:h-16 sm:w-16 sm:text-xl
          ${player ? "jersey-bubble border-chalk/90 shadow-lg" : "border-dashed border-chalk/70 bg-transparent text-chalk/90"}
          ${eligible ? "slot-eligible border-chalk" : ""}`}
        style={
          player
            ? ({
                "--bubble-main": school?.mainHex ?? "#333",
                "--bubble-accent": school?.accentHex ?? "#fff",
              } as React.CSSProperties)
            : undefined
        }
      >
        {player ? (player.jersey_number || initials(player.name)) : slot}
        {player && (
          <svg className="pointer-events-none absolute -inset-1.5" viewBox="0 0 76 76" aria-hidden>
            <circle
              cx="38"
              cy="38"
              r="35"
              fill="none"
              stroke="var(--chalk)"
              strokeWidth="1.5"
              strokeLinecap="round"
              className="chalk-ring opacity-80"
            />
          </svg>
        )}
      </span>
      {/* Caption: one truncated line per row so a long name or "school · era"
          can never wrap into the next section on a phone (§8.4). The school
          line only exists at sm+ — on mobile the recap list carries it. */}
      <span className="w-full min-w-0 text-center font-display text-[10px] leading-4 text-chalk drop-shadow sm:text-[11px]">
        <span className="block truncate">{player ? player.display_short : " "}</span>
        <span className="hidden truncate font-body text-[9px] opacity-80 sm:block">
          {player ? `${player.school} · ${player.decade}` : " "}
        </span>
      </span>
    </button>
  );
}

export default function FieldPane() {
  const { state, data } = useGame();
  const teamsById = new Map(data.teams.map((t) => [t.school_id, t]));
  const coach = state.hc;
  const coachActive = state.phase === "COACH_SPIN";

  return (
    <section
      aria-label="Your team"
      className="turf relative flex min-h-[140px] flex-col justify-between rounded-xl p-2 sm:min-h-[420px] sm:p-5 lg:min-h-0 lg:flex-1"
    >
      <div>
        <p className="text-center font-display text-xs tracking-[0.3em] text-chalk/80">OFFENSE</p>
        <div className="yard-line my-1.5 sm:my-3" />
        <div className="flex justify-around">
          {OFFENSE.map((s) => (
            <SlotNode key={s} slot={s} teamsById={teamsById} />
          ))}
        </div>
      </div>

      <div>
        <p className="mt-1 text-center font-display text-xs tracking-[0.3em] text-chalk/80 sm:mt-4">DEFENSE</p>
        <div className="yard-line my-1.5 sm:my-3" />
        <div className="flex justify-around">
          {DEFENSE.map((s) => (
            <SlotNode key={s} slot={s} teamsById={teamsById} />
          ))}
        </div>
      </div>

      <div className="mt-1 flex justify-center sm:mt-4">
        <div
          className={`flex min-w-48 items-center justify-center gap-2 rounded-md border-2 px-4 py-2 font-display text-sm text-chalk
            ${coach ? "border-chalk/90 bg-black/25" : "border-dashed border-chalk/60"}
            ${coachActive && !coach ? "slot-eligible" : ""}`}
        >
          {coach ? (
            <>
              <span className="tracking-wider">{coach.display_short}</span>
              <span className="font-body text-[10px] opacity-80">
                {coach.school} · {coach.decade}
              </span>
            </>
          ) : (
            <span className="tracking-[0.25em] opacity-90">HEAD COACH</span>
          )}
        </div>
      </div>
    </section>
  );
}
