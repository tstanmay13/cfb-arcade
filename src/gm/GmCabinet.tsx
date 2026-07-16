// CFB-GM (arcade cabinet #3, ADR-0023): a real-2026 college football dynasty
// sim. This is the cabinet entry — dynasty slots + team pick; the in-dynasty
// experience lives in GmShell. Rendered OUTSIDE GameProvider; lazy-loaded so
// the dailies never pay for it.
import { useEffect, useRef, useState } from "react";
import type { GmData } from "./engine/types.ts";
import { GM_ANCHOR_YEAR, GM_START_YEARS, loadGmData } from "./loadGmData.ts";
import { createDynasty } from "./engine/dynasty.ts";
import { newSeed } from "../engine/rng.ts";
import {
  createSlot, deleteSlot, exportDynasty, importDynasty, listSlots, loadDynasty, type SlotRow,
} from "./db.ts";
import GmShell from "./GmShell.tsx";
import { getTeamColors } from "./theme.ts";
import { TeamMark } from "./ui.tsx";

type Stage =
  | { k: "slots" }
  | { k: "pick" }
  | { k: "play"; slotId: number };

export default function GmCabinet({ onBack }: { onBack: () => void }) {
  const [data, setData] = useState<GmData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [slots, setSlots] = useState<SlotRow[] | null>(null);
  const [stage, setStage] = useState<Stage>({ k: "slots" });
  // Historical starts (M0.2): the pick screen can load any supported year.
  const [pickYear, setPickYear] = useState(GM_ANCHOR_YEAR);
  const [yearData, setYearData] = useState<Map<number, GmData>>(new Map());
  const fileRef = useRef<HTMLInputElement>(null);

  const refreshSlots = () => listSlots().then(setSlots, (e) => setError(String(e)));

  useEffect(() => {
    loadGmData().then(
      (d) => {
        setData(d);
        setYearData((m) => new Map(m).set(GM_ANCHOR_YEAR, d));
      },
      (e) => setError(String(e)),
    );
    refreshSlots();
  }, []);

  const pickData = yearData.get(pickYear) ?? null;
  useEffect(() => {
    if (yearData.has(pickYear)) return;
    let stale = false;
    loadGmData(pickYear).then(
      (d) => {
        if (!stale) setYearData((m) => new Map(m).set(pickYear, d));
      },
      (e) => setError(String(e)),
    );
    return () => {
      stale = true;
    };
  }, [pickYear, yearData]);

  if (error) {
    return (
      <Shell onBack={onBack}>
        <p className="mt-10 text-center text-sm">
          Couldn't load the dynasty universe. Re-bake it with{" "}
          <code className="rounded bg-ink/10 px-1">npm run build:gm</code> and reload.
        </p>
        <p className="mt-2 text-center text-xs opacity-60">{error}</p>
      </Shell>
    );
  }
  if (!data || !slots) {
    return (
      <Shell onBack={onBack}>
        <p className="mt-16 text-center font-display tracking-widest">LOADING THE UNIVERSE…</p>
      </Shell>
    );
  }

  if (stage.k === "play") {
    return (
      <GmShell
        slotId={stage.slotId}
        onExit={() => {
          refreshSlots();
          setStage({ k: "slots" });
        }}
      />
    );
  }

  if (stage.k === "pick") {
    return (
      <Shell onBack={() => setStage({ k: "slots" })}>
        <YearPick year={pickYear} onYear={setPickYear} />
        {pickData ? (
          <TeamPick
            data={pickData}
            onPick={async (tid, difficulty) => {
              const state = createDynasty(pickData, tid, newSeed(), difficulty);
              const slotId = await createSlot(state);
              setStage({ k: "play", slotId });
            }}
          />
        ) : (
          <p className="mt-10 text-center font-display tracking-widest">LOADING {pickYear}…</p>
        )}
      </Shell>
    );
  }

  return (
    <Shell onBack={onBack}>
      <header className="text-center">
        <p className="font-display text-sm tracking-[0.35em] text-team">RECRUIT · DEVELOP · REPEAT</p>
        <h1 className="mt-2 font-display text-5xl leading-tight">CFB-GM</h1>
        <p className="mx-auto mt-3 max-w-md text-sm opacity-75">
          Run a real 2026 Power-4 program: sim the real slate, chase the 12-team
          Playoff, and rebuild through recruiting — for as many seasons as you can hold on.
        </p>
      </header>

      <section className="mx-auto mt-8 w-full max-w-lg">
        <h2 className="mb-3 text-center font-display text-lg tracking-widest">YOUR DYNASTIES</h2>
        {slots.length === 0 && (
          <p className="text-center text-sm opacity-60">No saves yet. Start one below.</p>
        )}
        <ul className="space-y-2">
          {slots.map((s) => (
            <li
              key={s.id}
              className="flex items-center justify-between rounded-md border-2 border-paper-edge bg-white/50 px-4 py-3"
            >
              <div>
                <span className="font-display">{s.school}</span>
                <span className="ml-2 text-xs opacity-70">
                  Year {s.year} · {s.season} season · {s.record}
                </span>
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  className="rounded-full border-2 border-ink bg-ink px-4 py-1 font-display text-xs tracking-widest text-paper transition hover:opacity-85"
                  onClick={async () => {
                    if (await loadDynasty(s.id)) setStage({ k: "play", slotId: s.id });
                  }}
                >
                  CONTINUE
                </button>
                <button
                  type="button"
                  className="rounded-full border-2 border-paper-edge px-3 py-1 text-xs transition hover:border-ink/40"
                  onClick={async () => {
                    const json = await exportDynasty(s.id);
                    const url = URL.createObjectURL(new Blob([json], { type: "application/json" }));
                    const a = document.createElement("a");
                    a.href = url;
                    a.download = `cfbgm-${s.school.toLowerCase().replace(/\W+/g, "-")}-y${s.year}.json`;
                    a.click();
                    URL.revokeObjectURL(url);
                  }}
                >
                  Export
                </button>
                <button
                  type="button"
                  className="rounded-full border-2 border-paper-edge px-3 py-1 text-xs text-red-800 transition hover:border-red-800/60"
                  onClick={async () => {
                    if (window.confirm(`Delete the ${s.school} dynasty? This can't be undone.`)) {
                      await deleteSlot(s.id);
                      refreshSlots();
                    }
                  }}
                >
                  Delete
                </button>
              </div>
            </li>
          ))}
        </ul>

        <div className="mt-6 flex items-center justify-center gap-3">
          <button
            type="button"
            className="rounded-full border-2 border-ink bg-ink px-6 py-2 font-display text-sm tracking-widest text-paper transition hover:opacity-85"
            onClick={() => setStage({ k: "pick" })}
          >
            NEW DYNASTY
          </button>
          <button
            type="button"
            className="rounded-full border-2 border-paper-edge px-5 py-2 font-display text-xs tracking-widest transition hover:border-ink/40"
            onClick={() => fileRef.current?.click()}
          >
            IMPORT SAVE
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="application/json"
            className="hidden"
            onChange={async (e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (!file) return;
              try {
                const slotId = await importDynasty(await file.text());
                refreshSlots();
                setStage({ k: "play", slotId });
              } catch (err) {
                window.alert(String(err));
              }
            }}
          />
        </div>
      </section>
    </Shell>
  );
}

function Shell({ children, onBack }: { children: React.ReactNode; onBack: () => void }) {
  return (
    <main className="mx-auto min-h-screen max-w-4xl p-6">
      <button
        type="button"
        onClick={onBack}
        className="rounded-full border-2 border-paper-edge px-4 py-1 font-display text-xs tracking-[0.2em] transition hover:border-ink/40"
      >
        ← ARCADE
      </button>
      {children}
    </main>
  );
}

/** Start-year selector (M0.2): any season 2010–2026 except 2023. */
function YearPick({ year, onYear }: { year: number; onYear: (y: number) => void }) {
  return (
    <div className="mt-6 flex flex-wrap items-center justify-center gap-2">
      <span className="font-display text-xs tracking-[0.25em] opacity-70">START YEAR</span>
      <select
        value={year}
        onChange={(e) => onYear(Number(e.target.value))}
        className="rounded-md border-2 border-paper-edge bg-white/60 px-2 py-1 font-display text-sm"
      >
        {GM_START_YEARS.map((y) => (
          <option key={y} value={y}>
            {y}{y === GM_ANCHOR_YEAR ? " (current)" : ""}
          </option>
        ))}
      </select>
      {year !== GM_ANCHOR_YEAR && (
        <span className="text-[11px] opacity-60">
          era-correct rosters &amp; conferences · realignment arrives in year 2
        </span>
      )}
    </div>
  );
}

function TeamPick({
  data,
  onPick,
}: {
  data: GmData;
  onPick: (tid: number, difficulty: number) => void;
}) {
  // Conference groups from the data itself — era conferences for 2010+ starts.
  const confs = [...new Set(data.teams.filter((t) => t.p4).map((t) => t.conference))].sort(
    (a, b) => {
      const PRIORITY = ["SEC", "Big Ten", "Big 12", "ACC"];
      const [ia, ib] = [PRIORITY.indexOf(a), PRIORITY.indexOf(b)];
      return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || a.localeCompare(b);
    },
  );
  const [difficulty, setDifficulty] = useState(0);
  return (
    <section className="mt-6">
      <h2 className="mb-1 text-center font-display text-2xl tracking-widest">PICK YOUR PROGRAM</h2>
      <p className="mb-3 text-center text-xs opacity-70">
        Real {data.season} rosters &amp; schedule{data.season === GM_ANCHOR_YEAR ? ", projected ratings" : ""}.
        Prestige ★ sets your recruiting gravity.
      </p>
      <div className="mb-6 flex items-center justify-center gap-2">
        {["NORMAL", "HARD", "BRUTAL"].map((label, i) => (
          <button
            key={label}
            type="button"
            onClick={() => setDifficulty(i)}
            aria-pressed={difficulty === i}
            title={
              i === 0
                ? "Everyone plays by the same rules"
                : i === 1
                  ? "AI staffs recruit and bid 15% sharper; your NIL pool shrinks 15%"
                  : "AI +30%, your pool −30%, boosters demand an extra win"
            }
            className={`rounded-full border-2 px-4 py-1 font-display text-xs tracking-widest transition ${
              difficulty === i ? "border-ink bg-ink text-paper" : "border-paper-edge hover:border-ink/40"
            }`}
          >
            {label}
          </button>
        ))}
      </div>
      {confs.map((conf) => {
        const members = data.teams.filter((t) => t.p4 && t.conference === conf);
        if (!members.length) return null;
        return (
          <div key={conf} className="mb-6">
            <h3 className="mb-2 font-display text-sm tracking-[0.25em] opacity-70">{conf.toUpperCase()}</h3>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4">
              {members.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => onPick(t.id, difficulty)}
                  className="flex items-center gap-2 rounded-md border-2 border-paper-edge bg-white/50 px-2 py-2 text-left transition hover:border-ink/60 hover:shadow"
                  style={{ borderLeftWidth: 8, borderLeftColor: getTeamColors(t).primary }}
                >
                  <TeamMark team={t} size="m" />
                  <span className="min-w-0">
                    <span className="block truncate font-display text-sm">{t.school}</span>
                    <span className="block text-[10px] uppercase tracking-wide opacity-60">
                      {"★".repeat(t.prestige)} · Elo {t.elo}
                    </span>
                  </span>
                </button>
              ))}
            </div>
          </div>
        );
      })}
    </section>
  );
}
