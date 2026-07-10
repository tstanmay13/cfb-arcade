// Global run state (§2) — one reducer, one context. Engine randomness happens
// in the action creators (useGameActions) through a module-level seeded rng,
// NOT in the reducer: reducers must stay pure (React StrictMode
// double-invokes them), and event handlers run exactly once.
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  type Dispatch,
  type ReactNode,
} from "react";
import type { Coach, GameData, Player, SlotId, Team } from "../data/types.ts";
import { mulberry32, newSeed, type Rng } from "../engine/rng.ts";
import {
  allPlayerSlotsFilled,
  emptyPlayerSlots,
  eraRespin,
  expandedFallbackSpin,
  isPoolUsable,
  spin,
  spinCoach,
  teamRespin,
  type CoachSpinResult,
  type PlayerSlots,
  type SpinResult,
} from "../engine/spin.ts";

export type Phase =
  | "BOOT"
  | "TEAM_SELECT"
  | "DRAFT"
  | "COACH_SPIN"
  | "RESULTS";

export type Mode = "Classic" | "Scout";

export interface RunState {
  phase: Phase;
  favoriteTeam: Team | null;
  mode: Mode;
  slots: PlayerSlots;
  hc: Coach | null;
  respins: { team: number; era: number };
  currentSpin: SpinResult | null;
  currentCoachSpin: CoachSpinResult | null;
  /** Player tapped on the board, awaiting a slot choice (null = none). */
  pendingPick: Player | null;
  seed: number;
  /** Bumps every spin so the ticker animation can re-key. */
  spinCounter: number;
}

export const initialRunState: RunState = {
  phase: "TEAM_SELECT",
  favoriteTeam: null,
  mode: "Classic",
  slots: emptyPlayerSlots(),
  hc: null,
  respins: { team: 2, era: 2 },
  currentSpin: null,
  currentCoachSpin: null,
  pendingPick: null,
  seed: 0,
  spinCounter: 0,
};

export type Action =
  | { type: "START_RUN"; team: Team; mode: Mode; seed: number }
  | { type: "SPIN_RESULT"; spin: SpinResult; cost?: "team" | "era" | null }
  | { type: "PICK"; player: Player }
  | { type: "CANCEL_PICK" }
  | { type: "PLACE"; player: Player; slot: Exclude<SlotId, "HC"> }
  | { type: "COACH_SPIN_RESULT"; spin: CoachSpinResult; cost?: "team" | "era" | null }
  | { type: "PLACE_COACH"; coach: Coach }
  | { type: "REPLAY" };

export function reducer(state: RunState, action: Action): RunState {
  switch (action.type) {
    case "START_RUN":
      return {
        ...initialRunState,
        phase: "DRAFT",
        favoriteTeam: action.team,
        mode: action.mode,
        seed: action.seed,
      };
    case "SPIN_RESULT": {
      const respins = { ...state.respins };
      if (action.cost) respins[action.cost] -= 1;
      return {
        ...state,
        respins,
        currentSpin: action.spin,
        pendingPick: null,
        spinCounter: state.spinCounter + 1,
      };
    }
    case "PICK":
      return { ...state, pendingPick: action.player };
    case "CANCEL_PICK":
      return { ...state, pendingPick: null };
    case "PLACE": {
      // One pick per spin (§0 decision 1): placement consumes the pool.
      const slots = { ...state.slots, [action.slot]: action.player };
      const done = allPlayerSlotsFilled(slots);
      return {
        ...state,
        slots,
        pendingPick: null,
        currentSpin: null,
        phase: done ? "COACH_SPIN" : state.phase,
      };
    }
    case "COACH_SPIN_RESULT": {
      const respins = { ...state.respins };
      if (action.cost) respins[action.cost] -= 1;
      return {
        ...state,
        respins,
        currentCoachSpin: action.spin,
        spinCounter: state.spinCounter + 1,
      };
    }
    case "PLACE_COACH":
      return { ...state, hc: action.coach, phase: "RESULTS" };
    case "REPLAY":
      return { ...initialRunState, favoriteTeam: state.favoriteTeam };
    default:
      return state;
  }
}

// ---------------------------------------------------------------------------
// Context plumbing
// ---------------------------------------------------------------------------
interface Store {
  state: RunState;
  dispatch: Dispatch<Action>;
  data: GameData;
  rng: Rng;
}

const StoreContext = createContext<Store | null>(null);

// One rng per run, seeded at START_RUN; module-level so handlers share it.
let runRng: Rng = mulberry32(1);

export function GameProvider({ data, children }: { data: GameData; children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, initialRunState);
  const store = useMemo(() => ({ state, dispatch, data, rng: runRng }), [state, data]);
  return <StoreContext.Provider value={store}>{children}</StoreContext.Provider>;
}

export function useGame(): Store {
  const store = useContext(StoreContext);
  if (!store) throw new Error("useGame outside GameProvider");
  return store;
}

/** Team theming (§8.2) — injects the chosen program's colors into CSS vars. */
export function applyTeamTheme(team: Team | null): void {
  const r = document.documentElement.style;
  if (!team) return;
  r.setProperty("--primary-color", team.mainHex);
  r.setProperty("--secondary-color", team.accentHex);
  r.setProperty(
    "--bg-stadium-glow",
    `radial-gradient(circle at 50% 0%, ${team.mainHex}22 0%, #faf6ec 65%)`,
  );
}

export function useTeamTheme(team: Team | null): void {
  useEffect(() => applyTeamTheme(team), [team]);
}

// ---------------------------------------------------------------------------
// Action creators — the only place engine rng is consumed.
// ---------------------------------------------------------------------------
export function useGameActions() {
  const { state, dispatch, data } = useGame();

  const startRun = (team: Team, mode: Mode) => {
    const seed = newSeed();
    runRng = mulberry32(seed);
    dispatch({ type: "START_RUN", team, mode, seed });
    dispatch({ type: "SPIN_RESULT", spin: spin(data, runRng, {}) });
  };

  const doSpin = () => {
    // Fresh spin between picks is free only via the §5.6 dead-pool path; the
    // primary flow is: spin once, pick, spin again. A new SPIN after placing
    // costs nothing (it's the next of the 8 draft spins).
    dispatch({ type: "SPIN_RESULT", spin: spin(data, runRng, { exclude: state.currentSpin }) });
  };

  const doTeamRespin = () => {
    if (state.respins.team <= 0) return;
    if (state.phase === "COACH_SPIN") {
      const cur = state.currentCoachSpin;
      const next = spinCoach(data, runRng, { decade: cur?.era, exclude: cur });
      if (next) dispatch({ type: "COACH_SPIN_RESULT", spin: next, cost: "team" });
      return;
    }
    if (!state.currentSpin) return;
    dispatch({
      type: "SPIN_RESULT",
      spin: teamRespin(data, runRng, state.currentSpin),
      cost: "team",
    });
  };

  const doEraRespin = () => {
    if (state.respins.era <= 0) return;
    if (state.phase === "COACH_SPIN") {
      const cur = state.currentCoachSpin;
      const next = spinCoach(data, runRng, { teamId: cur?.teamId, exclude: cur });
      if (next) dispatch({ type: "COACH_SPIN_RESULT", spin: next, cost: "era" });
      return;
    }
    if (!state.currentSpin) return;
    const next = eraRespin(data, runRng, state.currentSpin);
    if (next) dispatch({ type: "SPIN_RESULT", spin: next, cost: "era" });
  };

  /** §5.6: dead pool + no re-spins left → free expanded re-roll. */
  const doFallbackSpin = () => {
    const next = expandedFallbackSpin(data, runRng, state.slots, state.currentSpin);
    if (next) dispatch({ type: "SPIN_RESULT", spin: next });
  };

  const startCoachSpin = () => {
    const next = spinCoach(data, runRng, {});
    if (next) dispatch({ type: "COACH_SPIN_RESULT", spin: next });
  };

  /** Place a pick; when it fills the 8th slot, roll the coach spin too
      (handler-driven so StrictMode effects can't double-consume rng). */
  const placePlayer = (player: Player, slot: Exclude<SlotId, "HC">) => {
    dispatch({ type: "PLACE", player, slot });
    const filled = { ...state.slots, [slot]: player };
    if (allPlayerSlotsFilled(filled)) {
      const next = spinCoach(data, runRng, {});
      if (next) dispatch({ type: "COACH_SPIN_RESULT", spin: next });
    }
  };

  const placeCoach = (coach: Coach) => {
    dispatch({ type: "PLACE_COACH", coach });
  };

  return {
    startRun,
    doSpin,
    doTeamRespin,
    doEraRespin,
    doFallbackSpin,
    startCoachSpin,
    placePlayer,
    placeCoach,
    poolIsDead:
      state.currentSpin !== null && !isPoolUsable(state.currentSpin.pool, state.slots),
  };
}
