/**
 * Applies every migration to a copy of a real database and reports the result.
 *
 *   npx tsx scripts/migrate-check.ts /path/to/copy.db
 *
 * Run against a *copy* — the point is to find out what a migration does to real rows before
 * it touches the rows a person cares about.
 */
import { ObjectGraph } from "@xeniur/graph";
const db = process.argv[2];
if (!db) { console.error("usage: migrate-check <copy-of-database.db>"); process.exit(2); }
const g = ObjectGraph.open({ dbPath: db, blobDir: "/tmp/xeniur-migrate-check-blobs" });
const q = (sql: string) => g.db.prepare(sql).all();
console.log("schema version:", q(`SELECT MAX(version) v FROM migrations`));
console.log("tables:", (q(`SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name`) as Array<{name:string}>).length);
console.log("fk violations:", g.db.pragma("foreign_key_check"));
g.close();
