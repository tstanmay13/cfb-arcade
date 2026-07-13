// CFB-GM shared types — baked data (scripts/build-gm.ts → public/gm-data.json)
// and the runtime dynasty state. Plain type-strippable TS (no enums), shared by
// the app AND the bake script like the draft cabinet's types.ts.

// ---------------------------------------------------------------------------
// Baked reference data (the Supabase seam, read-only)
// ---------------------------------------------------------------------------

export type PosGroup =
  | "QB" | "RB" | "WR" | "TE" | "OL"
  | "DL" | "LB" | "CB" | "S" | "K" | "P";

export interface GmTeam {
  id: number;
  school: string;
  mascot: string | null;
  /** Conference name; "FCS" for generic buy-game shells. */
  conference: string;
  /** Full-sim P4 program (rosters, recruiting) vs shell opponent. */
  p4: boolean;
  color: string | null;
  altColor: string | null;
  /** Preseason 2026 Elo (from real 2025 results, regressed). */
  elo: number;
  /** 1..6 stars for P4 (from Elo percentile); 0 for shells. */
  prestige: number;
}

/** Compact baked player seed — expanded into a full Player at dynasty creation. */
export interface GmPlayerSeed {
  /** Team id. */
  t: number;
  /** Display name. */
  n: string;
  /** Granular position label (QB, EDGE, OT, FS, ...). */
  p: string;
  /** Engine position group. */
  g: PosGroup;
  /** Projected 2026 overall, 40..99. */
  o: number;
  /** Class: 1 FR .. 4 SR. */
  c: number;
}

export interface GmSchedGame {
  w: number;
  h: number;
  a: number;
}

export interface GmData {
  version: number;
  season: number;
  teams: GmTeam[];
  players: GmPlayerSeed[];
  /** Real regular-season schedule for `season`, P4-involved games only. */
  schedule: GmSchedGame[];
}

// ---------------------------------------------------------------------------
// Runtime dynasty state
// ---------------------------------------------------------------------------

export interface SeasonStats {
  gp: number;
  paYd: number; paTD: number; paInt: number; paAtt: number; paCmp: number;
  ruYd: number; ruTD: number; ruAtt: number;
  rec: number; reYd: number; reTD: number;
  tkl: number; sck: number; int: number;
  fgm: number; fga: number;
}

export interface CareerLine extends SeasonStats {
  season: number;
  cls: number;
  ovr: number;
}

/** Visible development tier (hidden dev rating band). 0 Normal .. 3 Elite. */
export type DevTier = 0 | 1 | 2 | 3;

export interface Player {
  id: number;
  name: string;
  pos: string;
  g: PosGroup;
  cls: number;
  ovr: number;
  /** Compact core attributes — the ONLY simulation input besides ovr. */
  attrs: Record<string, number>;
  /** Hidden dev rating 1..100 (drives growth speed). */
  dev: number;
  devTier: DevTier;
  /** Hidden potential ceiling (ovr this player grows toward). */
  ceil: number;
  /** Recruiting stars 2..5 (derived for real imports). */
  stars: number;
  /** Per-player seed: EA-sheet expansion, hidden rolls. */
  seed: number;
  /** Weeks remaining out injured (0 = healthy). */
  inj: number;
  stats: SeasonStats;
  career: CareerLine[];
}

export interface TeamSeason {
  w: number;
  l: number;
  cw: number;
  cl: number;
  /** Points for/against (display + tiebreaks). */
  pf: number;
  pa: number;
}

export interface Team extends GmTeam {
  /** Player ids (P4 teams only; shells have none). */
  roster: number[];
  rec: TeamSeason;
}

export type GameKind =
  | "reg" | "ccg" | "cfp-r1" | "cfp-qf" | "cfp-sf" | "cfp-nc" | "bowl";

export interface SchedGame {
  id: number;
  week: number;
  kind: GameKind;
  home: number;
  away: number;
  /** Bowl/round label for postseason games. */
  name?: string;
  /** Conference-game flag (standings). */
  conf?: boolean;
}

export interface DriveLine {
  /** Offense team id. */
  t: number;
  q: number;
  /** Outcome: TD | FG | FGX | PUNT | TO | DOWNS | HALF | OT. */
  r: string;
  /** Net yards. */
  y: number;
  /** One-line description for the drive log. */
  d: string;
}

export interface BoxLine {
  pid: number;
  name: string;
  pos: string;
  t: number;
  line: string;
}

export interface GameResult {
  gid: number;
  week: number;
  kind: GameKind;
  home: number;
  away: number;
  hs: number;
  as: number;
  ot: number;
  name?: string;
  /** Drive log + box score kept only for user-team games (state weight). */
  drives?: DriveLine[];
  box?: BoxLine[];
  /** Headline performer line, all games. */
  star?: string;
}

export interface PollEntry {
  tid: number;
  /** Previous week's rank, 0 = unranked. */
  prev: number;
}

export interface NewsItem {
  season: number;
  week: number;
  text: string;
}

export interface CfpState {
  /** Seeded field, ids in seed order (1..12). */
  field: number[];
  /** Round results accumulate here for the bracket UI. */
  results: GameResult[];
  champion: number | null;
}

export interface SeasonHonors {
  season: number;
  champion: number | null;
  /** Player of the year: name + line (player may since have departed). */
  poy: string | null;
  userRecord: string;
  userPollRank: number | null;
}

export type Phase = "regular" | "ccg" | "cfp" | "offseason";

export interface DepartureLine {
  name: string;
  pos: string;
  ovr: number;
  reason: "graduated" | "nfl-draft" | "transfer-down" | "cut";
}

/** Full career record archived to the history store when a player departs. */
export interface ArchivedPlayer {
  name: string;
  pos: string;
  ovr: number;
  stars: number;
  cls: number;
  tid: number;
  reason: DepartureLine["reason"];
  career: CareerLine[];
}

export interface OffseasonReport {
  season: number;
  departures: DepartureLine[];
  /** Departed players with careers — consumed by the history store, not kept in state. */
  archive: ArchivedPlayer[];
  /** Incoming class, user team. */
  signees: { name: string; pos: string; stars: number; ovr: number }[];
  /** Biggest riser lines, user team. */
  risers: { name: string; pos: string; from: number; to: number }[];
  prestigeChanges: { school: string; from: number; to: number }[];
  classRank: number;
}

export interface DynastyState {
  v: number;
  seed: number;
  /** Dynasty year, 1-based. */
  year: number;
  season: number;
  /** Next week to simulate (regular season). */
  week: number;
  phase: Phase;
  userTid: number;
  teams: Team[];
  players: Record<number, Player>;
  nextPid: number;
  nextGid: number;
  schedule: SchedGame[];
  results: GameResult[];
  poll: PollEntry[];
  cfp: CfpState | null;
  news: NewsItem[];
  honors: SeasonHonors[];
  offseason: OffseasonReport | null;
}
