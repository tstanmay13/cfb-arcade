// Dynasty persistence (ADR-0023: first cabinet with saves). One Dexie DB,
// rows keyed by slot: a full-state snapshot per dynasty + an append-only
// archive of departed players (career stats kept forever — the history
// screens read these; CFB_GM_DESIGN "History"). Engines never import this.

import Dexie, { type EntityTable } from "dexie";
import type { ArchivedPlayer, DynastyState } from "./engine/types.ts";
import { migrateDynasty } from "./migrate.ts";

export interface SlotRow {
  id: number;
  school: string;
  season: number;
  year: number;
  record: string;
  updated: number;
}

interface SnapshotRow {
  slotId: number;
  state: DynastyState;
}

export interface ArchiveRow {
  id: number;
  slotId: number;
  season: number;
  player: ArchivedPlayer;
}

const db = new Dexie("cfbgm") as Dexie & {
  slots: EntityTable<SlotRow, "id">;
  snapshots: EntityTable<SnapshotRow, "slotId">;
  archive: EntityTable<ArchiveRow, "id">;
};

db.version(1).stores({
  slots: "++id, updated",
  snapshots: "slotId",
  archive: "++id, slotId",
});

function slotMeta(state: DynastyState): Omit<SlotRow, "id"> {
  const team = state.teams[state.userTid];
  return {
    school: team.school,
    season: state.season,
    year: state.year,
    record: `${team.rec.w}-${team.rec.l}`,
    updated: Date.now(),
  };
}

export async function listSlots(): Promise<SlotRow[]> {
  const rows = await db.slots.toArray();
  return rows.sort((a, b) => b.updated - a.updated);
}

export async function createSlot(state: DynastyState): Promise<number> {
  return db.transaction("rw", db.slots, db.snapshots, async () => {
    const id = (await db.slots.add(slotMeta(state) as SlotRow)) as number;
    await db.snapshots.put({ slotId: id, state });
    return id;
  });
}

/** Autosave: snapshot the state and append any newly departed players. */
export async function saveDynasty(
  slotId: number,
  state: DynastyState,
  departed?: ArchivedPlayer[],
): Promise<void> {
  await db.transaction("rw", db.slots, db.snapshots, db.archive, async () => {
    await db.slots.update(slotId, slotMeta(state));
    await db.snapshots.put({ slotId, state });
    if (departed?.length) {
      await db.archive.bulkAdd(
        departed.map((player) => ({ slotId, season: state.season, player }) as ArchiveRow),
      );
    }
  });
}

export async function loadDynasty(slotId: number): Promise<DynastyState | null> {
  const row = await db.snapshots.get(slotId);
  return row?.state ? migrateDynasty(row.state) : null;
}

export async function deleteSlot(slotId: number): Promise<void> {
  await db.transaction("rw", db.slots, db.snapshots, db.archive, async () => {
    await db.slots.delete(slotId);
    await db.snapshots.delete(slotId);
    await db.archive.where("slotId").equals(slotId).delete();
  });
}

export async function archiveFor(slotId: number): Promise<ArchiveRow[]> {
  return db.archive.where("slotId").equals(slotId).toArray();
}

// --- Export / import (the backup story) -------------------------------------

interface ExportFile {
  kind: "cfbgm-dynasty";
  version: 1;
  state: DynastyState;
  archive: { season: number; player: ArchivedPlayer }[];
}

export async function exportDynasty(slotId: number): Promise<string> {
  const state = await loadDynasty(slotId);
  if (!state) throw new Error("No such dynasty");
  const archive = (await archiveFor(slotId)).map((r) => ({ season: r.season, player: r.player }));
  const file: ExportFile = { kind: "cfbgm-dynasty", version: 1, state, archive };
  return JSON.stringify(file);
}

export async function importDynasty(json: string): Promise<number> {
  let file: ExportFile;
  try {
    file = JSON.parse(json) as ExportFile;
  } catch {
    throw new Error("Not valid JSON");
  }
  if (file.kind !== "cfbgm-dynasty" || file.version !== 1 || !file.state?.teams?.length) {
    throw new Error("Not a CFB-GM dynasty export");
  }
  return db.transaction("rw", db.slots, db.snapshots, db.archive, async () => {
    const state = migrateDynasty(file.state); // old exports predate the save rework
    const id = (await db.slots.add(slotMeta(state) as SlotRow)) as number;
    await db.snapshots.put({ slotId: id, state });
    if (file.archive?.length) {
      await db.archive.bulkAdd(
        file.archive.map((a) => ({ slotId: id, season: a.season, player: a.player }) as ArchiveRow),
      );
    }
    return id;
  });
}
