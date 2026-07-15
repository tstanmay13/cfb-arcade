// CFB-GM shared presentational primitives (V0 + V1 identity pass). Every
// dynasty module is built from these so the whole cabinet reads as one system:
// a titled Card surface, section labels, a status ramp, meters, and the
// TeamMark identity badge that gives every program a face.
// No engine logic here — pure presentation over data the panels already hold.
import type { ReactNode } from "react";
import type { GmTeam } from "./engine/types.ts";
import { getMarkColors, getTeamColors, monogram } from "./theme.ts";

/** Raw card class for the rare case a bespoke layout can't use <Card>. */
export const cardCls =
  "rounded-card border border-line bg-surface-raised shadow-card";

/**
 * The card primitive. A distinct raised surface with a hairline border, a soft
 * shadow, and a titled header rule — so every module is separable at a glance
 * without reading its text. `accent` paints a thin brand/status strip on top.
 */
export function Card({
  title,
  right,
  accent,
  tour,
  className = "",
  bodyClassName = "p-4",
  children,
}: {
  title?: ReactNode;
  right?: ReactNode;
  accent?: string;
  tour?: string;
  className?: string;
  bodyClassName?: string;
  children: ReactNode;
}) {
  return (
    <section data-tour={tour} className={`${cardCls} overflow-hidden ${className}`}>
      {accent && <div className="h-1 w-full" style={{ background: accent }} />}
      {title != null && (
        <header className="flex items-center justify-between gap-3 border-b border-line/70 px-4 py-2.5">
          <h3 className="font-display text-[11px] tracking-[0.22em] text-ink/55">{title}</h3>
          {right}
        </header>
      )}
      <div className={bodyClassName}>{children}</div>
    </section>
  );
}

/** Small uppercase display label for sub-sections inside a card. */
export function SectionLabel({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <h4 className={`font-display text-[10px] tracking-[0.25em] text-ink/55 ${className}`}>{children}</h4>
  );
}

export type Tone = "pos" | "neg" | "neu" | "accent";

const TONE_TEXT: Record<Tone, string> = {
  pos: "text-pos",
  neg: "text-neg",
  neu: "text-neu",
  accent: "text-accent",
};
const TONE_SOFT: Record<Tone, string> = {
  pos: "bg-pos-soft text-pos",
  neg: "bg-neg-soft text-neg",
  neu: "bg-surface-sunken text-neu",
  accent: "bg-accent-soft text-accent",
};

/** Colored text in the status ramp (win/loss, gain/loss, riser/dropper). */
export function StatusText({ tone, children, className = "" }: { tone: Tone; children: ReactNode; className?: string }) {
  return <span className={`${TONE_TEXT[tone]} ${className}`}>{children}</span>;
}

/** A soft status chip. */
export function Pill({ tone = "neu", children, className = "" }: { tone?: Tone; children: ReactNode; className?: string }) {
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold tracking-wide ${TONE_SOFT[tone]} ${className}`}>
      {children}
    </span>
  );
}

/** Poll/ranking movement indicator (▲n / ▼n / NEW / —). */
export function Delta({ prev, rank }: { prev: number; rank: number }) {
  if (prev === 0) return <StatusText tone="accent" className="font-bold">NEW</StatusText>;
  const diff = prev - rank;
  if (diff > 0) return <StatusText tone="pos">▲{diff}</StatusText>;
  if (diff < 0) return <StatusText tone="neg">▼{-diff}</StatusText>;
  return <span className="text-ink/30">—</span>;
}

/**
 * A labeled progress meter. `color` fills the bar (a team color or a token);
 * defaults to the accent. Used for commitment progress, NIL spend, stamina.
 */
export function Meter({
  value,
  max,
  color = "var(--accent)",
  track = "var(--surface-sunken)",
  height = 8,
  className = "",
}: {
  value: number;
  max: number;
  color?: string;
  track?: string;
  height?: number;
  className?: string;
}) {
  const pct = max > 0 ? Math.max(0, Math.min(100, (value / max) * 100)) : 0;
  return (
    <div
      className={`overflow-hidden rounded-full ${className}`}
      style={{ background: track, height }}
      role="progressbar"
      aria-valuenow={Math.round(pct)}
    >
      <div className="gm-meter-fill h-full rounded-full" style={{ width: `${pct}%`, background: color }} />
    </div>
  );
}

export type MarkSize = "xs" | "s" | "m" | "l" | "xl";

const MARK_SIZE: Record<MarkSize, { box: string; font: string; ring: number }> = {
  xs: { box: "h-4 w-4", font: "text-[7px]", ring: 1 },
  s: { box: "h-5 w-5", font: "text-[8px]", ring: 1.5 },
  m: { box: "h-8 w-8", font: "text-[11px]", ring: 2 },
  l: { box: "h-10 w-10", font: "text-sm", ring: 2.5 },
  xl: { box: "h-16 w-16", font: "text-2xl", ring: 3.5 },
};

/**
 * TeamMark (V1 identity pass): the generated monogram badge that gives every
 * program a visual body — primary fill, secondary ring, Graduate letters.
 * `inverse` flips to a light badge for placement ON a primary-colored slab
 * (the broadcast scoreboard). Decorative next to a written name.
 */
export function TeamMark({
  team,
  size = "m",
  inverse = false,
  className = "",
}: {
  team: GmTeam | null | undefined;
  size?: MarkSize;
  inverse?: boolean;
  className?: string;
}) {
  const s = MARK_SIZE[size];
  const mk = getMarkColors(team);
  const c = getTeamColors(team);
  const bg = inverse ? "#fffdf6" : mk.bg;
  const fg = inverse ? c.primary : mk.fg;
  const ring = inverse ? c.primary : mk.ring;
  return (
    <span
      aria-hidden
      title={team?.school}
      className={`inline-flex shrink-0 select-none items-center justify-center rounded-full font-display leading-none ${s.box} ${s.font} ${className}`}
      style={{
        background: bg,
        color: fg,
        boxShadow: `inset 0 0 0 ${s.ring}px ${ring}, 0 1px 2px rgba(27, 42, 65, 0.25)`,
      }}
    >
      {monogram(team?.school ?? "?")}
    </span>
  );
}

/**
 * A school name with its TeamMark. Color lives in the mark; the name stays
 * ink so lists of teams never read as rainbow text (V1). Bold when it's the
 * leader / user's team. `rank` prefixes an AP number; `mark={false}` drops
 * the badge for tight prose.
 */
export function TeamName({
  team,
  rank,
  lead = false,
  mark = true,
  markSize = "s",
  className = "",
}: {
  team: GmTeam;
  rank?: number;
  lead?: boolean;
  mark?: boolean;
  markSize?: MarkSize;
  className?: string;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 align-baseline ${className}`}
      style={{ fontWeight: lead ? 700 : undefined }}
    >
      {mark && <TeamMark team={team} size={markSize} />}
      <span className="min-w-0 truncate">
        {rank ? <span className="mr-0.5 tabular-nums opacity-60">#{rank}</span> : null}
        {team.school}
      </span>
    </span>
  );
}

/** A solid team-colored badge — used for portal commit destinations (V3.2). */
export function TeamBadge({ team, prefix, className = "" }: { team: GmTeam; prefix?: ReactNode; className?: string }) {
  const c = getTeamColors(team);
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-bold ${className}`}
      style={{ background: c.primary, color: c.onPrimary, boxShadow: `inset 0 0 0 1px ${c.secondary}` }}
    >
      {prefix}
      {team.school}
    </span>
  );
}
