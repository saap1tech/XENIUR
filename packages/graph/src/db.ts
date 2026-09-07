import Database from "better-sqlite3";
import type { Database as Db } from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { MIGRATIONS } from "./schema.js";

export type { Db };

/** Opens (or creates) the graph database and brings it to the latest schema version. */
export function openDatabase(path: string): Db {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  migrate(db);
  return db;
}

function migrate(db: Db): void {
  db.exec(`CREATE TABLE IF NOT EXISTS migrations (
    version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at INTEGER NOT NULL)`);

  const applied = new Set(
    db.prepare(`SELECT version FROM migrations`).all().map((r) => (r as { version: number }).version),
  );
  const pending = MIGRATIONS.filter((m) => !applied.has(m.version));
  if (pending.length === 0) return;

  // Foreign keys go OFF for the duration, and it is not optional: a migration that
  // rebuilds a parent table has to DROP it, and with enforcement on, ON DELETE CASCADE
  // would take every child row with it — representations, versions, the lot. SQLite
  // refuses to change this pragma inside a transaction, so it is toggled around them.
  db.pragma("foreign_keys = OFF");
  try {
    for (const m of pending) {
      // One transaction per migration: a half-applied schema is worse than none.
      db.transaction(() => {
        db.exec(m.sql);
        db.prepare(`INSERT INTO migrations (version, name, applied_at) VALUES (?, ?, ?)`)
          .run(m.version, m.name, Date.now());
      })();
    }
  } finally {
    db.pragma("foreign_keys = ON");
  }

  // With enforcement off, a bad migration can leave dangling references behind quietly.
  // Refuse to hand back a database that is already inconsistent.
  const violations = db.pragma("foreign_key_check") as unknown[];
  if (violations.length > 0) {
    throw new Error(
      `migration left ${violations.length} foreign key violation(s): ` +
      `${JSON.stringify(violations.slice(0, 3))}`,
    );
  }
}

export const json = {
  parse<T>(text: string | null, fallback: T): T {
    if (text === null || text === "") return fallback;
    try { return JSON.parse(text) as T; } catch { return fallback; }
  },
  stringify(value: unknown): string { return JSON.stringify(value ?? null); },
};
