// Interactive guided tour: steps through the real tabs, spotlighting the
// actual elements (via [data-tour] anchors) with a positioned tooltip card.
// The shell owns the step index and switches tabs; this renders the overlay.
import { useEffect, useState } from "react";

export interface TourStep {
  /** Which shell tab must be active for this step. */
  tab: string;
  /** [data-tour] anchor to spotlight; null = centered card. */
  key: string | null;
  title: string;
  body: string;
}

export const TOUR_STEPS: TourStep[] = [
  {
    tab: "dashboard",
    key: "header-team",
    title: "Your program",
    body: "Record, rank, prestige ★, season, and your NIL pool — the empire's vitals are always up here. Everything autosaves after every click.",
  },
  {
    tab: "dashboard",
    key: "advance",
    title: "The most important button",
    body: "SIM WEEK advances the whole world one week — every game plays, recruiting ticks, injuries heal. SIM TO SEASON END fast-forwards to the offseason.",
  },
  {
    tab: "dashboard",
    key: "play-game",
    title: "Or coach it yourself",
    body: "When you have a game this week, PLAY GAME opens it drive-by-drive: call chew-clock, no-huddle, blitz, or bench your QB for a spark. Exit anytime and it fast-sims instead.",
  },
  {
    tab: "dashboard",
    key: "mandates",
    title: "Your boosters' demands",
    body: "One or two mandates per season. Meet them ALL: +25% NIL money next year. Miss them all: −20% and an unhappy locker room. They're graded at season's end.",
  },
  {
    tab: "dashboard",
    key: "staff",
    title: "Your coaching staff",
    body: "Recruiters boost your recruiting interest, Tacticians boost game execution, Developers boost offseason growth. Good coordinators get poached — watch the carousel.",
  },
  {
    tab: "dashboard",
    key: "news",
    title: "The news wire",
    body: "Upsets, commits, flips, hot seats, Heisman watch — the storylines land here as you sim.",
  },
  {
    tab: "roster",
    key: "roster-table",
    title: "Your 85",
    body: "Click any player for their full card. DEV badges hint growth speed (ceiling stays hidden). Red MORale = portal risk. 📌 pins force a player into the lineup. 'rs-' = redshirted.",
  },
  {
    tab: "recruiting",
    key: "rap",
    title: "600 points, every week",
    body: "Your weekly Recruiting Action Points. They reset each week — spend them or lose them.",
  },
  {
    tab: "recruiting",
    key: "recruit-actions",
    title: "Work the board",
    body: "DM (10) and coach visits (25/75) build interest; official visits (150) need a home game. S1/S2 scouting reveals true OVR, the dev badge, and 💎gem/⚠️bust. First school to ~1,000 interest usually gets the commit — 🔒 means a deal-breaker locks you out.",
  },
  {
    tab: "schedule",
    key: "schedule-table",
    title: "Your slate",
    body: "Results, box scores, and full drive logs for games you played or watched. CONF games decide your title-game path.",
  },
  {
    tab: "standings",
    key: "standings-grid",
    title: "The conference races",
    body: "Top two in each conference meet in the title games at week 14. Conference champs auto-qualify for the Playoff.",
  },
  {
    tab: "top25",
    key: "poll",
    title: "The Top 25",
    body: "Ranked teams recruit better (contender deal-breakers unlock) and the committee is watching. ▲▼ show weekly movement. The top 12 are your Playoff Hopefuls.",
  },
  {
    tab: "top25",
    key: "cfp",
    title: "The road to the natty",
    body: "Same tab, scroll down: during the season it's the committee's live 12-team projection, drawn as a bracket. In December it becomes the real bracket — 4 conference champs + 8 at-larges — plus the bowl slate.",
  },
  {
    tab: "history",
    key: "history-ledger",
    title: "What you leave behind",
    body: "Season ledger, the national record book (never erased — go beat them), and your departed legends. Your legacy lives here across 50 years.",
  },
  {
    tab: "dashboard",
    key: "advance",
    title: "One more thing: the offseason",
    body: "After the title game, the offseason walks you through stages: retention (pay your unhappy stars) → the transfer portal (3 bidding rounds) → your class signs and the carousel spins. The full manual is in HOW TO PLAY. Now go win.",
  },
];

function useTargetRect(key: string | null, step: number): DOMRect | null {
  const [rect, setRect] = useState<DOMRect | null>(null);
  useEffect(() => {
    if (!key) {
      setRect(null);
      return;
    }
    let timer = 0;
    let tries = 0;
    let cancelled = false;
    const measure = () => {
      if (cancelled) return;
      const el = document.querySelector(`[data-tour="${key}"]`);
      if (el) {
        el.scrollIntoView({ block: "center" });
        setRect(el.getBoundingClientRect());
      } else if (tries++ < 15) {
        timer = window.setTimeout(measure, 120);
      } else {
        setRect(null);
      }
    };
    // Let the tab switch render first.
    timer = window.setTimeout(measure, 60);
    const onResize = () => measure();
    window.addEventListener("resize", onResize);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      window.removeEventListener("resize", onResize);
    };
  }, [key, step]);
  return rect;
}

export default function TourOverlay({
  step,
  onNext,
  onBack,
  onSkip,
}: {
  step: number;
  onNext: () => void;
  onBack: () => void;
  onSkip: () => void;
}) {
  const def = TOUR_STEPS[step];
  const rect = useTargetRect(def.key, step);
  const last = step === TOUR_STEPS.length - 1;

  const pad = 6;
  const cardW = 340;
  const below = rect ? rect.bottom + 12 + 210 < window.innerHeight : true;
  const cardTop = rect ? (below ? rect.bottom + 12 : Math.max(12, rect.top - 222)) : window.innerHeight / 2 - 110;
  const cardLeft = rect
    ? Math.min(Math.max(12, rect.left), window.innerWidth - cardW - 12)
    : window.innerWidth / 2 - cardW / 2;

  return (
    <div className="fixed inset-0 z-[70]" role="presentation">
      {/* Click shield + dimmer. The spotlight box punches the hole. */}
      {rect ? (
        <div
          className="pointer-events-none fixed rounded-lg border-2 border-team transition-all duration-200"
          style={{
            top: rect.top - pad,
            left: rect.left - pad,
            width: rect.width + pad * 2,
            height: rect.height + pad * 2,
            boxShadow: "0 0 0 9999px rgba(27, 42, 65, 0.62)",
          }}
        />
      ) : (
        <div className="fixed inset-0 bg-ink/60" />
      )}
      <div className="fixed inset-0" onClick={onNext} />

      <div
        className="fixed rounded-lg border-2 border-ink bg-paper p-4 shadow-xl"
        style={{ top: cardTop, left: cardLeft, width: cardW }}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
      >
        <p className="font-display text-[10px] tracking-[0.25em] opacity-60">
          TOUR · {step + 1}/{TOUR_STEPS.length}
        </p>
        <h3 className="mt-1 font-display text-lg leading-tight">{def.title}</h3>
        <p className="mt-1 text-sm">{def.body}</p>
        <div className="mt-3 flex items-center gap-2">
          <button
            type="button"
            onClick={onNext}
            className="rounded-full border-2 border-ink bg-ink px-5 py-1.5 font-display text-xs tracking-widest text-paper transition hover:opacity-85"
          >
            {last ? "FINISH ✔" : "NEXT →"}
          </button>
          {step > 0 && (
            <button
              type="button"
              onClick={onBack}
              className="rounded-full border-2 border-paper-edge px-4 py-1.5 font-display text-[10px] tracking-widest transition hover:border-ink/40"
            >
              ← BACK
            </button>
          )}
          {!last && (
            <button
              type="button"
              onClick={onSkip}
              className="ml-auto rounded-full border-2 border-paper-edge px-3 py-1.5 font-display text-[10px] tracking-widest opacity-70 transition hover:border-ink/40"
            >
              SKIP TOUR
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
