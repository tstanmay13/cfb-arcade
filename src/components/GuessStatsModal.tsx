// Wordle-style stats sheet for Guess the Season (ADR-0019): PERSONAL numbers
// from guessStorage + GLOBAL aggregates from the arcade_daily_stats RPC.
// Global data is strictly optional — offline or blocked, the sheet quietly
// shows personal stats only. No entry animation (reduced-motion safe by
// construction); bars are statically sized, identity is carried by labeled
// rails + a legend, never by color alone (You = ink, Everyone = ink/55 —
// contrast-validated against the paper surface).
import { useEffect, useMemo, useState } from "react";
import { MAX_GUESSES } from "../engine/guessSeason.ts";
import { loadGuessStats } from "../state/guessStorage.ts";
import {
  fetchGlobalStats,
  fetchOverview,
  type GlobalStats,
  type OverviewStats,
} from "../data/stats.ts";

interface JustFinished {
  won: boolean;
  guessCount: number;
  daily: boolean;
}

// Session cache so reopening the sheet doesn't refetch on every click.
const cache = new Map<string, { at: number; stats: GlobalStats | null }>();
const CACHE_MS = 60_000;

async function cachedGlobal(puzzle: number | null): Promise<GlobalStats | null> {
  const key = String(puzzle);
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.stats;
  const stats = await fetchGlobalStats("guess_season", puzzle);
  cache.set(key, { at: Date.now(), stats });
  return stats;
}

let overviewCache: { at: number; stats: OverviewStats | null } | null = null;

async function cachedOverview(): Promise<OverviewStats | null> {
  if (overviewCache && Date.now() - overviewCache.at < CACHE_MS) return overviewCache.stats;
  const stats = await fetchOverview("guess_season", 14);
  overviewCache = { at: Date.now(), stats };
  return stats;
}

/** 102 → "1:42". */
const fmtTime = (s: number) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, "0")}`;

export default function GuessStatsModal({
  open,
  onClose,
  todayPuzzle,
  justFinished,
}: {
  open: boolean;
  onClose: () => void;
  todayPuzzle: number;
  justFinished: JustFinished | null;
}) {
  const personal = useMemo(() => (open ? loadGuessStats() : null), [open]);
  const [today, setToday] = useState<GlobalStats | null | "loading">("loading");
  const [allTime, setAllTime] = useState<GlobalStats | null | "loading">("loading");
  const [overview, setOverview] = useState<OverviewStats | null | "loading">("loading");

  useEffect(() => {
    if (!open) return;
    let alive = true;
    setToday("loading");
    setAllTime("loading");
    setOverview("loading");
    cachedGlobal(todayPuzzle).then((s) => alive && setToday(s));
    cachedGlobal(null).then((s) => alive && setAllTime(s));
    cachedOverview().then((s) => alive && setOverview(s));
    return () => {
      alive = false;
    };
  }, [open, todayPuzzle]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open || !personal) return null;

  const personalWins = personal.dist.reduce((a, b) => a + b, 0);
  const globalDist = allTime !== "loading" && allTime ? allTime.guessDistribution : null;
  const globalWins = globalDist ? Object.values(globalDist).reduce((a, b) => a + b, 0) : 0;
  const rows = Array.from({ length: MAX_GUESSES }, (_, i) => {
    const mine = personal.dist[i] ?? 0;
    const theirs = globalDist ? (globalDist[String(i + 1)] ?? 0) : 0;
    return {
      n: i + 1,
      mine,
      minePct: personalWins > 0 ? (mine / personalWins) * 100 : 0,
      theirsPct: globalWins > 0 ? (theirs / globalWins) * 100 : 0,
    };
  });
  const maxPct = Math.max(1, ...rows.map((r) => Math.max(r.minePct, r.theirsPct)));
  const highlight = justFinished?.won ? justFinished.guessCount : null;
  const globalOffline = allTime === null && today === null;
  // Popular guesses reveal what today's crowd tried (usually the answer) —
  // only shown once THIS player has finished today's daily.
  const finishedToday = personal.lastPuzzle >= todayPuzzle;
  const todayGuesses =
    today !== "loading" && today !== null && finishedToday ? today.topGuesses.slice(0, 5) : [];
  const series = overview !== "loading" && overview !== null ? overview.series : [];
  const maxDayPlays = Math.max(1, ...series.map((d) => d.plays));

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink/45 p-4"
      onClick={onClose}
      role="presentation"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Guess the Season stats"
        onClick={(e) => e.stopPropagation()}
        className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-xl border-2 border-ink bg-paper p-5 shadow-xl"
      >
        <div className="flex items-start justify-between">
          <h2 className="font-display text-2xl tracking-wide">STATS</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close stats"
            className="rounded-md border border-paper-edge px-2 py-0.5 font-display text-sm opacity-70 transition hover:opacity-100"
          >
            ✕
          </button>
        </div>

        {/* Personal tiles */}
        <div className="mt-4 grid grid-cols-4 gap-1.5 text-center">
          {[
            [personal.played, "Played"],
            [personal.played > 0 ? `${Math.round((personal.wins / personal.played) * 100)}%` : "—", "Win rate"],
            [personal.streak, "Streak"],
            [personal.maxStreak, "Best"],
          ].map(([value, label]) => (
            <div key={label} className="rounded-lg border border-paper-edge bg-white/60 px-1 py-2">
              <p className="font-display text-2xl tabular-nums leading-none">{value}</p>
              <p className="mt-1 text-[9px] uppercase tracking-widest opacity-60">{label}</p>
            </div>
          ))}
        </div>

        {/* Today's national picture */}
        <section aria-label="Today worldwide" className="mt-4 rounded-lg border border-paper-edge bg-chalk/60 p-3 text-sm">
          <h3 className="font-display text-xs tracking-[0.25em] opacity-60">DAILY #{todayPuzzle} — EVERYONE</h3>
          {today === "loading" ? (
            <p className="mt-1 opacity-60">Checking the national ledger…</p>
          ) : today === null ? (
            <p className="mt-1 opacity-60">Global stats unreachable — playing offline is just fine.</p>
          ) : today.plays === 0 ? (
            <p className="mt-1">Nobody has finished today's puzzle yet — you could be first.</p>
          ) : (
            <p className="mt-1">
              <strong className="font-display">{Math.round(today.winPct ?? 0)}%</strong> of{" "}
              <span className="tabular-nums">{today.plays}</span>{" "}
              {today.players !== null && today.players > 0 ? (
                <>
                  {today.plays === 1 ? "run" : "runs"} by{" "}
                  <span className="tabular-nums">{today.players}</span>{" "}
                  {today.players === 1 ? "player" : "players"}
                </>
              ) : (
                <>{today.plays === 1 ? "player" : "players"}</>
              )}{" "}
              solved it
              {today.avgGuesses !== null && (
                <span className="opacity-70"> · avg {Number(today.avgGuesses).toFixed(1)} guesses</span>
              )}
              {today.medianTimeSeconds !== null && (
                <span className="opacity-70"> · median {fmtTime(today.medianTimeSeconds)}</span>
              )}
            </p>
          )}
          {todayGuesses.length > 0 && (
            <div className="mt-3 border-t border-paper-edge pt-2">
              <h4 className="font-display text-[10px] tracking-[0.25em] opacity-60">
                TODAY'S POPULAR GUESSES
              </h4>
              <ol className="mt-1.5 space-y-1">
                {todayGuesses.map((t, i) => (
                  <li key={t.guess} className="flex items-center gap-2">
                    <span className="w-3 text-right font-display text-xs tabular-nums opacity-50" aria-hidden>
                      {i + 1}
                    </span>
                    <span className="flex-1 truncate font-display text-sm uppercase tracking-wide">
                      {t.guess.replace(/_/g, " ")}
                    </span>
                    <span
                      className="text-[10px] tabular-nums opacity-60"
                      aria-label={`guessed ${t.n} ${t.n === 1 ? "time" : "times"}`}
                    >
                      ×{t.n}
                    </span>
                  </li>
                ))}
              </ol>
            </div>
          )}
        </section>

        {/* You vs the world, share of wins by guess count */}
        <section aria-label="Guess distribution, you versus everyone" className="mt-4">
          <div className="flex items-baseline justify-between">
            <h3 className="font-display text-xs tracking-[0.25em] opacity-60">GUESS DISTRIBUTION</h3>
            <div className="flex items-center gap-3 text-[10px] uppercase tracking-wider opacity-70">
              <span className="flex items-center gap-1">
                <span aria-hidden className="h-2 w-2 rounded-[2px] bg-ink" /> You
              </span>
              <span className="flex items-center gap-1">
                <span aria-hidden className="h-2 w-2 rounded-[2px] bg-ink/55" /> Everyone
              </span>
            </div>
          </div>

          {personalWins === 0 && !globalDist ? (
            <p className="mt-2 text-sm opacity-60">Win a daily puzzle and the bars start filling in.</p>
          ) : (
            <ol className="mt-2 space-y-1.5">
              {rows.map((r) => (
                <li
                  key={r.n}
                  aria-label={`Solved in ${r.n}: you ${r.mine} ${r.mine === 1 ? "win" : "wins"}${
                    globalDist ? `, everyone ${r.theirsPct.toFixed(0)}% of wins` : ""
                  }${highlight === r.n ? " — your latest solve" : ""}`}
                  className="flex items-center gap-2"
                >
                  <span className="w-3 text-right font-display text-sm tabular-nums" aria-hidden>
                    {r.n}
                  </span>
                  <div className="flex-1 space-y-0.5" aria-hidden>
                    <div className="h-3 rounded-sm bg-ink/5">
                      <div
                        className={`flex h-3 items-center justify-end rounded-sm ${
                          highlight === r.n ? "bg-emerald-700" : "bg-ink"
                        }`}
                        style={{ width: r.mine > 0 ? `${Math.max(9, (r.minePct / maxPct) * 100)}%` : "0%" }}
                      >
                        {r.mine > 0 && (
                          <span className="pr-1 text-[9px] font-bold leading-none text-paper tabular-nums">
                            {r.mine}
                            {highlight === r.n ? " ★" : ""}
                          </span>
                        )}
                      </div>
                    </div>
                    {globalDist && (
                      <div className="h-2 rounded-sm bg-ink/5">
                        <div
                          className="h-2 rounded-sm bg-ink/55"
                          style={{ width: r.theirsPct > 0 ? `${Math.max(2, (r.theirsPct / maxPct) * 100)}%` : "0%" }}
                        />
                      </div>
                    )}
                  </div>
                  <span className="w-9 text-right text-[10px] tabular-nums opacity-60" aria-hidden>
                    {globalDist ? `${r.theirsPct.toFixed(0)}%` : ""}
                  </span>
                </li>
              ))}
            </ol>
          )}
          {globalDist && (
            <p className="mt-1.5 text-right text-[10px] uppercase tracking-wider opacity-50">
              Everyone = share of {globalWins} global wins
            </p>
          )}
          {globalOffline && personalWins > 0 && (
            <p className="mt-1.5 text-[10px] uppercase tracking-wider opacity-50">
              Global comparison unavailable right now
            </p>
          )}
        </section>

        {/* National traffic: runs per day, zero-filled, today labeled (never
            color-only). Hidden entirely until the overview RPC is reachable. */}
        {series.length > 0 && overview !== "loading" && overview !== null && (
          <section aria-label="National runs per day, last 14 days" className="mt-4">
            <div className="flex items-baseline justify-between">
              <h3 className="font-display text-xs tracking-[0.25em] opacity-60">LAST 14 DAYS</h3>
              <span className="text-[10px] uppercase tracking-wider opacity-50">runs per day</span>
            </div>
            <div className="mt-2 flex h-16 items-end gap-[3px]" aria-hidden>
              {series.map((d, i) => (
                <div
                  key={d.day}
                  title={`${d.day}: ${d.plays} ${d.plays === 1 ? "run" : "runs"}, ${d.players} ${d.players === 1 ? "player" : "players"}`}
                  className={`flex-1 rounded-t-sm ${i === series.length - 1 ? "bg-emerald-700" : "bg-ink/70"}`}
                  style={{ height: d.plays > 0 ? `${Math.max(12.5, (d.plays / maxDayPlays) * 100)}%` : "2px" }}
                />
              ))}
            </div>
            <div className="mt-1 flex justify-between text-[9px] uppercase tracking-wider opacity-50">
              <span>{series[0].day.slice(5)}</span>
              <span>today</span>
            </div>
            <p className="mt-1.5 text-[10px] uppercase tracking-wider opacity-60">
              <span className="tabular-nums">{overview.today.plays}</span> runs ·{" "}
              <span className="tabular-nums">{overview.today.players}</span> players today —{" "}
              <span className="tabular-nums">{overview.allTime.plays}</span> runs ·{" "}
              <span className="tabular-nums">{overview.allTime.players}</span> players all-time
            </p>
          </section>
        )}
      </div>
    </div>
  );
}
