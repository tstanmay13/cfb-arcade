// How to Play — the manual. Every tab, every badge, every number the UI
// throws at you, in plain language.
import { RAP_ACTIONS } from "./engine/recruiting.ts";

const card = "rounded-md border-2 border-paper-edge bg-white/60 p-4";
const h = "font-display text-xs tracking-[0.25em] opacity-60";

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
          You're the head coach of a real 2026 Power-4 program, forever. One season =
          <span className="font-bold"> sim (or play) 13 weeks → conference title games → 12-team Playoff + bowls →
          the offseason</span>. The offseason is where dynasties are made: keep your stars out of the portal,
          shop it yourself, sign your recruiting class, survive your boosters, then hit{" "}
          <span className="font-display">START SEASON</span> and do it again — for up to 50 years.
        </p>
        <p className="mt-2 text-sm">
          Two buttons drive everything: <span className="font-display">SIM WEEK</span> plays the current week
          (recruiting ticks along automatically), and <span className="font-display">🏈 PLAY GAME</span> lets you
          coach your game drive-by-drive before simming the rest. Everything autosaves after every click.
        </p>
      </div>

      <div className={card}>
        <h3 className={h}>DASHBOARD</h3>
        <p className="mt-2 text-sm">
          Your week at a glance: next opponent, last result (with box score), the AP Top 10, your{" "}
          <span className="font-bold">booster mandates</span> (seasonal demands — meet them all for +25% NIL money
          next year, miss them all for −20% and an unhappy locker room), your three coaches, and the news feed.
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
        <h3 className={h}>RECRUITING</h3>
        <p className="mt-2 text-sm">
          You get <span className="font-bold">600 RAP each week</span> to spend on high-schoolers. First school to
          ~1,000 interest points usually gets the commit — watch the "leads" column.
        </p>
        <ul className="mt-2 space-y-0.5 text-xs">
          <li><span className="font-display">DM {RAP_ACTIONS.dm.cost}</span> — +{RAP_ACTIONS.dm.pts} interest, cheap pressure.</li>
          <li><span className="font-display">PC {RAP_ACTIONS.coach.cost}</span> — position coach, +{RAP_ACTIONS.coach.pts}.</li>
          <li><span className="font-display">HC {RAP_ACTIONS.hc.cost}</span> — in-home head-coach visit, +{RAP_ACTIONS.hc.pts}, once per recruit.</li>
          <li><span className="font-display">VIS {RAP_ACTIONS.visit.cost}</span> — official visit, +{RAP_ACTIONS.visit.pts}, needs a home game that week, +50 more if you win it.</li>
          <li><span className="font-display">S1/S2</span> — scouting: S1 tightens the OVR guess; S2 reveals the dev badge and whether he's a 💎 gem or ⚠️ bust.</li>
        </ul>
        <p className="mt-2 text-xs opacity-75">
          🔒 means a deal-breaker blocks you (he wants playing time you can't offer, a ranked contender, or an
          NFL-factory program). Signing Day hits after the conference championships — commits can still flip!
          Unsigned needs fill automatically in the late signing period.
        </p>
      </div>

      <div className={card}>
        <h3 className={h}>SCHEDULE · STANDINGS · TOP 25 · POSTSEASON</h3>
        <p className="mt-2 text-sm">
          <span className="font-bold">Schedule</span>: your slate, results, and box scores (with drive logs for
          games you played or watched). <span className="font-bold">Standings</span>: all four conference races —
          top two meet in the title game. <span className="font-bold">Top 25</span>: the weekly AP poll with
          movement. <span className="font-bold">Postseason</span>: the committee's live CFP projection during the
          season, then the full bracket + bowls. Four conference champs auto-qualify; eight at-larges fill the
          12-team field.
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
        <h3 className={h}>THE OFFSEASON (IN ORDER)</h3>
        <ul className="mt-2 space-y-1 text-sm">
          <li>
            <span className="font-bold">1 · Report</span> — who graduated, who got drafted (and where), camp
            risers, All-Americans.
          </li>
          <li>
            <span className="font-bold">2 · Retention</span> — unhappy players list their price. Pay it and
            they'll <em>probably</em> stay (loyalty helps; money only leaves on a yes). Pass and they hit the
            portal.
          </li>
          <li>
            <span className="font-bold">3 · Portal (3 rounds)</span> — bid your NIL pool on transfers. Offers
            must clear ~90% of the ask; every AI program is bidding from the same pool of money rules.
          </li>
          <li>
            <span className="font-bold">4 · Close-out</span> — your class signs, rosters cut to 85, prestige
            moves, coaching carousel spins (your coordinators can get poached; fired programs appear as{" "}
            <span className="font-bold">open jobs you can take</span>), and next year's NIL budget lands.
          </li>
        </ul>
      </div>

      <div className={card}>
        <h3 className={h}>MONEY, MORALE & STAFF</h3>
        <p className="mt-2 text-sm">
          Your <span className="font-bold">NIL pool</span> (top bar) is a per-cycle budget for retention + portal
          bids — set by prestige, boosted by winning it all, slashed by 4-win seasons and booster revolts.
          Players get unhappy when they're underpaid stars, buried on the depth chart, or losing.{" "}
          <span className="font-bold">Coaches</span> matter: Recruiters boost your interest gains, Tacticians
          boost game execution, Developers boost offseason growth.
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
