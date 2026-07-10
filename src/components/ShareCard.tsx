// Share/export (§10): a hidden, fixed-dimension (1080×1350) node rendered
// off-screen and rasterized by html2canvas on demand.
//
// IMPORTANT: everything here is inline-styled with plain hex colors —
// html2canvas can't parse the oklch()/color-mix() values Tailwind v4 emits,
// and a fixed pixel canvas shouldn't inherit responsive classes anyway.
import { forwardRef } from "react";
import type { Coach, Player, SlotId } from "../data/types.ts";
import { PLAYER_SLOTS } from "../data/types.ts";
import type { Resolved } from "../engine/resolve.ts";
import type { Mode } from "../state/store.tsx";

const INK = "#1b2a41";
const PAPER = "#faf6ec";
const GOLD = "#c9a227";
const GOLD_LIGHT = "#f3d97a";

export interface ShareCardProps {
  slots: Record<Exclude<SlotId, "HC">, Player | null>;
  hc: Coach | null;
  resolved: Resolved;
  mode: Mode;
  teamHex: string;
}

const BANNER: Record<string, string> = {
  natty: "NATIONAL CHAMPIONS",
  semis: "NATIONAL SEMIFINALISTS",
  major: "PLAYOFF QUARTERFINALISTS",
  minor: "WON THE BOWL, MISSED THE DANCE",
  loss: "REBUILDING YEAR",
};

const ShareCard = forwardRef<HTMLDivElement, ShareCardProps>(function ShareCard(
  { slots, hc, resolved, mode, teamHex },
  ref,
) {
  const scoutVerified =
    mode === "Scout" && (resolved.tier === "Tier0" || resolved.tier === "Tier1");
  const display = "Graduate, 'Arial Narrow', serif";
  const body = "'Archivo Variable', Archivo, system-ui, sans-serif";

  const line = (slot: Exclude<SlotId, "HC">) => {
    const p = slots[slot];
    if (!p) return null;
    return (
      <p
        key={slot}
        style={{
          margin: "0 0 18px",
          fontSize: 28,
          fontFamily: body,
          whiteSpace: "nowrap",
          overflow: "hidden",
          textOverflow: "ellipsis",
        }}
      >
        <span style={{ fontFamily: display, fontSize: 22, opacity: 0.55, display: "inline-block", width: 88 }}>
          {slot}
        </span>
        <strong>{p.display_short}</strong>
        <span style={{ opacity: 0.6 }}> · {p.school}</span>
        {resolved.allAmericans.includes(p.player_id) && (
          <span style={{ color: GOLD, fontSize: 22 }}> ★</span>
        )}
      </p>
    );
  };

  return (
    <div
      ref={ref}
      style={{
        position: "fixed",
        left: -20000,
        top: 0,
        width: 1080,
        height: 1350,
        background: scoutVerified
          ? `linear-gradient(135deg, ${GOLD} 0%, ${GOLD_LIGHT} 25%, ${GOLD} 50%, ${GOLD_LIGHT} 75%, ${GOLD} 100%)`
          : INK,
        padding: 18,
        boxSizing: "border-box",
        color: INK,
        fontFamily: body,
      }}
      aria-hidden
    >
      <div
        style={{
          background: PAPER,
          height: "100%",
          boxSizing: "border-box",
          padding: "52px 64px",
          display: "flex",
          flexDirection: "column",
          borderTop: `18px solid ${teamHex}`,
        }}
      >
        <p style={{ fontFamily: display, fontSize: 52, letterSpacing: 8, margin: 0, textAlign: "center" }}>
          THE 16-0 DRAFT
        </p>

        {/* Stat bar */}
        <div
          style={{
            display: "flex",
            justifyContent: "space-around",
            border: `4px solid ${INK}`,
            borderRadius: 12,
            padding: "18px 12px",
            margin: "34px 0 0",
            background: "#ffffff",
          }}
        >
          {[
            ["RECORD", resolved.record],
            ["TEAM OVR", String(Math.round(resolved.power))],
            ["MODE", mode.toUpperCase()],
          ].map(([label, value]) => (
            <div key={label} style={{ textAlign: "center" }}>
              <p style={{ fontFamily: display, fontSize: 64, margin: 0 }}>{value}</p>
              <p style={{ fontSize: 20, letterSpacing: 4, margin: 0, opacity: 0.55 }}>{label}</p>
            </div>
          ))}
        </div>

        {/* Banner */}
        {resolved.isDynasty && (
          <p
            style={{
              alignSelf: "center",
              margin: "30px 0 0",
              background: GOLD,
              color: "#ffffff",
              fontFamily: display,
              fontSize: 28,
              letterSpacing: 8,
              padding: "10px 34px",
              borderRadius: 999,
            }}
          >
            ★ DYNASTY ★
          </p>
        )}
        <p
          style={{
            fontFamily: display,
            fontSize: 46,
            textAlign: "center",
            margin: resolved.isDynasty ? "14px 0 0" : "34px 0 0",
            color: resolved.outcome === "natty" ? teamHex : INK,
          }}
        >
          {BANNER[resolved.outcome]}
        </p>

        {/* Roster */}
        <div style={{ display: "flex", gap: 48, marginTop: 44, flex: 1 }}>
          <div style={{ flex: 1 }}>{PLAYER_SLOTS.slice(0, 4).map(line)}</div>
          <div style={{ flex: 1 }}>{PLAYER_SLOTS.slice(4).map(line)}</div>
        </div>

        {/* Coach + awards */}
        <div style={{ borderTop: `3px solid ${INK}22`, paddingTop: 26 }}>
          <p style={{ fontSize: 30, margin: 0 }}>
            <span style={{ fontFamily: display, fontSize: 24, opacity: 0.55, display: "inline-block", width: 130 }}>
              COACH
            </span>
            <strong>{hc?.display_short}</strong>
            <span style={{ opacity: 0.6 }}> · {hc?.school}</span>
          </p>
          <p style={{ fontSize: 26, margin: "14px 0 0", opacity: 0.85 }}>
            Heisman: <strong>{resolved.heisman ? resolved.heisman.name : "none"}</strong>
            {"   ·   "}All-Americans: <strong>{resolved.allAmericans.length}</strong>
          </p>
        </div>

        {/* Footer */}
        <div
          style={{
            marginTop: 30,
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            background: INK,
            color: PAPER,
            borderRadius: 10,
            padding: "16px 26px",
          }}
        >
          <span style={{ fontFamily: display, fontSize: 24, letterSpacing: 4 }}>THE-16-0-DRAFT</span>
          {scoutVerified && (
            <span
              style={{
                fontFamily: display,
                fontSize: 22,
                letterSpacing: 3,
                color: GOLD_LIGHT,
                border: `2px solid ${GOLD_LIGHT}`,
                borderRadius: 999,
                padding: "6px 18px",
              }}
            >
              ✓ SCOUT VERIFIED
            </span>
          )}
        </div>
      </div>
    </div>
  );
});

export default ShareCard;
