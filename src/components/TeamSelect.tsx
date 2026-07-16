// TEAM_SELECT (§2): pick a favorite program (theme injection) + game mode,
// with the §9 trophy room below the fold. The picker groups the 68 P4 programs
// into the four Power-4 conference tabs + an Others bucket, keeps launch/mode
// controls above the list, and auto-selects the player's last-played team.
import { useEffect, useMemo, useState } from "react";
import type { Team } from "../data/types.ts";
import { STAT_LABELS } from "../data/types.ts";
import { CONFERENCE_ORDER, conferenceOf, type ConferenceKey } from "../data/conferences.ts";
import { applyTeamTheme, useGame, useGameActions, type Mode } from "../state/store.tsx";
import { compareBuilds, loadLastTeam, loadTrophyRoom, saveLastTeam, type RunPlayer, type RunSummary } from "../state/storage.ts";
import TeamMark, { softTeamFill } from "./TeamMark.tsx";

const OUTCOME_LABELS: Record<string, string> = {
  natty: "National Champions",
  semis: "Final Four",
  major: "Playoffs",
  minor: "Bowl Game",
  loss: "",
};

function RunRow({ run, onOpen }: { run: RunSummary; onOpen: (r: RunSummary) => void }) {
  // Tiered honors (§9): dynasty is rarest — gold fill + a notable border; a
  // national title is a gold fill; a semifinal is silver; a quarterfinal bronze.
  const filled = run.dynasty || run.outcome === "natty";
  const tierClass =
    run.dynasty ? "trophy-dynasty" :
    run.outcome === "natty" ? "trophy-gold-fill" :
    run.outcome === "semis" ? "trophy-silver" :
    run.outcome === "major" ? "trophy-bronze" : "";

  return (
    <button
      type="button"
      onClick={() => onOpen(run)}
      title="View this roster"
      className={`flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left transition hover:brightness-[0.97] ${filled ? "" : "bg-white/60"} ${tierClass}`}
    >
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
        {run.positionAwards?.map((a) => (
          <span key={a.award} className="rounded bg-emerald-100 px-2 py-0.5 text-xs text-emerald-800">{a.award}</span>
        ))}
        {run.dynasty && (
          <span className="rounded-full bg-amber-500 px-2 py-0.5 text-xs font-bold text-white">★ DYNASTY</span>
        )}
      </div>
      <span className="ml-auto shrink-0 text-xs opacity-50">{run.favorite_team} · {run.mode}</span>
    </button>
  );
}

function StatGrid({ player }: { player: RunPlayer }) {
  const labels = STAT_LABELS[player.position];
  return (
    <dl className="mt-1 grid grid-cols-5 gap-1 text-[10px] leading-tight">
      {labels.map((label, i) => (
        <div key={label}>
          <dt className="truncate uppercase tracking-wide opacity-50">{label}</dt>
          <dd className="font-display text-xs">{player.stats[i]}</dd>
        </div>
      ))}
    </dl>
  );
}

function RunDetailModal({ run, onClose }: { run: RunSummary; onClose: () => void }) {
  const { data } = useGame();
  const teamByName = useMemo(
    () => new Map(data.teams.map((t) => [t.name, t] as const)),
    [data.teams],
  );
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const dateStr = new Date(run.timestamp).toLocaleDateString(undefined, {
    year: "numeric", month: "short", day: "numeric",
  });
  // Same softened team-color slab the draft masthead uses, keyed to this run's
  // program, with a white line underneath.
  const favTeam = teamByName.get(run.favorite_team);
  const head = favTeam ? softTeamFill(favTeam.mainHex, 0.15) : null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Run details"
      onClick={onClose}
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 p-4 backdrop-blur-sm"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="max-h-[85vh] w-full max-w-lg overflow-y-auto rounded-xl border border-paper-edge bg-paper shadow-2xl"
      >
        <div
          className={`sticky top-0 flex items-center justify-between gap-3 border-b-4 border-white px-4 py-3 ${head ? "" : "bg-paper/95 backdrop-blur"}`}
          style={head ? { background: head.bg, color: head.fg } : undefined}
        >
          <div>
            <div className="flex items-center gap-2">
              <span className="font-display text-2xl font-bold">{run.record}</span>
              {run.outcome && OUTCOME_LABELS[run.outcome] && (
                <span className="rounded bg-black/15 px-2 py-0.5 text-xs">{OUTCOME_LABELS[run.outcome]}</span>
              )}
              {run.dynasty && (
                <span className="rounded-full bg-amber-500 px-2 py-0.5 text-xs font-bold text-white">★ DYNASTY</span>
              )}
            </div>
            <p className="mt-0.5 text-xs opacity-70">{run.favorite_team} · {run.mode} · {dateStr}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded-md border border-current/30 px-2 py-1 font-display text-xs transition hover:bg-black/10"
          >
            ✕
          </button>
        </div>

        <div className="space-y-2 p-4">
          {run.roster && run.roster.length > 0 ? (
            <>
              {run.roster.map((p) => {
                const team = teamByName.get(p.school);
                return (
                  <div key={p.slot} className="rounded-lg border border-paper-edge bg-white/60 px-3 py-2">
                    <div className="flex items-center gap-2">
                      <span className="w-9 shrink-0 font-display text-[10px] tracking-widest opacity-55">{p.slot}</span>
                      <TeamMark school={p.school} primary={team?.mainHex ?? null} secondary={team?.accentHex ?? null} size="s" />
                      <span className="truncate font-bold">{p.name}</span>
                      <span className="shrink-0 rounded bg-ink/85 px-1.5 py-0.5 font-display text-[10px] tracking-wider text-paper">
                        {p.position}
                      </span>
                      <span className="ml-auto shrink-0 text-[10px] uppercase tracking-wide opacity-50">
                        {p.school} · {p.decade}
                      </span>
                    </div>
                    {(p.heisman || p.allAmerican || p.positionAward) && (
                      <div className="mt-1 flex flex-wrap gap-1.5 pl-11">
                        {p.heisman && (
                          <span className="rounded bg-amber-100 px-2 py-0.5 text-[10px] font-bold text-amber-800">🏆 Heisman</span>
                        )}
                        {p.positionAward && (
                          <span className="rounded bg-emerald-100 px-2 py-0.5 text-[10px] font-bold text-emerald-800">{p.positionAward}</span>
                        )}
                        {p.allAmerican && (
                          <span className="rounded bg-blue-100 px-2 py-0.5 text-[10px] font-bold text-blue-800">All-American</span>
                        )}
                      </div>
                    )}
                    <div className="pl-11">
                      <StatGrid player={p} />
                    </div>
                  </div>
                );
              })}
              {run.coach && (
                <div className="flex items-center gap-2 rounded-lg border border-paper-edge bg-white/60 px-3 py-2">
                  <span className="w-9 shrink-0 font-display text-[10px] tracking-widest opacity-55">HC</span>
                  <span className="truncate font-bold">{run.coach.name}</span>
                  <span className="shrink-0 rounded bg-ink/85 px-1.5 py-0.5 font-display text-[10px] tracking-wider text-paper">
                    {run.coach.tier.toUpperCase()}
                  </span>
                  <span className="ml-auto shrink-0 text-[10px] uppercase tracking-wide opacity-50">{run.coach.school}</span>
                </div>
              )}
            </>
          ) : (
            <p className="py-6 text-center text-sm opacity-60">
              This run was saved before rosters were kept — no player detail available.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

function TrophyRoom() {
  const [room] = useState(loadTrophyRoom);
  const [openRun, setOpenRun] = useState<RunSummary | null>(null);
  if (room.recent_runs.length === 0) return null;

  const recent = room.recent_runs.slice(0, 5);
  // Rank by achievement (playoff depth → honors), not raw roster power, and
  // re-sort here so builds saved under the old power-only order display right.
  const best = [...room.top_builds].sort(compareBuilds).slice(0, 5);

  return (
    <section aria-label="Trophy room" className="w-full space-y-4">
      <div className="rounded-xl border border-paper-edge bg-white/50 p-4">
        <h2 className="mb-3 font-display text-sm tracking-[0.25em] opacity-70">RECENT RUNS</h2>
        <div className="space-y-2">
          {recent.map((r) => <RunRow key={r.timestamp} run={r} onOpen={setOpenRun} />)}
        </div>
      </div>
      <div className="rounded-xl border border-paper-edge bg-white/50 p-4">
        <h2 className="mb-3 font-display text-sm tracking-[0.25em] opacity-70">BEST BUILDS</h2>
        <div className="space-y-2">
          {best.map((r) => <RunRow key={r.timestamp} run={r} onOpen={setOpenRun} />)}
        </div>
      </div>
      {openRun && <RunDetailModal run={openRun} onClose={() => setOpenRun(null)} />}
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

        <div role="tabpanel" className="grid grid-cols-2 gap-2 md:grid-cols-3">
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
