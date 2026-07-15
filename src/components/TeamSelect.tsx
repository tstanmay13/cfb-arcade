// TEAM_SELECT (§2): pick a favorite program (theme injection) + game mode,
// with the §9 trophy room below the fold. The picker groups the 68 P4 programs
// into the four Power-4 conference tabs + an Others bucket, keeps launch/mode
// controls above the list, and auto-selects the player's last-played team.
import { useEffect, useMemo, useState } from "react";
import type { Team } from "../data/types.ts";
import { CONFERENCE_ORDER, conferenceOf, type ConferenceKey } from "../data/conferences.ts";
import { applyTeamTheme, useGame, useGameActions, type Mode } from "../state/store.tsx";
import { loadLastTeam, loadTrophyRoom, saveLastTeam, type RunSummary } from "../state/storage.ts";
import TeamMark from "./TeamMark.tsx";

const OUTCOME_LABELS: Record<string, string> = {
  natty: "National Champions",
  semis: "Final Four",
  major: "Playoffs",
  minor: "Bowl Game",
  loss: "",
};

function RunRow({ run }: { run: RunSummary }) {
  // Tiered honors (§9): dynasty is rarest — gold fill + a notable border; a
  // national title is a gold fill; a semifinal is silver; a quarterfinal bronze.
  const filled = run.dynasty || run.outcome === "natty";
  const tierClass =
    run.dynasty ? "trophy-dynasty" :
    run.outcome === "natty" ? "trophy-gold-fill" :
    run.outcome === "semis" ? "trophy-silver" :
    run.outcome === "major" ? "trophy-bronze" : "";

  return (
    <div className={`flex items-center gap-3 rounded-lg px-3 py-2 ${filled ? "" : "bg-white/60"} ${tierClass}`}>
      <span className="font-display text-lg font-bold">{run.record}</span>
      <div className="flex flex-wrap gap-1.5">
        {run.outcome && OUTCOME_LABELS[run.outcome] && (
          <span className="rounded bg-ink/10 px-2 py-0.5 text-xs">{OUTCOME_LABELS[run.outcome]}</span>
        )}
        {run.heisman && (
          <span className="rounded bg-amber-100 px-2 py-0.5 text-xs text-amber-800">Heisman</span>
        )}
        {(run.allAmericansCount ?? 0) > 0 && (
          <span className="rounded bg-blue-100 px-2 py-0.5 text-xs text-blue-800">
            {run.allAmericansCount} All-American{run.allAmericansCount === 1 ? "" : "s"}
          </span>
        )}
        {run.dynasty && (
          <span className="rounded-full bg-amber-500 px-2 py-0.5 text-xs font-bold text-white">★ DYNASTY</span>
        )}
      </div>
      <span className="ml-auto text-xs opacity-50">{run.favorite_team} · {run.mode}</span>
    </div>
  );
}

function TrophyRoom() {
  const [room] = useState(loadTrophyRoom);
  if (room.recent_runs.length === 0) return null;

  const recent = room.recent_runs.slice(0, 5);
  const best = room.top_builds.slice(0, 5);

  return (
    <section aria-label="Trophy room" className="w-full space-y-4">
      <div className="rounded-xl border border-paper-edge bg-white/50 p-4">
        <h2 className="mb-3 font-display text-sm tracking-[0.25em] opacity-70">RECENT RUNS</h2>
        <div className="space-y-2">
          {recent.map((r) => <RunRow key={r.timestamp} run={r} />)}
        </div>
      </div>
      <div className="rounded-xl border border-paper-edge bg-white/50 p-4">
        <h2 className="mb-3 font-display text-sm tracking-[0.25em] opacity-70">BEST BUILDS</h2>
        <div className="space-y-2">
          {best.map((r) => <RunRow key={r.timestamp} run={r} />)}
        </div>
      </div>
    </section>
  );
}

export default function TeamSelect({
  onOpenArcade,
  onOpenGm,
}: {
  onOpenArcade?: () => void;
  onOpenGm?: () => void;
}) {
  const { data } = useGame();
  const { startRun } = useGameActions();

  // Restore the last-played team + mode so the player can fire off another run
  // without re-picking. Read once on mount.
  const [remembered] = useState(loadLastTeam);
  const rememberedTeam = useMemo(
    () => (remembered ? data.teams.find((t) => t.school_id === remembered.schoolId) ?? null : null),
    [remembered, data.teams],
  );

  const [team, setTeam] = useState<Team | null>(rememberedTeam);
  const [mode, setMode] = useState<Mode>(remembered?.mode ?? "Classic");
  // True while the current selection is the auto-restored team (untouched).
  const [autoSelected, setAutoSelected] = useState(rememberedTeam != null);
  const [activeConf, setActiveConf] = useState<ConferenceKey>(
    rememberedTeam ? conferenceOf(rememberedTeam.school_id) : "SEC",
  );

  // Apply the restored team's theme on first paint.
  useEffect(() => {
    if (rememberedTeam) applyTeamTheme(rememberedTeam);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const teamsByConf = useMemo(() => {
    const groups: Record<ConferenceKey, Team[]> = {
      SEC: [], "Big Ten": [], ACC: [], "Big 12": [], Others: [],
    };
    for (const t of data.teams) groups[conferenceOf(t.school_id)].push(t);
    for (const key of CONFERENCE_ORDER) groups[key].sort((a, b) => a.name.localeCompare(b.name));
    return groups;
  }, [data.teams]);

  const choose = (t: Team) => {
    setTeam(t);
    setAutoSelected(false);
    applyTeamTheme(t); // live preview
  };

  const launch = () => {
    if (!team) return;
    saveLastTeam(team.school_id, mode);
    startRun(team, mode);
  };

  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col items-center gap-8 p-6 py-10">
      <header className="text-center">
        <p className="font-display text-sm tracking-[0.35em] text-team">SPIN · DRAFT · RUN THE TABLE</p>
        <h1 className="mt-2 font-display text-5xl leading-tight sm:text-6xl">THE 16-0 DRAFT</h1>
        <p className="mx-auto mt-3 max-w-md text-sm opacity-75">
          Nine spins across fifteen seasons of real college football data. Draft a
          star at every position, land a coach, and find out if your team runs the
          table.
        </p>
        <div className="mx-auto mt-4 flex flex-wrap items-center justify-center gap-2">
          {onOpenArcade && (
            <button
              type="button"
              onClick={onOpenArcade}
              className="rounded-full border-2 border-ink/30 bg-white/60 px-5 py-2 font-display text-xs tracking-[0.2em] shadow-sm transition hover:border-ink/60 hover:shadow"
            >
              🕹 ARCADE · GUESS THE SEASON →
            </button>
          )}
          {onOpenGm && (
            <button
              type="button"
              onClick={onOpenGm}
              className="rounded-full border-2 border-ink/30 bg-white/60 px-5 py-2 font-display text-xs tracking-[0.2em] shadow-sm transition hover:border-ink/60 hover:shadow"
            >
              🏈 CFB-GM · RUN A DYNASTY →
            </button>
          )}
        </div>
      </header>

      {/* Launch bar — the main mode's controls. Set off from the arcade/GM
          links above by a divider rule (no heavy card), mode + START kept above
          the team list so a returning player can go straight into another run. */}
      <section aria-label="Launch" className="w-full border-t-2 border-paper-edge pt-6">
        <div className="flex flex-col items-center gap-4 sm:flex-row sm:justify-center">
          {team && (
            <div className="flex min-w-0 items-center gap-3 sm:mr-auto">
              <TeamMark school={team.name} primary={team.mainHex} secondary={team.accentHex} size="l" />
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="truncate font-display text-lg">{team.name}</span>
                  {autoSelected && (
                    <span className="rounded-full bg-team px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-team-accent">
                      ↩ Last played
                    </span>
                  )}
                </div>
                {autoSelected && (
                  <span className="text-xs opacity-60">Auto-selected — pick another below to change</span>
                )}
              </div>
            </div>
          )}

          <div className="flex items-center gap-2">
            {(["Classic", "Scout"] as Mode[]).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setMode(m)}
                aria-pressed={mode === m}
                title={m === "Classic" ? "Stat lines visible on every pick." : "Stats hidden — draft on name recognition alone."}
                className={`rounded-full border-2 px-4 py-2 font-display text-xs tracking-widest transition
                  ${mode === m ? "border-ink bg-ink text-paper" : "border-paper-edge hover:border-ink/40"}`}
              >
                {m.toUpperCase()}
              </button>
            ))}
          </div>

          <button
            type="button"
            disabled={!team}
            onClick={launch}
            className="rounded-lg bg-team px-8 py-3 font-display text-lg tracking-[0.2em] text-team-accent shadow-lg transition enabled:hover:scale-105 disabled:opacity-40"
          >
            START
          </button>
        </div>
      </section>

      {/* Conference tabs — four Power-4 leagues + Others (independents). */}
      <section aria-label="Pick your program" className="w-full">
        <h2 className="mb-3 text-center font-display text-lg tracking-widest">PICK YOUR PROGRAM</h2>
        <div role="tablist" aria-label="Conference" className="mb-3 flex flex-wrap justify-center gap-2">
          {CONFERENCE_ORDER.map((conf) => (
            <button
              key={conf}
              type="button"
              role="tab"
              aria-selected={activeConf === conf}
              onClick={() => setActiveConf(conf)}
              className={`rounded-full border-2 px-4 py-1.5 font-display text-xs tracking-widest transition
                ${activeConf === conf ? "border-ink bg-ink text-paper" : "border-paper-edge bg-white/50 hover:border-ink/40"}`}
            >
              {conf.toUpperCase()}
              <span className="ml-1.5 opacity-60">{teamsByConf[conf].length}</span>
            </button>
          ))}
        </div>

        <div role="tabpanel" className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {teamsByConf[activeConf].map((t) => (
            <button
              key={t.school_id}
              type="button"
              onClick={() => choose(t)}
              aria-pressed={team?.school_id === t.school_id}
              className={`flex items-center gap-2 rounded-md border-2 bg-white/50 px-2 py-2 text-left transition
                ${team?.school_id === t.school_id ? "border-ink shadow-md" : "border-paper-edge hover:border-ink/40"}`}
              style={{ borderLeftWidth: 8, borderLeftColor: t.mainHex }}
            >
              <TeamMark school={t.name} primary={t.mainHex} secondary={t.accentHex} size="m" />
              <span className="min-w-0">
                <span className="block truncate font-display text-sm">{t.name}</span>
                <span className="block truncate text-[10px] uppercase tracking-wide opacity-60">{t.mascot}</span>
              </span>
            </button>
          ))}
        </div>
      </section>

      <TrophyRoom />
    </main>
  );
}
