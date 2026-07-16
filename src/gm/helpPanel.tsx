// How to Play — the manual. Every tab, every badge, every number the UI
// throws at you, in plain language.
import { RAP_ACTIONS } from "./engine/recruiting.ts";

const card = "rounded-card border border-line bg-surface-raised p-4 shadow-card";
const h = "font-display text-xs tracking-[0.25em] text-ink/55";

export default function HelpPanel({ onStartTour }: { onStartTour?: () => void }) {
  return (
    <div className="grid gap-3 md:grid-cols-2">
      {onStartTour && (
        <div className={`${card} flex items-center justify-between md:col-span-2`}>
          <div>
            <h3 className={h}>NEW HERE?</h3>
            <p className="mt-1 text-sm">
              Take the guided tour — it walks every tab and points at the actual buttons.
            </p>
          </div>
          <button
            type="button"
            onClick={onStartTour}
            className="rounded-full border-2 border-ink bg-ink px-5 py-2 font-display text-xs tracking-widest text-paper transition hover:opacity-85"
          >
            ▶ START THE TOUR
          </button>
        </div>
      )}
      <div className={`${card} md:col-span-2`}>
        <h3 className={h}>THE LOOP</h3>
        <p className="mt-2 text-sm">
          You're the head coach of a real Power-4 program, forever — start in{" "}
          <span className="font-bold">2026 or any real season back to 2010</span> (era-correct rosters and
          conferences; realignment catches up in year 2). One season =
          <span className="font-bold"> sim (or play) 13 weeks → conference title games → 12-team Playoff + bowls →
          an 8-week offseason</span>. The offseason is where dynasties are made: it's the ONLY time recruiting and
          the portal are open. Work it week by week, then hit{" "}
          <span className="font-display">START SEASON</span> and do it again — for up to 50 years.
        </p>
        <p className="mt-2 text-sm">
          In season: <span className="font-display">SIM WEEK</span> plays the current week,{" "}
          <span className="font-display">🏈 PLAY GAME</span> coaches your game drive-by-drive,{" "}
          <span className="font-display">SIM REG SEASON</span> stops before the postseason, and{" "}
          <span className="font-display">SIM WHOLE SEASON</span> runs to the recap. In the offseason, each panel's
          advance button moves one week; <span className="font-display">SIM OFFSEASON</span> auto-resolves the
          rest. Everything autosaves after every click.
        </p>
      </div>

      <div className={card}>
        <h3 className={h}>DASHBOARD</h3>
        <p className="mt-2 text-sm">
          Your week at a glance: next opponent, last result (with box score), the Top 10 rankings, your{" "}
          <span className="font-bold">booster mandates</span> (seasonal demands — meet them all for +25% NIL money
          next year, miss them all for −20% and an unhappy locker room), season stat leaders, an opponent
          scouting strip (their scheme + best players), your staff, and the news feed.
        </p>
      </div>

      <div className={card}>
        <h3 className={h}>ROSTER</h3>
        <p className="mt-2 text-sm">
          All ~85 players. <span className="font-bold">OVR</span> is current ability;{" "}
          <span className="font-bold">DEV badges</span> (Normal → Impact → Star → Elite) hint how fast someone
          grows — the actual ceiling is hidden. <span className="font-bold">YR</span> runs FR→SR ("rs-" =
          redshirted: played ≤4 games one year and banked it). <span className="font-bold">NIL</span> is their
          deal, <span className="font-bold">MOR</span>ale below ~35 (red) means portal risk.{" "}
          <span className="font-bold">📌 pin</span> a player to force him into the starting lineup over a higher
          OVR. Click any row for the full card; during the offseason you can also CUT.
        </p>
      </div>

      <div className={card}>
        <h3 className={h}>RECRUITING &amp; STAMINA (OFFSEASON ONLY)</h3>
        <p className="mt-2 text-sm">
          Each offseason week you get <span className="font-bold">~100 stamina</span> — ONE pool shared by
          recruiting, player development, morale work, and retention courting. Spend it where it matters; it
          resets weekly. First school to ~650 interest points usually gets the commit.
        </p>
        <ul className="mt-2 space-y-0.5 text-xs">
          <li><span className="font-display">DM {RAP_ACTIONS.dm.cost}</span> — +{RAP_ACTIONS.dm.pts} interest, cheap pressure.</li>
          <li><span className="font-display">PC {RAP_ACTIONS.coach.cost}</span> — position coach, +{RAP_ACTIONS.coach.pts}.</li>
          <li><span className="font-display">HC {RAP_ACTIONS.hc.cost}</span> — in-home head-coach visit, +{RAP_ACTIONS.hc.pts}, once per recruit.</li>
          <li><span className="font-display">VIS {RAP_ACTIONS.visit.cost}</span> — official visit, +{RAP_ACTIONS.visit.pts}, once per recruit.</li>
          <li><span className="font-display">S1/S2</span> — scouting, capped at two per recruit: S1 tightens the OVR guess; S2 reveals the dev badge and 💎/⚠️.</li>
          <li><span className="font-display">DEVELOP 25 / 1-ON-1 10 / TEAM TALK 30</span> — on the Roster tab: coach a player toward his ceiling or lift morale, from the same pool.</li>
        </ul>
        <p className="mt-2 text-xs opacity-75">
          🔒 means a deal-breaker blocks you. ✕ REMOVE hides a prospect from your board for the cycle. Signing Day
          is offseason week 8 — commits can still flip! Unsigned needs fill in the late signing period.
        </p>
      </div>

      <div className={card}>
        <h3 className={h}>SCHEDULE · STANDINGS · TOP 25</h3>
        <p className="mt-2 text-sm">
          <span className="font-bold">Schedule</span>: your slate, results, and box scores (with drive logs for
          games you played or watched) — rivalry games are flagged. <span className="font-bold">Standings</span>:
          all four conference races — top two meet in the title game. <span className="font-bold">Top 25</span>:
          the weekly poll with movement, the top 12 banded as Playoff Hopefuls, and — right below it — the
          committee's live CFP projection, then the full 12-team bracket + bowls. Four conference champs
          auto-qualify; eight at-larges fill the field.
        </p>
      </div>

      <div className={card}>
        <h3 className={h}>PLAYING A GAME (WATCH MODE)</h3>
        <p className="mt-2 text-sm">
          <span className="font-display">🏈 PLAY GAME</span> opens your matchup drive-by-drive. Between drives,
          toggle <span className="font-bold">CHEW CLOCK</span> (run-heavy, burns time — protect a lead),{" "}
          <span className="font-bold">NO-HUDDLE</span> (pass-heavy, saves time, riskier — chase points), or{" "}
          <span className="font-bold">BLITZ HEAVY</span> (more sacks, but your secondary is exposed). The{" "}
          <span className="font-bold">QB SPARK SWAP</span> benches your starter once per game: 35% the backup
          catches fire, 20% he's lost out there. Exiting just means the game fast-sims with the week — same
          engine, same dice.
        </p>
      </div>

      <div className={card}>
        <h3 className={h}>THE 8-WEEK OFFSEASON</h3>
        <ul className="mt-2 space-y-1 text-sm">
          <li>
            <span className="font-bold">Wk 1 · Report</span> — who graduated, who got drafted (and where), camp
            risers <em>and</em> droppers, All-Americans. Recruiting opens.
          </li>
          <li>
            <span className="font-bold">Wk 2 · Retention</span> — unhappy players list their price. Pay it and
            they'll <em>probably</em> stay (money only leaves on a yes), or spend stamina to{" "}
            <span className="font-bold">court them the non-NIL way</span> — it stacks, and sometimes works alone.
          </li>
          <li>
            <span className="font-bold">Wk 3–7 · Portal (5 rounds)</span> — bid your NIL pool on transfers.{" "}
            <span className="font-bold">Program fit discounts a player's ask up to 40%</span> (the YOUR PRICE
            column) — playing time, prestige, contention all count, and a great fit can beat a richer offer.
            Players take a few rounds to pick; every AI program bids under the same rules.
          </li>
          <li>
            <span className="font-bold">Wk 8 · Signing Day</span> — your class signs (flips happen!), rosters cut
            to 85, prestige moves, the carousel spins (fired programs appear as{" "}
            <span className="font-bold">open jobs you can take</span>), staff salaries come out, and next year's
            NIL budget lands.
          </li>
        </ul>
      </div>

      <div className={card}>
        <h3 className={h}>MONEY, MORALE, STAFF &amp; SCHEMES</h3>
        <p className="mt-2 text-sm">
          Your <span className="font-bold">NIL pool</span> (top bar) is a per-cycle budget for retention, portal
          bids, <em>and staff salaries</em> — set by prestige, boosted by winning it all, slashed by 4-win seasons
          and booster revolts. You employ <span className="font-bold">five coaches</span> (HC, OC, DC, Recruiting
          Coordinator, S&amp;C) — hire &amp; fire on the Staff tab in the offseason. Recruiters/RC boost interest
          and your stamina cap, Tacticians boost execution, Developers/S&amp;C boost growth. Your{" "}
          <span className="font-bold">OC and DC set your schemes</span> (Air Raid, 4-2-5…) — players whose skills
          fit the scheme execute better, portal targets discount for it, and a coordinator change reshapes your
          identity.
        </p>
        <p className="mt-2 text-xs opacity-75">
          Difficulty (picked at dynasty creation): Hard/Brutal sharpen every AI staff's recruiting and portal
          bids while shrinking your budget — and Brutal boosters demand one extra win.
        </p>
      </div>

      <div className={card}>
        <h3 className={h}>HISTORY</h3>
        <p className="mt-2 text-sm">
          The season ledger (champions, your finishes, POY winners), the national{" "}
          <span className="font-bold">record book</span> (single-season + career, never erased — beat them), and
          your program's departed legends. Export your save anytime from the dynasty list; it's a file you own.
        </p>
      </div>
    </div>
  );
}
