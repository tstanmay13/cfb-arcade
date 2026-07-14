// CFB-GM shared presentational primitives (V0). Every dynasty module is built
// from these so the whole cabinet reads as one system: a titled Card surface,
// section labels, a status ramp, meters, and team-colored school names.
// No engine logic here — pure presentation over data the panels already hold.
import type { ReactNode } from "react";
import type { GmTeam } from "./engine/types.ts";
import { getTeamColors } from "./theme.ts";

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

/**
 * A school name rendered in its own program color. Bold when it's the leader /
 * user's team — this is the reusable "leader" emphasis (V0.4). `rank` prefixes
 * an AP number when present.
 */
export function TeamName({
  team,
  rank,
  lead = false,
  className = "",
}: {
  team: GmTeam;
  rank?: number;
  lead?: boolean;
  className?: string;
}) {
  const c = getTeamColors(team);
  return (
    <span className={className} style={{ color: c.ink, fontWeight: lead ? 700 : undefined }}>
      {rank ? <span className="mr-0.5 tabular-nums opacity-60">#{rank}</span> : null}
      {team.school}
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
