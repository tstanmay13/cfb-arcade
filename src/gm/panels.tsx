// Read-only dynasty panels + modals. All data comes off DynastyState; the
// only I/O is HistoryPanel lazily reading the departed-player archive.
// Presentation is built entirely from the V0 design system (ui.tsx / theme.ts).
import { useEffect, useMemo, useState } from "react";
import type { DynastyState, GameResult, Player, PosGroup } from "./engine/types.ts";
import { CLASS_LABELS, DEV_TIER_LABELS, expandSheet } from "./engine/player.ts";
import { confStandings, p4Conferences } from "./engine/postseason.ts";
import { committeeOrder } from "./engine/poll.ts";
import { fmtMoney, marketValue } from "./engine/nil.ts";
import { LINEUP_COUNTS } from "./engine/lineup.ts";
import { effectiveAsk, portalFit, type PortalOffer } from "./engine/offseason.ts";
import {
  ARCHETYPE_LABELS, BOOSTER_LABELS, coachMarket, coachSalary, fireCoach, hireCoach,
  ROLE_LABELS, STAFF_ROLES, staffOf, teamScheme, type CoachRole,
} from "./engine/coaches.ts";
import { DEF_LABELS, OFF_LABELS, playerSchemeFit, type DefScheme, type OffScheme } from "./engine/schemes.ts";
import { boostMorale, developPlayer, retainEffort, STAMINA_COSTS, staminaMax } from "./engine/recruiting.ts";
import { draftProjection } from "./engine/progression.ts";
import { buildSeasonRecap } from "./engine/recap.ts";
import { archiveFor, type ArchiveRow } from "./db.ts";
import { getTeamColors } from "./theme.ts";
import {
  Card, cardCls, Delta, Meter, Pill, SectionLabel, StatusText, TeamMark, TeamName,
} from "./ui.tsx";

const th = "px-2 py-1.5 text-left font-display text-[10px] tracking-widest text-ink/50";
const td = "px-2 py-1.5";

function school(state: DynastyState, tid: number): string {
  return state.teams[tid].school;
}

function rankOf(state: DynastyState, tid: number): number {
  const i = state.poll.findIndex((e) => e.tid === tid);
  return i >= 0 ? i + 1 : 0;
}

/** A school name rendered in its own colors, with its poll rank when ranked. */
function TeamRef({ state, tid, lead }: { state: DynastyState; tid: number; lead?: boolean }) {
  const r = rankOf(state, tid);
  return <TeamName team={state.teams[tid]} rank={r || undefined} lead={lead ?? tid === state.userTid} />;
}

function teamGames(state: DynastyState, tid: number) {
  return state.schedule
    .filter((g) => g.home === tid || g.away === tid)
    .sort((a, b) => a.week - b.week)
    .map((g) => ({ game: g, result: state.results.find((r) => r.gid === g.id) ?? null }));
}

function userGames(state: DynastyState) {
  return teamGames(state, state.userTid);
}

// --- Dashboard ---------------------------------------------------------------

export function Dashboard({ state }: { state: DynastyState }) {
  const games = userGames(state);
  const next = games.find((g) => !g.result);
  const played = games.filter((g) => g.result);
  const last = played[played.length - 1] ?? null;
  const lastWeek = last ? last.game.week : null;
  const [showBox, setShowBox] = useState(false);

  return (
    <div className="space-y-3">
      {/* The week's headline: the matchup is the hero (V1 hierarchy). */}
      <MatchupHero state={state} next={next?.game ?? null} />

      <div className="grid gap-3 lg:grid-cols-3">
        <Card
          title={lastWeek != null ? `LAST RESULT · WEEK ${lastWeek}` : "LAST RESULT"}
          tour="last-result"
          className="lg:col-span-2"
        >
          {last?.result ? (
            <LastResult state={state} r={last.result} onBox={() => setShowBox(true)} />
          ) : (
            <p className="text-sm text-ink/60">No games in the books yet — sim a week.</p>
          )}
          {showBox && last?.result && (
            <BoxModal state={state} result={last.result} onClose={() => setShowBox(false)} />
          )}
        </Card>

        <MandatesCard state={state} />

        <Card title="RANKINGS · TOP 10" className="lg:col-span-2" bodyClassName="px-4 py-2">
          <ol className="text-sm">
            {state.poll.slice(0, 10).map((e, i) => (
              <li
                key={e.tid}
                className={`flex items-center gap-2 rounded px-1 py-1 ${i > 0 ? "border-t border-line/40" : ""}`}
                style={
                  e.tid === state.userTid
                    ? {
                        boxShadow: `inset 3px 0 0 ${getTeamColors(state.teams[e.tid]).primary}`,
                        background: `color-mix(in srgb, ${getTeamColors(state.teams[e.tid]).primary} 7%, transparent)`,
                      }
                    : undefined
                }
              >
                <span className="w-5 text-right font-display text-ink/45">{i + 1}</span>
                <TeamName team={state.teams[e.tid]} lead={e.tid === state.userTid} />
                <span className="text-xs text-ink/50">
                  {state.teams[e.tid].rec.w}-{state.teams[e.tid].rec.l}
                </span>
                <span className="ml-auto text-xs">
                  <Delta prev={e.prev} rank={i + 1} />
                </span>
              </li>
            ))}
          </ol>
        </Card>

        <ProgramRail state={state} />

        <SeasonStatsCard state={state} />
      </div>

      <Card title="#CFB_PULSE" tour="news">
        <ul className="space-y-1.5 text-sm">
          {state.news.slice(0, 12).map((n, i) => (
            <li key={i} className="flex gap-2">
              <span className="mt-0.5 shrink-0 rounded bg-surface-sunken px-1.5 text-[10px] font-bold text-ink/60">
                {n.season} wk{n.week}
              </span>
              <span>{n.text}</span>
            </li>
          ))}
          {state.news.length === 0 && <li className="text-ink/55">Quiet so far. Sim a week.</li>}
        </ul>
      </Card>
    </div>
  );
}

/**
 * The full-width matchup hero (V1): both programs' marks and colors, the
 * week, and the stakes — one glance answers "who's next."
 */
function MatchupHero({ state, next }: { state: DynastyState; next: DynastyState["schedule"][number] | null }) {
  const user = state.teams[state.userTid];
  if (!next) {
    return (
      <Card title="NEXT GAME" tour="next-game">
        <p className="text-sm text-ink/60">
          {state.phase === "offseason" ? "Season complete — see the Offseason Report." : "Regular season done."}
        </p>
      </Card>
    );
  }
  const home = next.home === state.userTid;
  const oppTid = home ? next.away : next.home;
  const opp = state.teams[oppTid];
  const rival = (user.rivals ?? []).includes(oppTid);
  const uc = getTeamColors(user);
  const oc = getTeamColors(opp);
  const userRank = rankOf(state, state.userTid);
  const oppRank = rankOf(state, oppTid);

  const side = (team: typeof user, colors: typeof uc, rank: number, away: boolean) => (
    <div className={`flex min-w-0 items-center gap-3 ${away ? "sm:flex-row-reverse sm:text-right" : ""}`}>
      <TeamMark team={team} size="xl" />
      <div className="min-w-0">
        <p className="truncate font-display text-xl leading-tight" style={{ color: colors.ink }}>
          {rank > 0 && <span className="mr-1 opacity-60">#{rank}</span>}
          {team.school}
        </p>
        <p className="mt-0.5 text-xs text-ink/65">
          {team.rec.w}-{team.rec.l} · {team.rec.cw}-{team.rec.cl} conf ·{" "}
          <span className="text-gold">{"★".repeat(team.prestige)}</span>
        </p>
      </div>
    </div>
  );

  return (
    <section
      data-tour="next-game"
      className={`${cardCls} overflow-hidden`}
      style={{
        borderLeft: `6px solid ${uc.primary}`,
        borderRight: `6px solid ${oc.primary}`,
        backgroundImage: `linear-gradient(100deg, ${uc.primary}12, transparent 38%, transparent 62%, ${oc.primary}12)`,
      }}
    >
      <div className="grid items-center gap-3 px-5 py-4 sm:grid-cols-[1fr_auto_1fr]">
        {side(user, uc, userRank, false)}
        <div className="text-center">
          <p className="font-display text-[10px] tracking-[0.3em] text-ink/50">WEEK {next.week}</p>
          <p className="my-0.5 font-display text-3xl leading-none">{home ? "VS" : "AT"}</p>
          <div className="flex flex-wrap items-center justify-center gap-1">
            {rival && <Pill tone="accent">RIVALRY</Pill>}
            {next.conf && <Pill tone="neu">CONF</Pill>}
          </div>
          {next.name && <p className="mt-1 text-[11px] text-ink/60">{next.name}</p>}
        </div>
        {side(opp, oc, oppRank, true)}
      </div>
      <OpponentScouting state={state} oppTid={oppTid} />
    </section>
  );
}

/** Next-game scouting snapshot (M1.1): top players + scheme identity. */
function OpponentScouting({ state, oppTid }: { state: DynastyState; oppTid: number }) {
  const opp = state.teams[oppTid];
  if (!opp.p4) {
    return (
      <p className="border-t border-line/60 px-5 py-1.5 text-[11px] text-ink/55">
        <span className="font-display tracking-widest text-ink/45">SCOUT </span>
        Buy-game opponent — they bring a team rating, not a roster. Handle business.
      </p>
    );
  }
  const top = opp.roster
    .map((pid) => state.players[pid])
    .sort((a, b) => b.ovr - a.ovr)
    .slice(0, 3);
  const { off, def } = teamScheme(state, oppTid);
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-line/60 px-5 py-1.5 text-[11px]">
      <span className="font-display tracking-widest text-ink/45">SCOUT</span>
      <span className="text-ink/75">
        Runs <span className="font-bold">{OFF_LABELS[off]}</span> ·{" "}
        <span className="font-bold">{DEF_LABELS[def]}</span>
      </span>
      <span className="text-ink/40">|</span>
      {top.map((p) => (
        <span key={p.id} className="text-ink/75">
          <span className="font-display text-ink/50">{p.pos}</span>{" "}
          <span className="font-bold">{p.name}</span> <span className="text-ink/55">{p.ovr}</span>
        </span>
      ))}
    </div>
  );
}

function LastResult({ state, r, onBox }: { state: DynastyState; r: GameResult; onBox: () => void }) {
  const userHome = r.home === state.userTid;
  const us = userHome ? r.hs : r.as;
  const them = userHome ? r.as : r.hs;
  const oppTid = userHome ? r.away : r.home;
  const win = us > them;
  return (
    // Keyed on the game so a fresh result re-runs the reveal (V1 moment).
    <div key={r.gid} className="gm-reveal">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <div
          className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg font-display text-2xl"
          style={{
            background: win ? "var(--pos-soft)" : "var(--neg-soft)",
            color: win ? "var(--pos)" : "var(--neg)",
          }}
        >
          {win ? "W" : "L"}
        </div>
        {/* Scoreboard-scale numerals — the one number this card exists for. */}
        <p className="font-display text-5xl leading-none tracking-tight">
          <StatusText tone={win ? "pos" : "neg"}>{us}</StatusText>
          <span className="text-ink/35">–</span>
          <span className="text-ink/75">{them}</span>
        </p>
        <p className="text-sm text-ink/70">
          {userHome ? "vs" : "at"} <TeamRef state={state} tid={oppTid} />
          {r.ot > 0 ? ` (${r.ot}OT)` : ""}
          {r.name ? ` · ${r.name}` : ""}
        </p>
      </div>
      {/* Star-player-of-the-game stat line (mechanical PR fills richer data). */}
      {r.star && (
        <div className="mt-3 flex items-start gap-2 rounded-lg border border-line/70 bg-surface-sunken/60 p-2.5">
          <span className="text-lg leading-none">⭐</span>
          <div>
            <SectionLabel>PLAYER OF THE GAME</SectionLabel>
            <p className="mt-0.5 text-sm">{r.star}</p>
          </div>
        </div>
      )}
      <button
        type="button"
        className="mt-3 text-xs font-bold text-accent underline-offset-2 hover:underline"
        onClick={onBox}
      >
        Box score + drive log →
      </button>
    </div>
  );
}

/** Season Stats module (M1.1): cumulative team stats + leaders per category. */
function SeasonStatsCard({ state }: { state: DynastyState }) {
  const team = state.teams[state.userTid];
  const players = team.roster.map((pid) => state.players[pid]);
  const gp = team.rec.w + team.rec.l;

  const leader = (f: (p: Player) => number) =>
    players.reduce<Player | null>((best, p) => (f(p) > (best ? f(best) : 0) ? p : best), null);

  const cats: { label: string; p: Player | null; line: (p: Player) => string }[] = [
    { label: "PASSING", p: leader((p) => p.stats.paYd), line: (p) => `${p.stats.paYd} yds · ${p.stats.paTD} TD ${p.stats.paInt} INT` },
    { label: "RUSHING", p: leader((p) => p.stats.ruYd), line: (p) => `${p.stats.ruYd} yds · ${p.stats.ruTD} TD` },
    { label: "RECEIVING", p: leader((p) => p.stats.reYd), line: (p) => `${p.stats.rec} rec · ${p.stats.reYd} yds · ${p.stats.reTD} TD` },
    { label: "TACKLES", p: leader((p) => p.stats.tkl), line: (p) => `${p.stats.tkl} tkl` },
    { label: "SACKS", p: leader((p) => p.stats.sck), line: (p) => `${p.stats.sck} sacks` },
    { label: "INTERCEPTIONS", p: leader((p) => p.stats.int), line: (p) => `${p.stats.int} INT` },
  ];

  return (
    <Card title="SEASON STATS" className="lg:col-span-3" bodyClassName="p-4">
      {gp === 0 ? (
        <p className="text-sm text-ink/60">No games yet — leaders appear after week 1.</p>
      ) : (
        <>
          <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
            <span><span className="text-ink/55">PPG</span> <span className="font-display">{(team.rec.pf / gp).toFixed(1)}</span></span>
            <span><span className="text-ink/55">Opp PPG</span> <span className="font-display">{(team.rec.pa / gp).toFixed(1)}</span></span>
            <span><span className="text-ink/55">Point diff</span>{" "}
              <StatusText tone={team.rec.pf >= team.rec.pa ? "pos" : "neg"} className="font-display">
                {team.rec.pf - team.rec.pa > 0 ? "+" : ""}{team.rec.pf - team.rec.pa}
              </StatusText>
            </span>
          </div>
          <div className="mt-3 grid gap-x-4 gap-y-2 sm:grid-cols-3">
            {cats.map(({ label, p, line }) =>
              p && line(p) && !line(p).startsWith("0 ") ? (
                <div key={label}>
                  <SectionLabel>{label}</SectionLabel>
                  <p className="mt-0.5 text-sm">
                    <span className="font-display text-xs text-ink/50">{p.pos}</span>{" "}
                    <span className="font-bold">{p.name}</span>{" "}
                    <span className="text-xs text-ink/60">{line(p)}</span>
                  </p>
                </div>
              ) : null,
            )}
          </div>
        </>
      )}
    </Card>
  );
}

/** Booster mandates as a live checklist — progress, not just prose (V1). */
function MandatesCard({ state }: { state: DynastyState }) {
  const team = state.teams[state.userTid];
  return (
    <Card
      title={`BOOSTER MANDATES · ${BOOSTER_LABELS[team.boosterType]}`}
      tour="mandates"
      bodyClassName="p-0"
    >
      <ul>
        {state.mandates.map((m, i) => (
          <MandateRow key={i} state={state} m={m} first={i === 0} />
        ))}
        {state.mandates.length === 0 && <li className="px-4 py-3 text-xs text-ink/55">The board is quiet.</li>}
      </ul>
      <p className="border-t border-line/70 px-4 py-2 text-[10px] text-ink/55">
        Hit every mandate: +25% NIL next cycle. Miss them all: −20% and a locker-room hit.
      </p>
    </Card>
  );
}

function MandateRow({ state, m, first }: { state: DynastyState; m: DynastyState["mandates"][number]; first: boolean }) {
  const team = state.teams[state.userTid];
  let status: React.ReactNode;
  let bar: React.ReactNode = null;

  if (m.met !== null) {
    status = m.met ? <Pill tone="pos">✓ MET</Pill> : <Pill tone="neg">✗ MISSED</Pill>;
  } else if (m.kind === "wins") {
    status = (
      <span className={`text-xs font-bold ${team.rec.w >= m.target ? "text-pos" : "text-ink/60"}`}>
        {team.rec.w} of {m.target}
      </span>
    );
  } else if (m.kind === "beat-rival") {
    const g = state.schedule.find(
      (x) =>
        (x.home === state.userTid && x.away === m.target) ||
        (x.away === state.userTid && x.home === m.target),
    );
    const res = g ? state.results.find((r) => r.gid === g.id) : undefined;
    if (res) {
      const won = (res.home === state.userTid ? res.hs : res.as) > (res.home === state.userTid ? res.as : res.hs);
      status = won ? <Pill tone="pos">✓ BEAT THEM</Pill> : <Pill tone="neg">✗ LOST IT</Pill>;
    } else {
      status = <Pill tone="neu">WEEK {g?.week ?? "—"}</Pill>;
    }
  } else {
    status = <Pill tone="neu">⏳ {m.kind === "cfp" ? "SELECTION DAY" : "SIGNING DAY"}</Pill>;
  }

  if (m.kind === "wins") {
    bar = (
      <Meter
        value={team.rec.w}
        max={m.target}
        color={team.rec.w >= m.target ? "var(--pos)" : "var(--accent)"}
        height={7}
        className="mt-1.5"
      />
    );
  }

  return (
    <li className={`px-4 py-2.5 ${first ? "" : "border-t border-line/60"}`}>
      <div className="flex items-baseline justify-between gap-2 text-sm">
        <span className="font-bold">{m.text}</span>
        {status}
      </div>
      {bar}
    </li>
  );
}

/** Staff, injuries, and NIL compressed into one quiet rail (V1 hierarchy). */
function ProgramRail({ state }: { state: DynastyState }) {
  const team = state.teams[state.userTid];
  const hurt = team.roster
    .map((pid) => state.players[pid])
    .filter((p) => p.inj > 0)
    .sort((a, b) => b.inj - a.inj);
  const paid = team.roster.map((pid) => state.players[pid]).filter((p) => p && p.nil > 0);
  return (
    <Card title="PROGRAM" tour="staff" bodyClassName="p-0">
      <div className="px-4 py-2.5">
        <SectionLabel>STAFF</SectionLabel>
        <ul className="mt-1 space-y-1 text-sm">
          {STAFF_ROLES.map((role) => {
            const c = staffOf(state, state.userTid)[role];
            return (
              <li key={role} className="flex items-baseline gap-2">
                <span className="w-7 font-display text-xs text-ink/60">{role}</span>
                {c ? (
                  <>
                    <span className="font-bold">{c.name}</span>
                    <span className="text-xs text-ink/55">{c.rating} · {ARCHETYPE_LABELS[c.archetype]}</span>
                  </>
                ) : (
                  <span className="text-ink/40">vacant</span>
                )}
              </li>
            );
          })}
        </ul>
        <p className="mt-1.5 text-[10px] text-ink/45">
          Hire &amp; fire on the Staff tab. Recruiters boost interest · Tacticians execution · Developers camp gains.
        </p>
      </div>
      <div className="border-t border-line/60 px-4 py-2.5">
        <SectionLabel>INJURY REPORT · {hurt.length} OUT</SectionLabel>
        {hurt.length === 0 ? (
          <p className="mt-1 text-sm text-ink/60">Clean bill of health.</p>
        ) : (
          <ul className="mt-1 space-y-0.5 text-sm">
            {hurt.slice(0, 5).map((p) => (
              <li key={p.id} className="flex items-baseline gap-1.5">
                <span className="font-display text-xs text-ink/60">{p.pos}</span>
                <span className="font-bold">{p.name}</span>
                <StatusText tone="neg" className="text-xs">
                  {p.inj >= 15 ? "out for season" : `${p.inj} wk${p.inj > 1 ? "s" : ""}`}
                </StatusText>
              </li>
            ))}
            {hurt.length > 5 && <li className="text-xs text-ink/45">+{hurt.length - 5} more on the Roster tab</li>}
          </ul>
        )}
      </div>
      <div className="border-t border-line/60 px-4 py-2.5">
        <SectionLabel>NIL</SectionLabel>
        <p className="mt-1 text-sm">
          <span className="font-display">{fmtMoney(team.nilBudget)}</span>
          <span className="text-xs text-ink/55"> pool · {paid.length} players on deals</span>
        </p>
      </div>
    </Card>
  );
}

// --- Staff (M1.7) --------------------------------------------------------------

/** Coaching staff management: your five-role staff + the hiring market. */
export function StaffPanel({ state, onMutate }: { state: DynastyState; onMutate: () => void }) {
  const [flash, setFlash] = useState<string | null>(null);
  const staff = staffOf(state, state.userTid);
  const market = coachMarket(state);
  const offseason = state.phase === "offseason";
  const vacantRoles = STAFF_ROLES.filter((r) => r !== "HC" && !staff[r]);

  const run = (fn: () => string | null) => {
    const err = fn();
    if (err) {
      setFlash(err);
      window.setTimeout(() => setFlash(null), 2500);
    } else {
      onMutate();
    }
  };

  const schemeOf = (role: CoachRole, scheme?: string) =>
    role === "OC" && scheme ? OFF_LABELS[scheme as OffScheme] :
    role === "DC" && scheme ? DEF_LABELS[scheme as DefScheme] : null;

  return (
    <div className="space-y-3">
      <Card
        title="YOUR STAFF"
        right={!offseason && <Pill tone="neu">HIRE &amp; FIRE OPEN IN THE OFFSEASON</Pill>}
      >
        {flash && <StatusText tone="neg" className="mb-2 block rounded bg-neg-soft px-2 py-1">{flash}</StatusText>}
        <ul className="divide-y divide-line/60">
          {STAFF_ROLES.map((role) => {
            const c = staff[role];
            const scheme = c && schemeOf(role, c.scheme);
            return (
              <li key={role} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
                <div>
                  <SectionLabel>{ROLE_LABELS[role]}</SectionLabel>
                  {c ? (
                    <p className="mt-0.5 text-sm">
                      <span className="font-bold">{c.name}</span>{" "}
                      <span className="text-ink/60">
                        {c.rating} OVR · {ARCHETYPE_LABELS[c.archetype]}
                        {scheme ? <> · runs the <span className="font-bold text-ink/80">{scheme}</span></> : null}
                        {" · "}{fmtMoney(coachSalary(c))}/yr
                      </span>
                    </p>
                  ) : (
                    <p className="mt-0.5 text-sm text-ink/45">Vacant — no {role === "RC" ? "recruiting" : role === "SC" ? "development" : "scheme"} boost</p>
                  )}
                </div>
                {c && role !== "HC" && offseason && (
                  <button
                    type="button"
                    onClick={() => run(() => fireCoach(state, c.id))}
                    className="rounded-full border border-line px-3 py-1 font-display text-[10px] tracking-widest text-neg transition hover:border-neg/60 hover:bg-neg-soft"
                  >
                    FIRE
                  </button>
                )}
              </li>
            );
          })}
        </ul>
        <p className="mt-2 text-[11px] text-ink/50">
          Salaries come out of your NIL pool every cycle — a stud coordinator is money the portal never sees.
          Your OC/DC set the schemes your roster is graded against.
        </p>
      </Card>

      <Card title={`COACHING MARKET · ${market.length} AVAILABLE`}>
        {vacantRoles.length === 0 && (
          <p className="mb-2 text-sm text-ink/55">No openings — fire someone to make room.</p>
        )}
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line bg-surface-sunken/50">
                <th className={th}>NAME</th>
                <th className={th}>OVR</th>
                <th className={th}>TYPE</th>
                <th className={`${th} hidden sm:table-cell`}>SALARY/YR</th>
                <th className={th}>{offseason ? "HIRE AS" : ""}</th>
              </tr>
            </thead>
            <tbody>
              {market.slice(0, 20).map((c) => (
                <tr key={c.id} className="border-b border-line/50">
                  <td className={`${td} font-bold`}>{c.name}</td>
                  <td className={`${td} font-display`}>{c.rating}</td>
                  <td className={td}>{ARCHETYPE_LABELS[c.archetype]}</td>
                  <td className={`${td} hidden font-mono text-xs sm:table-cell`}>{fmtMoney(coachSalary(c))}</td>
                  <td className={`${td} whitespace-nowrap`}>
                    {offseason &&
                      vacantRoles.map((role) => (
                        <button
                          key={role}
                          type="button"
                          onClick={() => run(() => hireCoach(state, c.id, role))}
                          className="mr-1 rounded border border-line px-2 py-0.5 text-[10px] font-bold transition hover:border-ink/50 hover:bg-accent-soft"
                        >
                          {role}
                        </button>
                      ))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

// --- Roster ------------------------------------------------------------------

/** Group order for the depth chart formation and the grouped roster table. */
const OFFENSE: PosGroup[] = ["QB", "RB", "WR", "TE", "OL"];
const DEFENSE: PosGroup[] = ["DL", "LB", "CB", "S"];
const SPECIAL: PosGroup[] = ["K", "P"];
const GROUP_ORDER: PosGroup[] = [...OFFENSE, ...DEFENSE, ...SPECIAL];
const GROUP_LABELS: Record<PosGroup, string> = {
  QB: "Quarterbacks", RB: "Running Backs", WR: "Wide Receivers", TE: "Tight Ends",
  OL: "Offensive Line", DL: "Defensive Line", LB: "Linebackers", CB: "Cornerbacks",
  S: "Safeties", K: "Kickers", P: "Punters",
};
const STARTER_COUNT = new Map(LINEUP_COUNTS);

type RosterSortCol = "pos" | "name" | "yr" | "ovr" | "dev" | "nil" | "mor";

export function RosterPanel({
  state,
  onCut,
  onPin,
  onMutate,
}: {
  state: DynastyState;
  onCut?: (pid: number) => void;
  onPin?: (pid: number) => void;
  onMutate?: () => void;
}) {
  const [sel, setSel] = useState<Player | null>(null);
  // Column sorting (M1.2): "pos" is the grouped depth-chart default; any other
  // column flattens the table and sorts by it, re-click flips direction.
  const [sortCol, setSortCol] = useState<RosterSortCol>("pos");
  const [sortDir, setSortDir] = useState<1 | -1>(-1);
  // Side-by-side comparison (M1.2): pick two, get the modal.
  const [compare, setCompare] = useState<number[]>([]);
  const canCut = state.phase === "offseason" && !!onCut;
  const team = state.teams[state.userTid];
  const pins = useMemo(() => new Set(team.pins ?? []), [team.pins]);

  // Players grouped by position, pins-first then OVR (matches sim depth order).
  const byGroup = useMemo(() => {
    const map = new Map<PosGroup, Player[]>();
    for (const pid of team.roster) {
      const p = state.players[pid];
      (map.get(p.g) ?? map.set(p.g, []).get(p.g)!).push(p);
    }
    for (const list of map.values()) {
      list.sort((a, b) => Number(pins.has(b.id)) - Number(pins.has(a.id)) || b.ovr - a.ovr);
    }
    return map;
  }, [state, team.roster, pins]);

  // Flat sorted view when a column sort is active.
  const flatRows = useMemo(() => {
    if (sortCol === "pos") return null;
    const key: Record<Exclude<RosterSortCol, "pos">, (p: Player) => number | string> = {
      name: (p) => p.name,
      yr: (p) => p.cls,
      ovr: (p) => p.ovr,
      dev: (p) => p.devTier,
      nil: (p) => p.nil,
      mor: (p) => p.morale,
    };
    const f = key[sortCol];
    return team.roster
      .map((pid) => state.players[pid])
      .sort((a, b) => {
        const [x, y] = [f(a), f(b)];
        const cmp = typeof x === "string" ? x.localeCompare(y as string) : (x as number) - (y as number);
        return cmp * sortDir || b.ovr - a.ovr;
      });
  }, [state, team.roster, sortCol, sortDir]);

  const clickSort = (col: RosterSortCol) => {
    if (col === sortCol) setSortDir((d) => (d === 1 ? -1 : 1));
    else {
      setSortCol(col);
      setSortDir(col === "name" ? 1 : -1);
    }
  };
  const sortTh = (col: RosterSortCol, label: string, extra = "") => (
    <th
      className={`${th} ${extra} cursor-pointer select-none hover:text-ink`}
      onClick={() => clickSort(col)}
      title={col === "pos" ? "Group by position" : `Sort by ${label}`}
    >
      {label}
      {sortCol === col ? (sortDir === -1 ? " ▾" : " ▴") : ""}
    </th>
  );

  const comparePair = compare.length === 2 ? (compare.map((pid) => state.players[pid]).filter(Boolean) as Player[]) : null;
  const toggleCompare = (pid: number) =>
    setCompare((c) => (c.includes(pid) ? c.filter((x) => x !== pid) : [...c.slice(-1), pid]));

  return (
    <div className="space-y-3">
      <NilHeader state={state} />
      {state.phase === "offseason" && onMutate && (
        <StaminaActionsBar state={state} onMutate={onMutate} />
      )}
      <DepthChart state={state} byGroup={byGroup} onSelect={setSel} />

      <Card
        title={`ROSTER · ${team.roster.length} PLAYERS`}
        tour="roster-table"
        bodyClassName="p-0"
        right={
          compare.length > 0 && (
            <span className="text-xs text-ink/60">
              comparing {compare.length}/2 — pick with the ⚖ column
            </span>
          )
        }
      >
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line bg-surface-sunken/50">
                {sortTh("name", "NAME")}
                {sortTh("pos", "POS")}
                {sortTh("yr", "YR")}
                {sortTh("ovr", "OVR")}
                {sortTh("dev", "DEV")}
                {sortTh("nil", "NIL", "hidden sm:table-cell")}
                {sortTh("mor", "MOR", "hidden sm:table-cell")}
                <th className={th}>STATUS</th>
                <th className={th} title="Compare two players">⚖</th>
                {canCut && <th className={th}></th>}
              </tr>
            </thead>
            {flatRows ? (
              <tbody>
                {flatRows.map((p) => (
                  <RosterRow
                    key={p.id}
                    p={p}
                    starter={false}
                    pins={pins}
                    onPin={onPin}
                    canCut={canCut}
                    onCut={onCut}
                    onSel={() => setSel(p)}
                    compared={compare.includes(p.id)}
                    onCompare={() => toggleCompare(p.id)}
                  />
                ))}
              </tbody>
            ) : (
              GROUP_ORDER.filter((g) => (byGroup.get(g)?.length ?? 0) > 0).map((g) => {
                const list = byGroup.get(g)!;
                const starters = STARTER_COUNT.get(g) ?? 1;
                return (
                  <tbody key={g}>
                    <tr>
                      <td colSpan={canCut ? 10 : 9} className="border-b border-line bg-surface-sunken/70 px-2 py-1">
                        <span className="font-display text-[11px] tracking-[0.2em] text-ink/70">
                          {GROUP_LABELS[g]}
                        </span>
                        <span className="ml-2 text-[10px] text-ink/45">{list.length}</span>
                      </td>
                    </tr>
                    {list.map((p, i) => (
                      <RosterRow
                        key={p.id}
                        p={p}
                        starter={i < starters}
                        pins={pins}
                        onPin={onPin}
                        canCut={canCut}
                        onCut={onCut}
                        onSel={() => setSel(p)}
                        compared={compare.includes(p.id)}
                        onCompare={() => toggleCompare(p.id)}
                      />
                    ))}
                  </tbody>
                );
              })
            )}
          </table>
        </div>
      </Card>

      {sel && <PlayerCard state={state} player={sel} onClose={() => setSel(null)} onMutate={onMutate} />}
      {comparePair && comparePair.length === 2 && (
        <CompareModal state={state} a={comparePair[0]} b={comparePair[1]} onClose={() => setCompare([])} />
      )}
    </div>
  );
}

function RosterRow({
  p, starter, pins, onPin, canCut, onCut, onSel, compared, onCompare,
}: {
  p: Player;
  starter: boolean;
  pins: Set<number>;
  onPin?: (pid: number) => void;
  canCut: boolean;
  onCut?: (pid: number) => void;
  onSel: () => void;
  compared: boolean;
  onCompare: () => void;
}) {
  return (
    <tr
      className="cursor-pointer border-b border-line/50 transition hover:bg-accent-soft/40"
      onClick={onSel}
      style={compared ? { boxShadow: "inset 3px 0 0 var(--accent)" } : undefined}
    >
      <td className={td}>
        <span className="flex items-center gap-1.5">
          {onPin && (
            <button
              type="button"
              title={pins.has(p.id) ? "Unpin from the starting lineup" : "Pin as starter"}
              className={pins.has(p.id) ? "" : "opacity-25 hover:opacity-70"}
              onClick={(e) => {
                e.stopPropagation();
                onPin(p.id);
              }}
            >
              📌
            </button>
          )}
          <span className="font-medium">{p.name}</span>
          {starter && <Pill tone="pos" className="!px-1.5 !py-0">ST</Pill>}
        </span>
      </td>
      <td className={`${td} font-display text-xs`}>{p.pos}</td>
      <td className={`${td} whitespace-nowrap text-ink/70`}>
        {p.rs ? "rs-" : ""}
        {CLASS_LABELS[p.cls] ?? p.cls}
      </td>
      <td className={`${td} font-display`}>{p.ovr}</td>
      <td className={td}><DevBadge tier={p.devTier} /></td>
      <td className={`${td} hidden font-mono text-xs sm:table-cell`}>{p.nil > 0 ? fmtMoney(p.nil) : "—"}</td>
      <td className={`${td} hidden font-mono text-xs sm:table-cell`}>
        <span className={p.morale <= 35 ? "text-neg" : ""}>{p.morale}</span>
      </td>
      <td className={`${td} text-xs`}>
        {p.inj > 0 ? <StatusText tone="neg">OUT {p.inj}w</StatusText> : <span className="text-ink/35">—</span>}
      </td>
      <td className={td}>
        <button
          type="button"
          title="Compare"
          className={compared ? "text-accent" : "opacity-30 hover:opacity-80"}
          onClick={(e) => {
            e.stopPropagation();
            onCompare();
          }}
        >
          ⚖
        </button>
      </td>
      {canCut && (
        <td className={td}>
          <button
            type="button"
            className="rounded border border-line px-1.5 py-0.5 text-[10px] font-bold text-neg transition hover:border-neg/50 hover:bg-neg-soft"
            onClick={(e) => {
              e.stopPropagation();
              if (window.confirm(`Cut ${p.name}?`)) onCut!(p.id);
            }}
          >
            CUT
          </button>
        </td>
      )}
    </tr>
  );
}

/** Offseason stamina sinks beyond recruiting (M1.4): the shared-pool tradeoff. */
function StaminaActionsBar({ state, onMutate }: { state: DynastyState; onMutate: () => void }) {
  const [flash, setFlash] = useState<string | null>(null);
  const run = (fn: () => string | null) => {
    const err = fn();
    if (err) {
      setFlash(err);
      window.setTimeout(() => setFlash(null), 2500);
    } else {
      onMutate();
    }
  };
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-card border border-line bg-surface-raised px-4 py-2.5">
      <div className="min-w-[140px]">
        <SectionLabel>STAMINA</SectionLabel>
        <p className="font-display text-sm">
          {state.stamina}
          <span className="text-ink/45"> / {staminaMax(state)}</span>
        </p>
      </div>
      <button
        type="button"
        disabled={state.stamina < STAMINA_COSTS.moraleTeam}
        onClick={() => run(() => boostMorale(state, null))}
        className="rounded-full border border-line px-3 py-1 font-display text-[10px] tracking-widest transition hover:border-ink/50 hover:bg-accent-soft disabled:opacity-30"
        title="+6 morale, whole roster"
      >
        🗣 TEAM MORALE TALK · {STAMINA_COSTS.moraleTeam}
      </button>
      <span className="text-[11px] text-ink/50">
        Develop &amp; 1-on-1 morale actions live on each player's card. Same pool as recruiting — spend it where it matters.
      </span>
      {flash && <StatusText tone="neg" className="rounded bg-neg-soft px-2 py-0.5 text-xs">{flash}</StatusText>}
    </div>
  );
}

function NilHeader({ state }: { state: DynastyState }) {
  const team = state.teams[state.userTid];
  const paid = team.roster.map((pid) => state.players[pid]).filter((p) => p && p.nil > 0);
  const payroll = paid.reduce((a, p) => a + p.nil, 0);
  const pool = team.nilBudget;
  const colors = getTeamColors(team);
  return (
    <Card accent={colors.primary} bodyClassName="p-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <SectionLabel>NIL PAYROLL</SectionLabel>
          <p className="mt-0.5 font-display text-2xl leading-none">{fmtMoney(payroll)}</p>
          <p className="mt-1 text-xs text-ink/55">{paid.length} players on NIL deals</p>
        </div>
        <div className="text-right">
          <SectionLabel>THIS CYCLE'S POOL</SectionLabel>
          <p className="mt-0.5 font-display text-2xl leading-none">{fmtMoney(pool)}</p>
          <p className="mt-1 text-xs text-ink/55">retention + portal budget</p>
        </div>
      </div>
      <Meter value={Math.min(payroll, pool)} max={pool || 1} color={colors.primary} className="mt-3" height={10} />
    </Card>
  );
}

/**
 * Football-field depth chart (V2.1) — the headline visual. Position clusters
 * sit in offense/defense/special bands on a turf cross-section; each cluster
 * shows its depth stack, starter chips in the program's colors.
 */
function DepthChart({
  state,
  byGroup,
  onSelect,
}: {
  state: DynastyState;
  byGroup: Map<PosGroup, Player[]>;
  onSelect: (p: Player) => void;
}) {
  const team = state.teams[state.userTid];
  const colors = getTeamColors(team);

  const band = (label: string, groups: PosGroup[]) => (
    <div>
      <div className="mb-2 flex items-center gap-2">
        <span className="font-display text-[10px] tracking-[0.3em] text-chalk/90 drop-shadow">{label}</span>
        <span className="h-px flex-1 bg-chalk/25" />
      </div>
      <div className="flex flex-wrap gap-2">
        {groups.map((g) => {
          const stack = byGroup.get(g) ?? [];
          const starters = STARTER_COUNT.get(g) ?? 1;
          return (
            <div key={g} className="min-w-[92px] flex-1 rounded-lg bg-black/25 p-2">
              <div className="mb-1 text-center font-display text-[11px] tracking-widest text-chalk/95">{g}</div>
              <div className="space-y-1">
                {stack.slice(0, Math.max(starters + 1, 2)).map((p, idx) => {
                  const isStarter = idx === 0;
                  return (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => onSelect(p)}
                      style={
                        isStarter
                          ? ({ ["--chip"]: colors.primary, ["--chip-ink"]: colors.onPrimary } as React.CSSProperties)
                          : undefined
                      }
                      className={`block w-full rounded px-1.5 py-1 text-left transition hover:brightness-110 ${
                        isStarter ? "gm-chip shadow" : "bg-chalk/90 text-ink"
                      }`}
                      title={`${p.name} · ${p.pos} · ${p.ovr} OVR`}
                    >
                      <span className="flex items-baseline justify-between gap-1">
                        <span className="truncate text-[11px] font-bold leading-tight">{p.name}</span>
                        <span className="font-display text-[11px] tabular-nums">{p.ovr}</span>
                      </span>
                      <span className="block text-[9px] uppercase tracking-wide opacity-80">
                        {p.rs ? "rs-" : ""}{CLASS_LABELS[p.cls] ?? p.cls}
                        {p.inj > 0 ? " · OUT" : isStarter ? " · starter" : " · depth"}
                      </span>
                    </button>
                  );
                })}
                {stack.length === 0 && (
                  <div className="rounded bg-black/20 px-1.5 py-1 text-center text-[10px] text-chalk/70">empty</div>
                )}
                {stack.length > Math.max(starters + 1, 2) && (
                  <div className="text-center text-[9px] text-chalk/70">
                    +{stack.length - Math.max(starters + 1, 2)} more
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );

  return (
    <Card title="DEPTH CHART" tour="depth-chart" bodyClassName="p-0">
      <div className="gm-field space-y-4 rounded-b-card p-4">
        {band("OFFENSE", OFFENSE)}
        {band("DEFENSE", DEFENSE)}
        {band("SPECIAL TEAMS", SPECIAL)}
      </div>
      <p className="px-4 py-2 text-[11px] text-ink/55">
        Program-colored chips are this week's starters (📌 pins override OVR). Tap any player for their card.
        Depth-chart editing arrives with the mechanical update.
      </p>
    </Card>
  );
}

export function DevBadge({ tier }: { tier: number }) {
  const styles = [
    "border-stone-400 text-stone-600",
    "border-slate-500 text-slate-700",
    "border-amber-500 text-amber-700",
    "border-purple-600 text-purple-800",
  ];
  return (
    <span className={`inline-block rounded border px-1 text-[10px] font-bold tracking-wide ${styles[tier]}`}>
      {DEV_TIER_LABELS[tier].toUpperCase()}
    </span>
  );
}

function PlayerCard({
  state,
  player,
  onClose,
  onMutate,
}: {
  state: DynastyState;
  player: Player;
  onClose: () => void;
  onMutate?: () => void;
}) {
  const [flash, setFlash] = useState<string | null>(null);
  const sheet = expandSheet(player);
  const colors = getTeamColors(state.teams[state.userTid]);
  const career = player.career;
  const peak = Math.max(player.ovr, ...career.map((c) => c.ovr));
  const floor = Math.min(player.ovr, ...career.map((c) => c.ovr));

  // Live draft projection vs all current draft-eligibles (M1.2).
  const eligibleOvrs = useMemo(
    () =>
      state.teams
        .filter((t) => t.p4)
        .flatMap((t) => t.roster.map((pid) => state.players[pid]))
        .filter((p) => p.cls >= 3)
        .map((p) => p.ovr),
    [state],
  );
  const draft = draftProjection(eligibleOvrs, player);

  // Scheme fit vs YOUR schemes (M1.2) — only meaningful for your own roster.
  const onUserRoster = state.teams[state.userTid].roster.includes(player.id);
  const { off, def } = teamScheme(state, state.userTid);
  const fit = onUserRoster ? playerSchemeFit(player, off, def) : 0;
  const fitLabel = fit > 0.25 ? "Great fit" : fit > 0.05 ? "Good fit" : fit < -0.25 ? "Poor fit" : fit < -0.05 ? "Stretch" : "Neutral";

  // Usage proxy (M1.2): offensive touches as a share of the team's.
  const touches = player.stats.paAtt + player.stats.ruAtt + player.stats.rec;
  const teamTouches = state.teams[state.userTid].roster
    .map((pid) => state.players[pid])
    .reduce((a, p) => a + p.stats.paAtt + p.stats.ruAtt + p.stats.rec, 0);

  const canAct = onMutate && onUserRoster && state.phase === "offseason";
  const run = (fn: () => string | null) => {
    const err = fn();
    if (err) {
      setFlash(err);
      window.setTimeout(() => setFlash(null), 2500);
    } else {
      onMutate!();
    }
  };
  return (
    <Modal onClose={onClose}>
      {/* Header band in program colors */}
      <div className="-mx-5 -mt-5 mb-4 flex items-center justify-between px-5 py-4" style={{ background: colors.primary, color: colors.onPrimary }}>
        <div>
          <h3 className="font-display text-2xl leading-none">{player.name}</h3>
          <p className="mt-1 text-sm opacity-90">
            {player.pos} · {CLASS_LABELS[player.cls] ?? player.cls}
            {player.rs ? " (rs)" : ""} · {"★".repeat(player.stars)}
          </p>
        </div>
        <div className="text-right">
          <div className="font-display text-4xl leading-none">{player.ovr}</div>
          <div className="text-[10px] uppercase tracking-widest opacity-80">Overall</div>
        </div>
      </div>

      {/* Vitals row */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Vital label="Dev"><DevBadge tier={player.devTier} /></Vital>
        <Vital label="Morale">
          <span className={player.morale <= 35 ? "text-neg" : ""}>{player.morale}</span>
          <Meter value={player.morale} max={100} color={player.morale <= 35 ? "var(--neg)" : "var(--pos)"} height={5} className="mt-1" />
        </Vital>
        <Vital label="NIL">{player.nil > 0 ? fmtMoney(player.nil) : "unpaid"}</Vital>
        <Vital label="Market">{fmtMoney(marketValue(player))}</Vital>
        <Vital label="Draft stock">{draft ?? <span className="text-ink/45">off the board</span>}</Vital>
        {onUserRoster && (
          <Vital label={`Fit · ${OFF_LABELS[off]}`}>
            <StatusText tone={fit > 0.05 ? "pos" : fit < -0.05 ? "neg" : "neu"}>{fitLabel}</StatusText>
          </Vital>
        )}
        <Vital label="Usage">
          {touches > 0 && teamTouches > 0 ? (
            <>
              {touches} touches <span className="text-ink/50">· {Math.round((touches / teamTouches) * 100)}% of team</span>
            </>
          ) : (
            <span className="text-ink/45">—</span>
          )}
          <div className="text-[9px] font-normal text-ink/40">derived from stats, not snaps</div>
        </Vital>
      </div>
      {player.inj > 0 && (
        <p className="mt-2">
          <Pill tone="neg">OUT {player.inj} week{player.inj > 1 ? "s" : ""}</Pill>
        </p>
      )}

      {/* Offseason stamina actions (M1.4) — the shared-pool tradeoff, per player. */}
      {canAct && (
        <div className="mt-3 flex flex-wrap items-center gap-2 rounded-lg border border-line bg-surface-sunken/40 px-3 py-2">
          <span className="font-display text-[10px] tracking-widest text-ink/50">
            STAMINA {state.stamina}
          </span>
          <button
            type="button"
            disabled={state.stamina < STAMINA_COSTS.develop || player.ovr >= player.ceil}
            onClick={() => run(() => developPlayer(state, player.id))}
            className="rounded-full border border-line px-3 py-1 font-display text-[10px] tracking-widest transition hover:border-ink/50 hover:bg-accent-soft disabled:opacity-30"
            title="Coach them up — an immediate step toward their ceiling"
          >
            📈 DEVELOP · {STAMINA_COSTS.develop}
          </button>
          <button
            type="button"
            disabled={state.stamina < STAMINA_COSTS.moraleTarget}
            onClick={() => run(() => boostMorale(state, player.id))}
            className="rounded-full border border-line px-3 py-1 font-display text-[10px] tracking-widest transition hover:border-ink/50 hover:bg-accent-soft disabled:opacity-30"
            title="+18 morale, this player"
          >
            🗣 1-ON-1 · {STAMINA_COSTS.moraleTarget}
          </button>
          {player.ovr >= player.ceil && <span className="text-[10px] text-ink/45">at their ceiling</span>}
          {flash && <StatusText tone="neg" className="text-xs">{flash}</StatusText>}
        </div>
      )}

      {(player.accolades?.length || player.injHist?.length) ? (
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          {player.accolades && player.accolades.length > 0 && (
            <div>
              <SectionLabel>ACCOLADES</SectionLabel>
              <ul className="mt-1 space-y-0.5 text-sm">
                {player.accolades.map((a, i) => (
                  <li key={i}>
                    🎖️ {a.season} — {a.award}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {player.injHist && player.injHist.length > 0 && (
            <div>
              <SectionLabel>INJURY HISTORY</SectionLabel>
              <ul className="mt-1 space-y-0.5 text-sm">
                {player.injHist.map((h, i) => (
                  <li key={i} className="text-ink/70">
                    {h.season} — out {h.weeks >= 15 ? "for the season" : `${h.weeks} wk${h.weeks > 1 ? "s" : ""}`}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      ) : null}

      <SectionLabel className="mt-5">RATINGS</SectionLabel>
      <div className="mt-1.5 grid grid-cols-2 gap-x-6 gap-y-1 text-sm sm:grid-cols-3">
        {sheet.map((e) => (
          <div key={e.label} className="flex items-center justify-between gap-2 border-b border-line/40 pb-0.5">
            <span className="text-xs text-ink/65">{e.label}</span>
            <span className="font-mono font-bold">{e.value}</span>
          </div>
        ))}
      </div>

      <SectionLabel className="mt-5">{state.season} SEASON</SectionLabel>
      <p className="mt-1 text-sm">{statLine(player) || "No stats yet."}</p>

      {career.length > 0 && (
        <>
          <SectionLabel className="mt-5">CAREER PROGRESSION</SectionLabel>
          <ProgressionBars career={career} current={{ season: state.season, ovr: player.ovr }} floor={floor} peak={peak} />
          <table className="mt-3 w-full text-xs">
            <thead>
              <tr className="border-b border-line text-ink/50">
                <th className={th}>YEAR</th>
                <th className={th}>YR</th>
                <th className={th}>OVR</th>
                <th className={th}>LINE</th>
              </tr>
            </thead>
            <tbody>
              {career.map((c) => (
                <tr key={c.season} className="border-b border-line/50">
                  <td className={td}>{c.season}</td>
                  <td className={td}>{CLASS_LABELS[c.cls] ?? c.cls}</td>
                  <td className={`${td} font-display`}>{c.ovr}</td>
                  <td className={td}>{careerLine(c) || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </Modal>
  );
}

/** Side-by-side player comparison (M1.2) — the roster note that survived. */
function CompareModal({ state, a, b, onClose }: { state: DynastyState; a: Player; b: Player; onClose: () => void }) {
  const colors = getTeamColors(state.teams[state.userTid]);
  const sheets = [expandSheet(a), expandSheet(b)];
  const labels = sheets[0].map((e) => e.label);
  const num = (v: number | string) => (typeof v === "number" ? v : parseInt(String(v), 10) || 0);
  const row = (label: string, va: React.ReactNode, vb: React.ReactNode, hiA = false, hiB = false) => (
    <tr key={label} className="border-b border-line/40">
      <td className={`${td} text-right font-bold ${hiA ? "text-pos" : ""}`}>{va}</td>
      <td className={`${td} text-center text-xs text-ink/55`}>{label}</td>
      <td className={`${td} font-bold ${hiB ? "text-pos" : ""}`}>{vb}</td>
    </tr>
  );
  return (
    <Modal onClose={onClose}>
      <div className="-mx-5 -mt-5 mb-4 grid grid-cols-2 px-5 py-4" style={{ background: colors.primary, color: colors.onPrimary }}>
        {[a, b].map((p, i) => (
          <div key={p.id} className={i === 0 ? "text-right pr-4" : "pl-4"}>
            <h3 className="font-display text-xl leading-none">{p.name}</h3>
            <p className="mt-1 text-xs opacity-90">
              {p.pos} · {CLASS_LABELS[p.cls] ?? p.cls} · <span className="font-display text-lg">{p.ovr}</span>
            </p>
          </div>
        ))}
      </div>
      <table className="w-full text-sm">
        <tbody>
          {row("OVR", a.ovr, b.ovr, a.ovr > b.ovr, b.ovr > a.ovr)}
          {row("DEV", <DevBadge tier={a.devTier} />, <DevBadge tier={b.devTier} />, a.devTier > b.devTier, b.devTier > a.devTier)}
          {row("MORALE", a.morale, b.morale, a.morale > b.morale, b.morale > a.morale)}
          {row("NIL", a.nil > 0 ? fmtMoney(a.nil) : "—", b.nil > 0 ? fmtMoney(b.nil) : "—", a.nil > b.nil, b.nil > a.nil)}
          {row("MARKET", fmtMoney(marketValue(a)), fmtMoney(marketValue(b)), marketValue(a) > marketValue(b), marketValue(b) > marketValue(a))}
          {labels.map((label, i) =>
            row(
              label,
              sheets[0][i].value,
              sheets[1][i]?.value ?? "—",
              num(sheets[0][i].value) > num(sheets[1][i]?.value ?? 0),
              num(sheets[1][i]?.value ?? 0) > num(sheets[0][i].value),
            ),
          )}
          {row("SEASON", statLine(a) || "—", statLine(b) || "—")}
        </tbody>
      </table>
      {a.g !== b.g && (
        <p className="mt-2 text-[11px] text-ink/50">
          Different position groups — the ratings sheets don't line up one-to-one.
        </p>
      )}
    </Modal>
  );
}

function Vital({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-line/70 bg-surface-sunken/50 p-2">
      <div className="text-[10px] uppercase tracking-widest text-ink/50">{label}</div>
      <div className="mt-0.5 text-sm font-bold">{children}</div>
    </div>
  );
}

function ProgressionBars({
  career,
  current,
  floor,
  peak,
}: {
  career: { season: number; ovr: number }[];
  current: { season: number; ovr: number };
  floor: number;
  peak: number;
}) {
  const points = career.some((c) => c.season === current.season) ? career : [...career, current];
  const span = Math.max(1, peak - floor);
  return (
    <div className="mt-1.5 flex items-end gap-2">
      {points.map((c) => {
        const h = 16 + ((c.ovr - floor) / span) * 44;
        return (
          <div key={c.season} className="flex flex-1 flex-col items-center gap-1">
            <span className="font-display text-[11px]">{c.ovr}</span>
            <div className="w-full rounded-t bg-accent/80" style={{ height: h }} />
            <span className="text-[10px] text-ink/50">'{String(c.season).slice(2)}</span>
          </div>
        );
      })}
    </div>
  );
}

interface AnyLine {
  gp: number; paYd: number; paTD: number; paInt: number; ruYd: number; ruTD: number;
  rec: number; reYd: number; reTD: number; tkl: number; sck: number; int: number;
  fgm: number; fga: number;
}

function careerLine(s: AnyLine): string {
  const bits: string[] = [];
  if (s.paYd) bits.push(`${s.paYd} pass yds, ${s.paTD} TD, ${s.paInt} INT`);
  if (s.ruYd > 50) bits.push(`${s.ruYd} rush yds, ${s.ruTD} TD`);
  if (s.rec) bits.push(`${s.rec} rec, ${s.reYd} yds, ${s.reTD} TD`);
  if (s.tkl > 5) bits.push(`${s.tkl} tkl`);
  if (s.sck) bits.push(`${s.sck} sacks`);
  if (s.int) bits.push(`${s.int} INT`);
  if (s.fga) bits.push(`${s.fgm}/${s.fga} FG`);
  return bits.join(" · ");
}

function statLine(p: Player): string {
  return careerLine(p.stats);
}

// --- Schedule ------------------------------------------------------------------

export function SchedulePanel({ state }: { state: DynastyState }) {
  const [boxFor, setBoxFor] = useState<GameResult | null>(null);
  const games = userGames(state);
  const rivals = new Set(state.teams[state.userTid].rivals ?? []);
  const nextId = state.phase === "regular" ? games.find((g) => !g.result)?.game.id : undefined;
  return (
    <Card
      title={`${state.season} SCHEDULE · ${school(state, state.userTid)}`}
      tour="schedule-table"
      bodyClassName="p-0"
    >
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-line bg-surface-sunken/50">
              <th className={th}>WK</th>
              <th className={th}>OPPONENT</th>
              <th className={th}>RESULT</th>
              <th className={th}></th>
            </tr>
          </thead>
          <tbody>
            {games.map(({ game, result }) => {
              const home = game.home === state.userTid;
              const opp = home ? game.away : game.home;
              const us = result ? (home ? result.hs : result.as) : null;
              const them = result ? (home ? result.as : result.hs) : null;
              const rival = rivals.has(opp);
              const win = us != null && them != null && us > them;
              const isNext = game.id === nextId;
              return (
                <tr
                  key={game.id}
                  className="border-b border-line/50"
                  style={
                    isNext
                      ? { boxShadow: "inset 3px 0 0 var(--gold)", background: "color-mix(in srgb, var(--gold) 8%, transparent)" }
                      : rival
                        ? { boxShadow: "inset 3px 0 0 var(--accent)" }
                        : undefined
                  }
                >
                  <td className={`${td} font-display text-ink/60`}>{game.week}</td>
                  <td className={td}>
                    <span className="flex flex-wrap items-center gap-1.5">
                      <span className="text-ink/55">{home ? "vs" : "at"}</span>
                      <TeamRef state={state} tid={opp} />
                      {rival && <Pill tone="accent">RIVALRY</Pill>}
                      {game.name && <span className="text-xs text-ink/55">{game.name}</span>}
                      {game.conf && <Pill tone="neu">CONF</Pill>}
                    </span>
                  </td>
                  <td className={`${td} whitespace-nowrap`}>
                    {result ? (
                      // Outcome-colored scoreboard numerals (V1 hierarchy).
                      <StatusText tone={win ? "pos" : "neg"} className="font-display text-base">
                        {win ? "W" : "L"} {us}–{them}{result.ot > 0 ? ` (${result.ot}OT)` : ""}
                      </StatusText>
                    ) : isNext ? (
                      <span className="font-display text-[10px] tracking-[0.2em] text-gold">NEXT UP</span>
                    ) : (
                      <span className="text-ink/35">—</span>
                    )}
                  </td>
                  <td className={td}>
                    {result?.box && (
                      <button
                        type="button"
                        className="text-xs font-bold text-accent hover:underline"
                        onClick={() => setBoxFor(result)}
                      >
                        Box
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {boxFor && <BoxModal state={state} result={boxFor} onClose={() => setBoxFor(null)} />}
    </Card>
  );
}

function BoxModal({ state, result, onClose }: { state: DynastyState; result: GameResult; onClose: () => void }) {
  const [showDrives, setShowDrives] = useState(false);
  return (
    <Modal onClose={onClose}>
      <h3 className="font-display text-xl">
        {school(state, result.away)} {result.as} — {result.hs} {school(state, result.home)}
        {result.ot > 0 ? ` (${result.ot}OT)` : ""}
      </h3>
      {result.name && <p className="text-xs text-ink/55">{result.name}</p>}
      {result.totals && (
        <p className="mt-1 text-xs text-ink/70">
          {school(state, result.away)}: {result.totals.a.yd} yds ({result.totals.a.py} pass · {result.totals.a.ry} rush),{" "}
          {result.totals.a.to} TO — {school(state, result.home)}: {result.totals.h.yd} yds ({result.totals.h.py} pass ·{" "}
          {result.totals.h.ry} rush), {result.totals.h.to} TO
        </p>
      )}
      {result.star && <p className="mt-1 text-sm">⭐ {result.star}</p>}

      {result.box && (
        <>
          <SectionLabel className="mt-4">BOX SCORE</SectionLabel>
          {[result.away, result.home].map((tid) => {
            const lines = result.box!.filter((b) => b.t === tid);
            if (!lines.length) return null;
            return (
              <div key={tid} className="mt-2">
                <p className="font-display text-sm"><TeamName team={state.teams[tid]} /></p>
                <ul className="mt-1 space-y-0.5 text-xs">
                  {lines.map((b) => (
                    <li key={b.pid}>
                      <span className="font-bold">{b.name}</span> <span className="text-ink/55">{b.pos}</span> — {b.line}
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </>
      )}

      {result.drives && (
        <>
          <button
            type="button"
            className="mt-4 text-xs font-bold text-accent hover:underline"
            onClick={() => setShowDrives(!showDrives)}
          >
            {showDrives ? "Hide" : "Show"} drive log ({result.drives.length} drives)
          </button>
          {showDrives && (
            <ul className="mt-2 max-h-64 space-y-0.5 overflow-y-auto text-xs">
              {result.drives.map((d, i) => (
                <li key={i}>
                  <span className="mr-1 rounded bg-surface-sunken px-1 text-[10px]">Q{d.q}</span>
                  <span className="font-bold">{school(state, d.t)}</span>: {d.r} — {d.d} ({d.y} yds)
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </Modal>
  );
}

// --- Standings -----------------------------------------------------------------

export function StandingsPanel({ state }: { state: DynastyState }) {
  const [viewTid, setViewTid] = useState<number | null>(null);
  return (
    <div className="grid gap-3 md:grid-cols-2" data-tour="standings-grid">
      {viewTid !== null && <TeamPage state={state} tid={viewTid} onClose={() => setViewTid(null)} />}
      {p4Conferences(state.teams).map((conf) => (
        <Card key={conf} title={conf.toUpperCase()} bodyClassName="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line bg-surface-sunken/50">
                  <th className={th}>TEAM</th>
                  <th className={th}>CONF</th>
                  <th className={th}>OVERALL</th>
                  <th className={th}>PF-PA</th>
                </tr>
              </thead>
              <tbody>
                {confStandings(state.teams, conf).map((t) => (
                  <tr
                    key={t.id}
                    className="cursor-pointer border-b border-line/50 transition hover:bg-accent-soft/30"
                    onClick={() => setViewTid(t.id)}
                    title={`Open ${t.school}'s team page`}
                    style={
                      t.id === state.userTid
                        ? {
                            boxShadow: `inset 3px 0 0 ${getTeamColors(t).primary}`,
                            background: `color-mix(in srgb, ${getTeamColors(t).primary} 7%, transparent)`,
                          }
                        : undefined
                    }
                  >
                    <td className={td}><TeamRef state={state} tid={t.id} /></td>
                    <td className={td}>{t.rec.cw}-{t.rec.cl}</td>
                    <td className={td}>{t.rec.w}-{t.rec.l}</td>
                    <td className={`${td} text-xs text-ink/60`}>{t.rec.pf}-{t.rec.pa}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      ))}
    </div>
  );
}

// --- Team page (M1.5): any team, their season at a glance ----------------------

/** Full team page modal: identity, record, scheme, and season results. */
export function TeamPage({ state, tid, onClose }: { state: DynastyState; tid: number; onClose: () => void }) {
  const t = state.teams[tid];
  const colors = getTeamColors(t);
  const games = teamGames(state, tid);
  const rank = rankOf(state, tid);
  const { off, def } = t.p4 ? teamScheme(state, tid) : { off: null, def: null };
  return (
    <Modal onClose={onClose}>
      <div className="-mx-5 -mt-5 mb-4 flex items-center gap-3 px-5 py-4" style={{ background: colors.primary, color: colors.onPrimary }}>
        <TeamMark team={t} size="l" />
        <div>
          <h3 className="font-display text-2xl leading-none">
            {rank > 0 && <span className="mr-1 opacity-70">#{rank}</span>}
            {t.school}
          </h3>
          <p className="mt-1 text-sm opacity-90">
            {t.rec.w}-{t.rec.l} ({t.rec.cw}-{t.rec.cl} {t.conference}) · {"★".repeat(t.prestige)}
            {off && def ? ` · ${OFF_LABELS[off]} / ${DEF_LABELS[def]}` : ""}
          </p>
        </div>
      </div>
      <SectionLabel>{state.season} SCHEDULE &amp; RESULTS</SectionLabel>
      <ul className="mt-1.5 space-y-1 text-sm">
        {games.map(({ game, result }) => {
          const home = game.home === tid;
          const oppTid = home ? game.away : game.home;
          const opp = state.teams[oppTid];
          if (!result) {
            return (
              <li key={game.id} className="flex items-center gap-2 text-ink/60">
                <span className="w-10 font-display text-xs text-ink/45">WK {game.week}</span>
                <span>{home ? "vs" : "at"}</span>
                <TeamName team={opp} />
                {game.name && <span className="text-xs text-ink/45">· {game.name}</span>}
              </li>
            );
          }
          const us = home ? result.hs : result.as;
          const them = home ? result.as : result.hs;
          const won = us > them;
          return (
            <li key={game.id} className="flex items-center gap-2">
              <span className="w-10 font-display text-xs text-ink/45">WK {game.week}</span>
              <StatusText tone={won ? "pos" : "neg"} className="w-4 font-display">{won ? "W" : "L"}</StatusText>
              <span className="font-mono text-xs">{us}-{them}{result.ot > 0 ? ` ${result.ot}OT` : ""}</span>
              <span className="text-ink/60">{home ? "vs" : "at"}</span>
              <TeamName team={opp} />
              {game.name && <span className="text-xs text-ink/45">· {game.name}</span>}
            </li>
          );
        })}
        {games.length === 0 && <li className="text-ink/55">No games scheduled{t.p4 ? "" : " — buy-game shell opponent"}.</li>}
      </ul>
    </Modal>
  );
}

// --- Top 25 (merged rankings + postseason, V5) ---------------------------------

export function RankingsPanel({ state }: { state: DynastyState }) {
  const [viewTid, setViewTid] = useState<number | null>(null);
  return (
    <div className="space-y-3">
      <Top25Card state={state} onTeam={setViewTid} />
      <PostseasonSection state={state} />
      {viewTid !== null && <TeamPage state={state} tid={viewTid} onClose={() => setViewTid(null)} />}
    </div>
  );
}

function Top25Card({ state, onTeam }: { state: DynastyState; onTeam: (tid: number) => void }) {
  const rows = state.poll.slice(0, 25).map((e, i) => ({ e, rank: i + 1 }));
  const hopefuls = rows.slice(0, 12);
  const rest = rows.slice(12);
  const rankRow = ({ e, rank }: { e: DynastyState["poll"][number]; rank: number }) => {
    const t = state.teams[e.tid];
    const self = e.tid === state.userTid;
    return (
      <li
        key={e.tid}
        className="flex cursor-pointer items-center gap-2 break-inside-avoid rounded px-1 py-0.5 transition hover:bg-accent-soft/40"
        onClick={() => onTeam(e.tid)}
        title={`Open ${t.school}'s team page`}
        style={
          self
            ? {
                boxShadow: `inset 3px 0 0 ${getTeamColors(t).primary}`,
                background: `color-mix(in srgb, ${getTeamColors(t).primary} 7%, transparent)`,
              }
            : undefined
        }
      >
        <span className="w-6 text-right font-display text-ink/45">{rank}</span>
        <TeamName team={t} lead={self} />
        <span className="text-xs text-ink/50">{t.rec.w}-{t.rec.l}</span>
        <span className="ml-auto text-xs"><Delta prev={e.prev} rank={rank} /></span>
      </li>
    );
  };
  return (
    <Card title={`TOP 25 · ${state.season}`} tour="poll">
      <div className="rounded-lg border border-pos/30 bg-pos-soft/40 p-3">
        <div className="mb-1.5 flex items-center gap-2">
          <SectionLabel className="!text-pos">🏈 PLAYOFF HOPEFULS · TOP 12</SectionLabel>
          <span className="h-px flex-1 bg-pos/20" />
        </div>
        <ol className="gap-x-8 text-sm sm:columns-2">{hopefuls.map(rankRow)}</ol>
      </div>
      <div className="mt-3 px-1">
        <div className="mb-1.5 flex items-center gap-2">
          <SectionLabel>13 – 25 · IN THE HUNT</SectionLabel>
          <span className="h-px flex-1 bg-line" />
        </div>
        <ol className="gap-x-8 text-sm sm:columns-2">{rest.map(rankRow)}</ol>
      </div>
    </Card>
  );
}

function PostseasonSection({ state }: { state: DynastyState }) {
  // Pre-bracket: the committee's live projected field, drawn as a bracket.
  if (!state.cfp) {
    const proj = committeeOrder(state.teams).slice(0, 12);
    return (
      <Card title="CFP PROJECTION" tour="cfp" right={<Pill tone="neu">LIVE · 12-TEAM</Pill>}>
        <p className="mb-3 text-xs text-ink/55">
          The committee's current 12 — 4 conference champions auto-bid at season's end.
        </p>
        <CfpBracket state={state} field={proj} results={[]} champion={null} />
      </Card>
    );
  }

  const bowls = state.results.filter((r) => r.kind === "bowl");
  return (
    <>
      <Card
        title="CFP BRACKET"
        tour="cfp"
        right={state.cfp.champion !== null ? <Pill tone="accent">🏆 CHAMPION CROWNED</Pill> : undefined}
      >
        {state.cfp.champion !== null && (
          <p className="mb-3 rounded-lg px-3 py-2 font-display" style={{ background: "var(--pos-soft)", color: "var(--pos)" }}>
            🏆 <TeamName team={state.teams[state.cfp.champion]} /> — National Champions
          </p>
        )}
        <CfpBracket state={state} field={state.cfp.field} results={state.cfp.results} champion={state.cfp.champion} />
      </Card>
      <Card title="BOWL SEASON">
        <ul className="space-y-1.5 text-sm">
          {bowls.map((r) => (
            <li key={r.gid} className="flex flex-wrap items-baseline gap-x-2">
              <span className="text-xs text-ink/55">{r.name}:</span>
              <ScoreInline state={state} r={r} />
            </li>
          ))}
          {bowls.length === 0 && <li className="text-xs text-ink/55">Bowls play in playoff week 1.</li>}
        </ul>
      </Card>
    </>
  );
}

// The fixed 12-team bracket order (byes fold into round 1 → a clean 8→4→2→1
// tree). Each pair = a top-4 bye seed + the first-round matchup that feeds it.
const BRACKET_PAIRS: { bye: number; r1: [number, number] }[] = [
  { bye: 1, r1: [8, 9] },
  { bye: 4, r1: [5, 12] },
  { bye: 2, r1: [7, 10] },
  { bye: 3, r1: [6, 11] },
];

function findResult(results: GameResult[], a: number, b: number): GameResult | null {
  return results.find((r) => (r.home === a && r.away === b) || (r.home === b && r.away === a)) ?? null;
}
function winnerOf(r: GameResult): number {
  return r.hs >= r.as ? r.home : r.away;
}

function CfpBracket({
  state,
  field,
  results,
  champion,
}: {
  state: DynastyState;
  field: number[];
  results: GameResult[];
  champion: number | null;
}) {
  const seed = (n: number): number | undefined => field[n - 1];
  const r1res = results.filter((r) => r.kind === "cfp-r1");
  const qfres = results.filter((r) => r.kind === "cfp-qf");
  const sfres = results.filter((r) => r.kind === "cfp-sf");
  const ncres = results.filter((r) => r.kind === "cfp-nc");

  // Round 1 column: 8 slots (bye seed, then its feeder matchup), pair by pair.
  const r1slots = BRACKET_PAIRS.flatMap((p) => {
    const [aS, bS] = p.r1;
    const a = seed(aS);
    const b = seed(bS);
    const res = a != null && b != null ? findResult(r1res, a, b) : null;
    return [
      { kind: "bye" as const, tids: [seed(p.bye)], seeds: [p.bye], res: null },
      { kind: "match" as const, tids: [a, b], seeds: [aS, bS], res },
    ];
  });

  // Quarterfinals: bye seed vs round-1 winner, one per pair.
  const qfMatches = BRACKET_PAIRS.map((p) => {
    const byeTid = seed(p.bye);
    const [aS, bS] = p.r1;
    const a = seed(aS);
    const b = seed(bS);
    const r1 = a != null && b != null ? findResult(r1res, a, b) : null;
    const r1w = r1 ? winnerOf(r1) : undefined;
    const res = byeTid != null && r1w != null ? findResult(qfres, byeTid, r1w) : null;
    return { tids: [byeTid, r1w], res, byeTid };
  });

  // Semifinals: top pair (0,1) and bottom pair (2,3) of the QF.
  const sfMatches = [[0, 1], [2, 3]].map((pair) => {
    const w0 = qfMatches[pair[0]].res ? winnerOf(qfMatches[pair[0]].res!) : undefined;
    const w1 = qfMatches[pair[1]].res ? winnerOf(qfMatches[pair[1]].res!) : undefined;
    const res = w0 != null && w1 != null ? findResult(sfres, w0, w1) : null;
    return { tids: [w0, w1], res };
  });

  const ncW0 = sfMatches[0].res ? winnerOf(sfMatches[0].res!) : undefined;
  const ncW1 = sfMatches[1].res ? winnerOf(sfMatches[1].res!) : undefined;
  const ncMatch = { tids: [ncW0, ncW1], res: ncW0 != null && ncW1 != null ? findResult(ncres, ncW0, ncW1) : null };

  return (
    <div className="overflow-x-auto">
      <div className="gm-bracket flex min-w-[640px] gap-0">
        <BracketRound label="First Round" first>
          {r1slots.map((s, i) => (
            <BracketMatch key={i} state={state} tids={s.tids} seeds={s.seeds} res={s.res} bye={s.kind === "bye"} champion={champion} />
          ))}
        </BracketRound>
        <BracketRound label="Quarterfinals">
          {qfMatches.map((m, i) => (
            <BracketMatch key={i} state={state} tids={m.tids} res={m.res} champion={champion} />
          ))}
        </BracketRound>
        <BracketRound label="Semifinals">
          {sfMatches.map((m, i) => (
            <BracketMatch key={i} state={state} tids={m.tids} res={m.res} champion={champion} />
          ))}
        </BracketRound>
        <BracketRound label="Championship" last>
          <BracketMatch state={state} tids={ncMatch.tids} res={ncMatch.res} champion={champion} />
        </BracketRound>
      </div>
    </div>
  );
}

function BracketRound({
  label,
  children,
  first,
  last,
}: {
  label: string;
  children: React.ReactNode;
  first?: boolean;
  last?: boolean;
}) {
  return (
    <div className="flex flex-1 flex-col">
      <div className="mb-2 text-center font-display text-[10px] tracking-[0.2em] text-ink/50">{label}</div>
      <div className={`flex flex-1 flex-col ${last ? "" : "gm-bracket-feeds"} ${first ? "" : "gm-bracket-fed"}`}>
        {children}
      </div>
    </div>
  );
}

function BracketMatch({
  state,
  tids,
  seeds,
  res,
  bye,
  champion,
}: {
  state: DynastyState;
  tids: (number | undefined)[];
  seeds?: number[];
  res: GameResult | null;
  bye?: boolean;
  champion?: number | null;
}) {
  const winner = res ? winnerOf(res) : null;
  const row = (tid: number | undefined, idx: number) => {
    if (tid == null) {
      return (
        <div key={idx} className="flex items-center justify-between gap-1 px-2 py-1 text-xs text-ink/35">
          <span>{seeds ? `Seed ${seeds[idx]}` : "TBD"}</span>
        </div>
      );
    }
    const t = state.teams[tid];
    const isW = winner === tid;
    const isChamp = champion != null && champion === tid;
    const sc = res ? (res.home === tid ? res.hs : res.as) : null;
    return (
      <div
        key={idx}
        className={`flex items-center justify-between gap-1 px-2 py-1 text-xs ${isW ? "bg-pos-soft/50" : ""}`}
      >
        <span className="flex items-center gap-1 truncate">
          {seeds && <span className="text-ink/40">{seeds[idx]}</span>}
          <TeamName team={t} lead={isW || isChamp} markSize="xs" />
          {isChamp && <span>🏆</span>}
        </span>
        {sc != null && <span className={`font-display tabular-nums ${isW ? "text-pos" : "text-ink/45"}`}>{sc}</span>}
      </div>
    );
  };
  return (
    <div className="gm-bracket-match relative flex flex-1 flex-col justify-center px-3">
      <div className={`rounded-lg border ${bye ? "border-dashed border-line/60 bg-surface-sunken/40" : "border-line bg-surface-raised"} shadow-card`}>
        {bye ? (
          <div className="flex items-center justify-between px-2 py-1.5 text-xs">
            <span className="flex items-center gap-1">
              {seeds && <span className="text-ink/40">{seeds[0]}</span>}
              {tids[0] != null ? <TeamName team={state.teams[tids[0]]} markSize="xs" /> : "TBD"}
            </span>
            <span className="text-[9px] uppercase tracking-widest text-ink/40">bye</span>
          </div>
        ) : (
          <>
            {row(tids[0], 0)}
            <div className="border-t border-line/60" />
            {row(tids[1], 1)}
          </>
        )}
      </div>
    </div>
  );
}

function ScoreInline({ state, r }: { state: DynastyState; r: GameResult }) {
  const winHome = r.hs > r.as;
  return (
    <span className="text-sm">
      <TeamName team={state.teams[r.away]} lead={!winHome} /> <span className="tabular-nums">{r.as}</span>
      <span className="mx-1 text-ink/40">—</span>
      <span className="tabular-nums">{r.hs}</span> <TeamName team={state.teams[r.home]} lead={winHome} />
      {r.ot > 0 ? ` (${r.ot}OT)` : ""}
    </span>
  );
}

// --- History -----------------------------------------------------------------

export function HistoryPanel({ state, slotId }: { state: DynastyState; slotId: number }) {
  const [rows, setRows] = useState<ArchiveRow[] | null>(null);
  useEffect(() => {
    archiveFor(slotId).then(setRows, () => setRows([]));
  }, [slotId, state.season]);

  const legends = useMemo(() => {
    if (!rows) return [];
    return rows
      .filter((r) => r.player.tid === state.userTid)
      .map((r) => {
        const tot = r.player.career.reduce(
          (a, c) => a + c.paYd * 0.04 + c.paTD * 6 + c.ruYd * 0.09 + c.ruTD * 6 + c.reYd * 0.09 + c.reTD * 6 + c.sck * 7 + c.int * 8 + c.tkl * 0.35,
          0,
        );
        return { ...r, value: tot };
      })
      .sort((a, b) => b.value - a.value)
      .slice(0, 15);
  }, [rows, state.userTid]);

  return (
    <div className="grid gap-3 md:grid-cols-2">
      <TrophyCase state={state} />
      <Card title="SEASON LEDGER" tour="history-ledger" bodyClassName="p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line bg-surface-sunken/50">
                <th className={th}>SEASON</th>
                <th className={th}>CHAMPION</th>
                <th className={th}>YOU</th>
                <th className={th}>POY</th>
              </tr>
            </thead>
            <tbody>
              {[...state.honors].reverse().map((h) => (
                <tr key={h.season} className="border-b border-line/50 align-top">
                  <td className={`${td} font-display`}>{h.season}</td>
                  <td className={td}>{h.champion !== null ? <TeamName team={state.teams[h.champion]} /> : "—"}</td>
                  <td className={td}>
                    {h.userRecord}
                    {h.userPollRank ? ` · #${h.userPollRank}` : ""}
                  </td>
                  <td className={`${td} text-xs`}>{h.poy ?? "—"}</td>
                </tr>
              ))}
              {state.honors.length === 0 && (
                <tr>
                  <td className={td} colSpan={4}>
                    <span className="text-xs text-ink/55">Finish a season to start the ledger.</span>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>
      <RecordBookCard state={state} />
      <Card title={`PROGRAM LEGENDS · ${rows ? rows.filter((r) => r.player.tid === state.userTid).length : "…"} DEPARTED`}>
        <ul className="space-y-1.5 text-sm">
          {legends.map((r) => (
            <li key={r.id}>
              <span className="font-bold">{r.player.name}</span>{" "}
              <span className="text-xs text-ink/55">
                {r.player.pos} · left {r.season} ({r.player.reason}) · peaked {r.player.ovr} OVR
              </span>
            </li>
          ))}
          {legends.length === 0 && (
            <li className="text-xs text-ink/55">Your departed greats will be remembered here.</li>
          )}
        </ul>
      </Card>
    </div>
  );
}

function TrophyCase({ state }: { state: DynastyState }) {
  const natties = state.honors.filter((h) => h.champion === state.userTid);
  const ccgs = state.honors.filter((h) => h.userCcg);
  const cfps = state.honors.filter((h) => h.userCfp).length;
  if (natties.length === 0 && ccgs.length === 0 && cfps === 0) return null;
  return (
    <Card title="YOUR TROPHY CASE" className="md:col-span-2">
      <div className="flex flex-wrap gap-2">
        {natties.map((h) => (
          <span
            key={`n${h.season}`}
            className="rounded-lg border-2 border-gold bg-gold/10 px-3 py-2 font-display text-sm text-gold shadow-sm"
          >
            🏆 {h.season} NATIONAL CHAMPIONS
          </span>
        ))}
        {ccgs.map((h) => (
          <span
            key={`c${h.season}`}
            className="rounded-lg border-2 border-line-strong bg-surface-sunken px-3 py-2 font-display text-xs"
          >
            🥇 {h.season} CONFERENCE CHAMPS
          </span>
        ))}
        {cfps > 0 && (
          <span className="rounded-lg border-2 border-line bg-surface-sunken px-3 py-2 font-display text-xs">
            🎟️ {cfps} CFP APPEARANCE{cfps > 1 ? "S" : ""}
          </span>
        )}
      </div>
    </Card>
  );
}

function RecordBookCard({ state }: { state: DynastyState }) {
  const cats = Object.keys(state.records);
  const [cat, setCat] = useState<string>(cats[0] ?? "Passing yards");
  const [mode, setMode] = useState<"season" | "career">("season");
  const book = state.records[cat];
  return (
    <Card
      title="NATIONAL RECORD BOOK"
      className="md:col-span-2"
      right={
        <div className="flex items-center gap-2 text-xs">
          <select
            value={cat}
            onChange={(e) => setCat(e.target.value)}
            className="rounded border border-line bg-surface-raised px-1 py-0.5"
          >
            {cats.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
          {(["season", "career"] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setMode(m)}
              className={`rounded-full border px-2 py-0.5 font-display tracking-widest ${mode === m ? "border-ink bg-ink text-paper" : "border-line"}`}
            >
              {m.toUpperCase()}
            </button>
          ))}
        </div>
      }
    >
      {book ? (
        <ol className="columns-1 text-sm sm:columns-2">
          {book[mode].map((e, i) => (
            <li key={`${e.name}-${e.season}-${i}`} className="mb-0.5 break-inside-avoid">
              <span className="inline-block w-6 font-display text-ink/45">{i + 1}.</span>
              <span className="font-bold">{e.name}</span>{" "}
              <span className="text-xs text-ink/55">
                {e.school} · {mode === "season" ? e.season : `since ${e.season}`}
              </span>{" "}
              <span className="font-mono">{e.value}</span>
            </li>
          ))}
        </ol>
      ) : (
        <p className="text-xs text-ink/55">Finish a season to open the book.</p>
      )}
    </Card>
  );
}

// --- Offseason (stage-driven, v1.2) ---------------------------------------------

export function OffseasonPanel({
  state,
  onRetention,
  onPortal,
  onTakeJob,
  onAdvanceWeek,
}: {
  state: DynastyState;
  onRetention: (paidPids: number[]) => void;
  onPortal: (offers: PortalOffer[]) => void;
  onTakeJob?: (tid: number) => void;
  onAdvanceWeek?: () => void;
}) {
  if (state.offStage === "retention") {
    return <RetentionStage state={state} onRetention={onRetention} />;
  }
  if (state.offStage === "portal") {
    return <PortalStage state={state} onPortal={onPortal} />;
  }
  return <OffseasonReportView state={state} onTakeJob={onTakeJob} onAdvanceWeek={onAdvanceWeek} />;
}

function BudgetBar({ state, committed }: { state: DynastyState; committed: number }) {
  const budget = state.teams[state.userTid].nilBudget;
  const over = committed > budget;
  return (
    <div className="text-sm">
      <span className="text-ink/60">NIL pool </span>
      <span className="font-display">{fmtMoney(budget)}</span>
      {committed > 0 && (
        <>
          <span className="text-ink/60"> · committed </span>
          <StatusText tone={over ? "neg" : "pos"} className="font-display">{fmtMoney(committed)}</StatusText>
          {over ? <span className="text-neg"> — over budget, trim your offers</span> : ""}
        </>
      )}
      <Meter value={committed} max={budget || 1} color={over ? "var(--neg)" : "var(--pos)"} className="mt-1" height={6} />
    </div>
  );
}

function RetentionStage({
  state,
  onRetention,
}: {
  state: DynastyState;
  onRetention: (paidPids: number[]) => void;
}) {
  const [picked, setPicked] = useState<number[]>([]);
  const [, bump] = useState(0); // courting mutates engine state in place
  const committed = state.retention
    .filter((c) => picked.includes(c.pid))
    .reduce((a, c) => a + c.ask, 0);
  const budget = state.teams[state.userTid].nilBudget;
  const court = (pid: number) => {
    const err = retainEffort(state, pid);
    if (!err) bump((n) => n + 1);
  };
  return (
    <Card
      title="RETENTION WINDOW"
      right={<Pill tone="neu">OFFSEASON · WEEK {state.offWeek}/8</Pill>}
    >
      <p className="text-sm text-ink/75">
        These players have one foot in the portal. Pay their ask and they'll probably stay (loyalty helps); or spend{" "}
        <span className="font-bold">{STAMINA_COSTS.retain} stamina</span> to court them the non-NIL way — it stacks
        with a paid deal, and sometimes works alone. Money only leaves your pool on a successful re-sign.
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-4">
        <div className="flex-1 min-w-[220px]">
          <BudgetBar state={state} committed={committed} />
        </div>
        <span className="text-xs text-ink/60">
          Stamina <span className="font-display">{state.stamina}</span>
        </span>
      </div>
      <ul className="mt-3 space-y-2">
        {state.retention.map((c) => {
          const p = state.players[c.pid];
          const on = picked.includes(c.pid);
          return (
            <li key={c.pid} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-line bg-surface-sunken/40 px-3 py-2">
              <div>
                <span className="font-bold">{p.name}</span>{" "}
                <span className="text-xs text-ink/55">
                  {p.pos} · {p.ovr} OVR · morale {p.morale} · {c.reason}
                </span>
              </div>
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  disabled={!!c.courted || state.stamina < STAMINA_COSTS.retain}
                  onClick={() => court(c.pid)}
                  title="Non-NIL retention effort: +loyalty, +morale, better stay odds"
                  className={`rounded-full border px-3 py-1 font-display text-[10px] tracking-widest transition ${
                    c.courted ? "border-pos/50 text-pos" : "border-line hover:border-ink/40"
                  } disabled:opacity-40`}
                >
                  {c.courted ? "✓ COURTED" : `🤝 COURT · ${STAMINA_COSTS.retain}`}
                </button>
                <button
                  type="button"
                  onClick={() => setPicked(on ? picked.filter((x) => x !== c.pid) : [...picked, c.pid])}
                  className={`rounded-full border-2 px-4 py-1 font-display text-xs tracking-widest transition ${
                    on ? "border-ink bg-ink text-paper" : "border-line hover:border-ink/40"
                  }`}
                >
                  {on ? `PAYING ${fmtMoney(c.ask)}` : `PAY ${fmtMoney(c.ask)}`}
                </button>
              </div>
            </li>
          );
        })}
        {state.retention.length === 0 && (
          <li className="text-sm text-ink/55">Nobody is threatening to leave. Lucky you.</li>
        )}
      </ul>
      <button
        type="button"
        disabled={committed > budget}
        onClick={() => onRetention(picked)}
        className="mt-4 rounded-full border-2 border-ink bg-ink px-6 py-2 font-display text-xs tracking-widest text-paper transition hover:opacity-85 disabled:opacity-40"
      >
        CONFIRM → OPEN THE PORTAL
      </button>
    </Card>
  );
}

type PortalSort = "ovr" | "ask" | "pos" | "from";

function PortalStage({
  state,
  onPortal,
}: {
  state: DynastyState;
  onPortal: (offers: PortalOffer[]) => void;
}) {
  const [offers, setOffers] = useState<Record<number, number>>({});
  const [posFilter, setPosFilter] = useState<string>("ALL");
  const [sort, setSort] = useState<PortalSort>("ovr");
  const committed = Object.values(offers).reduce((a, b) => a + b, 0);
  const budget = state.teams[state.userTid].nilBudget;
  const needs = useMemo(() => {
    const have = new Map<string, number>();
    for (const pid of state.teams[state.userTid].roster) {
      const p = state.players[pid];
      have.set(p.g, (have.get(p.g) ?? 0) + 1);
    }
    const targets: [string, number][] = [
      ["QB", 4], ["RB", 6], ["WR", 9], ["TE", 4], ["OL", 14],
      ["DL", 12], ["LB", 9], ["CB", 7], ["S", 6], ["K", 2], ["P", 2],
    ];
    return new Map(targets.map(([g, want]) => [g, Math.max(0, want - (have.get(g) ?? 0))]));
  }, [state]);
  const rows = useMemo(() => {
    let list = state.portal;
    if (posFilter !== "ALL") list = list.filter((e) => state.players[e.pid]?.g === posFilter);
    const cmp: Record<PortalSort, (a: typeof list[number], b: typeof list[number]) => number> = {
      ovr: (a, b) => state.players[b.pid].ovr - state.players[a.pid].ovr,
      ask: (a, b) => b.ask - a.ask,
      pos: (a, b) => state.players[a.pid].g.localeCompare(state.players[b.pid].g) || state.players[b.pid].ovr - state.players[a.pid].ovr,
      from: (a, b) => school(state, a.fromTid).localeCompare(school(state, b.fromTid)),
    };
    return [...list].sort(cmp[sort]).slice(0, 40);
  }, [state, posFilter, sort]);

  const sortableTh = (key: PortalSort, label: string, extra = "") => (
    <th className={`${th} ${extra} cursor-pointer select-none hover:text-ink`} onClick={() => setSort(key)}>
      {label}{sort === key ? " ▾" : ""}
    </th>
  );

  return (
    <div className="grid gap-3 lg:grid-cols-3">
      <Card
        title="TRANSFER PORTAL"
        className="lg:col-span-2"
        right={<Pill tone="accent">ROUND {state.portalRound} / 5</Pill>}
        bodyClassName="p-4"
      >
        <BudgetBar state={state} committed={committed} />
        <p className="mt-2 text-xs text-ink/60">
          A strong program fit discounts a player's ask — down to 60% for a perfect fit. Great fit can
          beat a richer offer. Players take a few rounds to decide; everyone else is bidding too.
        </p>
        <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
          <select
            value={posFilter}
            onChange={(e) => setPosFilter(e.target.value)}
            className="rounded border border-line bg-surface-raised px-1 py-0.5"
          >
            {["ALL", "QB", "RB", "WR", "TE", "OL", "DL", "LB", "CB", "S", "K", "P"].map((p) => (
              <option key={p} value={p}>{p}</option>
            ))}
          </select>
          <span className="text-ink/55">
            Open needs:{" "}
            {[...needs.entries()].filter(([, n]) => n > 0).map(([g, n]) => `${g}×${n}`).join(" ") || "none"}
          </span>
        </div>
        <div className="mt-2 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line bg-surface-sunken/50">
                <th className={th}>PLAYER</th>
                {sortableTh("pos", "POS")}
                {sortableTh("ovr", "OVR")}
                {sortableTh("from", "FROM")}
                {sortableTh("ask", "ASK")}
                <th className={th} title="Their ask after your program-fit discount">YOUR PRICE</th>
                <th className={th}>INTEREST</th>
                <th className={th}>MY OFFER</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((e) => {
                const p = state.players[e.pid];
                const need = (needs.get(p.g) ?? 0) > 0;
                const myOffer = offers[e.pid] ?? 0;
                // Fit-discounted price (M1.3): what YOUR program has to clear.
                const fit = portalFit(state, state.teams[state.userTid], p.g);
                const myPrice = effectiveAsk(e.ask, fit);
                const progress = myPrice > 0 ? Math.min(100, (myOffer / myPrice) * 100) : 0;
                return (
                  <tr key={e.pid} className="border-b border-line/50">
                    <td className={td}>
                      <span className="font-bold">{p.name}</span>{" "}
                      <span className="text-xs text-ink/45">{CLASS_LABELS[p.cls] ?? p.cls}</span>
                      {need && <Pill tone="pos" className="ml-1 !px-1.5 !py-0">NEED</Pill>}
                    </td>
                    <td className={`${td} font-display`}>{p.g}</td>
                    <td className={`${td} font-mono`}>{p.ovr}</td>
                    <td className={`${td} text-xs`}><TeamName team={state.teams[e.fromTid]} /></td>
                    <td className={`${td} font-mono text-xs text-ink/55`}>{fmtMoney(e.ask)}</td>
                    <td className={`${td} font-mono text-xs`}>
                      <span className={myPrice < e.ask ? "font-bold text-pos" : ""}>{fmtMoney(myPrice)}</span>
                      {myPrice < e.ask && (
                        <span className="ml-1 text-[10px] text-pos">−{Math.round((1 - myPrice / e.ask) * 100)}%</span>
                      )}
                    </td>
                    <td className={td}>
                      <div className="flex items-center gap-1" title="How close your offer is to their (discounted) number">
                        <Meter value={progress} max={100} color={progress >= 100 ? "var(--pos)" : "var(--accent)"} height={6} className="w-16" />
                        <span className="text-[10px] text-ink/50">{Math.round(progress)}%</span>
                      </div>
                    </td>
                    <td className={td}>
                      <input
                        type="number"
                        min={0}
                        step={50}
                        value={offers[e.pid] ? offers[e.pid] / 1000 : ""}
                        placeholder="$k"
                        onChange={(ev) => {
                          const v = Math.max(0, Number(ev.target.value)) * 1000;
                          setOffers((o) => {
                            const next = { ...o };
                            if (v > 0) next[e.pid] = v;
                            else delete next[e.pid];
                            return next;
                          });
                        }}
                        className="w-20 rounded border border-line bg-surface-raised px-1 py-0.5 font-mono text-xs"
                      />
                    </td>
                  </tr>
                );
              })}
              {rows.length === 0 && (
                <tr>
                  <td className={td} colSpan={8}>
                    <span className="text-sm text-ink/55">The portal is empty this round.</span>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <button
          type="button"
          disabled={committed > budget}
          onClick={() => {
            onPortal(Object.entries(offers).map(([pid, amount]) => ({ pid: Number(pid), amount })));
            setOffers({});
          }}
          className="mt-4 rounded-full border-2 border-ink bg-ink px-6 py-2 font-display text-xs tracking-widest text-paper transition hover:opacity-85 disabled:opacity-40"
        >
          SUBMIT ROUND {state.portalRound}
        </button>
      </Card>
      <Card title="YOUR PORTAL LEDGER">
        <ul className="space-y-1 text-xs">
          {state.portalLog.map((l, i) => (
            <li key={i} className={l.startsWith("IN") ? "text-pos" : l.startsWith("STAY") ? "" : "text-neg"}>
              {l}
            </li>
          ))}
          {state.portalLog.length === 0 && <li className="text-ink/55">Quiet so far.</li>}
        </ul>
      </Card>
    </div>
  );
}

function OffseasonReportView({
  state,
  onTakeJob,
  onAdvanceWeek,
}: {
  state: DynastyState;
  onTakeJob?: (tid: number) => void;
  onAdvanceWeek?: () => void;
}) {
  const r = state.offseason!;
  const honors = state.honors[state.honors.length - 1];
  const userTeam = state.teams[state.userTid];
  const colors = getTeamColors(userTeam);
  const allConf = honors?.allConf?.[userTeam.conference];
  const showAdvance = onAdvanceWeek && (state.offStage === "report" || state.offStage === "signing");

  return (
    <div className="space-y-3">
      {showAdvance && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-card border-2 border-ink bg-surface-raised px-4 py-3">
          <div>
            <SectionLabel>OFFSEASON · WEEK {state.offWeek} / 8</SectionLabel>
            <p className="mt-0.5 text-sm text-ink/70">
              {state.offStage === "report"
                ? "Work the recruiting board, then advance to the retention window."
                : "Signing day — commits finalize, cuts to 85, prestige & budgets settle."}
            </p>
          </div>
          <button
            type="button"
            onClick={onAdvanceWeek}
            className="rounded-full border-2 border-ink bg-ink px-6 py-2 font-display text-xs tracking-widest text-paper transition hover:opacity-85"
          >
            {state.offStage === "report" ? "▶ ADVANCE TO RETENTION" : "🖊 SIGNING DAY → FINISH"}
          </button>
        </div>
      )}
      {/* Big hero wrap-up */}
      <Card accent={colors.primary} bodyClassName="p-0">
        <div className="px-5 py-5" style={{ background: `linear-gradient(180deg, ${colors.primary}14, transparent)` }}>
          <SectionLabel>SEASON WRAPPED</SectionLabel>
          <h2 className="mt-1 font-display text-3xl leading-none sm:text-4xl">{r.season} in the books</h2>
          <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
            {honors && honors.champion !== null && (
              <Pill tone="accent">🏆 {school(state, honors.champion)} — National Champions</Pill>
            )}
            <span className="rounded-lg border border-line bg-surface-raised px-3 py-1.5">
              You finished <span className="font-display text-base">{honors?.userRecord}</span>
              {honors?.userPollRank ? <> · <span className="font-display">#{honors.userPollRank}</span></> : ""}
            </span>
            <span className="rounded-lg border border-line bg-surface-raised px-3 py-1.5">
              Class rank <span className="font-display text-base">#{r.classRank}</span>
            </span>
            <span className="rounded-lg border border-line bg-surface-raised px-3 py-1.5">
              Next NIL pool <span className="font-display text-base">{fmtMoney(userTeam.nilBudget)}</span>
            </span>
            {honors?.poy && (
              <span className="rounded-lg border border-line bg-surface-raised px-3 py-1.5">POY: {honors.poy}</span>
            )}
          </div>
          {state.mandates.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-2 text-sm">
              {state.mandates.map((m, i) => (
                <span key={i} className="rounded-lg border border-line bg-surface-raised px-2.5 py-1">
                  {m.met === null ? "⏳" : m.met ? "✅" : "❌"} {m.text}
                </span>
              ))}
            </div>
          )}
          <ShareRecapButton state={state} />
        </div>
      </Card>

      {/* Risers & Droppers — headline, side by side (V6.3) */}
      <div className="grid gap-3 md:grid-cols-2">
        <Card title="📈 BIGGEST RISERS" accent="var(--pos)">
          <ul className="space-y-2">
            {r.risers.map((x, i) => (
              <li key={i} className="flex items-center justify-between gap-2">
                <span>
                  <span className="font-bold">{x.name}</span>{" "}
                  <span className="text-xs text-ink/55">{x.pos}</span>
                </span>
                <span className="flex items-center gap-2 text-sm">
                  <span className="text-ink/50">{x.from}</span>
                  <span className="text-ink/40">→</span>
                  <span className="font-display text-lg text-pos">{x.to}</span>
                  <Pill tone="pos">+{x.to - x.from}</Pill>
                </span>
              </li>
            ))}
            {r.risers.length === 0 && <li className="text-sm text-ink/55">A quiet development camp.</li>}
          </ul>
        </Card>
        <Card title="📉 BIGGEST DROPPERS" accent="var(--neg)">
          <ul className="space-y-2">
            {r.droppers.map((x, i) => (
              <li key={i} className="flex items-center justify-between gap-2">
                <span>
                  <span className="font-bold">{x.name}</span>{" "}
                  <span className="text-xs text-ink/55">{x.pos}</span>
                </span>
                <span className="flex items-center gap-2 text-sm">
                  <span className="text-ink/50">{x.from}</span>
                  <span className="text-ink/40">→</span>
                  <span className="font-display text-lg text-neg">{x.to}</span>
                  <Pill tone="neg">{x.to - x.from}</Pill>
                </span>
              </li>
            ))}
            {r.droppers.length === 0 && (
              <li className="text-sm text-ink/55">No regressions to report this camp.</li>
            )}
          </ul>
        </Card>
      </div>

      {/* All-Americans / All-Conference by unit (V6.2) */}
      {(honors?.allAmericans?.length || allConf?.length) && (
        <Card title="POSTSEASON HONORS">
          <div className="grid gap-4 md:grid-cols-2">
            {honors?.allAmericans && honors.allAmericans.length > 0 && (
              <HonorsList label="ALL-AMERICANS (1ST TEAM)" entries={honors.allAmericans} />
            )}
            {allConf && allConf.length > 0 && (
              <HonorsList label={`ALL-${userTeam.conference.toUpperCase()} (1ST TEAM)`} entries={allConf} />
            )}
          </div>
        </Card>
      )}

      {state.openJobs.length > 0 && onTakeJob && (
        <Card title="🧳 OPEN JOBS — THE CAROUSEL IS SPINNING" accent="var(--accent)">
          <ul className="space-y-2">
            {state.openJobs.map((tid) => {
              const t = state.teams[tid];
              return (
                <li key={tid} className="flex items-center justify-between gap-2">
                  <span className="flex items-center gap-2">
                    <TeamName team={t} />
                    <span className="text-xs text-ink/55">
                      {"★".repeat(t.prestige)} · {t.conference} · NIL {fmtMoney(t.nilBudget)}
                    </span>
                  </span>
                  <button
                    type="button"
                    className="rounded-full border-2 border-line px-3 py-0.5 font-display text-[10px] tracking-widest transition hover:border-ink/50"
                    onClick={() => {
                      if (window.confirm(`Leave ${school(state, state.userTid)} for ${t.school}?`)) {
                        onTakeJob(tid);
                      }
                    }}
                  >
                    TAKE JOB
                  </button>
                </li>
              );
            })}
          </ul>
        </Card>
      )}

      <div className="grid gap-3 md:grid-cols-2">
        <Card title="DEPARTURES">
          <ul className="space-y-1 text-sm">
            {r.departures.map((d, i) => (
              <li key={i}>
                <span className="font-bold">{d.name}</span>{" "}
                <span className="text-xs text-ink/55">
                  {d.pos} · {d.ovr} OVR · {d.reason}
                  {d.detail ? ` (${d.detail})` : ""}
                </span>
              </li>
            ))}
            {r.departures.length === 0 && <li className="text-xs text-ink/55">Everyone returns!</li>}
          </ul>
        </Card>

        <Card title="SIGNING CLASS + PORTAL">
          <ul className="space-y-1 text-sm">
            {r.signees.map((s, i) => (
              <li key={i}>
                <span className="text-gold">{"★".repeat(s.stars)}</span> <span className="font-bold">{s.name}</span>{" "}
                <span className="text-xs text-ink/55">{s.pos} · {s.ovr} OVR</span>
              </li>
            ))}
          </ul>
          {state.portalLog.length > 0 && (
            <ul className="mt-3 space-y-0.5 border-t border-line/70 pt-2 text-xs">
              {state.portalLog.map((l, i) => (
                <li key={i} className={l.startsWith("IN") ? "text-pos" : l.startsWith("STAY") ? "" : "text-neg"}>
                  {l}
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <Card title="PRESTIGE MOVES">
        <ul className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
          {r.prestigeChanges.map((c, i) => (
            <li key={i} className="flex items-center gap-1.5">
              <span className="font-bold">{c.school}</span>
              <span className="text-xs text-ink/55">{"★".repeat(c.from)} → {"★".repeat(c.to)}</span>
              <StatusText tone={c.to > c.from ? "pos" : "neg"}>{c.to > c.from ? "📈" : "📉"}</StatusText>
            </li>
          ))}
          {r.prestigeChanges.length === 0 && <li className="text-xs text-ink/55">The order holds.</li>}
        </ul>
      </Card>
    </div>
  );
}

/** Group an "POS Name (School)" honors list by offense/defense/special unit. */
function HonorsList({ label, entries }: { label: string; entries: string[] }) {
  const UNIT: Record<string, PosGroup[]> = {
    OFFENSE: ["QB", "RB", "WR", "TE", "OL"],
    DEFENSE: ["DL", "LB", "CB", "S"],
    "SPECIAL TEAMS": ["K", "P"],
  };
  const posOf = (s: string) => s.trim().split(/\s+/)[0];
  const grouped = Object.entries(UNIT)
    .map(([unit, groups]) => ({
      unit,
      list: entries.filter((e) => groups.some((g) => posOf(e).startsWith(g))),
    }))
    .filter((u) => u.list.length > 0);
  const leftover = entries.filter((e) => !grouped.some((u) => u.list.includes(e)));

  return (
    <div className="rounded-lg border border-line bg-surface-sunken/40 p-3">
      <SectionLabel>{label}</SectionLabel>
      <div className="mt-2 space-y-2">
        {grouped.map((u) => (
          <div key={u.unit}>
            <div className="text-[10px] font-bold uppercase tracking-widest text-ink/45">{u.unit}</div>
            <ul className="mt-0.5 space-y-0.5 text-sm">
              {u.list.map((e, i) => (
                <li key={i}>{e}</li>
              ))}
            </ul>
          </div>
        ))}
        {leftover.length > 0 && (
          <ul className="space-y-0.5 text-sm">
            {leftover.map((e, i) => (
              <li key={i}>{e}</li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function ShareRecapButton({ state }: { state: DynastyState }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className="mt-4 rounded-full border-2 border-line bg-surface-raised px-4 py-1.5 font-display text-[10px] tracking-widest transition hover:border-ink/40"
      onClick={() => {
        void navigator.clipboard.writeText(buildSeasonRecap(state)).then(() => {
          setCopied(true);
          window.setTimeout(() => setCopied(false), 2000);
        });
      }}
    >
      {copied ? "COPIED ✓" : "📋 COPY SEASON RECAP"}
    </button>
  );
}

// --- Shared modal ---------------------------------------------------------------

function Modal({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink/50 p-4"
      onClick={onClose}
      role="presentation"
    >
      <div
        className="max-h-[85vh] w-full max-w-lg overflow-y-auto rounded-card border border-line bg-surface-raised p-5 shadow-raised"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
      >
        {children}
        <button
          type="button"
          onClick={onClose}
          className="mt-4 rounded-full border-2 border-line px-4 py-1 font-display text-xs tracking-widest transition hover:border-ink/40"
        >
          CLOSE
        </button>
      </div>
    </div>
  );
}
