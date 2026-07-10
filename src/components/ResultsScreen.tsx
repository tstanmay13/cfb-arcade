// RESULTS (§8 / feeds §10's share card): the bragging artifact — banner,
// record, compact game strip, roster with fluffed stats, awards.
import { useRef, useState } from "react";
import type { Player, SlotId } from "../data/types.ts";
import { PLAYER_SLOTS } from "../data/types.ts";
import { useGame } from "../state/store.tsx";
import ShareCard from "./ShareCard.tsx";

const OUTCOME_BANNER: Record<string, { title: string; sub: string }> = {
  natty: { title: "NATIONAL CHAMPIONS", sub: "Ran the table." },
  semis: { title: "NATIONAL SEMIFINALISTS", sub: "One game short of the big one." },
  major: { title: "PLAYOFF QUARTERFINALISTS", sub: "Made the dance, met a buzzsaw." },
  minor: { title: "BOWL SEASON", sub: "Missed the playoff, won the bowl." },
  loss: { title: "REBUILDING YEAR", sub: "The transfer portal beckons." },
};

function SlotLine({ slot, player }: { slot: Exclude<SlotId, "HC">; player: Player }) {
  const { state } = useGame();
  const r = state.resolved!;
  const isAA = r.allAmericans.includes(player.player_id);
  return (
    <li className="flex items-baseline justify-between gap-2 border-b border-paper-edge py-1.5 text-sm">
      <span className="w-10 shrink-0 font-display text-xs opacity-60">{slot}</span>
      <span className="flex-1 truncate">
        <strong>{player.display_short}</strong>
        <span className="opacity-60"> · {player.school} ’{player.decade.slice(2, 4)}s</span>
        {isAA && (
          <span className="ml-1.5 rounded bg-amber-500/90 px-1 py-0.5 align-middle font-display text-[9px] tracking-wider text-white">
            ALL-AMERICAN
          </span>
        )}
      </span>
    </li>
  );
}

export default function ResultsScreen() {
  const { state, dispatch } = useGame();
  const r = state.resolved!;
  const banner = OUTCOME_BANNER[r.outcome];
  const champs = r.outcome === "natty";
  const cardRef = useRef<HTMLDivElement>(null);
  const [exporting, setExporting] = useState(false);

  // §10: rasterize the hidden fixed-size node → PNG download.
  const shareCard = async () => {
    if (!cardRef.current || exporting) return;
    setExporting(true);
    try {
      const { default: html2canvas } = await import("html2canvas");
      const canvas = await html2canvas(cardRef.current, {
        width: 1080,
        height: 1350,
        scale: 1,
        backgroundColor: null,
      });
      const a = document.createElement("a");
      a.href = canvas.toDataURL("image/png");
      a.download = `the-16-0-draft-${r.record}${r.isDynasty ? "-dynasty" : ""}.png`;
      a.click();
    } finally {
      setExporting(false);
    }
  };

  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col items-center gap-6 p-6 py-10">
      {/* Banner */}
      <header className="w-full rounded-xl border-4 border-ink bg-white/70 p-6 text-center shadow-md">
        {r.isDynasty && (
          <p className="mx-auto mb-2 w-fit rounded-full bg-amber-500 px-4 py-1 font-display text-xs tracking-[0.3em] text-white shadow">
            ★ DYNASTY ★
          </p>
        )}
        <h1 className={`font-display text-3xl tracking-wide sm:text-4xl ${champs ? "text-team" : ""}`}>
          {banner.title}
        </h1>
        <p className="mt-1 text-sm opacity-70">
          {r.isDynasty ? "Projected multi-year dynasty." : banner.sub}
        </p>
        <div className="mt-4 flex items-center justify-center gap-8">
          <div>
            <p className="font-display text-5xl tabular-nums">{r.record}</p>
            <p className="text-[10px] uppercase tracking-widest opacity-60">Final record</p>
          </div>
          <div>
            <p className="font-display text-5xl tabular-nums">{Math.round(r.power)}</p>
            <p className="text-[10px] uppercase tracking-widest opacity-60">Team OVR</p>
          </div>
          <div>
            <p className="font-display text-5xl">{state.mode === "Scout" ? "🔍" : "★"}</p>
            <p className="text-[10px] uppercase tracking-widest opacity-60">{state.mode} mode</p>
          </div>
        </div>
      </header>

      {/* Game strip */}
      <ol className="flex w-full flex-wrap justify-center gap-1" aria-label="Game by game">
        {r.schedule.map((g) => (
          <li
            key={g.week}
            title={`${g.phase === "REG" ? `Week ${g.week}` : g.phase}: ${g.score} vs ${g.opponent}`}
            className={`flex h-7 w-7 items-center justify-center rounded text-xs font-bold text-white
              ${g.result === "WIN" ? "bg-emerald-700" : "bg-red-800"}
              ${g.phase !== "REG" ? "ring-2 ring-amber-400" : ""}`}
          >
            {g.result === "WIN" ? "W" : "L"}
          </li>
        ))}
      </ol>

      {/* Awards */}
      <section className="flex w-full flex-wrap items-center justify-center gap-3 text-sm">
        <p className="rounded-full border border-paper-edge bg-white/60 px-4 py-1.5">
          <span className="font-display text-xs tracking-wider opacity-60">HEISMAN </span>
          {r.heisman ? (
            <strong>
              {r.heisman.name} ({r.heisman.position})
              {r.heisman.viaHornung ? " — stat-line eruption" : ""}
            </strong>
          ) : (
            <span className="opacity-70">nobody this year</span>
          )}
        </p>
        <p className="rounded-full border border-paper-edge bg-white/60 px-4 py-1.5">
          <span className="font-display text-xs tracking-wider opacity-60">ALL-AMERICANS </span>
          <strong>{r.allAmericans.length}</strong>
        </p>
        <p className="rounded-full border border-paper-edge bg-white/60 px-4 py-1.5">
          <span className="font-display text-xs tracking-wider opacity-60">COACH </span>
          <strong>{state.hc?.display_short}</strong>
          <span className="opacity-60"> · {state.hc?.coach_tier}</span>
        </p>
      </section>

      {/* Roster */}
      <section className="w-full rounded-xl border border-paper-edge bg-white/50 p-4">
        <h2 className="mb-1 font-display text-sm tracking-[0.25em] opacity-70">THE ROSTER</h2>
        <ul className="grid gap-x-8 sm:grid-cols-2">
          {PLAYER_SLOTS.map((slot) => {
            const p = state.slots[slot];
            return p ? <SlotLine key={slot} slot={slot} player={p} /> : null;
          })}
        </ul>
      </section>

      <div className="flex gap-3">
        <button
          type="button"
          onClick={shareCard}
          disabled={exporting}
          className="rounded-lg bg-team px-8 py-3 font-display tracking-widest text-team-accent shadow transition enabled:hover:brightness-110 disabled:opacity-50"
        >
          {exporting ? "RENDERING…" : "SHARE THE CARD"}
        </button>
        <button
          type="button"
          onClick={() => dispatch({ type: "REPLAY" })}
          className="rounded-lg border-2 border-ink px-8 py-3 font-display tracking-widest transition hover:bg-ink/5"
        >
          RUN IT BACK
        </button>
      </div>

      <ShareCard
        ref={cardRef}
        slots={state.slots}
        hc={state.hc}
        resolved={r}
        mode={state.mode}
        teamHex={state.favoriteTeam?.mainHex ?? "#1b2a41"}
      />
    </main>
  );
}
