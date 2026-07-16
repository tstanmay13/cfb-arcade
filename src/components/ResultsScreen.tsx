// RESULTS (§8 / feeds §10's share): the bragging artifact — banner, record,
// compact game strip, roster with fluffed stats, awards.
import { useState } from "react";
import type { PerformanceCategory } from "../data/types.ts";
import { PLAYER_SLOTS, STAT_LABELS, STAT_LABELS_SHORT } from "../data/types.ts";
import { POSITION_AWARD_LABELS } from "../engine/awards.ts";
import { buildShareText } from "../engine/share.ts";
import { useGame } from "../state/store.tsx";
import { RegularGameChip, PlayoffGameChip } from "./GameChip.tsx";

const OUTCOME_BANNER: Record<string, { title: string; sub: string }> = {
  natty: { title: "NATIONAL CHAMPIONS", sub: "Ran the table." },
  semis: { title: "NATIONAL SEMIFINALISTS", sub: "One game short of the big one." },
  major: { title: "PLAYOFF QUARTERFINALISTS", sub: "Made the dance, met a buzzsaw." },
  minor: { title: "BOWL SEASON", sub: "Missed the playoff, won the bowl." },
  loss: { title: "REBUILDING YEAR", sub: "The transfer portal beckons." },
};

const PERF_STYLES: Record<PerformanceCategory, { label: string; bg: string }> = {
  significantly_worse: { label: "▼▼", bg: "bg-red-700" },
  marginally_worse: { label: "▼", bg: "bg-red-400" },
  same: { label: "—", bg: "bg-gray-400" },
  marginally_better: { label: "▲", bg: "bg-emerald-400" },
  significantly_better: { label: "▲▲", bg: "bg-emerald-700" },
};

function PerformanceBadge({ category }: { category?: PerformanceCategory }) {
  if (!category) return null;
  const style = PERF_STYLES[category];
  return (
    <span className={`rounded px-1.5 py-0.5 font-display text-[10px] text-white ${style.bg}`}>
      {style.label}
    </span>
  );
}

/** Format stat value - preserve decimals for ratio stats */
function formatStat(value: number): string {
  return Number.isInteger(value) ? value.toLocaleString() : value.toFixed(1);
}

export default function ResultsScreen() {
  const { state, dispatch } = useGame();
  const r = state.resolved!;
  const banner = OUTCOME_BANNER[r.outcome];
  const champs = r.outcome === "natty";
  const [copied, setCopied] = useState(false);

  // §10: Wordle-style text summary → clipboard (works everywhere, no render).
  const copyResult = async () => {
    const text = buildShareText(r, {
      teamName: state.favoriteTeam?.name ?? "—",
      scoutVerified: state.mode === "Scout" && (r.tier === "Tier0" || r.tier === "Tier1"),
    });
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // Insecure context / older browser: fall back to a hidden textarea.
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.left = "-9999px";
      document.body.appendChild(ta);
      ta.select();
      try {
        document.execCommand("copy");
      } catch {
        /* nothing more we can do — leave the UI unflagged */
        ta.remove();
        return;
      }
      ta.remove();
    }
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
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
        {/* text-4xl + nowrap so "13-2" can't wrap mid-number at phone width */}
        <div className="mt-4 flex flex-wrap items-center justify-center gap-x-6 gap-y-3 sm:gap-8">
          <div>
            <p className="whitespace-nowrap font-display text-4xl tabular-nums sm:text-5xl">{r.record}</p>
            <p className="text-[10px] uppercase tracking-widest opacity-60">Final record</p>
          </div>
          <div>
            <p className="font-display text-4xl tabular-nums sm:text-5xl">{Math.round(r.power)}</p>
            <p className="text-[10px] uppercase tracking-widest opacity-60">Team OVR</p>
          </div>
          <div>
            <p className="font-display text-4xl sm:text-5xl">{state.mode === "Scout" ? "🔍" : "★"}</p>
            <p className="text-[10px] uppercase tracking-widest opacity-60">{state.mode} mode</p>
          </div>
        </div>
      </header>

      {/* Regular Season Games */}
      <section className="w-full">
        <h3 className="mb-2 text-center font-display text-[10px] tracking-[0.3em] opacity-50">
          REGULAR SEASON
        </h3>
        <ol className="flex flex-wrap justify-center gap-2" aria-label="Regular season results">
          {r.schedule
            .filter((g) => g.phase === "REG")
            .map((g) => (
              <RegularGameChip key={g.week} game={g} />
            ))}
        </ol>
      </section>

      {/* Postseason Games - Separate section, larger */}
      {r.schedule.some((g) => g.phase !== "REG") && (
        <section className="w-full">
          <h3 className="mb-2 text-center font-display text-[10px] tracking-[0.3em] opacity-50">
            POSTSEASON
          </h3>
          <div className="flex flex-wrap justify-center gap-3" aria-label="Postseason results">
            {r.schedule
              .filter((g) => g.phase !== "REG")
              .map((g) => (
                <PlayoffGameChip key={g.week} game={g} />
              ))}
          </div>
        </section>
      )}

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
        {r.positionAwards.length > 0 && (
          <p className="rounded-full border border-paper-edge bg-white/60 px-4 py-1.5">
            <span className="font-display text-xs tracking-wider opacity-60">AWARDS </span>
            <strong>{r.positionAwards.map((a) => POSITION_AWARD_LABELS[a.award]).join(" · ")}</strong>
          </p>
        )}
        <p className="rounded-full border border-paper-edge bg-white/60 px-4 py-1.5">
          <span className="font-display text-xs tracking-wider opacity-60">COACH </span>
          <strong>{state.hc?.display_short}</strong>
          <span className="opacity-60"> · {state.hc?.coach_tier}</span>
        </p>
      </section>

      {/* Season Stats Roster */}
      <section className="w-full rounded-xl border border-paper-edge bg-white/50 p-4">
        <h2 className="mb-2 font-display text-sm tracking-[0.25em] opacity-70">SEASON STATS</h2>
        <ul className="space-y-1.5">
          {PLAYER_SLOTS.map((slot) => {
            const p = state.slots[slot];
            if (!p) return null;
            const stats = r.fluffedStats[p.player_id];
            const perf = r.playerPerformance?.[p.player_id];
            const labels = STAT_LABELS[p.primary_position];
            const values = [stats.stat_1, stats.stat_2, stats.stat_3, stats.stat_4, stats.stat_5];
            const isAA = r.allAmericans.includes(p.player_id);
            const posAward = r.positionAwards.find((a) => a.playerId === p.player_id);

            return (
              <li key={slot} className="rounded-lg border border-paper-edge bg-white/60 px-3 py-2">
                {/* Two lines: identity + honors, then the 5-stat grid — the
                    old single-row layout crushed the stats into an overlapping
                    smear at phone width (shrink-0 info vs 5 squeezed columns). */}
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span className="w-9 shrink-0 font-display text-[10px] tracking-widest opacity-55">{slot}</span>
                  <strong className="truncate text-sm">{p.display_short}</strong>
                  <PerformanceBadge category={perf} />
                  {isAA && (
                    <span className="shrink-0 rounded bg-amber-500 px-1 py-0.5 font-display text-[8px] tracking-wider text-white">
                      ALL-AMERICAN
                    </span>
                  )}
                  {posAward && (
                    <span className="shrink-0 rounded bg-emerald-600 px-1 py-0.5 font-display text-[8px] tracking-wider text-white">
                      {POSITION_AWARD_LABELS[posAward.award].toUpperCase()}
                    </span>
                  )}
                </div>
                <dl className="mt-1 grid grid-cols-5 gap-1 text-[10px] leading-tight sm:pl-11">
                  {labels.map((label, i) => (
                    <div key={label}>
                      <dt className="truncate uppercase tracking-wide opacity-50">
                        <span className="sm:hidden">{STAT_LABELS_SHORT[p.primary_position][i]}</span>
                        <span className="hidden sm:inline">{label}</span>
                      </dt>
                      <dd className="font-display text-xs tabular-nums">{formatStat(values[i])}</dd>
                    </div>
                  ))}
                </dl>
              </li>
            );
          })}
        </ul>
      </section>

      <div className="flex flex-wrap justify-center gap-3">
        <button
          type="button"
          onClick={copyResult}
          className={`rounded-lg px-8 py-3 font-display tracking-widest shadow transition hover:brightness-110 ${
            copied ? "bg-emerald-700 text-white" : "bg-team text-team-accent"
          }`}
        >
          {copied ? "COPIED ✓" : "COPY RESULT"}
        </button>
        <button
          type="button"
          onClick={() => dispatch({ type: "REPLAY" })}
          className="rounded-lg border-2 border-ink px-8 py-3 font-display tracking-widest transition hover:bg-ink/5"
        >
          RUN IT BACK
        </button>
      </div>
    </main>
  );
}
