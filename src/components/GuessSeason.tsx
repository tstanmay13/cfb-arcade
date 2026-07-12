// GUESS THE SEASON (arcade cabinet #2, ADR-0017): show a real team-season's
// game-by-game slate + record; identify the program & year in 6 guesses. Pure
// logic lives in engine/guessSeason.ts; this is the screen around it. Rendered
// OUTSIDE GameProvider (App view state) — it takes `teams` as a prop and lazily
// fetches its own seasons.json on first open.
import { useEffect, useMemo, useRef, useState } from "react";
import type { Team } from "../data/types.ts";
import { loadSeasons } from "../data/loadSeasons.ts";
import { recordResult } from "../data/stats.ts";
import GuessStatsModal from "./GuessStatsModal.tsx";
import {
  buildGuessShareText,
  CLOSE_YEARS,
  dailyIndex,
  evaluateGuess,
  hintsFor,
  MAX_GUESSES,
  puzzleNumber,
  revealedOpponentIndices,
  type GuessFeedback,
  type SeasonsCatalog,
} from "../engine/guessSeason.ts";
import { loadGuessStats, recordDailyResult, type GuessStats } from "../state/guessStorage.ts";

interface GuessRow {
  school_id: string;
  teamName: string;
  season: number;
  fb: GuessFeedback;
}

type Round = { mode: "daily" | "free"; idx: number; puzzle: number | null; startedAt: number };

export default function GuessSeason({ teams, onBack }: { teams: Team[]; onBack: () => void }) {
  const [catalog, setCatalog] = useState<SeasonsCatalog | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [round, setRound] = useState<Round | null>(null);
  const [guesses, setGuesses] = useState<GuessRow[]>([]);
  const [selTeam, setSelTeam] = useState<string | null>(null);
  const [selYear, setSelYear] = useState<number | null>(null);
  const [stats, setStats] = useState<GuessStats | null>(null);
  const [copied, setCopied] = useState(false);
  const [showStats, setShowStats] = useState(false);
  const statsTimer = useRef<number | null>(null);

  const resetBoard = () => {
    setGuesses([]);
    setSelTeam(null);
    setSelYear(null);
    setStats(null);
    setCopied(false);
    setShowStats(false);
  };
  const startDaily = (cat: SeasonsCatalog) => {
    const now = new Date();
    setRound({
      mode: "daily",
      idx: dailyIndex(cat.entries.length, now),
      puzzle: puzzleNumber(now),
      startedAt: Date.now(),
    });
    resetBoard();
  };
  const startFree = (cat: SeasonsCatalog) => {
    // UI-only randomness (not engine code) — a fresh puzzle each tap.
    const idx = Math.floor(Math.random() * cat.entries.length);
    setRound({ mode: "free", idx, puzzle: null, startedAt: Date.now() });
    resetBoard();
  };

  // Auto-open of the stats sheet is delayed past the reveal; clear on unmount.
  useEffect(() => {
    return () => {
      if (statsTimer.current !== null) window.clearTimeout(statsTimer.current);
    };
  }, []);

  useEffect(() => {
    loadSeasons().then(
      (cat) => {
        setCatalog(cat);
        startDaily(cat);
      },
      (e) => setError(String(e)),
    );
    // Mount-only: the daily puzzle is fixed for the session; setters are stable.
  }, []);

  const programs = useMemo(() => [...teams].sort((a, b) => a.name.localeCompare(b.name)), [teams]);
  const teamById = useMemo(() => new Map(teams.map((t) => [t.school_id, t])), [teams]);
  const years = useMemo(() => {
    if (!catalog || catalog.entries.length === 0) return [] as number[];
    const seasons = catalog.entries.map((e) => e.season);
    const lo = Math.min(...seasons);
    const hi = Math.max(...seasons);
    return Array.from({ length: hi - lo + 1 }, (_, i) => lo + i);
  }, [catalog]);

  if (error) {
    return (
      <Shell onBack={onBack}>
        <p className="mt-10 text-center text-sm">
          Couldn't load the season catalog. Re-bake it with{" "}
          <code className="rounded bg-ink/10 px-1">npm run build:seasons</code> and reload.
        </p>
        <p className="mt-2 text-center text-xs opacity-60">{error}</p>
      </Shell>
    );
  }
  if (!catalog || !round) {
    return (
      <Shell onBack={onBack}>
        <p className="mt-16 text-center font-display tracking-widest">SHUFFLING THE SLATE…</p>
      </Shell>
    );
  }

  const answer = catalog.entries[round.idx];
  const won = guesses.length > 0 && guesses[guesses.length - 1].fb.win;
  const lost = !won && guesses.length >= MAX_GUESSES;
  const over = won || lost;
  const hints = hintsFor(guesses.length);
  const revealed = over
    ? new Set(answer.games.map((_, i) => i))
    : new Set(hints.opponents ? revealedOpponentIndices(answer.games.length) : []);
  const selTeamName = selTeam ? (teamById.get(selTeam)?.name ?? selTeam) : null;
  const dup =
    selTeam !== null &&
    selYear !== null &&
    guesses.some((g) => g.school_id === selTeam && g.season === selYear);
  const canSubmit = !over && selTeam !== null && selYear !== null && !dup;

  const submitGuess = () => {
    if (!canSubmit || selTeam === null || selYear === null) return;
    const fb = evaluateGuess({ school_id: selTeam, season: selYear }, answer);
    const next = [...guesses, { school_id: selTeam, teamName: selTeamName ?? selTeam, season: selYear, fb }];
    setGuesses(next);
    const nowWon = fb.win;
    const nowLost = !nowWon && next.length >= MAX_GUESSES;
    if (nowWon || nowLost) {
      // Side effect in the handler (runs once), not an effect — same discipline
      // as store.tsx. recordDailyResult is idempotent per puzzle regardless.
      const isDaily = round.mode === "daily" && round.puzzle !== null;
      // Same guard as the local streak: a replayed daily reports globally once.
      const alreadyCounted = isDaily && loadGuessStats().lastPuzzle >= (round.puzzle as number);
      setStats(
        isDaily ? recordDailyResult(round.puzzle as number, nowWon, next.length) : loadGuessStats(),
      );
      if (!alreadyCounted) {
        // Fire-and-forget global report (ADR-0019) — never blocks the reveal.
        recordResult({
          game: "guess_season",
          puzzleNumber: isDaily ? round.puzzle : null,
          won: nowWon,
          guessCount: next.length,
          guesses: next.map((g) => `${g.school_id} ${g.season}`),
          hintsUsed: Math.min(next.length - (nowWon ? 1 : 0), 4),
          timeToCompleteSeconds: Math.round((Date.now() - round.startedAt) / 1000),
        });
      }
      if (statsTimer.current !== null) window.clearTimeout(statsTimer.current);
      statsTimer.current = window.setTimeout(() => setShowStats(true), 1300);
    }
  };

  const copyResult = async () => {
    const text = buildGuessShareText(
      guesses.map((g) => g.fb),
      { puzzle: round.puzzle, won },
    );
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // Insecure context / older browser: hidden-textarea fallback (mirrors
      // ResultsScreen.tsx).
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.left = "-9999px";
      document.body.appendChild(ta);
      ta.select();
      try {
        document.execCommand("copy");
      } catch {
        ta.remove();
        return;
      }
      ta.remove();
    }
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  };

  return (
    <Shell onBack={onBack} onStats={() => setShowStats(true)}>
      <GuessStatsModal
        open={showStats}
        onClose={() => setShowStats(false)}
        todayPuzzle={puzzleNumber(new Date())}
        justFinished={over ? { won, guessCount: guesses.length, daily: round.mode === "daily" } : null}
      />
      <div className="mt-1 flex items-center justify-center gap-3">
        <span className="rounded-full border border-ink/20 bg-white/60 px-3 py-1 font-display text-xs tracking-widest">
          {round.mode === "daily" ? `DAILY #${round.puzzle}` : "FREE PLAY"}
        </span>
        {round.mode === "daily" ? (
          <button
            type="button"
            onClick={() => startFree(catalog)}
            className="text-xs underline decoration-dotted underline-offset-4 opacity-70 hover:opacity-100"
          >
            Random round ⟳
          </button>
        ) : (
          <button
            type="button"
            onClick={() => startDaily(catalog)}
            className="text-xs underline decoration-dotted underline-offset-4 opacity-70 hover:opacity-100"
          >
            Daily #{puzzleNumber(new Date())} →
          </button>
        )}
      </div>
      <p className="mt-2 text-center text-sm opacity-75">
        One real season. Name the <strong>program</strong> and <strong>year</strong> in six guesses.
      </p>

      {/* The mystery season */}
      <section aria-label="The mystery season" className="mt-5 w-full rounded-xl border-2 border-ink bg-white/70 p-4 shadow-sm">
        <div className="flex items-end justify-center gap-6">
          <div className="text-center">
            <p className="font-display text-4xl tabular-nums leading-none">{answer.record}</p>
            <p className="mt-1 text-[10px] uppercase tracking-widest opacity-60">Final record</p>
          </div>
          <div className="text-center">
            <p className="font-display text-4xl tabular-nums leading-none">{answer.games.length}</p>
            <p className="mt-1 text-[10px] uppercase tracking-widest opacity-60">Games</p>
          </div>
        </div>
        <ol className="mt-4 flex flex-wrap justify-center gap-1.5" aria-label="Game by game">
          {answer.games.map((g, i) => (
            <li
              key={g.n}
              title={`Game ${g.n}${g.post ? " · postseason" : ""}: ${g.res} ${g.us}–${g.them}`}
              className={`flex w-16 flex-col items-center gap-0.5 rounded-md border p-1.5 text-center ${
                g.res === "W" ? "border-emerald-700/40 bg-emerald-700/10" : "border-red-800/40 bg-red-800/10"
              } ${g.post ? "ring-2 ring-amber-400" : ""}`}
            >
              <span className={`font-display text-sm leading-none ${g.res === "W" ? "text-emerald-800" : "text-red-800"}`}>
                {g.res}
              </span>
              <span className="text-[11px] tabular-nums">
                {g.us}–{g.them}
              </span>
              <span className="w-full truncate text-[9px] uppercase tracking-wide opacity-60">
                {revealed.has(i) ? g.opp : "···"}
              </span>
            </li>
          ))}
        </ol>
      </section>

      {/* Hint ladder (superseded by the reveal once the game is over) */}
      {!over && (hints.conference || hints.starPosition || hints.starName) && (
        <section aria-label="Hints" className="mt-4 w-full rounded-lg border border-paper-edge bg-chalk/60 p-3 text-sm">
          <h2 className="mb-1.5 font-display text-xs tracking-[0.25em] opacity-60">HINTS</h2>
          <ul className="space-y-1">
            {hints.conference && (
              <li>
                <span className="opacity-60">Conference:</span> <strong>{answer.conference}</strong>
              </li>
            )}
            {hints.starPosition && (
              <li>
                <span className="opacity-60">Star player:</span>{" "}
                <strong>
                  {hints.starName ? `${answer.star.name} · ` : ""}
                  {answer.star.pos} · {answer.star.ovr} OVR
                </strong>
              </li>
            )}
            {hints.opponents && (
              <li className="opacity-70">
                Opponents revealed on the slate above (spread across the season).
              </li>
            )}
          </ul>
        </section>
      )}

      {/* Guesses */}
      <section aria-label="Your guesses" className="mt-4 w-full space-y-1.5">
        {guesses.map((g, i) => (
          <GuessRowView key={i} row={g} />
        ))}
        {!over &&
          Array.from({ length: MAX_GUESSES - guesses.length }).map((_, i) => (
            <div key={`ghost-${i}`} className="h-[38px] rounded-md border border-dashed border-paper-edge/80" />
          ))}
      </section>

      {/* Input or reveal */}
      {!over ? (
        <section aria-label="Make a guess" className="mt-4 w-full rounded-xl border border-paper-edge bg-white/60 p-4">
          <h2 className="mb-2 font-display text-xs tracking-[0.25em] opacity-60">PROGRAM</h2>
          <div className="grid grid-cols-3 gap-1.5 sm:grid-cols-6">
            {programs.map((t) => (
              <button
                key={t.school_id}
                type="button"
                onClick={() => setSelTeam(t.school_id)}
                aria-pressed={selTeam === t.school_id}
                className={`rounded-md border-2 bg-white/60 px-1.5 py-2 text-center font-display text-xs transition ${
                  selTeam === t.school_id ? "border-ink shadow" : "border-paper-edge hover:border-ink/40"
                }`}
                style={{ borderLeftWidth: 6, borderLeftColor: t.mainHex }}
              >
                {t.name}
              </button>
            ))}
          </div>

          <h2 className="mb-2 mt-4 font-display text-xs tracking-[0.25em] opacity-60">YEAR</h2>
          <div className="flex flex-wrap gap-1.5">
            {years.map((y) => (
              <button
                key={y}
                type="button"
                onClick={() => setSelYear(y)}
                aria-pressed={selYear === y}
                className={`rounded-md border-2 px-2.5 py-1.5 text-sm tabular-nums transition ${
                  selYear === y ? "border-ink bg-ink text-paper" : "border-paper-edge bg-white/60 hover:border-ink/40"
                }`}
              >
                {y}
              </button>
            ))}
          </div>

          <button
            type="button"
            onClick={submitGuess}
            disabled={!canSubmit}
            className="mt-4 w-full rounded-lg bg-ink px-6 py-3 font-display tracking-widest text-paper shadow transition enabled:hover:brightness-110 disabled:opacity-40"
          >
            {dup
              ? "ALREADY GUESSED"
              : selTeamName && selYear !== null
                ? `GUESS: ${selTeamName} ${selYear}`
                : "PICK A PROGRAM & YEAR"}
          </button>
          <p className="mt-2 text-center text-xs opacity-60">
            {MAX_GUESSES - guesses.length} {MAX_GUESSES - guesses.length === 1 ? "guess" : "guesses"} left
          </p>
        </section>
      ) : (
        <section
          aria-label="Result"
          className={`mt-4 w-full rounded-xl border-4 p-5 text-center shadow-md ${
            won ? "border-emerald-700 bg-emerald-700/10" : "border-ink bg-white/70"
          }`}
        >
          <h2 className="font-display text-2xl tracking-wide">
            {won ? `SOLVED IN ${guesses.length}/${MAX_GUESSES} 🎉` : `OUT OF GUESSES — X/${MAX_GUESSES}`}
          </h2>
          <p className="mt-2 font-display text-3xl">
            {answer.team} <span className="tabular-nums">{answer.season}</span>
          </p>
          <p className="mt-1 text-sm opacity-75">
            {answer.record} · {answer.conference} · Star: {answer.star.name} ({answer.star.pos} · {answer.star.ovr} OVR)
          </p>

          {stats && (
            <p className="mt-3 text-sm">
              {round.mode === "daily" ? (
                <>
                  <span className="font-display">🔥 Streak {stats.streak}</span>
                  <span className="opacity-60"> · best {stats.maxStreak} · </span>
                  {stats.wins}/{stats.played} solved
                </>
              ) : (
                <span className="opacity-70">Free play — daily streak untouched.</span>
              )}
            </p>
          )}

          <div className="mt-4 flex flex-wrap justify-center gap-3">
            <button
              type="button"
              onClick={copyResult}
              className={`rounded-lg px-6 py-3 font-display tracking-widest shadow transition hover:brightness-110 ${
                copied ? "bg-emerald-700 text-white" : "bg-ink text-paper"
              }`}
            >
              {copied ? "COPIED ✓" : "COPY RESULT"}
            </button>
            <button
              type="button"
              onClick={() => startFree(catalog)}
              className="rounded-lg border-2 border-ink px-6 py-3 font-display tracking-widest transition hover:bg-ink/5"
            >
              RANDOM ROUND
            </button>
          </div>
        </section>
      )}
    </Shell>
  );
}

function Shell({
  children,
  onBack,
  onStats,
}: {
  children: React.ReactNode;
  onBack: () => void;
  onStats?: () => void;
}) {
  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col px-4 py-6">
      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={onBack}
          className="rounded-md px-2 py-1 font-display text-xs tracking-widest opacity-70 transition hover:opacity-100"
        >
          ← ARCADE
        </button>
        <div className="flex items-center gap-3">
          <span className="font-display text-xs tracking-[0.3em] opacity-40">CFB ARCADE</span>
          {onStats && (
            <button
              type="button"
              onClick={onStats}
              className="rounded-md border border-paper-edge bg-white/60 px-2 py-1 font-display text-xs tracking-widest opacity-80 transition hover:opacity-100"
            >
              📊 STATS
            </button>
          )}
        </div>
      </div>
      <h1 className="mt-3 text-center font-display text-4xl leading-tight sm:text-5xl">GUESS THE SEASON</h1>
      {children}
    </main>
  );
}

function GuessRowView({ row }: { row: GuessRow }) {
  const { teamHit, yearDiff } = row.fb;
  const yearClose = yearDiff !== 0 && Math.abs(yearDiff) <= CLOSE_YEARS;
  const arrow = yearDiff === 0 ? "" : yearDiff > 0 ? "▲" : "▼";
  const label = `Guessed ${row.teamName} ${row.season}: team ${
    teamHit ? "correct" : "wrong"
  }, year ${yearDiff === 0 ? "correct" : yearClose ? "within two" : "off"}${
    arrow ? `, answer is ${yearDiff > 0 ? "later" : "earlier"}` : ""
  }`;
  return (
    <div
      aria-label={label}
      className="chip-in flex items-center gap-2.5 rounded-md border border-paper-edge bg-white/50 px-3 py-2"
    >
      <span aria-hidden className={`h-4 w-4 shrink-0 rounded-sm ${teamHit ? "bg-emerald-600" : "bg-ink/20"}`} />
      <span className="flex-1 truncate text-sm">{row.teamName}</span>
      <span className="text-sm tabular-nums">{row.season}</span>
      <span
        aria-hidden
        className={`h-4 w-4 shrink-0 rounded-sm ${
          yearDiff === 0 ? "bg-emerald-600" : yearClose ? "bg-amber-400" : "bg-ink/20"
        }`}
      />
      <span aria-hidden className="w-4 text-center text-xs opacity-70">
        {arrow}
      </span>
    </div>
  );
}
