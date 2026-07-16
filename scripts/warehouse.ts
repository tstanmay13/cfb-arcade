// Shared warehouse access for the bake scripts (ADR-0025): every bake reads
// the platform repo's cfb.db directly via node:sqlite — read-only, owner-side,
// zero credentials. The default path assumes the standard sibling checkout;
// CFB_DB_PATH (the same env var the platform repo uses) points anywhere else.
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";

const HERE = dirname(fileURLToPath(import.meta.url));

export const CFB_DB_PATH =
  process.env.CFB_DB_PATH ?? join(HERE, "..", "..", "cfb", "cfb.db");

export function openWarehouse(): DatabaseSync {
  if (!existsSync(CFB_DB_PATH)) {
    throw new Error(
      `warehouse not found at ${CFB_DB_PATH} — restore it in the platform repo ` +
        "(`node --no-warnings src/cli.ts restore`, needs the R2_* creds) or set " +
        "CFB_DB_PATH to an existing cfb.db.",
    );
  }
  return new DatabaseSync(CFB_DB_PATH, { readOnly: true });
}

/** One "?" per value — every user-adjacent string (team names, athlete ids)
    is bound, never spliced into the SQL. */
export const placeholders = (n: number) =>
  `(${Array.from({ length: n }, () => "?").join(",")})`;
